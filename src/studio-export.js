/* A frozen shot, one serial render/compose/add loop, and one retained result. */
(function(root){
 'use strict';
 const M=root.TetraStudioModel;
 function filename(name,extension){return (name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').trim().slice(0,80)||'tetra-motion')+'.'+extension;}
 // Encoder rate control may overshoot its target slightly; the estimate gates the 64 MiB in-memory path before any frame renders.
 function estimateBytes(project){return Math.ceil(M.bitrate(project.output,project.shot.fps)*project.shot.frameCount/project.shot.fps/8*1.05)+65536;}
 // A few consecutive GPU sample passes share one fence in export; pixels are unchanged because pass order is.
 const FENCE_BATCH=4;
 // Large exports render into a private OPFS file. A file the user picks is opened only by save(),
 // after the export succeeded, so a failed or canceled export never touches, truncates or removes it.
 const TEMP_PREFIX='tetra-export-';
 const fault=(code,message)=>{const error=Error(message);error.code=code;return error;};
 function create({drainPreview=async()=>{},setOwner=()=>{},notify=()=>{},isHidden=()=>document.hidden,now=()=>performance.now(),prepare=root.TetraStudioRender.prepare,createCompositor=root.TetraStudioFX.createCompositor,probe=root.TetraStudioEncoder.probe,createSink=root.TetraStudioEncoder.createSink,maxBytes=root.TetraStudioEncoder?.MAX_BYTES,
  storage=root.navigator?.storage,locks=root.navigator?.locks,pickFile=typeof root.showSaveFilePicker==='function'?options=>root.showSaveFilePicker(options):null}={}){
  let state='idle',active=false,controller=null,submitted=0,total=0,result=null,url=null,error=null,errorCode=null,alternative=null,config=null,profile=null,paused=false,resumeWaiter=null,job=0,promise=Promise.resolve(),forcedFailure=null,saving=false,saveError=null;
  const largeOutput=()=>typeof storage?.getDirectory==='function'&&typeof storage.estimate==='function'&&typeof locks?.request==='function'&&typeof pickFile==='function';
  // The lock marks the temporary file as in use, so a sweep from another tab skips it.
  async function createTemp(extension){
   const directory=await storage.getDirectory(),name=TEMP_PREFIX+(root.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2))+'.'+extension;
   let release=null;await new Promise((resolve,reject)=>{locks.request(name,()=>new Promise(done=>{release=done;resolve();})).catch(reject);});
   try{
    const handle=await directory.getFileHandle(name,{create:true});
    return {name,handle,async remove(){
     try{await directory.removeEntry(name);}catch(reason){if(reason?.name!=='NotFoundError')throw fault('TEMP_DELETE_FAILED','Could not delete the temporary video file '+name+': '+(reason?.message||reason));}finally{release();}
    }};
   }catch(reason){release();throw reason;}
  }
  const emptyTimings=()=>({prepareMs:0,renderMs:0,fxMs:0,encodeMs:0,finalizeMs:0,cleanupMs:0});
  let timings=emptyTimings(),started=null,ended=null,suspendedAt=null,suspendedMs=0,pendingStage=null,completedFrames=0;
  function snapshot(){
   const at=ended??now(),elapsedMs=started===null?0:Math.max(0,at-started),pausedMs=suspendedMs+(suspendedAt===null?0:Math.max(0,at-suspendedAt));
   const stages={...timings};if(pendingStage)stages[pendingStage.name]+=Math.max(0,at-pendingStage.at);
   const frameMs=stages.renderMs+stages.fxMs+stages.encodeMs,fps=submitted&&frameMs>0?submitted*1000/frameMs:0;
   return {state,active,saving,saveError,submitted,completedFrames,total,result,url,error,errorCode,alternative,config,profile,job,timings:stages,elapsedMs,activeMs:Math.max(0,elapsedMs-pausedMs),suspendedMs:pausedMs,fps,etaMs:state==='rendering'&&fps>0?Math.max(0,(total-submitted)*1000/fps):null};
  }
  async function timed(name,operation){pendingStage={name,at:now()};try{return await operation();}finally{timings[name]+=Math.max(0,now()-pendingStage.at);pendingStage=null;}}
  function emit(){notify(snapshot());}
  function transition(next){const at=now();if(suspendedAt!==null&&next!=='suspended'){suspendedMs+=Math.max(0,at-suspendedAt);suspendedAt=null;}if(next==='suspended'&&suspendedAt===null)suspendedAt=at;state=next;emit();}
  function check(signal){if(signal.aborted)throw new DOMException('Video export canceled','AbortError');}
  async function boundary(signal){
   check(signal);if(!paused&&!isHidden())return;paused=true;transition('suspended');
   await new Promise((resolve,reject)=>{
    const abort=()=>{resumeWaiter=null;reject(new DOMException('Video export canceled','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});resumeWaiter=()=>{signal.removeEventListener('abort',abort);resumeWaiter=null;resolve();};
   });check(signal);transition('rendering');
  }
  // Closing, redoing or leaving discards the result, including its temporary file; a failed deletion is reported.
  async function clearResult(){
   if(saving)throw fault('SAVE_ACTIVE','Wait for the video to finish saving.');
   const temp=result?.temp;if(url)URL.revokeObjectURL(url);url=null;result=null;saveError=null;if(!active){state='idle';error=null;errorCode=null;alternative=null;}emit();
   if(temp)await temp.remove();
  }
  const api={
   snapshot,
   largeOutput,
   start(input,options={}){
    if(active)throw Error('A video export is already active');if(saving)throw fault('SAVE_ACTIVE','Wait for the video to finish saving.');const project=M.createSession(input).project;
    const cleared=clearResult();active=true;controller=new AbortController();const signal=controller.signal,id=++job;
    submitted=0;total=project.shot.frameCount;error=null;errorCode=null;alternative=null;config=null;profile=null;forcedFailure=null;paused=isHidden();
    timings=emptyTimings();started=now();ended=null;suspendedAt=null;suspendedMs=0;pendingStage=null;completedFrames=0;transition('preparing');
    promise=(async()=>{
     let session=null,fx=null,sink=null,completed=null,temp=null,stream=null,tempFile=null;
     try{
      await cleared;const estimate=estimateBytes(project),large=estimate>maxBytes;
      if(large&&!largeOutput())throw fault('OUTPUT_TOO_LARGE_ESTIMATE',`This video is estimated at ${Math.ceil(estimate/1048576)} MiB, above the ${maxBytes/1048576} MiB in-memory limit, and this browser cannot save directly to a file. Shorten the duration, choose a lower bitrate or use 720p.`);
      if(large){
       const {quota=0,usage=0}=await storage.estimate(),free=Math.max(0,quota-usage);check(signal);
       if(free<estimate)throw fault('STORAGE_QUOTA',`This video is estimated at ${Math.ceil(estimate/1048576)} MiB, but only ${Math.floor(free/1048576)} MiB of browser storage is available for its temporary file. Free disk space, shorten the duration or choose a lower bitrate.`);
      }
      pendingStage={name:'prepareMs',at:now()};await drainPreview();check(signal);
      const size=M.dimensions(project.output),support=await probe({...size,resolution:project.output.resolution,fps:project.shot.fps,container:project.output.container,frameCount:total,bitrate:M.bitrate(project.output,project.shot.fps)},signal);check(signal);
      if(!support.supported){
       if(project.output.container==='mp4'){const other=await probe({...size,resolution:project.output.resolution,fps:project.shot.fps,container:'webm',frameCount:total,bitrate:M.bitrate(project.output,project.shot.fps)},signal);check(signal);if(other.supported)alternative=other.config;}
       const failure=Error(support.reason||'The selected video format is unavailable.');failure.code=support.code||'UNSUPPORTED_CONFIG';throw failure;
      }
      if(project.output.container==='auto'&&support.config.container==='webm'){alternative=support.config;const failure=Error('MP4 is unavailable. Use the confirmed WebM alternative or return to editing.');failure.code='MP4_UNAVAILABLE';throw failure;}
      config=support.config;emit();
      if(large){temp=await createTemp(config.container==='webm'?'webm':'mp4');check(signal);stream=await temp.handle.createWritable();check(signal);}
      setOwner('export');const resources=options.getResources?options.getResources():options;
      session=await prepare(project,{...resources,signal});check(signal);
      fx=createCompositor(resources.renderer,size);
      profile={backend:session.backend,source:session.plan.extent,output:size,samples:project.output.samples,iterations:session.plan.iterations,frames:[]};emit();
      sink=await createSink(fx.canvas,config,{signal,...(stream?{fileStream:stream}:{})});check(signal);timings.prepareMs+=Math.max(0,now()-pendingStage.at);pendingStage=null;transition('rendering');
      const stable=project.output.temporal==='stable'&&project.shot.motion==='travel';
      // A frame on the same camera with a time-invariant look composes to the same pixels as the frame before it.
      const invariant=!!root.TetraStudioFX?.timeInvariant(project.look),repeats=session.plan.frames.map((frame,k)=>invariant&&k>0&&JSON.stringify(frame.camera)===JSON.stringify(session.plan.frames[k-1].camera));
      for(let k=0;k<total;k++){
       await boundary(signal);let renderMs=0;
       const frame=await timed('renderMs',async()=>{const began=now();try{return await session.renderBase(k,'final',signal,{fenceBatch:FENCE_BATCH});}finally{renderMs=now()-began;}});completedFrames++;
       // Per-frame numerical record to correlate visible jumps with direct/perturb switches, reference changes and the GPU backend.
       const numerical=session.numerical?.states[k];profile.frames.push({k,mode:numerical?.mode??null,descriptor:numerical?.descriptor??null,backend:session.backend,renderMs});
       try{
        await timed('fxMs',()=>fx.compose(frame,{look:project.look,k,fps:project.shot.fps,rollDeg:session.plan.frames[k].camera.rollDeg,...(stable?{motion:true,sequence:1}:{}),signal}));check(signal);
        await timed('encodeMs',()=>sink.addFrame(M.timing(project,k),{repeat:repeats[k],still:!repeats[k]&&!!repeats[k+1]}));check(signal);submitted=k+1;emit();
       }finally{frame.release();}
      }
      check(signal);transition('finalizing');completed=await timed('finalizeMs',()=>sink.finish());check(signal);
      if(temp)tempFile=await temp.handle.getFile();
      if(id!==job)throw new DOMException('Video export replaced','AbortError');
     }catch(reason){completed=null;error=forcedFailure||(reason.name==='AbortError'?null:reason.message);errorCode=reason.code||null;}
     finally{
      if(pendingStage){timings[pendingStage.name]+=Math.max(0,now()-pendingStage.at);pendingStage=null;}
      const cleanupStarted=now();pendingStage={name:'cleanupMs',at:cleanupStarted};
      const cleanupErrors=[];
      for(const cleanup of [()=>!completed&&sink?.cancel(),()=>!sink&&stream?.abort(),()=>fx?.dispose(),()=>session?.dispose()]){try{await cleanup();}catch(reason){cleanupErrors.push(reason.message||String(reason));}}
      try{if(profile)profile.resourcesAfterCleanup={render:session?.diagnostics?.(),fx:fx?.diagnostics?.()};}catch(reason){cleanupErrors.push(reason.message);}
      try{setOwner('studio');}catch(reason){cleanupErrors.push(reason.message);}
      if(cleanupErrors.length){error=(error?error+' · ':'')+'Resource cleanup failed: '+cleanupErrors.join('; ');errorCode=errorCode||'CLEANUP_FAILED';completed=null;}
      if(signal.aborted||id!==job){completed=null;error=error||forcedFailure;}
      if(completed&&!error){try{result={...completed,filename:filename(project.name,completed.extension),project,...(temp?{temp}:{})};url=URL.createObjectURL(temp?tempFile:result.blob);}catch(reason){result=null;error=reason.message;}}
      if(!result&&temp){try{await temp.remove();}catch(reason){error=(error?error+' · ':'')+reason.message;errorCode=errorCode||reason.code;}}
      active=false;controller=null;resumeWaiter=null;
      timings.cleanupMs+=Math.max(0,now()-cleanupStarted);pendingStage=null;ended=now();transition(result?'ready':error?'failed':'canceled');
     }
     return snapshot();
    })();return promise;
   },
   cancel(){if(!active)return Promise.resolve();transition('canceling');controller.abort();return promise;},
   fail(message){if(!active)return Promise.resolve();forcedFailure=message;controller.abort();return promise;},
   hidden(){if(active&&state!=='finalizing'&&state!=='ready')paused=true;},
   resume(){if(active&&state==='suspended'&&!isHidden()){paused=false;resumeWaiter?.();}},
   clearResult,
   // Call from the click that asks to save: the picker is the first await, inside that click's activation.
   async save(){
    const target=result;if(active||saving||!target?.temp)throw fault('NOTHING_TO_SAVE','There is no finished video waiting to be saved.');
    saving=true;saveError=null;emit();let writable=null,piped=false;
    try{
     let handle;try{handle=await pickFile({suggestedName:target.filename,types:[{description:target.extension.toUpperCase()+' video',accept:{[target.mimeType]:['.'+target.extension]}}]});}
     catch(reason){throw reason?.name==='AbortError'?fault('SAVE_ABORTED','Not saved: no location was chosen. The video is kept; Save again to choose a location.'):reason;}
     writable=await handle.createWritable();const source=(await target.temp.handle.getFile()).stream();
     // pipeTo closes the file only after the last byte and aborts it on any failure; only a completed close counts as saved.
     piped=true;await source.pipeTo(writable);target.savedAs=handle.name;
    }catch(reason){
     let message=reason.code==='SAVE_ABORTED'?reason.message:'Not saved: '+(reason?.message||reason)+'. The video is kept; Save again to retry.';
     if(writable&&!piped){try{await writable.abort();}catch(abort){message+=' Closing the chosen file also failed: '+(abort?.message||abort);}}
     saving=false;saveError=message;emit();throw fault(reason.code||'SAVE_FAILED',message);
    }
    const temp=target.temp;target.temp=null;if(url)URL.revokeObjectURL(url);url=null;saving=false;
    try{await temp.remove();}catch(reason){saveError='Saved to '+target.savedAs+', but '+reason.message;}
    emit();if(saveError)throw fault('TEMP_DELETE_FAILED',saveError);return snapshot();
   },
   // Removes temporary files that no page holds, such as those left by a closed or crashed tab.
   async sweep(){
    if(!largeOutput())return 0;const directory=await storage.getDirectory(),failures=[],names=[];let removed=0;
    for await(const [name] of directory.entries())if(name.startsWith(TEMP_PREFIX))names.push(name);
    for(const name of names){
     try{await locks.request(name,{ifAvailable:true},async lock=>{if(lock){await directory.removeEntry(name);removed++;}});}catch(reason){if(reason?.name!=='NotFoundError')failures.push(name+': '+(reason?.message||reason));}
    }
    if(failures.length)throw fault('TEMP_DELETE_FAILED','Could not delete temporary video files: '+failures.join('; '));
    return removed;
   },
   async dispose(){await api.cancel();await clearResult();}
  };return api;
 }
 root.TetraStudioExport={TEMP_PREFIX,create,filename,estimateBytes};if(typeof module!=='undefined')module.exports=root.TetraStudioExport;
})(globalThis);
