/* Offline frames through the existing GPU kernels; no live/adaptive image history. */
(function(root){
 'use strict';
 const F=createFixed(256),M=root.TetraStudioModel,C=root.TetraStudioCamera,R=root.TetraRender;
 const check=signal=>{if(signal?.aborted)throw new DOMException('Frame rendering canceled','AbortError');};
 const fixed=camera=>({x:F.parse(camera.x),y:F.parse(camera.y),span:F.parse(camera.span)});
 const magnitude=camera=>Math.max(1,Math.abs(Number(camera.x)),Math.abs(Number(camera.y)));
 const needDigits=camera=>Math.min(256,Math.ceil(Math.log10(magnitude(camera)/Number(camera.span)))+24);
 function referencePlan(plan){
  const descriptors=[],states=[];let current=null,previous=null,previousKey=null;
  for(const frame of plan.frames){
   const key=JSON.stringify(frame.camera);
   if(key===previousKey){states.push(previous);continue;}
   const camera=C.sourceCamera(frame.camera,plan.size.width,plan.extent),view=fixed(camera);
   const mode=Number(camera.span)/plan.extent.width>=magnitude(camera)*2**-16?'direct':'perturb';
   if(mode==='perturb'){
    const ay=F.abs(view.y),limit=view.span*64n,need=needDigits(camera);
    if(!current||current.digits<need||F.abs(F.parse(current.x)-view.x)>limit||F.abs(F.parse(current.y)-ay)>limit){
     const point=R.referencePoint(F,view);current={id:descriptors.length,startFrame:frame.k,x:F.text(point.x),y:F.text(point.y),digits:Math.min(256,Math.max(30,need+16)),iterations:plan.iterations,maxRe:80};descriptors.push(current);
    }
   }
   previous={camera,mode,descriptor:mode==='perturb'?current.id:null};previousKey=key;states.push(previous);
  }
  return {descriptors,states};
 }
 function abortedAwait(promise,signals){
  return new Promise((resolve,reject)=>{
   const clean=()=>signals.forEach(signal=>signal?.removeEventListener('abort',abort));
   const abort=()=>{clean();reject(new DOMException('Reference preparation canceled','AbortError'));};
   if(signals.some(signal=>signal?.aborted)){Promise.resolve(promise).catch(()=>{});abort();return;}
   signals.forEach(signal=>signal?.addEventListener('abort',abort,{once:true}));
   Promise.resolve(promise).then(value=>{clean();resolve(value);},reason=>{clean();reject(reason);});
  });
 }
 async function prepare(project,{renderer,compute=null,reference=options=>root.TetraReference.compute(options),signal,size,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  if(!renderer||renderer.lost())throw Error('Motion rendering requires a working WebGL2 GPU');
  const plan=await C.plan(project,{signal,...(size?{size}:{}),yieldTask}),{extent}=plan;
  if(extent.width>renderer.maxTexture||extent.height>renderer.maxTexture||extent.width*extent.height>8294400||extent.width*extent.height*4>64*1024*1024){const error=Error('The rolled source frame exceeds the GPU image limit. Change the shot or output settings.');error.code='SOURCE_LIMIT';throw error;}
  const backend=compute&&!compute.failed?'webgpu':'webgl',samples=plan.project.output.samples;
  if(backend==='webgl'&&((plan.iterations>=8192&&samples>=4)||(plan.iterations>=4096&&samples>=16))&&!renderer.floatColor)throw Error('This shot requires float render targets for bounded full-sample GPU work.');
  const numerical=referencePlan(plan),usesPerturb=numerical.states.some(state=>state.mode==='perturb');
  renderer.program('direct');
  if(usesPerturb){
   renderer.program('perturb');while(!renderer.warm()){check(signal);if(renderer.lost())throw Error('GPU lost while preparing shaders');await yieldTask();}
   if(plan.iterations>=8192){renderer.program('perturbCycle');if(renderer.programs?.perturbBla)renderer.program('perturbBlaCycle');}
  }
  if(backend==='webgpu'){
   const kinds=usesPerturb?['direct','perturb','perturbBla',...(plan.iterations>=8192?['perturbCycle','perturbBlaCycle']:[])]:['direct'];
   for(const kind of kinds){compute.pipeline(kind);if(kind!=='direct')compute.pipeline(kind+'@approach');}
   while(compute.pending.size){check(signal);if(compute.failed)throw Error('WebGPU shader preparation failed');await yieldTask();}
   if(compute.failed)throw Error('WebGPU is unavailable for this shot');
  }
  check(signal);
  const refs=new Map(),rates=new Map(),initialBuilds=renderer.blaBuilds||0,stats={backend,submits:0,releases:0,cacheHits:0,completedFrames:0,renderMs:0,source:extent,output:plan.size,samples,iterations:plan.iterations};
  const lifetime=new AbortController();let cache=null,disposed=false,active=false,drain=Promise.resolve(),finishDrain=null;
  function activeCheck(renderSignal){check(signal);check(renderSignal);if(disposed)throw new DOMException('Render session ended','AbortError');if(renderer.lost()||(backend==='webgpu'&&compute.failed))throw Error('GPU device was lost; retry the shot from frame 0.');}
  function dropCache(){if(cache){if(cache.readers)throw Error('A source frame is still being composed');renderer.releaseFrame(cache.frame);stats.releases++;cache=null;}}
  async function getReference(id,renderSignal){
   if(refs.has(id)){const value=refs.get(id);refs.delete(id);refs.set(id,value);return value;}
   const descriptor=numerical.descriptors[id],{x,y,digits,iterations,maxRe}=descriptor;
   const ref=await abortedAwait(reference({x,y,digits,iterations,maxRe}),[renderSignal,signal,lifetime.signal]);activeCheck(renderSignal);
   ref.point={x:F.parse(x),y:F.parse(y)};ref.maxRe=maxRe;ref.digits??=digits;refs.set(id,ref);if(refs.size>6)refs.delete(refs.keys().next().value);return ref;
  }
  function handle(item,k){item.readers++;let released=false;return {frame:item.frame,contentKey:item,renderer,complete:true,frameIndex:k,camera:plan.frames[k].camera,descriptor:item.descriptor,backend,samples:item.samples,iterations:plan.iterations,
   release(){if(!released){released=true;item.readers--;}}};}
  return {
   plan,numerical,backend,
   diagnostics(){return {...stats,blaBuilds:(renderer.blaBuilds||0)-initialBuilds,source:{...extent},output:{...plan.size},cachedFrames:cache?1:0,cachedSamples:cache?.samples??null,cachedBytes:cache?extent.width*extent.height*4:0,references:refs.size,active};},
   async renderBase(k,profile='final',renderSignal){
    if(active)throw Error('Only one source frame may render at a time');if(!['preview','final'].includes(profile))throw Error('Invalid frame profile');activeCheck(renderSignal);M.timing(plan.project,k);
    const selected=profile==='final'?samples:4,state=numerical.states[k],palette=M.ENUMS.palette.indexOf(plan.project.look.palette);
    const key=JSON.stringify([state.camera,extent,palette,plan.iterations,selected,state.descriptor,backend]);
    if(cache?.key===key){stats.cacheHits++;return handle(cache,k);}
    dropCache();active=true;drain=new Promise(resolve=>{finishDrain=resolve;});const started=performance.now();let frame=null,writesPending=false;
    try{
     activeCheck(renderSignal);const ref=state.mode==='perturb'?await getReference(state.descriptor,renderSignal):null,view=fixed(state.camera);
     const base={iterations:plan.iterations,palette,rules:root.TetraCore.RULES.gpu,aspect:extent.height/extent.width,blaPolicy:'deterministic'};
     const scene=state.mode==='direct'?{...base,mode:'direct',center:[F.number(view.x),F.number(view.y)],span:F.number(view.span)}:{...base,...R.perturbScene(F,view,ref.point.x,ref.point.y),ref};
     activeCheck(renderSignal);frame=renderer.beginFrame(extent.width,extent.height,null,false);writesPending=true;
     const levels=scene.mode==='perturb'?renderer.blaPolicy(frame,scene):0;
     const partial=backend==='webgl'&&((plan.iterations>=8192&&selected>=4)||(plan.iterations>=4096&&selected>=16));
     const effective=renderer.effectiveIterations(scene,frame.width,frame.height),kernel=backend==='webgpu'?compute.kernel(scene,levels):null;
     if(backend==='webgpu'&&!kernel)throw Error('The prepared GPU kernel is unavailable');
     const rateKey=[backend,scene.mode,scene.iterations,selected,levels,effective].join('|');
     const policy=R.batchPolicy({backend,effective,samples:selected,capacity:backend==='webgpu'?compute.capacity(kernel):Infinity,partial,highCap:scene.iterations>=8192,edge:partial?32:undefined,rate:rates.get(rateKey)??60,area:frame.width*frame.height});
     const tiles=R.tiles(frame.width,frame.height,policy.edge);let budget=policy.budget;
     let index=0;
     while(index<tiles.length){
      activeCheck(renderSignal);const batch=[];let pixels=0;
      do{const tile=tiles[index++];batch.push(tile);pixels+=tile.width*tile.height;}while(index<tiles.length&&pixels+tiles[index].width*tiles[index].height<=budget);
      stats.submits++;const batchStarted=performance.now();
      writesPending=true;
      if(backend==='webgpu'){const completed=await compute.draw(renderer,frame,scene,selected,0,batch,kernel,levels,null,()=>disposed||signal?.aborted||renderSignal?.aborted);if(completed===false){activeCheck(renderSignal);throw Error('GPU sampling did not complete');}}
      else if(partial){for(const tile of batch){const completed=await renderer.drawAATile(frame,tile,scene,()=>disposed||signal?.aborted||renderSignal?.aborted,0,selected);if(!completed){activeCheck(renderSignal);throw Error('GPU sampling did not complete');}}writesPending=false;}
      else{renderer.prepare(frame,scene,selected,0);for(const tile of batch)renderer.drawTile(frame,tile);await renderer.fence();writesPending=false;}
      activeCheck(renderSignal);
      const next=R.adaptBatch(policy,pixels,performance.now()-batchStarted);rates.set(rateKey,next.rate);budget=next.budget;
     }
     if(backend==='webgpu'){compute.complete(frame);await renderer.fence();writesPending=false;}
     activeCheck(renderSignal);stats.completedFrames++;cache={key,frame,samples:selected,descriptor:state.descriptor,readers:0};frame=null;return handle(cache,k);
    }finally{
     // WebGPU readback may already have queued WebGL texture uploads from an
     // earlier batch. Drain those too before cancel returns the source to its pool.
     try{if(frame&&writesPending&&!renderer.lost())await renderer.fence();}
     finally{if(frame){renderer.releaseFrame(frame);stats.releases++;}stats.renderMs+=performance.now()-started;active=false;finishDrain();}
    }
   },
   async dispose(){disposed=true;lifetime.abort();await drain;dropCache();refs.clear();}
  };
 }
 root.TetraStudioRender={referencePlan,prepare};
 if(typeof module!=='undefined')module.exports=root.TetraStudioRender;
})(globalThis);
