/* A frozen shot, one serial render/compose/add loop, and one retained result. */
(function(root){
 'use strict';
 const M=root.TetraStudioModel;
 function filename(name,extension){return (name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').trim().slice(0,80)||'tetra-motion')+'.'+extension;}
 function create({drainPreview=async()=>{},setOwner=()=>{},notify=()=>{},isHidden=()=>document.hidden,now=()=>performance.now(),prepare=root.TetraStudioRender.prepare,createCompositor=root.TetraStudioFX.createCompositor,probe=root.TetraStudioEncoder.probe,createSink=root.TetraStudioEncoder.createSink}={}){
  let state='idle',active=false,controller=null,submitted=0,total=0,result=null,url=null,error=null,errorCode=null,alternative=null,config=null,profile=null,paused=false,resumeWaiter=null,job=0,promise=Promise.resolve(),forcedFailure=null;
  const emptyTimings=()=>({prepareMs:0,renderMs:0,fxMs:0,encodeMs:0,finalizeMs:0,cleanupMs:0});
  let timings=emptyTimings(),started=null,ended=null,suspendedAt=null,suspendedMs=0,pendingStage=null,completedFrames=0;
  function snapshot(){
   const at=ended??now(),elapsedMs=started===null?0:Math.max(0,at-started),pausedMs=suspendedMs+(suspendedAt===null?0:Math.max(0,at-suspendedAt));
   const stages={...timings};if(pendingStage)stages[pendingStage.name]+=Math.max(0,at-pendingStage.at);
   const frameMs=stages.renderMs+stages.fxMs+stages.encodeMs,fps=submitted&&frameMs>0?submitted*1000/frameMs:0;
   return {state,active,submitted,completedFrames,total,result,url,error,errorCode,alternative,config,profile,job,timings:stages,elapsedMs,activeMs:Math.max(0,elapsedMs-pausedMs),suspendedMs:pausedMs,fps,etaMs:state==='rendering'&&fps>0?Math.max(0,(total-submitted)*1000/fps):null};
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
  function clearResult(){if(url)URL.revokeObjectURL(url);url=null;result=null;if(!active){state='idle';error=null;errorCode=null;alternative=null;}emit();}
  const api={
   snapshot,
   start(input,options={}){
    if(active)throw Error('A video export is already active');const project=M.createSession(input).project;
    clearResult();active=true;controller=new AbortController();const signal=controller.signal,id=++job;
    submitted=0;total=project.shot.frameCount;error=null;errorCode=null;alternative=null;config=null;profile=null;forcedFailure=null;paused=isHidden();
    timings=emptyTimings();started=now();ended=null;suspendedAt=null;suspendedMs=0;pendingStage=null;completedFrames=0;transition('preparing');
    promise=(async()=>{
     let session=null,fx=null,sink=null,completed=null;
     try{
      pendingStage={name:'prepareMs',at:now()};await drainPreview();check(signal);
      const size=M.dimensions(project.output),support=await probe({...size,resolution:project.output.resolution,fps:project.shot.fps,container:project.output.container,frameCount:total},signal);check(signal);
      if(!support.supported){
       if(project.output.container==='mp4'){const other=await probe({...size,resolution:project.output.resolution,fps:project.shot.fps,container:'webm',frameCount:total},signal);check(signal);if(other.supported)alternative=other.config;}
       const failure=Error(support.reason||'The selected video format is unavailable.');failure.code=support.code||'UNSUPPORTED_CONFIG';throw failure;
      }
      if(project.output.container==='auto'&&support.config.container==='webm'){alternative=support.config;const failure=Error('MP4 is unavailable. Use the confirmed WebM alternative or return to editing.');failure.code='MP4_UNAVAILABLE';throw failure;}
      config=support.config;emit();setOwner('export');const resources=options.getResources?options.getResources():options;
      session=await prepare(project,{...resources,signal});check(signal);
      fx=createCompositor(resources.renderer,size);
      profile={backend:session.backend,source:session.plan.extent,output:size,samples:project.output.samples,iterations:session.plan.iterations};emit();
      sink=await createSink(fx.canvas,config,{signal});check(signal);timings.prepareMs+=Math.max(0,now()-pendingStage.at);pendingStage=null;transition('rendering');
      for(let k=0;k<total;k++){
       await boundary(signal);const frame=await timed('renderMs',()=>session.renderBase(k,'final',signal));completedFrames++;
       try{
        await timed('fxMs',()=>fx.compose(frame,{look:project.look,k,fps:project.shot.fps,rollDeg:session.plan.frames[k].camera.rollDeg,signal}));check(signal);
        await timed('encodeMs',()=>sink.addFrame(M.timing(project,k)));check(signal);submitted=k+1;emit();
       }finally{frame.release();}
      }
      check(signal);transition('finalizing');completed=await timed('finalizeMs',()=>sink.finish());check(signal);
      if(id!==job)throw new DOMException('Video export replaced','AbortError');
     }catch(reason){completed=null;error=forcedFailure||(reason.name==='AbortError'?null:reason.message);errorCode=reason.code||null;}
     finally{
      if(pendingStage){timings[pendingStage.name]+=Math.max(0,now()-pendingStage.at);pendingStage=null;}
      const cleanupStarted=now();pendingStage={name:'cleanupMs',at:cleanupStarted};
      const cleanupErrors=[];
      for(const cleanup of [()=>!completed&&sink?.cancel(),()=>fx?.dispose(),()=>session?.dispose()]){try{await cleanup();}catch(reason){cleanupErrors.push(reason.message||String(reason));}}
      try{if(profile)profile.resourcesAfterCleanup={render:session?.diagnostics?.(),fx:fx?.diagnostics?.()};}catch(reason){cleanupErrors.push(reason.message);}
      try{setOwner('studio');}catch(reason){cleanupErrors.push(reason.message);}
      active=false;controller=null;resumeWaiter=null;
      if(cleanupErrors.length){error=(error?error+' · ':'')+'Resource cleanup failed: '+cleanupErrors.join('; ');errorCode=errorCode||'CLEANUP_FAILED';completed=null;}
      if(signal.aborted||id!==job){completed=null;error=error||forcedFailure;}
      if(completed&&!error){try{result={...completed,filename:filename(project.name,completed.extension),project};url=URL.createObjectURL(result.blob);}catch(reason){result=null;error=reason.message;}}
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
   async dispose(){await api.cancel();clearResult();}
  };return api;
 }
 root.TetraStudioExport={create,filename};if(typeof module!=='undefined')module.exports=root.TetraStudioExport;
})(globalThis);
