/* Native Studio controls; Explore owns its own camera, history and saved views. */
(function(root){
 'use strict';
 const M=root.TetraStudioModel,C=root.TetraStudioCamera,FX=root.TetraStudioFX,F=createFixed(256);
 const copy=value=>JSON.parse(JSON.stringify(value)),get=(object,path)=>path.split('.').reduce((value,key)=>value[key],object);
 function put(object,path,value){const keys=path.split('.'),last=keys.pop();get(object,keys.join('.'))[last]=value;}
 function create(bridge){
  const $=id=>document.getElementById(id),stage=$('studioCanvas'),context=stage.getContext('2d',{alpha:false}),wide=matchMedia('(min-width:761px)'),records=[];
  let session=null,preview=null,pipeline=null,entered=false,endpoint=null,draft=null,original=false,entering=false,notice='',confirming=null,thumbRevision=0,thumbDone=-1,thumbPromise=null,thumbAbort=null,thumbStarting=false;
  const store=M.createStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
  const pointers=new Map();let gesture=null;
  const thumbBases=new Map();
  const project=()=>session.project;
  const draftDirty=()=>endpoint&&JSON.stringify(draft)!==JSON.stringify(project().shot[endpoint]);
  const announce=text=>{notice=text;$('studioNotice').textContent=text;};
  function clearInvalidNumbers(){document.querySelectorAll('#studioFields input[aria-invalid]').forEach(input=>input.removeAttribute('aria-invalid'));}
  function ask(text,choices){
   if(confirming)return Promise.resolve('cancel');const dialog=$('studioConfirm'),focus=document.activeElement;
   $('studioConfirmText').textContent=text;$('studioConfirmChoices').replaceChildren();
   return new Promise(resolve=>{
    confirming=answer=>{confirming=null;dialog.close();focus?.focus?.();resolve(answer);};
    for(const [value,label]of choices){const button=document.createElement('button');button.textContent=label;button.onclick=()=>confirming?.(value);$('studioConfirmChoices').append(button);}
    dialog.showModal();
   });
  }
  $('studioConfirm').addEventListener('close',()=>confirming?.('cancel'));
  function cancelGesture(){pointers.clear();gesture=null;}
  function currentShot(){const value=M.validate(project());if(endpoint){value.shot.start=copy(draft);value.shot.end=copy(draft);value.shot.motion='hold';}return value;}
  function previewSize(){const size=M.dimensions(project().output),scale=Math.min(1,512/Math.max(size.width,size.height));return {width:Math.round(size.width*scale),height:Math.round(size.height*scale)};}
  function baseKey(value,size){return JSON.stringify([value.shot,value.output.aspect,value.numerics,value.look.palette,size]);}
  async function dropPipeline(){if(pipeline){const previous=pipeline;pipeline=null;previous.abort.abort();await previous.fx?.dispose();await previous.render?.dispose();}}
  async function ensurePipeline(signal){
   if(thumbPromise)await thumbPromise;
   if(signal.aborted)throw new DOMException('Preview canceled','AbortError');
   const value=currentShot(),size=previewSize(),key=baseKey(value,size);
   if(pipeline?.key===key)return pipeline;
   await dropPipeline();const abort=new AbortController(),resources=bridge.resources();
   const render=await root.TetraStudioRender.prepare(value,{...resources,size,signal:abort.signal});
   const fx=FX.createCompositor(resources.renderer,size);pipeline={key,render,fx,abort};return pipeline;
  }
  function makePreview(){
   const p=project();preview=root.TetraStudioPreview.create({frameCount:p.shot.frameCount,fps:p.shot.fps,
    renderBase:async(k,{signal})=>{const pipe=await ensurePipeline(signal);if(signal.aborted)throw new DOMException('Preview canceled','AbortError');const base=await pipe.render.renderBase(k,'preview',signal);base.pipe=pipe;return base;},
    compose:(base,{k,signal})=>base.pipe.fx.compose(base,{look:project().look,k,fps:project().shot.fps,rollDeg:base.pipe.render.plan.frames[k].camera.rollDeg,original,framing:!!endpoint,signal}),
    present:(canvas,{k})=>{if(!entered)return;if(stage.width!==canvas.width||stage.height!==canvas.height){stage.width=canvas.width;stage.height=canvas.height;}context.drawImage(canvas,0,0);fitCanvas();$('studioFrameNote').textContent=`Preview · ${canvas.width} × ${canvas.height} · frame ${k+1} / ${project().shot.frameCount} · 4 samples`;},
    onState:state=>{if(!entered)return;$('studioScrub').value=state.desiredK;$('studioTime').textContent=`${(state.desiredK/project().shot.fps).toFixed(3)} s / ${(project().shot.frameCount/project().shot.fps).toFixed(3)} s${state.pending?' · Pending':''}`;$('studioPlay').setAttribute('aria-pressed',String(state.playing));if(state.error)announce(state.error);if(!state.playing&&!state.pending)queueThumbnails();}
   });
  }
  function fitCanvas(){if(!entered)return;const box=$('studioCanvasArea').getBoundingClientRect(),aspect=M.dimensions(project().output),ratio=aspect.width/aspect.height,w=Math.min(box.width,box.height*ratio);stage.style.width=Math.max(1,w)+'px';stage.style.height=Math.max(1,w/ratio)+'px';}
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
   if(!entered||!preview||thumbStarting||thumbPromise||thumbDone===thumbRevision||exporter.snapshot().active||document.hidden)return;
   thumbStarting=true;const revision=thumbRevision,value=project();thumbAbort=new AbortController();const signal=thumbAbort.signal;
   thumbPromise=(async()=>{
    await preview.suspend();
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
   })().catch(reason=>{if(reason.name!=='AbortError'){thumbDone=revision;announce(reason.message);}}).finally(()=>{
    thumbPromise=null;thumbAbort=null;thumbStarting=false;if(entered&&!document.hidden&&!exporter.snapshot().active)preview.resume();
   });
  }
  async function drainPreview(){thumbAbort?.abort();await preview?.suspend();await thumbPromise;await dropPipeline();}
  const exporter=root.TetraStudioExport.create({drainPreview,setOwner:bridge.setOwner,notify:exportState});
  function exportState(state){
   if(!session)return;const locked=state.active;
   $('studioFields').disabled=locked;$('studioTransport').disabled=locked;
   for(const id of ['studioName','studioSave','studioFiles','studioUndo','studioRedo','leaveStudio','studioVideo'])$(id).disabled=locked;
   $('studioExportStart').hidden=locked||state.state==='ready';$('studioExportCancel').hidden=!locked;$('studioExportResume').hidden=state.state!=='suspended';$('studioExportClose').disabled=locked;
   $('studioExportProgress').max=state.total||project().shot.frameCount;$('studioExportProgress').value=state.submitted;
   const names={idle:'Ready to export',preparing:'Preparing GPU and codec',rendering:`Rendering · ${state.submitted} / ${state.total} frames`,suspended:'Suspended · Resume when this tab is visible',finalizing:'Finalizing video',canceling:'Canceling · waiting for safe cleanup',canceled:'Export canceled',failed:'Export failed: '+state.error,ready:'File ready'};
   $('studioExportState').textContent=names[state.state];
   $('studioReturnEdit').hidden=locked||!['ready','failed','canceled'].includes(state.state);$('studioDownload').hidden=state.state!=='ready';$('studioResultVideo').hidden=state.state!=='ready';
   if(state.state==='ready'&&state.url){const video=$('studioResultVideo');if(video.getAttribute('src')!==state.url)video.src=state.url;const link=$('studioDownload');link.href=state.url;link.download=state.result.filename;link.textContent=`Download ${state.result.extension.toUpperCase()} · ${(state.result.bytes/1048576).toFixed(1)} MiB`;}
   else{const video=$('studioResultVideo');if(video.hasAttribute('src')){video.pause();video.removeAttribute('src');video.load();}$('studioDownload').removeAttribute('href');}
   if(!locked)sync();
  }
  function changed(before){
   const next=project(),change=M.changeKind(before,next);thumbnailsChanged();cancelGesture();
   if(change.time&&before.shot.frameCount!==next.shot.frameCount||before.shot.fps!==next.shot.fps)preview.setTiming(next.shot.frameCount,next.shot.fps);
   else preview.refresh({base:change.base});sync();fitCanvas();
  }
  function edit(mutator){if(exporter.snapshot().active)return;try{const before=project();session.applyEdit(mutator);changed(before);}catch(reason){announce(reason.message);sync();}}
  function commit(){session?.commitEdit();sync();}
  function numeric(parent,label,path,{scale=1,step=.01,read=()=>get(project(),path),write=(p,value)=>put(p,path,value),rule=path.replace(/^look\./,''),draftOnly=false,description=''}={}){
   const r=M.RULES[rule],row=document.createElement('div'),range=document.createElement('input'),number=document.createElement('input'),text=document.createElement('label'),reset=document.createElement('button'),unit=scale===100?'%':r.unit;
   row.className='studio-number';range.type='range';number.type='number';const id='studio-'+path.replaceAll('.','-');range.id=id;number.id=id+'-number';text.htmlFor=id;text.textContent=label+' ('+unit+')';
   range.min=number.min=(r.values?Math.min(...r.values):r.min)*scale;range.max=number.max=(r.values?Math.max(...r.values):r.max)*scale;range.step=number.step=r.values?2:step*scale;number.setAttribute('aria-label',label+' in '+unit);reset.textContent='Reset';reset.setAttribute('aria-label','Reset '+label);
   const apply=value=>{
    if(!Number.isFinite(value)||(r.values?!r.values.includes(value):value<r.min||value>r.max))throw Error(label+' is outside the allowed range');
    if(draftOnly){if(!endpoint)throw Error('Select Start or End to adjust roll.');draft={...draft,rollDeg:value};draftChanged();}else edit(p=>write(p,value));
   };
   range.addEventListener('pointerdown',()=>{if(!draftOnly&&!session.editing)session.beginEdit();});
   range.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&!draftOnly&&!session.editing)session.beginEdit();});
   range.oninput=()=>{if(!draftOnly&&!session.editing)session.beginEdit();try{const invalid=number.hasAttribute('aria-invalid');apply(Number(range.value)/scale);number.value=range.value;number.removeAttribute('aria-invalid');if(invalid)announce('');}catch(reason){announce(reason.message);}};
   range.onchange=range.onpointerup=range.onkeyup=range.onblur=()=>commit();
   number.onchange=()=>{try{if(!number.value.trim())throw Error('Enter a value for '+label);apply(Number(number.value)/scale);number.removeAttribute('aria-invalid');}catch(reason){number.setAttribute('aria-invalid','true');announce(reason.message);}};
   reset.onclick=()=>{try{number.removeAttribute('aria-invalid');apply(r.default);sync();}catch(reason){announce(reason.message);}};
   row.append(text,range,number,reset);if(description){const small=document.createElement('small');small.textContent=description;row.append(small);}parent.append(row);
   records.push(()=>{if(!session)return;const value=read();range.value=value*scale;if(document.activeElement!==number&&!number.hasAttribute('aria-invalid'))number.value=String(Number((value*scale).toFixed(5)));if(draftOnly){range.disabled=number.disabled=reset.disabled=!endpoint;}});
  }
  function select(parent,label,values,read,write){
   const row=document.createElement('label'),input=document.createElement('select');row.className='studio-select';row.append(document.createTextNode(label));input.setAttribute('aria-label',label);
   for(const item of values){const [value,text]=Array.isArray(item)?item:[item,item],option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}row.append(input);parent.append(row);
   input.onchange=()=>write(input.value);records.push(()=>{if(session)input.value=read();});return input;
  }
  function toggle(parent,label,path){const row=document.createElement('label'),input=document.createElement('input');row.className='studio-switch';input.type='checkbox';row.append(document.createTextNode(label),input);parent.append(row);input.onchange=()=>edit(p=>put(p,path,input.checked));records.push(()=>{if(session)input.checked=get(project(),path);});}
  function section(id,title){const parent=$(id),h=document.createElement('h2');h.textContent=title;parent.append(h);return parent;}
  function details(parent,title){const el=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title;el.append(summary);parent.append(el);return el;}
  const motion=section('studioMotionControls','Motion');
  select(motion,'Path',[['hold','Hold'],['in','Tunnel In'],['out','Tunnel Out'],['drift','Drift']],()=>project().shot.motion==='hold'?'hold':M.motionLabel(project()).replace('Tunnel ','').toLowerCase(),async value=>{
   if(value==='hold'){edit(p=>{p.shot.motion='hold';});return;}
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
  numeric(motion,'Speed','speed',{rule:'speed',step:.01,read:()=>10/(project().shot.frameCount/project().shot.fps),write:(p,v)=>M.setSpeed(p,v),description:'1× = 10 seconds. Duration is quantized to whole frames.'});
  select(motion,'Easing',M.ENUMS.easing,()=>project().shot.easing,value=>edit(p=>{p.shot.easing=value;}));
  numeric(motion,'Endpoint roll','rollDeg',{rule:'rollDeg',step:1,read:()=>draft?.rollDeg??0,draftOnly:true,description:'Roll follows the saved angle difference; +180° to −180° turns a full circle.'});
  const look=section('studioLookControls','Look');
  select(look,'Preset',[...FX.PRESET_NAMES,'Custom'],()=>FX.presetName(project()),value=>{if(value!=='Custom'){clearInvalidNumbers();edit(p=>FX.applyPreset(p,value));}});
  select(look,'Palette',M.ENUMS.palette,()=>project().look.palette,value=>edit(p=>{p.look.palette=value;}));
  for(const [label,path]of [['Hue','hueDeg'],['Saturation','saturation'],['Glow strength','bloom.intensity'],['FX Amount','amount']])numeric(look,label,'look.'+path,{step:path==='hueDeg'?1:.01});
  const color=details(look,'Look Details');numeric(color,'Color speed','look.hueRate',{step:.001});numeric(color,'Exposure','look.exposureEV');toggle(color,'Bloom enabled','look.bloom.enabled');numeric(color,'Glow size','look.bloom.radiusRatio',{scale:100,step:.0001});numeric(color,'Glow threshold','look.bloom.threshold');
  const spatial=details(look,'Spatial FX');toggle(spatial,'Prism enabled','look.prism.enabled');numeric(spatial,'Prism blend','look.prism.amount');numeric(spatial,'Prism separation','look.prism.offsetRatio',{scale:100,step:.0001});toggle(spatial,'Kaleidoscope enabled','look.kaleido.enabled');numeric(spatial,'Kaleidoscope segments','look.kaleido.segments');numeric(spatial,'Kaleidoscope blend','look.kaleido.blend');numeric(spatial,'Kaleidoscope angle','look.kaleido.angleDeg',{step:1});
  const resetLook=document.createElement('button');resetLook.textContent='Reset Look';resetLook.onclick=()=>{clearInvalidNumbers();edit(p=>FX.applyPreset(p,'Neutral'));};look.append(resetLook);
  const rhythm=section('studioRhythmControls','Rhythm');toggle(rhythm,'Pulse enabled','look.pulse.enabled');numeric(rhythm,'Pulse interval','look.pulse.period');numeric(rhythm,'Pulse strength','look.pulse.strength');numeric(rhythm,'Pulse sharpness','look.pulse.sharpness',{description:'Smooth crest: (½ − ½ cos phase) raised to sharpness.'});
  const rd=details(rhythm,'Rhythm Details');for(const [label,path]of [['Pulse phase','pulse.phase'],['Exposure response','pulse.exposureEV'],['Glow response','pulse.bloomGain']])numeric(rd,label,'look.'+path);
  toggle(rd,'Glow Wave enabled','look.wave.enabled');numeric(rd,'Wave strength','look.wave.strengthEV');numeric(rd,'Wave bands','look.wave.fieldCycles');numeric(rd,'Wave speed','look.wave.speed',{description:'Positive: Outward · Negative: Inward · Zero: Static'});
  const output=section('studioOutputControls','Video output');
  for(const [label,path,values]of [['Aspect','aspect',M.ENUMS.aspect],['Resolution','resolution',M.ENUMS.resolution],['Sampling','samples',[[4,'Standard · 4 samples'],[16,'Fine · 16 samples']]],['Container','container',[['auto','MP4 preferred'],['mp4','MP4 / AVC'],['webm','WebM / VP9']]]])select(output,label,values,()=>project().output[path],value=>edit(p=>{p.output[path]=['resolution','samples'].includes(path)?Number(value):value;}));
  select(output,'FPS',M.ENUMS.fps,()=>project().shot.fps,value=>edit(p=>M.setFps(p,Number(value))));
  const advanced=details(output,'Numerics');select(advanced,'Iterations',[['auto-shot','Auto for shot'],['fixed','Fixed cap']],()=>project().numerics.iterations,value=>edit(p=>{p.numerics.iterations=value;}));numeric(advanced,'Fixed cap','numerics.fixedIterations',{rule:'fixedIterations',step:1});
  function sync(){
   if(!session)return;records.forEach(fn=>fn());if(document.activeElement!==$('studioName'))$('studioName').value=project().name;
   $('studioSaved').textContent=session.dirty?'Unsaved changes':'Saved on device';$('studioUndo').disabled=!session.canUndo;$('studioRedo').disabled=!session.canRedo;
   $('studioStart').setAttribute('aria-pressed',String(endpoint==='start'));$('studioEnd').setAttribute('aria-pressed',String(endpoint==='end'));$('studioEndUnused').hidden=project().shot.motion!=='hold';
   $('studioApply').disabled=!endpoint||!draftDirty();$('studioDiscard').disabled=!endpoint;$('studioViewLabel').textContent=endpoint?'Editing '+(endpoint==='start'?'Start A':'End B')+' · Framing view — spatial FX hidden':'Preview';
   $('studioScrub').max=project().shot.frameCount-1;$('studioOriginal').setAttribute('aria-pressed',String(original));
  }
  function draftChanged(){cancelGestureIfInvalid();preview.refresh({base:true});sync();}
  function cancelGestureIfInvalid(){if(!endpoint)cancelGesture();}
  function applyDraft(){if(endpoint&&draftDirty())edit(p=>{p.shot[endpoint]=copy(draft);});sync();}
  async function settleDraft(){
   commit();if(!draftDirty())return true;
   const answer=await ask('Apply the changes to '+(endpoint==='start'?'Start A':'End B')+'?',[['apply','Apply'],['discard','Discard'],['cancel','Cancel']]);
   if(answer==='apply')applyDraft();else if(answer==='discard')draft=copy(project().shot[endpoint]);else return false;sync();return true;
  }
  async function selectEndpoint(which){if(!await settleDraft())return;preview.pause();endpoint=which;draft=copy(project().shot[which]);cancelGesture();preview.seek(which==='start'?0:project().shot.frameCount-1);preview.refresh({base:true});sync();}
  $('studioStart').onclick=()=>selectEndpoint('start');$('studioEnd').onclick=()=>selectEndpoint('end');$('studioApply').onclick=applyDraft;
  $('studioDiscard').onclick=()=>{draft=copy(project().shot[endpoint]);preview.refresh({base:true});sync();};
  async function previewView(play=false){if(!await settleDraft())return;endpoint=null;draft=null;cancelGesture();preview.refresh({base:true});sync();if(play)preview.play();else preview.resume();}
  $('studioPreviewView').onclick=()=>previewView();$('studioPlay').onclick=()=>previewView(true);$('studioPause').onclick=()=>preview.pause();
  $('studioScrub').oninput=async()=>{const k=Number($('studioScrub').value);if(endpoint){if(!await settleDraft())return;endpoint=null;draft=null;sync();}preview.seek(k);};
  $('studioOriginal').onclick=()=>{original=!original;preview.refresh();sync();};
  $('studioName').onchange=()=>{const name=$('studioName').value;edit(p=>{p.name=name;});};
  $('studioUndo').onclick=async()=>{if(!await settleDraft())return;const before=project();session.undo();if(endpoint)draft=copy(project().shot[endpoint]);changed(before);};
  $('studioRedo').onclick=async()=>{if(!await settleDraft())return;const before=project();session.redo();if(endpoint)draft=copy(project().shot[endpoint]);changed(before);};
  $('studioSave').onclick=async()=>{if(!await settleDraft())return;try{session.save(store);announce('Project saved on this device.');sync();}catch(reason){announce(reason.message);}};
  async function replaceProject(value,{saved=false}={}){
   if(!await settleDraft())return false;
   if(session.dirty&&await ask('Replace this shot with unsaved changes? Export JSON first to keep a separate copy.',[['yes','Replace shot'],['cancel','Cancel']])!=='yes')return false;
    await drainPreview();await preview.dispose();await clearThumbnails();const before=project();if(saved)session.load(value);else session.import(M.serialize(value));endpoint=null;draft=null;original=false;clearInvalidNumbers();thumbnailsChanged();makePreview();sync();fitCanvas();preview.seek(0);announce(saved?'Project loaded.':'Project imported.');return before!==project();
  }
  function listProjects(){
   const list=$('studioProjectList');list.replaceChildren();try{for(const item of store.list()){
    const row=document.createElement('div'),load=document.createElement('button'),remove=document.createElement('button');load.textContent=item.name;remove.textContent='Delete';remove.setAttribute('aria-label','Delete '+item.name);
    load.onclick=async()=>{if(await replaceProject(item,{saved:true}))$('studioProjects').close();};remove.onclick=async()=>{if(await ask('Delete saved project “'+item.name+'” from this device?',[['yes','Delete'],['cancel','Cancel']])==='yes'){try{store.delete(item.id);if(item.id===project().id){session.markUnsaved();sync();}listProjects();}catch(reason){$('studioProjectMessage').textContent=reason.message;announce(reason.message);}}};row.append(load,remove);list.append(row);
   }}catch(reason){const text=document.createElement('p');text.textContent=reason.message;list.append(text);}}
  $('studioFiles').onclick=()=>{$('studioProjectMessage').textContent='';listProjects();$('studioProjects').showModal();};$('studioProjectsClose').onclick=()=>$('studioProjects').close();
  $('studioImport').onclick=()=>$('studioImportFile').click();$('studioImportFile').onchange=async()=>{const file=$('studioImportFile').files[0];try{if(file){if(file.size>M.MAX_JSON_BYTES)throw Error('Project exceeds 128 KiB');const value=M.deserialize(await file.text());if(await replaceProject(value))$('studioProjects').close();}}catch(reason){$('studioProjectMessage').textContent=reason.message;announce(reason.message);}finally{$('studioImportFile').value='';}};
  $('studioJSON').onclick=async()=>{if(!await settleDraft())return;const blob=new Blob([M.serialize(project())],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=root.TetraStudioExport.filename(project().name,'json');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);announce('Project JSON is ready to save.');};
  function settingsLayout(){if(!entered)return;const dialog=$('studioSettings');if(wide.matches){if(dialog.open)dialog.close();dialog.show();}else if(dialog.open)dialog.close();fitCanvas();}
  $('studioSettingsBtn').onclick=()=>$('studioSettings').showModal();$('studioSettingsClose').onclick=()=>$('studioSettings').close();wide.addEventListener('change',settingsLayout);new ResizeObserver(()=>{cancelGesture();fitCanvas();}).observe($('studioCanvasArea'));
  function exportSummary(){const p=project(),size=M.dimensions(p.output);$('studioExportSummary').textContent=`${size.width} × ${size.height} · ${p.shot.fps} fps · ${p.shot.frameCount} frames · ${(p.shot.frameCount/p.shot.fps).toFixed(3)} s · ${p.output.samples} samples · silent SDR · ${p.output.container==='webm'?'WebM / VP9':'MP4 / AVC'} · 64 MiB file limit`;$('studioExportProgress').max=p.shot.frameCount;}
  $('studioVideo').onclick=async()=>{if(!await settleDraft())return;endpoint=null;draft=null;sync();exportSummary();exportState(exporter.snapshot());$('studioExportDialog').showModal();};
  $('studioExportStart').onclick=async()=>{commit();try{await exporter.start(project(),bridge.resources());}catch(reason){announce(reason.message);}if(entered&&!document.hidden&&exporter.snapshot().state!=='ready')preview.resume();};
  $('studioExportCancel').onclick=()=>exporter.cancel();$('studioExportResume').onclick=()=>exporter.resume();
  function closeExport(){if(exporter.snapshot().active)return;exporter.clearResult();$('studioExportDialog').close();if(entered&&!document.hidden)preview.resume();}
  $('studioExportClose').onclick=$('studioReturnEdit').onclick=closeExport;$('studioExportDialog').addEventListener('cancel',e=>{if(exporter.snapshot().active)e.preventDefault();else exporter.clearResult();});
  $('studioExportDialog').addEventListener('close',()=>{if(!exporter.snapshot().active){exporter.clearResult();if(entered&&!document.hidden)preview.resume();}});
  function normalizedPoint(event){const r=stage.getBoundingClientRect();return {x:(event.clientX-r.left)*stage.width/r.width,y:(event.clientY-r.top)*stage.height/r.height};}
  function startGesture(){
   if(!endpoint||!pointers.size){gesture=null;return;}
   const values=[...pointers.values()],point=values.length>1?{x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2}:values[0];
   gesture={camera:copy(draft),anchor:C.screenToWorld(draft,point.x,point.y,stage.width,stage.height),distance:values.length>1?Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y):null};
  }
  function boundedCamera(value){const min=F.parse('1e-200'),max=F.parse('1e12'),limit=F.parse('1e12'),clamp=(v,a,b)=>v<a?a:v>b?b:v;return {...value,x:F.text(clamp(F.parse(value.x),-limit,limit)),y:F.text(clamp(F.parse(value.y),-limit,limit)),span:F.text(clamp(F.parse(value.span),min,max))};}
  function anchorCamera(camera,anchor,point,span){const next={...camera,span},mapped=C.screenToWorld(next,point.x,point.y,stage.width,stage.height);return boundedCamera({...next,x:F.text(F.parse(next.x)+F.parse(anchor.x)-F.parse(mapped.x)),y:F.text(F.parse(next.y)+F.parse(anchor.y)-F.parse(mapped.y))});}
  stage.addEventListener('pointerdown',e=>{if(!endpoint||exporter.snapshot().active){announce('Select Start or End to frame the shot.');return;}e.preventDefault();stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,normalizedPoint(e));startGesture();});
  stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,normalizedPoint(e));const values=[...pointers.values()],point=values.length>1?{x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2}:values[0];
   let span=gesture.camera.span;if(gesture.distance&&values.length>1){const distance=Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y);if(distance>0)span=F.text(F.mul(F.parse(span),F.parse(String(gesture.distance/distance))));}
   draft=anchorCamera(gesture.camera,gesture.anchor,point,span);draftChanged();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,e=>{pointers.delete(e.pointerId);startGesture();});
  function zoom(factor,point){if(!endpoint){announce('Select Start or End to frame the shot.');return;}const anchor=C.screenToWorld(draft,point.x,point.y,stage.width,stage.height),span=F.text(F.mul(F.parse(draft.span),F.parse(String(factor))));draft=anchorCamera(draft,anchor,point,span);preview.refresh({base:true});sync();}
  stage.addEventListener('wheel',e=>{if(exporter.snapshot().active)return;e.preventDefault();zoom(Math.exp(Math.max(-.5,Math.min(.5,e.deltaY*.002))),normalizedPoint(e));},{passive:false});
  stage.addEventListener('dblclick',e=>zoom(.5,normalizedPoint(e)));
  stage.addEventListener('keydown',e=>{if(!endpoint||exporter.snapshot().active)return;const key=e.key;if(['+','=','-','_'].includes(key)){e.preventDefault();zoom(key==='+'||key==='='?.5:2,{x:stage.width/2,y:stage.height/2});}
   else if(key.startsWith('Arrow')){e.preventDefault();const point={x:stage.width/2,y:stage.height/2},anchor=C.screenToWorld(draft,point.x+(key==='ArrowRight'?20:key==='ArrowLeft'?-20:0),point.y+(key==='ArrowDown'?20:key==='ArrowUp'?-20:0),stage.width,stage.height);draft=anchorCamera(draft,anchor,point,draft.span);preview.refresh({base:true});sync();}
  });
  document.addEventListener('keydown',e=>{
   if(!entered||document.querySelector('dialog:modal')||e.target.closest('input,select,textarea,[contenteditable=true]')||exporter.snapshot().active)return;
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'studioRedo':'studioUndo').click();}
   else if(e.code==='Space'){e.preventDefault();if(preview.state().playing)preview.pause();else previewView(true);}
   else if(e.key==='Escape'){e.preventDefault();if(draftDirty()){draft=copy(project().shot[endpoint]);preview.refresh({base:true});sync();}else preview.pause();}
  });
  document.addEventListener('visibilitychange',()=>{if(!entered)return;cancelGesture();if(document.hidden){thumbAbort?.abort();preview.suspend();exporter.hidden();}else if(exporter.snapshot().state==='suspended')exportState(exporter.snapshot());});
  matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',e=>{if(e.matches&&entered)preview.pause();});
  window.addEventListener('pagehide',()=>{if(entered){thumbAbort?.abort();preview.suspend();exporter.cancel();}});
  const api={
   async enter(){
    if(entered||entering)return;entering=true;
    try{
     const answer=session?.dirty?await ask('Continue the unsaved shot or start a new shot from Explore?',[['continue','Continue shot'],['new','New from Explore'],['cancel','Cancel']]):'new';if(answer==='cancel')return;
     await bridge.enter();entered=true;$('studio').hidden=false;document.body.dataset.app='studio';
     if(answer==='new')session=M.createSession(M.createProject(bridge.snapshot()));
     endpoint=null;draft=null;original=false;thumbnailsChanged();makePreview();sync();settingsLayout();preview.seek(0);stage.focus();announce('Choose Start or End to frame. Set / Update applies a draft.');
    }catch(reason){announce(reason.message);}finally{entering=false;}
   },
   async leave(){
    if(exporter.snapshot().active||!await settleDraft())return;
    if(session.dirty&&await ask('Leave Studio? This unsaved shot remains in this tab; Save or export JSON to keep it.',[['yes','Return to Explore'],['cancel','Cancel']])!=='yes')return;
    await exporter.dispose();await drainPreview();await preview.dispose();await clearThumbnails();entered=false;cancelGesture();$('studioSettings').close();$('studio').hidden=true;document.body.dataset.app='explore';await bridge.leave();$('openStudioBtn').focus();
   },
   deviceLost(){if(!entered)return;thumbAbort?.abort();preview.suspend();exporter.fail('GPU device was lost. Restore the device and retry from frame 0.');announce('GPU device was lost. Return to Explore to restore it, then retry from frame 0.');},
   diagnostics(){const output=exporter.snapshot();return {entered,endpoint,draft:draft&&copy(draft),draftDirty:!!session&&!!draftDirty(),project:session&&copy(project()),dirty:session?.dirty,revision:session?.revision,preview:preview?.state(),render:pipeline?.render.diagnostics(),fx:pipeline?.fx.diagnostics(),export:{...output,config:copy(output.config),profile:copy(output.profile),result:output.result?{filename:output.result.filename,bytes:output.result.bytes}:null},notice,thumbnails:{revision:thumbRevision,completed:thumbDone,active:!!thumbPromise}};}
  };
  $('leaveStudio').onclick=()=>api.leave();return api;
 }
 root.TetraStudio={create};
})(globalThis);
