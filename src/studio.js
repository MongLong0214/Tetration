/* Native Studio controls; Explore owns its own camera, history and saved views. */
(function(root){
 'use strict';
 const M=root.TetraStudioModel,C=root.TetraStudioCamera,FX=root.TetraStudioFX,F=createFixed(256);
 const copy=value=>JSON.parse(JSON.stringify(value)),get=(object,path)=>path.split('.').reduce((value,key)=>value[key],object);
 function put(object,path,value){const keys=path.split('.'),last=keys.pop();get(object,keys.join('.'))[last]=value;}
 function create(bridge){
  const $=id=>document.getElementById(id),stage=$('studioCanvas'),context=stage.getContext('2d',{alpha:false}),wide=matchMedia('(min-width:761px) and (min-height:481px)'),records=[],numericRecords=[],effectGroups=[];
  let session=null,preview=null,pipeline=null,entered=false,endpoint=null,draft=null,original=false,entering=false,notice='',confirming=null,thumbRevision=0,thumbDone=-1,thumbPromise=null,thumbAbort=null,thumbStarting=false,composedSamples=4,displayedSamples=0,composedCamera=null,displayedCamera=null,setup=null,settingsOpen=false,activeTab='Motion',detailTimer=null,resizeTimer=null,thumbTimer=null,requested=null,displayedSize=null,detailError=null,transitioning=false,nextTransition=null;
  const store=M.createStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
  const pointers=new Map();let gesture=null,framingRaf=null;
  const completedImage=document.createElement('canvas'),completedContext=completedImage.getContext('2d',{alpha:false});
  const thumbBases=new Map();
  const project=()=>session.project;
  const draftDirty=()=>endpoint&&JSON.stringify(draft)!==JSON.stringify(project().shot[endpoint]);
  const announce=text=>{notice=text;$('studioNotice').textContent=text;};
  function clearInvalidNumbers(scope='all'){numericRecords.filter(r=>scope==='all'||r.path.startsWith('look.')).forEach(r=>r.revert());}
  function pause(){clearTimeout(detailTimer);detailTimer=null;preview?.pause();}
  function openModal(id){pause();const dialog=$(id);if(!dialog.open)dialog.showModal();}
  function chooseTab(name,{focus=false}={}){activeTab=name;for(const tab of ['Motion','Look','Rhythm']){const selected=tab===name;$( 'studio'+tab+'Tab').setAttribute('aria-selected',String(selected));$('studio'+tab+'Tab').tabIndex=selected?0:-1;$('studio'+tab+'Controls').hidden=!selected;}if(focus)$('studio'+name+'Tab').focus();}
  for(const [i,name]of ['Motion','Look','Rhythm'].entries()){const tab=$('studio'+name+'Tab');tab.onclick=()=>chooseTab(name);tab.onkeydown=e=>{const names=['Motion','Look','Rhythm'];let target;if(e.key==='ArrowRight')target=(i+1)%3;else if(e.key==='ArrowLeft')target=(i+2)%3;else if(e.key==='Home')target=0;else if(e.key==='End')target=2;else return;e.preventDefault();chooseTab(names[target],{focus:true});};}
  function revealNumber(record){
   for(const id of ['studioProjects','studioHelpDialog','studioExportDialog'])if($(id).open&&!$(id).contains(record.number))$(id).close();
   if(record.tab){chooseTab(record.tab);settingsOpen=true;settingsLayout();}else openModal('studioExportDialog');
   for(let el=record.number.parentElement;el;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;
   record.number.focus();record.number.scrollIntoView({block:'nearest'});
  }
  function commitNumbers(){commit();let first=null;for(const record of numericRecords){if(!record.commit()&&!first)first=record;}if(first){announce('Correct the highlighted value, or Reset it before continuing.');revealNumber(first);return false;}return true;}
  async function transition(action){nextTransition=action;if(transitioning)return;transitioning=true;try{while(nextTransition){const current=nextTransition;nextTransition=null;await current();}}catch(reason){announce(reason.message);}finally{transitioning=false;}}

  function ask(text,choices){
   pause();if(confirming)return Promise.resolve('cancel');const dialog=$('studioConfirm'),focus=document.activeElement;
   $('studioConfirmText').textContent=text;$('studioConfirmChoices').replaceChildren();
   return new Promise(resolve=>{
    confirming=answer=>{confirming=null;dialog.close();focus?.focus?.();resolve(answer);};
    for(const [value,label]of choices){const button=document.createElement('button');button.textContent=label;button.onclick=()=>confirming?.(value);$('studioConfirmChoices').append(button);}
    dialog.showModal();
   });
  }
  $('studioConfirm').addEventListener('close',()=>confirming?.('cancel'));
  function cancelGesture(){pointers.clear();gesture=null;if(framingRaf!==null)cancelAnimationFrame(framingRaf);framingRaf=null;}
  function currentShot(){const value=M.validate(project());if(endpoint){value.shot.start=copy(draft);value.shot.end=copy(draft);value.shot.motion='hold';}return value;}
  function previewSize(detailed=false){const output=M.dimensions(project().output),box=stage.getBoundingClientRect(),shot=currentShot().shot;let maxTexture=8192;try{maxTexture=bridge.resources().renderer.maxTexture;}catch{}
   return root.TetraStudioPreview.sizeFor({width:box.width,height:box.height,aspect:project().output.aspect,outputWidth:output.width,outputHeight:output.height,dpr:devicePixelRatio,detailed,motion:!endpoint&&shot.motion==='travel',maxTexture,rolled:shot.start.rollDeg!==0||(shot.motion==='travel'&&shot.end.rollDeg!==0)});
  }
  function requestBudget(detailed){const size=previewSize(detailed);if(!size)return null;return {...size,quality:detailed?'detailed':'quick',samples:detailed?project().output.samples:4};}
  function frameNote(){if(!displayedSize){$('studioFrameNote').textContent='Preview · preparing';return;}const refining=requested&&(requested.width!==displayedSize.width||requested.height!==displayedSize.height||requested.samples!==displayedSamples);$('studioFrameNote').textContent=`Preview ${displayedSize.width} × ${displayedSize.height} · ${displayedSamples} samples${!endpoint&&!original&&project().shot.motion==='travel'?' · Smooth motion':''}${refining?' · Refining to '+requested.width+' × '+requested.height:''}${detailError?' · Detailed preview unavailable':''}`;$('studioDetailRetry').hidden=!detailError;}
  function quick(){clearTimeout(detailTimer);detailTimer=null;detailError=null;requested=requestBudget(false)||requested;if(requested)preview.setRequest(requested);frameNote();}
  function scheduleDetailed(){if(detailTimer||!entered||document.hidden||pointers.size||preview.state().playing||preview.state().suspended||exporter.snapshot().active||document.querySelector('dialog:modal'))return;const target=requestBudget(true);if(!target)return;if(detailError||JSON.stringify(target)===JSON.stringify(requested)){scheduleThumbnails();return;}detailTimer=setTimeout(()=>{detailTimer=null;if(!entered||document.hidden||pointers.size||preview.state().playing||preview.state().suspended||exporter.snapshot().active||document.querySelector('dialog:modal'))return;requested=requestBudget(true);if(requested)preview.setRequest(requested);frameNote();},300);}
  $('studioDetailRetry').onclick=()=>{detailError=null;requested=requestBudget(true);if(requested&&!preview.setRequest(requested))preview.refresh({base:true});frameNote();};

  function baseKey(value,size){return JSON.stringify([value.shot,value.output.aspect,value.output.samples,value.numerics,value.look.palette,size]);}
  async function disposeParts({fx,render},{keepFX=false}={}){
   const failures=[];for(const cleanup of [()=>!keepFX&&fx?.dispose(),()=>render?.dispose()]){try{await cleanup();}catch(reason){failures.push(reason.message||String(reason));}}
   if(failures.length)throw Error('Preview cleanup failed: '+failures.join('; '));
  }
  async function dropPipeline(){if(pipeline){const previous=pipeline;pipeline=null;previous.abort.abort();await disposeParts(previous);}}
  async function ensurePipeline(signal,size){
   if(thumbPromise)await thumbPromise;
   if(signal.aborted)throw new DOMException('Preview canceled','AbortError');
   const value=currentShot(),key=baseKey(value,size),resources=bridge.resources();
   if(pipeline?.key===key&&pipeline.renderer===resources.renderer)return pipeline;
   const old=pipeline,reuse=old?.renderer===resources.renderer&&old.fx.canvas.width===size.width&&old.fx.canvas.height===size.height;
   pipeline=null;if(old){old.abort.abort();try{await disposeParts(old,{keepFX:reuse});}catch(reason){if(reuse){try{await disposeParts({fx:old.fx});}catch(cleanup){throw Error(reason.message+' · '+cleanup.message);}}throw reason;}}
   const abort=new AbortController(),cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();let render,fx=reuse?old.fx:null;
   try{render=await root.TetraStudioRender.prepare(value,{...resources,size,signal:abort.signal});if(signal.aborted)throw new DOMException('Preview canceled','AbortError');fx=fx||FX.createCompositor(resources.renderer,size);}
   catch(reason){try{await disposeParts({fx,render});}catch(cleanup){throw Error(reason.message+' · '+cleanup.message);}throw reason;}finally{signal.removeEventListener('abort',cancel);}
   pipeline={key,render,fx,abort,renderer:resources.renderer};return pipeline;
  }
  function makePreview(){
   const p=project();preview=root.TetraStudioPreview.create({frameCount:p.shot.frameCount,fps:p.shot.fps,
    renderBase:async(k,{signal,request})=>{const target=request||requestBudget(false);if(!target)throw new DOMException('Preview area is hidden','AbortError');const pipe=await ensurePipeline(signal,{width:target.width,height:target.height});if(signal.aborted)throw new DOMException('Preview canceled','AbortError');const base=await pipe.render.renderBase(k,target.quality==='quick'?'preview':'final',signal);base.pipe=pipe;return base;},
    compose:(base,{k,signal,generation})=>{composedSamples=base.samples;composedCamera=copy(base.pipe.render.plan.frames[k].camera);return base.pipe.fx.compose(base,{look:project().look,k,fps:project().shot.fps,rollDeg:base.pipe.render.plan.frames[k].camera.rollDeg,original,framing:!!endpoint,motion:project().shot.motion==='travel',sequence:generation,signal});},
    present:(canvas)=>{if(!entered)return;displayedSamples=composedSamples;displayedCamera=composedCamera;displayedSize={width:canvas.width,height:canvas.height};detailError=null;if(stage.width!==canvas.width||stage.height!==canvas.height){stage.width=canvas.width;stage.height=canvas.height;}if(completedImage.width!==canvas.width||completedImage.height!==canvas.height){completedImage.width=canvas.width;completedImage.height=canvas.height;}completedContext.drawImage(canvas,0,0);context.drawImage(canvas,0,0);if(endpoint)warpPreview();frameNote();},
    onState:state=>{if(!entered)return;$('studioScrub').value=state.desiredK;$('studioTime').textContent=`${(state.desiredK/project().shot.fps).toFixed(3)} s / ${(project().shot.frameCount/project().shot.fps).toFixed(3)} s${state.pending?' · Pending':''}`;$('studioPlay').setAttribute('aria-pressed',String(state.playing));if(state.error){if(requested?.quality==='detailed'){detailError=state.error;frameNote();}else announce(state.error);}
     const look=project().look,spatial=look.amount>0&&((look.prism.enabled&&look.prism.amount>0&&look.prism.offsetRatio>0)||(look.kaleido.enabled&&look.kaleido.blend>0));
     if(state.playing&&!endpoint&&!spatial&&pipeline?.render.plan.project.shot.motion==='travel'){const camera=pipeline.render.plan.frames[state.desiredK]?.camera;if(camera)warpCamera(camera);}
     if(!state.playing&&!state.pending&&!state.suspended)scheduleDetailed();
    }
   });
  }
  function fitCanvas(){if(!entered)return;const size=M.dimensions(project().output),box=$('studioCanvasArea').getBoundingClientRect(),ratio=size.width/size.height,w=Math.max(0,Math.min(box.width,box.height*ratio));stage.style.width=w+'px';stage.style.height=w/ratio+'px';}
  function scheduleThumbnails(){if(thumbTimer||thumbPromise||thumbDone===thumbRevision)return;thumbTimer=setTimeout(()=>{thumbTimer=null;queueThumbnails();},300);}

  function thumbnailsChanged(){thumbRevision++;thumbAbort?.abort();}
  async function clearThumbnails(){for(const entry of thumbBases.values()){await entry.fx.dispose();entry.source.renderer.releaseFrame(entry.source.frame);}thumbBases.clear();}
  async function thumbnailBase(which,shot,size,signal){
   const resources=bridge.resources(),key=JSON.stringify([shot.shot.start,shot.look.palette,shot.numerics,size]);let entry=thumbBases.get(which);
   if(entry?.key===key&&entry.source.renderer===resources.renderer)return entry;
   if(entry){await entry.fx.dispose();entry.source.renderer.releaseFrame(entry.source.frame);thumbBases.delete(which);}
   let render=null,base=null,frame=null;
   try{
    render=await root.TetraStudioRender.prepare(shot,{...resources,size,signal});base=await render.renderBase(0,'preview',signal);
    // Two tiny endpoint thumbnail images are UI scratch. They retain only the
    // completed orbit pixels, so look edits recompose without new orbit work.
    frame=resources.renderer.beginFrame(base.frame.width,base.frame.height,base.frame);await resources.renderer.fence();
    if(signal.aborted)throw new DOMException('Thumbnail canceled','AbortError');
    entry={key,source:{complete:true,renderer:resources.renderer,frame},fx:FX.createCompositor(resources.renderer,size)};thumbBases.set(which,entry);frame=null;return entry;
   }finally{base?.release();if(frame)resources.renderer.releaseFrame(frame);await render?.dispose();}
  }
  function queueThumbnails(){
   if(!entered||!preview||thumbStarting||thumbPromise||thumbDone===thumbRevision||exporter.snapshot().active||document.hidden||preview.state().pending||preview.state().playing||document.querySelector('dialog:modal'))return;
   thumbStarting=true;const revision=thumbRevision,value=project();thumbAbort=new AbortController();const signal=thumbAbort.signal;
   const work=preview.idleTask(async idleSignal=>{
    idleSignal.addEventListener('abort',()=>thumbAbort?.abort(),{once:true});
    const output=M.dimensions(value.output),scale=96/Math.max(output.width,output.height),size={width:Math.max(1,Math.round(output.width*scale)),height:Math.max(1,Math.round(output.height*scale))};
    for(const [which,k]of [['start',0],['end',value.shot.frameCount-1]]){
     if(signal.aborted)break;const shot=M.validate(value);shot.shot.start=copy(value.shot[which]);shot.shot.end=copy(value.shot[which]);shot.shot.motion='hold';
     shot.numerics.iterations='fixed';shot.numerics.fixedIterations=value.numerics.iterations==='fixed'?value.numerics.fixedIterations:Math.max(C.autoIterations(value.shot.start),C.autoIterations(value.shot.motion==='hold'?value.shot.start:value.shot.end));
     {
      const entry=await thumbnailBase(which,shot,size,signal),canvas=await entry.fx.compose(entry.source,{look:value.look,k,fps:value.shot.fps,rollDeg:value.shot[which].rollDeg,signal});
      if(revision===thumbRevision&&entered&&!signal.aborted){const thumb=$('studio'+(which==='start'?'Start':'End')+'Thumb');thumb.width=canvas.width;thumb.height=canvas.height;thumb.getContext('2d').drawImage(canvas,0,0);}
     }
    }
    if(!signal.aborted)thumbDone=revision;
   });if(!work){thumbStarting=false;thumbAbort=null;return;}thumbPromise=work.catch(reason=>{if(reason.name!=='AbortError'){thumbDone=revision;announce(reason.message);}}).finally(()=>{
    thumbPromise=null;thumbAbort=null;thumbStarting=false;if(entered&&!document.hidden&&!exporter.snapshot().active)scheduleDetailed();
   });
  }
  async function drainPreview(){clearTimeout(detailTimer);detailTimer=null;clearTimeout(thumbTimer);thumbTimer=null;thumbAbort?.abort();await preview?.suspend();await thumbPromise;await dropPipeline();}
  const exporter=root.TetraStudioExport.create({drainPreview,setOwner:bridge.setOwner,notify:exportState});
  function exportState(state){
   if(!session)return;const locked=state.active;
   $('studioFields').disabled=locked;$('studioOutputFields').disabled=locked;$('studioTransport').disabled=locked;
   for(const id of ['studioStart','studioEnd','studioPreviewView','studioApply','studioDiscard','studioZoomIn','studioZoomOut'])$(id).disabled=locked;
   for(const id of ['studioName','studioSave','studioFiles','studioHelp','studioUndo','studioRedo','leaveStudio','studioVideo'])$(id).disabled=locked;
   $('studioExportStart').hidden=locked||state.state==='ready';$('studioExportCancel').hidden=!locked;$('studioExportResume').hidden=state.state!=='suspended';$('studioExportClose').disabled=locked;
   $('studioExportProgress').max=state.total||project().shot.frameCount;$('studioExportProgress').value=state.submitted;
   const names={idle:'Ready to export',preparing:state.config?'Preparing GPU':'Checking video support',rendering:`Rendering · ${state.submitted} / ${state.total} frames`,suspended:'Suspended · Resume when this tab is visible',finalizing:'Finalizing video',canceling:'Canceling · waiting for safe cleanup',canceled:'Export canceled',failed:'Export failed: '+state.error,ready:'File ready'};
   $('studioExportState').textContent=names[state.state]+(state.state==='failed'?' · Retry starts from frame 0.':'');$('studioExportStart').textContent=['failed','canceled'].includes(state.state)?'Retry':'Create video';$('studioUseWebM').hidden=locked||!state.alternative;$('studioEditOutput').hidden=locked||state.state!=='failed';$('studioEditRotation').hidden=locked||state.errorCode!=='SOURCE_LIMIT';
   $('studioReturnEdit').hidden=locked||!['ready','failed','canceled'].includes(state.state);$('studioDownload').hidden=state.state!=='ready';$('studioResultVideo').hidden=state.state!=='ready';
   if(state.state==='ready'&&state.url){const video=$('studioResultVideo');if(video.getAttribute('src')!==state.url)video.src=state.url;const link=$('studioDownload');link.href=state.url;link.download=state.result.filename;link.textContent=`Download ${state.result.extension.toUpperCase()} · ${(state.result.bytes/1048576).toFixed(1)} MiB`;}
   else{const video=$('studioResultVideo');if(video.hasAttribute('src')){video.pause();video.removeAttribute('src');video.load();}$('studioDownload').removeAttribute('href');}
   if(!locked)sync();
  }
  function changed(before){
   const next=project(),change=M.changeKind(before,next);if(!change.model){sync();return;}if(change.base||change.look||change.time)thumbnailsChanged();
   if(change.base){cancelGesture();fitCanvas();quick();}
   if(change.time&&(before.shot.frameCount!==next.shot.frameCount||before.shot.fps!==next.shot.fps))preview.setTiming(next.shot.frameCount,next.shot.fps);
   else preview.refresh({base:change.base});sync();exportSummary();
  }
  function edit(mutator){if(exporter.snapshot().active)return;try{const before=project(),clean=endpoint&&!draftDirty();session.applyEdit(mutator);if(clean)draft=copy(project().shot[endpoint]);changed(before);}catch(reason){announce(reason.message);sync();}}
  function commit(){numericRecords.forEach(r=>r.end());session?.commitEdit();sync();}
  function numeric(parent,label,path,{scale=1,step=.01,read=()=>get(project(),path),write=(p,value)=>put(p,path,value),rule=path.replace(/^look\./,''),draftOnly=false,description=''}={}){
   const r=M.RULES[rule],row=document.createElement('div'),range=document.createElement('input'),number=document.createElement('input'),text=document.createElement('label'),reset=document.createElement('button'),error=document.createElement('small'),unit=scale===100?'%':r.unit;
   row.className='studio-number';range.type='range';number.type='number';const id='studio-'+path.replaceAll('.','-');range.id=id;number.id=id+'-number';text.htmlFor=id;text.textContent=label+' ('+unit+')';error.id=id+'-error';error.className='studio-error';number.setAttribute('aria-describedby',error.id);range.setAttribute('aria-label',label+' in '+unit);
   range.min=number.min=(r.values?Math.min(...r.values):r.min)*scale;range.max=number.max=(r.values?Math.max(...r.values):r.max)*scale;range.step=number.step=r.values?2:step*scale;number.setAttribute('aria-label',label+' in '+unit);reset.textContent='Reset';reset.setAttribute('aria-label','Reset '+label);
   let dirty=false,dragStart=null,interaction=null;const tab=parent.closest('[role=tabpanel]')?.id.replace('studio','').replace('Controls','')||null;
   function mark(message=''){error.textContent=message;if(message)number.setAttribute('aria-invalid','true');else number.removeAttribute('aria-invalid');updateTabErrors();}
   function value(){const v=Number(number.value)/scale;if(!number.value.trim()||!Number.isFinite(v)||(r.values?!r.values.includes(v):v<r.min||v>r.max)||(r.integer&&!Number.isInteger(v)))throw Error('Enter '+label+' between '+number.min+' and '+number.max+' '+unit);return v;}
   function apply(v){if(draftOnly){if(!endpoint)throw Error('Edit Start or End to adjust rotation.');draft={...draft,rollDeg:v};draftChanged();}else edit(p=>write(p,v));}
   function finish(event){if(dragStart===null)return;if(event?.type==='change'&&interaction!=='program')return;if(event?.type==='keyup'&&!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;commit();}
   function begin(source='program'){if(exporter.snapshot().active)return;if(dragStart!==null)return;if(numericRecords.some(r=>r.dragging))commit();interaction=source;dragStart=draftOnly?copy(draft):project();if(!draftOnly&&!session.editing)session.beginEdit();}
   function cancel(){if(dragStart===null)return;const before=project();if(draftOnly){draft=dragStart;draftChanged();}else{session.cancelEdit();changed(before);}dragStart=null;interaction=null;dirty=false;mark();sync();}
   range.onpointerdown=()=>begin('pointer');range.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))begin('keyboard');};
   range.oninput=()=>{begin();apply(Number(range.value)/scale);number.value=range.value;dirty=false;mark();};range.onchange=range.onpointerup=range.onkeyup=range.onblur=range.onlostpointercapture=finish;range.onpointercancel=cancel;
   const record={path,tab,number,get dragging(){return dragStart!==null;},end(){dragStart=null;interaction=null;},commit(){if(!dirty&&!number.hasAttribute('aria-invalid'))return true;try{const v=value();apply(v);dirty=false;mark();sync();return true;}catch(reason){mark(reason.message);return false;}},revert(){dirty=false;mark();number.value=String(Number((read()*scale).toFixed(5)));}};
   number.oninput=()=>{dirty=true;try{value();mark();}catch(reason){mark(reason.message);}};number.onchange=()=>record.commit();number.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();record.revert();}};
   reset.onclick=()=>{finish();dirty=false;mark();apply(r.default);record.revert();sync();};row.append(text,range,number,reset,error);if(description){const small=document.createElement('small');small.textContent=description;row.append(small);}parent.append(row);numericRecords.push(record);
   records.push(()=>{if(!session)return;const v=read();range.value=v*scale;if(!dirty&&!number.hasAttribute('aria-invalid'))number.value=String(Number((v*scale).toFixed(5)));const group=/^look\.(bloom|pulse|prism|kaleido|wave)\./.exec(path),disabled=exporter.snapshot().active||(draftOnly&&!endpoint)||(group&&!get(project(),'look.'+group[1]+'.enabled'));range.disabled=number.disabled=reset.disabled=!!disabled;});
  }
  function updateTabErrors(){for(const tab of ['Motion','Look','Rhythm']){const invalid=numericRecords.some(r=>r.tab===tab&&r.number.hasAttribute('aria-invalid')),el=$('studio'+tab+'Tab');el.dataset.invalid=String(invalid);el.setAttribute('aria-description',invalid?'Contains an invalid value':'Shot controls');}}
  function select(parent,label,values,read,write){
   const row=document.createElement('label'),input=document.createElement('select');row.className='studio-select';row.append(document.createTextNode(label));input.setAttribute('aria-label',label);
   for(const item of values){const [value,text]=Array.isArray(item)?item:[item,item],option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}row.append(input);parent.append(row);
   input.onchange=()=>write(input.value);records.push(()=>{if(session)input.value=read();});return input;
  }
  function toggle(parent,label,path){const row=document.createElement('label'),input=document.createElement('input');row.className='studio-switch';input.type='checkbox';row.append(document.createTextNode(label),input);parent.append(row);input.onchange=()=>{const value=input.checked;if(!value){const invalid=numericRecords.find(r=>r.path.startsWith(path.replace('.enabled','')+'.')&&!r.commit());if(invalid){input.checked=get(project(),path);announce('Correct the highlighted effect value, or Reset it before turning the effect off.');revealNumber(invalid);return;}}edit(p=>put(p,path,value));};records.push(()=>{if(session)input.checked=get(project(),path);});return input;}
  function section(id,title){const parent=$(id),h=document.createElement('h2');h.textContent=title;parent.append(h);return parent;}
  function details(parent,title){const el=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title;el.append(summary);parent.append(el);return el;}
  const motion=section('studioMotionControls','Motion');
  select(motion,'Path',[['hold','Still'],['in','Tunnel In'],['out','Tunnel Out'],['drift','Drift']],()=>project().shot.motion==='hold'?'hold':M.motionLabel(project()).replace('Tunnel ','').toLowerCase(),async value=>{
   if(!commitNumbers()){sync();return;}if(value==='hold'){pause();edit(p=>{p.shot.motion='hold';});return;}
   if(!await settleDraft()){sync();return;}
   const label=M.motionLabel({...M.validate(project()),shot:{...project().shot,motion:'travel'}}),equal=project().shot.start.span===project().shot.end.span;
   if(value==='drift'&&!equal){if(await ask('Match End zoom to Start for a constant-scale Drift?',[['yes','Match end zoom'],['cancel','Cancel']])!=='yes'){sync();return;}edit(p=>{p.shot.end.span=p.shot.start.span;p.shot.motion='travel';});}
   else if((value==='in'||value==='out')&&equal){announce('Set a '+(value==='in'?'closer':'farther')+' End, then choose Tunnel '+value+'.');await selectEndpoint('end');sync();}
   else if(value==='in'&&label==='Tunnel Out'||value==='out'&&label==='Tunnel In'){
    if(await ask('Reverse start and end to change the zoom direction?',[['yes','Reverse start and end'],['cancel','Cancel']])==='yes')edit(p=>{[p.shot.start,p.shot.end]=[p.shot.end,p.shot.start];p.shot.motion='travel';});else sync();
   }else edit(p=>{p.shot.motion='travel';});
  });
  const reverse=document.createElement('button');reverse.textContent='Reverse Path';reverse.onclick=async()=>{if(await settleDraft())edit(p=>C.reverseEndpoints(p));};motion.append(reverse);
  numeric(motion,'Duration','duration',{rule:'duration',step:1/30,read:()=>project().shot.frameCount/project().shot.fps,write:(p,v)=>M.setDuration(p,v)});
  const motionDetails=details(motion,'Speed, easing and rotation');
  numeric(motionDetails,'Speed','speed',{rule:'speed',step:.01,read:()=>10/(project().shot.frameCount/project().shot.fps),write:(p,v)=>M.setSpeed(p,v),description:'1× = 10 seconds. Duration uses whole frames.'});
  select(motionDetails,'Easing',M.ENUMS.easing,()=>project().shot.easing,value=>edit(p=>{p.shot.easing=value;}));
  numeric(motionDetails,'Endpoint rotation','rollDeg',{rule:'rollDeg',step:1,read:()=>draft?.rollDeg??0,draftOnly:true,description:'Edit Start or End. +180° to −180° turns a full circle.'});
  function effect(parent,title,key){const group=document.createElement('section'),header=document.createElement('div'),heading=document.createElement('h3'),note=document.createElement('p');group.className='studio-effect';header.className='studio-effect-header';heading.textContent=title;header.append(heading);toggle(header,title+' enabled','look.'+key+'.enabled');note.className='studio-effect-note';group.append(header,note);parent.append(group);effectGroups.push({key,note});const reset=document.createElement('button');reset.textContent='Reset '+title;reset.onclick=()=>{commit();numericRecords.filter(r=>r.path.startsWith('look.'+key+'.')).forEach(r=>r.revert());edit(p=>{p.look[key]=M.neutralLook(p.look.palette)[key];});sync();};group.append(reset);return group;}
  const look=section('studioLookControls','Look');
  select(look,'Preset',[...FX.PRESET_NAMES,'Custom'],()=>FX.presetName(project()),value=>{if(value!=='Custom'){commit();clearInvalidNumbers('look');edit(p=>FX.applyPreset(p,value));}});
  select(look,'Palette',M.ENUMS.palette,()=>project().look.palette,value=>edit(p=>{p.look.palette=value;}));
  for(const [label,path]of [['Hue','hueDeg'],['Saturation','saturation'],['FX Amount','amount']])numeric(look,label,'look.'+path,{step:path==='hueDeg'?1:.01});
  const color=details(look,'Color details');numeric(color,'Color cycle speed','look.hueRate',{step:.001});numeric(color,'Exposure','look.exposureEV',{description:'EV changes brightness by powers of two.'});
  const glow=effect(look,'Glow','bloom');numeric(glow,'Glow strength','look.bloom.intensity');const gd=details(glow,'Glow size and threshold');numeric(gd,'Glow size','look.bloom.radiusRatio',{scale:100,step:.0001});numeric(gd,'Glow threshold','look.bloom.threshold');
  const prism=effect(look,'Prism','prism');numeric(prism,'Prism blend','look.prism.amount');numeric(prism,'Prism separation','look.prism.offsetRatio',{scale:100,step:.0001});
  const kaleido=effect(look,'Kaleidoscope','kaleido');numeric(kaleido,'Kaleidoscope blend','look.kaleido.blend');const kd=details(kaleido,'Segments and angle');numeric(kd,'Kaleidoscope segments','look.kaleido.segments');numeric(kd,'Kaleidoscope angle','look.kaleido.angleDeg',{step:1});
  const resetLook=document.createElement('button');resetLook.textContent='Reset Look';resetLook.onclick=()=>{commit();clearInvalidNumbers('look');edit(p=>FX.applyPreset(p,'Neutral'));};look.append(resetLook);
  const rhythm=section('studioRhythmControls','Rhythm'),pulse=effect(rhythm,'Pulse','pulse');numeric(pulse,'Pulse interval','look.pulse.period');numeric(pulse,'Pulse strength','look.pulse.strength');const pd=details(pulse,'Pulse shape and response');numeric(pd,'Pulse sharpness','look.pulse.sharpness',{description:'Higher sharpness makes a narrower crest; Play to see the pulse.'});for(const [label,path]of [['Pulse phase','pulse.phase'],['Exposure response','pulse.exposureEV'],['Glow response','pulse.bloomGain']])numeric(pd,label,'look.'+path);
  const wave=effect(rhythm,'Glow Wave','wave');numeric(wave,'Wave strength','look.wave.strengthEV');numeric(wave,'Wave speed','look.wave.speed',{description:'Positive: Outward · Negative: Inward · Zero: Still'});numeric(details(wave,'Wave bands'),'Wave bands','look.wave.fieldCycles');
  const rhythmNote=document.createElement('p');rhythmNote.textContent='Pulse and Glow Wave also work with a still camera. Press Play to see time effects.';rhythm.append(rhythmNote);
  const output=section('studioOutputControls','Video output');
  for(const [label,path,values]of [['Aspect','aspect',M.ENUMS.aspect],['Resolution','resolution',M.ENUMS.resolution],['Sampling','samples',[[4,'Standard · 4 samples'],[16,'Fine · 16 samples']]],['Format','container',[['auto','MP4 preferred — checked when creating'],['mp4','MP4 / AVC'],['webm','WebM / VP9']]]])select(output,label,values,()=>project().output[path],value=>edit(p=>{p.output[path]=['resolution','samples'].includes(path)?Number(value):value;}));
  select(output,'FPS',M.ENUMS.fps,()=>project().shot.fps,value=>edit(p=>M.setFps(p,Number(value))));
  const advanced=details(output,'Advanced');select(advanced,'Iterations',[['auto-shot','Auto for shot'],['fixed','Fixed cap']],()=>project().numerics.iterations,value=>edit(p=>{p.numerics.iterations=value;}));numeric(advanced,'Fixed cap','numerics.fixedIterations',{rule:'fixedIterations',step:1});
  function sync(){
   if(!session)return;records.forEach(fn=>fn());if(document.activeElement!==$('studioName'))$('studioName').value=project().name;
   const locked=exporter.snapshot().active,p=project(),same=JSON.stringify(draft)===JSON.stringify(p.shot.start);
   $('studioSaved').textContent=session.dirty?'Unsaved changes':'Saved on device';$('studioUndo').disabled=locked||!session.canUndo;$('studioRedo').disabled=locked||!session.canRedo;
   $('studioStart').setAttribute('aria-pressed',String(endpoint==='start'));$('studioEnd').setAttribute('aria-pressed',String(endpoint==='end'));$('studioEndUnused').hidden=p.shot.motion!=='hold';
   $('studioPreviewView').setAttribute('aria-pressed',String(!endpoint));$('studioFramingTools').hidden=!endpoint;$('studioZoomIn').disabled=$('studioZoomOut').disabled=locked;
   const ratio=endpoint?Number(p.shot.start.span)/Number(draft.span):1;$('studioZoom').textContent=ratio>=.01&&ratio<10000?ratio.toFixed(ratio<10?2:0)+'×':ratio.toExponential(1)+'×';
   $('studioApply').disabled=locked||!endpoint;$('studioApply').hidden=!endpoint||setup==='end'&&same;$('studioApply').textContent=setup==='end'?'Use as End & animate':endpoint==='end'?'Use as End':'Use as Start';$('studioDiscard').disabled=locked||!endpoint;$('studioDiscard').hidden=!endpoint||!draftDirty()||setup==='end';
   $('studioViewLabel').textContent=endpoint?'Editing '+(endpoint==='start'?'start':'end'):'Preview · '+(p.shot.motion==='hold'?'Camera is still':M.motionLabel(p));stage.dataset.editing=String(!!endpoint);stage.setAttribute('aria-label',endpoint?'Shot framing. Drag or zoom, then Use as '+(endpoint==='start'?'Start':'End')+'.':'Video preview. Edit Start or Edit End to change framing.');
   $('studioGuidance').textContent=setup==='start'?'Drag or zoom to choose Start.':setup==='end'?(same?'Choose a different End, or keep the camera still.':'Confirm End to animate from Start.'):endpoint?'Drag or zoom to adjust '+(endpoint==='start'?'Start':'End')+'.':'Play to preview. Look / Rhythm add effects.';
   $('studioStill').hidden=$('studioStillNote').hidden=setup!=='end';$('studioStill').title='Proceed without using the unconfirmed end draft; the stored end is preserved.';
   $('studioAnimate').hidden=setup!==null||endpoint!=='end'||draftDirty()||p.shot.motion!=='hold'||JSON.stringify(p.shot.start)===JSON.stringify(p.shot.end);
   const spatial=!!endpoint&&!original&&p.look.amount>0&&((p.look.prism.enabled&&p.look.prism.amount>0&&p.look.prism.offsetRatio>0)||(p.look.kaleido.enabled&&p.look.kaleido.blend>0));
   $('studioBypass').textContent=original?'Original comparison — preview only; final video uses your effects.':p.look.amount===0?'Effects bypassed: amount is 0. Adjust FX Amount in Look.':spatial?'Spatial effects are hidden while framing.':'';
   $('studioShowEffects').hidden=!original;$('studioViewEffects').hidden=!spatial;$('studioAdjustAmount').hidden=original||p.look.amount!==0;
   for(const {key,note}of effectGroups){const value=p.look[key];note.textContent=!value.enabled?'Off — turn on to adjust':p.look.amount===0?'Effects bypassed: amount is 0':original?'Original comparison — preview only':key==='wave'?(value.speed>0?'Outward':value.speed<0?'Inward':'Still')+' · '+value.speed+' cycles/s':(['bloom','pulse','prism','kaleido'].includes(key)&&((value.intensity??value.strength??value.amount??value.blend)===0))?'On · strength is 0':'';}
   $('studioScrub').max=p.shot.frameCount-1;$('studioOriginal').setAttribute('aria-pressed',String(original));updateTabErrors();
  }
  function warpCamera(camera){
   if(!entered||!displayedCamera||!completedImage.width)return;
   const matrix=C.screenMatrix(displayedCamera,camera,stage.width,stage.height);if(!matrix.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6))return;
   context.save();context.fillStyle='#080812';context.fillRect(0,0,stage.width,stage.height);context.setTransform(...matrix);context.drawImage(completedImage,0,0);context.restore();
  }
  function warpPreview(){if(endpoint)warpCamera(draft);}
  function draftChanged(){
   clearTimeout(detailTimer);detailTimer=null;detailError=null;warpPreview();
   if(framingRaf===null)framingRaf=requestAnimationFrame(()=>{framingRaf=null;if(!entered||!endpoint)return;quick();preview.refresh({base:true});sync();});
  }
  function applyDraft({advance=true}={}){
   if(!endpoint)return;if(advance&&!commitNumbers())return;const which=endpoint,value=copy(draft);
   if(setup==='end'&&advance){edit(p=>{p.shot.end=value;p.shot.motion='travel';});setup=null;endpoint=null;draft=null;quick();preview.seek(0,{request:requested});sync();announce('End applied. '+M.motionLabel(project())+'. Press Play to preview.');return;}
   if(draftDirty())edit(p=>{p.shot[which]=value;});draft=copy(project().shot[which]);
   if(setup==='start'&&advance){setup='end';endpoint='end';draft=copy(project().shot.start);cancelGesture();quick();preview.seek(project().shot.frameCount-1,{request:requested});announce('');}
   else{if(!advance)setup=null;announce((which==='start'?'Start':'End')+' applied.'+(project().shot.motion==='hold'?' Camera is still.':''));}sync();
  }
  async function settleDraft({discardInputs=false}={}){
   pause();if(!commitNumbers()){
    if(!discardInputs||await ask('Discard invalid numeric entries and continue? Valid project values will be preserved.',[['discard','Discard invalid inputs'],['cancel','Cancel']])!=='discard'){nextTransition=null;return false;}clearInvalidNumbers();
   }
   if(!draftDirty())return true;
   const answer=await ask('Apply the changes to '+(endpoint==='start'?'Start':'End')+'?',[['apply','Apply'],['discard','Discard'],['cancel','Cancel']]);
   if(answer==='apply')applyDraft({advance:false});else if(answer==='discard'){draft=copy(project().shot[endpoint]);setup=null;}else{nextTransition=null;return false;}sync();return true;
  }
  async function selectEndpoint(which){if(!await settleDraft())return;setup=null;endpoint=which;draft=copy(project().shot[which]);cancelGesture();quick();preview.seek(which==='start'?0:project().shot.frameCount-1,{request:requested});sync();}
  $('studioStart').onclick=()=>transition(()=>selectEndpoint('start'));$('studioEnd').onclick=()=>transition(()=>selectEndpoint('end'));$('studioApply').onclick=()=>transition(async()=>applyDraft());
  $('studioDiscard').onclick=()=>{draft=copy(project().shot[endpoint]);setup=null;clearInvalidNumbers();draftChanged();};
  async function previewView(play=false){if(!await settleDraft())return;setup=null;endpoint=null;draft=null;cancelGesture();quick();preview.seek(preview.state().desiredK,{request:requested});sync();if(play)preview.play();}
  $('studioPreviewView').onclick=$('studioViewEffects').onclick=()=>transition(()=>previewView());$('studioPlay').onclick=()=>transition(()=>previewView(true));$('studioPause').onclick=pause;
  $('studioStill').onclick=()=>transition(async()=>{pause();if(!commitNumbers())return;edit(p=>{p.shot.motion='hold';});setup=null;endpoint=null;draft=null;quick();preview.seek(0,{request:requested});sync();announce('Camera stays at Start. The unconfirmed End draft was not used; the stored End was preserved.');});
  $('studioAnimate').onclick=()=>transition(async()=>{if(!await settleDraft())return;edit(p=>{p.shot.motion='travel';});endpoint=null;draft=null;setup=null;quick();preview.seek(0,{request:requested});sync();});
  $('studioScrub').oninput=()=>transition(async()=>{const k=Number($('studioScrub').value);if(!await settleDraft())return;endpoint=null;draft=null;setup=null;quick();sync();preview.seek(k,{request:requested});});
  $('studioOriginal').onclick=()=>{original=!original;preview.refresh();sync();};$('studioShowEffects').onclick=()=>{original=false;preview.refresh();sync();};
  $('studioAdjustAmount').onclick=()=>revealNumber(numericRecords.find(r=>r.path==='look.amount'));
  $('studioName').onchange=()=>{const name=$('studioName').value;edit(p=>{p.name=name;});};
  for(const [id,method]of [['studioUndo','undo'],['studioRedo','redo']])$(id).onclick=()=>transition(async()=>{if(!await settleDraft())return;const before=project();session[method]();setup=null;if(endpoint)draft=copy(project().shot[endpoint]);clearInvalidNumbers();changed(before);});
  $('studioSave').onclick=()=>transition(async()=>{if(!await settleDraft())return;try{session.save(store);announce('Project saved on this device. Export video creates a video file.');sync();}catch(reason){announce(reason.message);}});
  async function replaceProject(value,{saved=false,newShot=false}={}){
   if(!await settleDraft({discardInputs:true}))return false;
   if(session.dirty&&await ask('Replace this shot with unsaved changes? Export project JSON first to keep a copy.',[['yes','Discard changes and replace'],['cancel','Cancel']])!=='yes')return false;
   await drainPreview();await preview.dispose();await clearThumbnails();if(newShot)session=M.createSession(value);else if(saved)session.load(value);else session.import(M.serialize(value));endpoint=newShot?'start':null;draft=newShot?copy(project().shot.start):null;setup=newShot?'start':null;original=false;clearInvalidNumbers();thumbnailsChanged();requested=null;detailError=null;makePreview();sync();fitCanvas();requested=requestBudget(false);preview.seek(0,{request:requested});announce(newShot?'Frame your start view.':saved?'Project loaded.':'Project imported.');return true;
  }
  function listProjects(){
   const list=$('studioProjectList');list.replaceChildren();try{for(const item of store.list()){
    const row=document.createElement('div'),load=document.createElement('button'),remove=document.createElement('button');load.textContent=item.name;remove.textContent='Delete';remove.setAttribute('aria-label','Delete '+item.name);
    load.onclick=()=>transition(async()=>{if(await replaceProject(item,{saved:true}))$('studioProjects').close();});remove.onclick=async()=>{if(await ask('Delete saved project “'+item.name+'” from this device?',[['yes','Delete'],['cancel','Cancel']])==='yes'){try{store.delete(item.id);if(item.id===project().id){session.markUnsaved();sync();}listProjects();}catch(reason){$('studioProjectMessage').textContent=reason.message;announce(reason.message);}}};row.append(load,remove);list.append(row);
   }}catch(reason){const text=document.createElement('p');text.textContent=reason.message;list.append(text);}}
  $('studioFiles').onclick=()=>{$('studioProjectMessage').textContent='';listProjects();openModal('studioProjects');};$('studioProjectsClose').onclick=()=>$('studioProjects').close();
  $('studioNew').onclick=()=>transition(async()=>{if(await replaceProject(M.createProject(bridge.snapshot()),{newShot:true}))$('studioProjects').close();});
  $('studioImport').onclick=()=>$('studioImportFile').click();$('studioImportFile').onchange=()=>transition(async()=>{const file=$('studioImportFile').files[0];try{if(file){if(file.size>M.MAX_JSON_BYTES)throw Error('Project exceeds 128 KiB');const value=M.deserialize(await file.text());if(await replaceProject(value))$('studioProjects').close();}}catch(reason){$('studioProjectMessage').textContent=reason.message;announce(reason.message);}finally{$('studioImportFile').value='';}});
  $('studioJSON').onclick=()=>transition(async()=>{if(!await settleDraft())return;const blob=new Blob([M.serialize(project())],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=root.TetraStudioExport.filename(project().name,'json');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);announce('Project JSON is ready to save.');});
  function settingsLayout(){if(!entered)return;$('studioSettings').hidden=!wide.matches&&!settingsOpen;$('studioSettingsBtn').setAttribute('aria-expanded',String(!$('studioSettings').hidden));fitCanvas();}
  $('studioSettingsBtn').onclick=()=>{settingsOpen=!settingsOpen;settingsLayout();};$('studioSettingsClose').onclick=()=>{settingsOpen=false;settingsLayout();$('studioSettingsBtn').focus();};wide.addEventListener('change',settingsLayout);
  new ResizeObserver(()=>{cancelGesture();fitCanvas();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!entered||exporter.snapshot().active||document.hidden)return;if(preview.state().playing)quick();else scheduleDetailed();},150);}).observe($('studioCanvasArea'));
  function exportSummary(){if(!session)return;const p=project(),size=M.dimensions(p.output);$('studioExportSummary').textContent=`${size.width} × ${size.height} · ${p.shot.fps} fps · ${(p.shot.frameCount/p.shot.fps).toFixed(3)} s · ${p.shot.frameCount} frames · silent video · ${p.output.container==='auto'?'MP4 preferred — checked when creating':p.output.container==='webm'?'WebM / VP9 requested':'MP4 / AVC requested'}`;$('studioExportProgress').max=p.shot.frameCount;}
  $('studioVideo').onclick=()=>transition(async()=>{if(!await settleDraft())return;endpoint=null;draft=null;setup=null;preview.refresh({base:true});sync();exportSummary();exportState(exporter.snapshot());openModal('studioExportDialog');});
  $('studioExportStart').onclick=async()=>{pause();if(!commitNumbers())return;try{await exporter.start(project(),{getResources:bridge.resources});}catch(reason){announce(reason.message);}};
  $('studioExportCancel').onclick=()=>exporter.cancel();$('studioExportResume').onclick=()=>exporter.resume();
  $('studioUseWebM').onclick=()=>{edit(p=>{p.output.container='webm';});exporter.clearResult();exportSummary();announce('WebM selected. Create video starts again from frame 0.');};
  $('studioEditOutput').onclick=()=>{document.querySelector('#studioOutputControls select').focus();};$('studioEditRotation').onclick=()=>{closeExport();selectEndpoint(project().shot.motion==='hold'?'start':'end').then(()=>{chooseTab('Motion');settingsOpen=true;settingsLayout();motionDetails.open=true;$('studio-rollDeg-number').focus();});};
  function closeExport(){if(exporter.snapshot().active)return;exporter.clearResult();$('studioExportDialog').close();}
  $('studioExportClose').onclick=$('studioReturnEdit').onclick=closeExport;$('studioExportDialog').addEventListener('cancel',e=>{if(exporter.snapshot().active)e.preventDefault();else exporter.clearResult();});
  for(const id of ['studioProjects','studioExportDialog','studioHelpDialog'])$(id).addEventListener('close',()=>{if(id==='studioExportDialog'&&!exporter.snapshot().active)exporter.clearResult();if(entered&&!document.hidden&&!exporter.snapshot().active&&!document.querySelector('dialog:modal'))preview.resume();});
  $('studioHelp').onclick=()=>openModal('studioHelpDialog');$('studioHelpClose').onclick=()=>$('studioHelpDialog').close();
  function normalizedPoint(event){const r=gesture?.mapping||stage.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top,width:r.width,height:r.height};}
  function startGesture(){
   if(!endpoint||!pointers.size){gesture=null;return;}
   const values=[...pointers.values()],point=values.length>1?{x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2}:values[0];
   const mapping=stage.getBoundingClientRect();if(mapping.width<=0||mapping.height<=0){gesture=null;return;}gesture={mapping:{left:mapping.left,top:mapping.top,width:mapping.width,height:mapping.height},camera:copy(draft),anchor:C.screenToWorld(draft,point.x,point.y,mapping.width,mapping.height),distance:values.length>1?Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y):null};
  }
  function boundedCamera(value){const min=F.parse('1e-200'),max=F.parse('1e12'),limit=F.parse('1e12'),clamp=(v,a,b)=>v<a?a:v>b?b:v;return {...value,x:F.text(clamp(F.parse(value.x),-limit,limit)),y:F.text(clamp(F.parse(value.y),-limit,limit)),span:F.text(clamp(F.parse(value.span),min,max))};}
  function anchorCamera(camera,anchor,point,span){const mapping=gesture?.mapping||stage.getBoundingClientRect(),next={...camera,span},mapped=C.screenToWorld(next,point.x,point.y,mapping.width,mapping.height);return boundedCamera({...next,x:F.text(F.parse(next.x)+F.parse(anchor.x)-F.parse(mapped.x)),y:F.text(F.parse(next.y)+F.parse(anchor.y)-F.parse(mapped.y))});}
  stage.addEventListener('pointerdown',e=>{if(!endpoint||exporter.snapshot().active){announce('Select Start or End to frame the shot.');return;}e.preventDefault();pause();quick();stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,normalizedPoint(e));startGesture();});
  stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,normalizedPoint(e));const values=[...pointers.values()],point=values.length>1?{x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2}:values[0];
   let span=gesture.camera.span;if(gesture.distance&&values.length>1){const distance=Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y);if(distance>0)span=F.text(F.mul(F.parse(span),F.parse(String(gesture.distance/distance))));}
   draft=anchorCamera(gesture.camera,gesture.anchor,point,span);draftChanged();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,e=>{pointers.delete(e.pointerId);startGesture();if(!pointers.size)scheduleDetailed();});
  function zoom(factor,point){if(!endpoint){announce('Select Start or End to frame the shot.');return;}const box=stage.getBoundingClientRect();if(box.width<=0||box.height<=0)return;const anchor=C.screenToWorld(draft,point.x,point.y,box.width,box.height),span=F.text(F.mul(F.parse(draft.span),F.parse(String(factor))));draft=anchorCamera(draft,anchor,point,span);draftChanged();}
  stage.addEventListener('wheel',e=>{if(exporter.snapshot().active)return;e.preventDefault();zoom(Math.exp(Math.max(-.5,Math.min(.5,e.deltaY*.002))),normalizedPoint(e));},{passive:false});
  stage.addEventListener('dblclick',e=>zoom(.5,normalizedPoint(e)));
  for(const [id,factor]of [['studioZoomIn',.5],['studioZoomOut',2]])$(id).onclick=()=>{const box=stage.getBoundingClientRect();zoom(factor,{x:box.width/2,y:box.height/2});};
  stage.addEventListener('keydown',e=>{if(!endpoint||exporter.snapshot().active)return;const box=stage.getBoundingClientRect();if(box.width<=0||box.height<=0)return;const key=e.key;if(['+','=','-','_'].includes(key)){e.preventDefault();zoom(key==='+'||key==='='?.5:2,{x:box.width/2,y:box.height/2});}
   else if(key.startsWith('Arrow')){e.preventDefault();const point={x:stage.getBoundingClientRect().width/2,y:stage.getBoundingClientRect().height/2},anchor=C.screenToWorld(draft,point.x+(key==='ArrowRight'?20:key==='ArrowLeft'?-20:0),point.y+(key==='ArrowDown'?20:key==='ArrowUp'?-20:0),stage.getBoundingClientRect().width,stage.getBoundingClientRect().height);draft=anchorCamera(draft,anchor,point,draft.span);draftChanged();}
  });
  document.addEventListener('keydown',e=>{
   if(!entered||document.querySelector('dialog:modal')||e.target.closest('input,select,textarea,[contenteditable=true]')||exporter.snapshot().active)return;
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'studioRedo':'studioUndo').click();}
   else if(e.code==='Space'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.closest('button,a,summary')){e.preventDefault();if(preview.state().playing)preview.pause();else transition(()=>previewView(true));}
   else if(e.key==='Escape'){e.preventDefault();if(draftDirty()){draft=copy(project().shot[endpoint]);preview.refresh({base:true});sync();}else preview.pause();}
  });
  document.addEventListener('visibilitychange',()=>{if(!entered)return;cancelGesture();if(document.hidden){thumbAbort?.abort();preview.suspend();exporter.hidden();}else{const state=exporter.snapshot();if(state.state==='suspended')exportState(state);else if(!state.active&&!document.querySelector('dialog:modal'))preview.resume();}});
  matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',e=>{if(e.matches&&entered)preview.pause();});
  window.addEventListener('pagehide',()=>{if(entered){thumbAbort?.abort();preview.suspend();exporter.cancel();}});
  const api={
   async enter(){
    if(entered||entering)return;entering=true;let handed=false;
    try{
     const answer=session?await ask('Continue this shot, or start a new shot from the current Explore view?',[['continue','Continue shot'],['new','New from Explore'],['cancel','Cancel']]):'new';if(answer==='cancel')return;
     bridge.resources();handed=true;await bridge.enter();entered=true;$('studio').hidden=false;document.body.dataset.app='studio';
     if(answer==='new'){session=M.createSession(M.createProject(bridge.snapshot()));setup='start';endpoint='start';draft=copy(project().shot.start);}else{setup=null;endpoint=null;draft=null;}
     original=false;requested=null;displayedSize=null;displayedCamera=null;completedImage.width=completedImage.height=0;detailError=null;settingsOpen=false;chooseTab('Motion');thumbnailsChanged();makePreview();sync();settingsLayout();requested=requestBudget(false);preview.seek(0,{request:requested});stage.focus();announce(answer==='new'?'':'Continue editing or press Play to preview.');
    }catch(reason){try{await drainPreview();await preview?.dispose();await clearThumbnails();}catch{}entered=false;$('studio').hidden=true;document.body.dataset.app='explore';if(handed)await bridge.leave();bridge.error?.(reason.message);announce(reason.message);}finally{entering=false;}
   },
   async leave(){
    if(exporter.snapshot().active||!await settleDraft({discardInputs:true}))return;
    if(session.dirty&&await ask('Leave Studio? This shot remains in this tab. Save project or export JSON to keep it.',[['yes','Return to Explore'],['cancel','Cancel']])!=='yes')return;
    await exporter.dispose();await drainPreview();await preview.dispose();await clearThumbnails();entered=false;cancelGesture();completedImage.width=completedImage.height=0;$('studioSettings').hidden=true;$('studio').hidden=true;document.body.dataset.app='explore';await bridge.leave();$('openStudioBtn').focus();
   },
   deviceLost(){if(!entered)return;thumbAbort?.abort();preview.suspend();exporter.fail('GPU device was lost. Restore the device and retry from frame 0.');announce('GPU device was lost. Return to Explore to restore it, then retry from frame 0.');},
   diagnostics(){const output=exporter.snapshot();return {entered,setup,activeTab,displayedCamera:displayedCamera&&copy(displayedCamera),requested:requested&&copy(requested),displayedSize:displayedSize&&copy(displayedSize),detailError,transitioning,endpoint,draft:draft&&copy(draft),draftDirty:!!session&&!!draftDirty(),project:session&&copy(project()),dirty:session?.dirty,revision:session?.revision,preview:preview?.state(),render:pipeline?.render.diagnostics(),fx:pipeline?.fx.diagnostics(),export:{...output,config:copy(output.config),profile:copy(output.profile),result:output.result?{filename:output.result.filename,bytes:output.result.bytes}:null},notice,thumbnails:{revision:thumbRevision,completed:thumbDone,active:!!thumbPromise}};}
  };
  $('leaveStudio').onclick=()=>transition(()=>api.leave());return api;
 }
 root.TetraStudio={create};
})(globalThis);
