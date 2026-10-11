/* One active frame and one desired target. Play ticks never cancel useful work. */
(function(root){
 'use strict';
 function sizeFor({width,height,aspect,outputWidth,outputHeight,dpr=1,detailed=false,motion=false,maxTexture=8192,rolled=false}){
  if(!(width>0&&height>0))return null;
  const [a,b]=aspect==='16:9'?[16,9]:aspect==='9:16'?[9,16]:[1,1],density=detailed||motion?Math.min(2,dpr):1;
  const edge=detailed?1536:motion?1024:512;
  let n=Math.min(width*density/a,height*density/b,outputWidth/a,outputHeight/b,edge/Math.max(a,b),Math.sqrt((detailed?1500000:edge*edge)/(a*b)),maxTexture/a,maxTexture/b);
  if(rolled)n=Math.min(n,(maxTexture-2)/Math.hypot(a,b),Math.sqrt(8294400)/(Math.hypot(a,b)+2));
  n=Math.floor(n/2)*2;
  return n>=2?{width:a*n,height:b*n}:null;
 }
 function create({frameCount,fps,renderBase,compose,present,onState=()=>{},now=()=>performance.now(),requestTick=fn=>requestAnimationFrame(fn),cancelTick=id=>cancelAnimationFrame(id)}){
  let N=frameCount,rate=fps,desired=0,displayed=-1,generation=0,lookRevision=0,playing=false,suspended=false,active=false,pending=true,raf=null,startTime=0,startK=0,controller=null,run=Promise.resolve(),error=null,disposed=false,request=null;
  const state=()=>({desiredK:desired,displayedK:displayed,pending:active||pending,playing,suspended,generation,lookRevision,error,inFlight:active?1:0,queued:pending?1:0});
  const emit=()=>onState(state());
  function stopClock(){playing=false;if(raf!==null)cancelTick(raf);raf=null;}
  function tick(){
   raf=null;if(!playing||suspended||disposed)return;
   const target=Math.min(N-1,Math.floor(startK+(now()-startTime)*rate/1000));
   if(target!==desired){desired=target;pending=true;pump();}
   if(desired<N-1)raf=requestTick(tick);emit();
  }
  function pump(){
   if(active||!pending||suspended||disposed)return;
   active=true;pending=false;const k=desired,g=generation,frameRequest=request;controller=new AbortController();const signal=controller.signal;emit();
   run=(async()=>{
    let base=null;
    try{
     base=await renderBase(k,{signal,generation:g,request:frameRequest});
     if(g!==generation||suspended||disposed)return;
     // A look edit preserves compatible orbit work. Recompose with the newest
     // look if another edit arrived during the previous bounded FX pass.
     let revision,canvas;
     do{revision=lookRevision;canvas=await compose(base,{k,signal,generation:g,lookRevision:revision});if(g!==generation||suspended||disposed)break;}
     while(revision!==lookRevision);
     if(g!==generation||suspended||disposed||signal.aborted)return;
     if(k>=displayed){present(canvas,{k,generation:g,request:frameRequest});displayed=k;}
     if(desired===k)pending=false;
     if(k===N-1&&desired===N-1){stopClock();pending=false;}
     error=null;
    }catch(reason){if(reason.name!=='AbortError'&&g===generation){error=reason.message;stopClock();pending=false;}}
    finally{base?.release?.();active=false;controller=null;emit();if(pending&&!suspended&&!disposed)pump();}
   })();
  }
  function invalidate(){generation++;displayed=-1;controller?.abort();}
  const api={
   state,
   seek(k,options={}){if(!Number.isInteger(k)||k<0||k>=N)throw Error('Invalid preview frame');if(options.request)request=options.request;stopClock();invalidate();desired=k;pending=true;suspended=false;error=null;pump();emit();},
   setRequest(value){if(JSON.stringify(value)===JSON.stringify(request))return false;request=value;invalidate();pending=true;error=null;pump();emit();return true;},
   refresh({base=false}={}){if(base)invalidate();else lookRevision++;pending=true;error=null;pump();emit();},
   setTiming(frameCount,nextFps){const u=desired/(N-1);N=frameCount;rate=nextFps;api.seek(Math.round(u*(N-1)));},
   play(){if(disposed)return;if(desired===N-1){invalidate();desired=0;}suspended=false;playing=true;startK=desired;startTime=now();pending=true;error=null;pump();if(raf===null)raf=requestTick(tick);emit();},
   pause(){stopClock();pending=displayed!==desired||active;pump();emit();},
   async suspend(){stopClock();suspended=true;pending=false;invalidate();emit();await run;},
   resume(){if(disposed)return;suspended=false;pending=true;pump();emit();},
   async drain(){await run;},
   idleTask(task){if(active||pending||playing||suspended||disposed)return null;active=true;controller=new AbortController();const signal=controller.signal;const work=Promise.resolve().then(()=>task(signal)).finally(()=>{active=false;controller=null;emit();if(pending&&!suspended&&!disposed)pump();});run=work.catch(()=>{});return work;},
   async dispose(){disposed=true;await api.suspend();},
  };
  return api;
 }
 root.TetraStudioPreview={create,sizeFor};if(typeof module!=='undefined')module.exports=root.TetraStudioPreview;
})(globalThis);
