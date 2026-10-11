/* A frozen shot, one serial render/compose/add loop, and one retained result. */
(function(root){
 'use strict';
 const M=root.TetraStudioModel;
 function filename(name,extension){return (name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').trim().slice(0,80)||'tetra-motion')+'.'+extension;}
 function create({drainPreview=async()=>{},setOwner=()=>{},notify=()=>{},isHidden=()=>document.hidden,prepare=root.TetraStudioRender.prepare,createCompositor=root.TetraStudioFX.createCompositor,probe=root.TetraStudioEncoder.probe,createSink=root.TetraStudioEncoder.createSink}={}){
  let state='idle',active=false,controller=null,submitted=0,total=0,result=null,url=null,error=null,config=null,profile=null,paused=false,resumeWaiter=null,job=0,promise=Promise.resolve(),forcedFailure=null;
  const snapshot=()=>({state,active,submitted,total,result,url,error,config,profile,job});
  function emit(){notify(snapshot());}
  function transition(next){state=next;emit();}
  function check(signal){if(signal.aborted)throw new DOMException('Video export canceled','AbortError');}
  async function boundary(signal){
   check(signal);if(!paused&&!isHidden())return;paused=true;transition('suspended');
   await new Promise((resolve,reject)=>{
    const abort=()=>{resumeWaiter=null;reject(new DOMException('Video export canceled','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});resumeWaiter=()=>{signal.removeEventListener('abort',abort);resumeWaiter=null;resolve();};
   });check(signal);transition('rendering');
  }
  function clearResult(){if(url)URL.revokeObjectURL(url);url=null;result=null;if(state==='ready')state='idle';emit();}
  const api={
   snapshot,
   start(input,options){
    if(active)throw Error('A video export is already active');const project=M.createSession(input).project;
    clearResult();active=true;controller=new AbortController();const signal=controller.signal,id=++job;
    submitted=0;total=project.shot.frameCount;error=null;config=null;profile=null;forcedFailure=null;paused=isHidden();transition('preparing');
    promise=(async()=>{
     let session=null,fx=null,sink=null;
     try{
      await drainPreview();check(signal);setOwner('export');
      session=await prepare(project,{...options,signal});check(signal);
      const size=session.plan.size;fx=createCompositor(options.renderer,size);
      // Compile/allocate the selected look before starting the output writer.
      const base=await session.renderBase(0,'final',signal);
      try{await fx.compose(base,{look:project.look,k:0,fps:project.shot.fps,rollDeg:session.plan.frames[0].camera.rollDeg,signal});}finally{base.release();}
      check(signal);const support=await probe({...size,resolution:project.output.resolution,fps:project.shot.fps,container:project.output.container,frameCount:total},signal);check(signal);
      if(!support.supported)throw Error(support.reason||'The selected video format is unavailable.');
      if(project.output.container==='auto'&&support.config.container==='webm')throw Error('MP4 is unavailable. Select WebM to use the confirmed alternative.');
      config=support.config;profile={backend:session.backend,source:session.plan.extent,output:size,samples:project.output.samples,iterations:session.plan.iterations};emit();
      sink=await createSink(fx.canvas,config,{signal});check(signal);transition('rendering');
      for(let k=0;k<total;k++){
       await boundary(signal);const frame=await session.renderBase(k,'final',signal);
       try{
        await fx.compose(frame,{look:project.look,k,fps:project.shot.fps,rollDeg:session.plan.frames[k].camera.rollDeg,signal});check(signal);
        await sink.addFrame(M.timing(project,k));check(signal);submitted=k+1;emit();
       }finally{frame.release();}
      }
      check(signal);transition('finalizing');const completed=await sink.finish();check(signal);
      if(id!==job)throw new DOMException('Video export replaced','AbortError');
      result={...completed,filename:filename(project.name,completed.extension),project};url=URL.createObjectURL(result.blob);transition('ready');
     }catch(reason){error=forcedFailure||(reason.name==='AbortError'?null:reason.message);transition(error?'failed':'canceled');}
     finally{
      if(sink&&state!=='ready')await sink.cancel().catch(()=>{});
      await fx?.dispose();await session?.dispose();if(profile)profile.resourcesAfterCleanup={render:session?.diagnostics?.(),fx:fx?.diagnostics?.()};active=false;controller=null;resumeWaiter=null;setOwner('studio');emit();
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
