(function(){
 'use strict';
 const $=id=>document.getElementById(id),F=createFixed(256),Q=F.Q;
 const workerSource=__WORKER_SOURCE__;
 const workerURL=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
 const presets=[
  {name:'Overview',sub:'COMPLEX PLANE',x:'-0.2',y:'0',span:'7'},
  {name:'Bloom',sub:'RECURSIVE PETALS',x:'-2.5',y:'0',span:'1.8'},
  {name:'Filaments',sub:'BETWEEN THE BASINS',x:'-1.84',y:'0.09',span:'0.46'},
  {name:'Feather',sub:'FOLDS AND BRANCHES',x:'-0.72',y:'0.36',span:'0.7'}
 ];
 let view={x:F.parse(presets[1].x),y:F.parse(presets[1].y),span:F.parse(presets[1].span)},palette=0,iterations=256,engine='auto',grid=false;
 let gpu=null,legacyGPU=null,modernGPU=null,webgpuStatus='pending',workers=[],serial=0,timer=0,raf=0,toastTimer=0,locationIndex=1;
 let quality=4,colorPhase=0,flow=false,flowStarted=0,flowFrame=0,flowPaint=0,displayView=null,renderStage='initial',activeFrame=null,activeRenderer=null,displayCanvas=null,gpuPending=null;
 let history=[],future=[],savedViews=[],pointerMap=new Map(),pinch=null,drag=null,gestureSaved=false;
 let currentMode='gpu',lastImage=null,lastView=null,lastRenderComplete=false,started=0,activePass=0,passes=[],pendingPaint=0;
 let lastCompletedInfo=null,workerTransfer='pixels',coordinateDraft=false;
 const poolLimit=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1,navigator.deviceMemory&&navigator.deviceMemory<=2?2:4));
 let gpuCanvas=$('gpuCanvas');
 const legacyCanvas=gpuCanvas,modernCanvas=$('webgpuCanvas');
 const cpuCanvas=$('cpuCanvas'),gridCanvas=$('gridCanvas'),viewport=$('viewport');
 const ctx=cpuCanvas.getContext('2d',{alpha:false}),gridCtx=gridCanvas.getContext('2d');displayCanvas=cpuCanvas;
 let dims={w:1,h:1,dpr:1};
 const minSpan=F.parse('1e-200'),maxSpan=F.parse('1e12'),maxCoordinate=F.parse('1e12');
 const serialize=(v=view)=>({x:F.text(v.x),y:F.text(v.y),span:F.text(v.span)});
 const clone=v=>({x:v.x,y:v.y,span:v.span});
 const ratio=(a,n,d=1)=>a*BigInt(Math.round(n*1e6))/BigInt(Math.max(1,Math.round(d*1e6)));
 const numFormat=(n,d=6)=>Math.abs(n)>1e7||(Math.abs(n)>0&&Math.abs(n)<1e-5)?n.toExponential(4):n.toFixed(d);
 function toast(message){clearTimeout(toastTimer);const el=$('toast');el.textContent=message;el.hidden=false;if(el.showPopover)el.showPopover();toastTimer=setTimeout(()=>{if(el.hidePopover)el.hidePopover();el.hidden=true;},3300);}
 function saveHistory(){future=[];const prev=history.at(-1);if(!prev||prev.x!==view.x||prev.y!==view.y||prev.span!==view.span){if(history.length>=80)history.shift();history.push(clone(view));}$('backBtn').disabled=!history.length;$('forwardBtn').disabled=!future.length;}
 function validate(v){
  if(v.span<minSpan||v.span>maxSpan)throw Error('Span must be between 1e-200 and 1e12.');
  if(F.abs(v.x)>maxCoordinate||F.abs(v.y)>maxCoordinate)throw Error('Each coordinate must be between -1e12 and 1e12.');return v;
 }
 function bounded(v){let limit=false;if(v.span<minSpan){v.span=minSpan;limit=true;}if(v.span>maxSpan){v.span=maxSpan;limit=true;}
  for(const key of ['x','y'])if(F.abs(v[key])>maxCoordinate){v[key]=v[key]<0n?-maxCoordinate:maxCoordinate;limit=true;}
  if(limit)toast('Navigation limit reached.');return v;
 }
 function hashString(){const p=new URLSearchParams({v:'1',x:F.text(view.x),y:F.text(view.y),s:F.text(view.span),n:String(iterations),p:String(palette),e:engine,g:grid?'1':'0',q:String(quality),c:String(Math.round(hue()*100)/100)});return p.toString();}
 function updateURL(){try{window.history.replaceState(null,'','#'+hashString());}catch{}}
 function readHash(hash=location.hash){
  if(hash.length>2400)throw Error('This view link is too long.');
  const p=new URLSearchParams(hash.replace(/^#/,''));if(!p.has('x'))return;
  if(p.get('v')!=='1')throw Error('Unsupported view link version.');
  view=validate({x:F.parse(p.get('x')),y:F.parse(p.get('y')),span:F.parse(p.get('s'))});
  const n=Number(p.get('n'));iterations=[64,128,256,512,1024].includes(n)?n:256;
  palette=[0,1,2,3].includes(Number(p.get('p')))?Number(p.get('p')):0;
  engine=['auto','cpu','big'].includes(p.get('e'))?p.get('e'):'auto';grid=p.get('g')==='1';quality=p.get('q')==='1'?1:4;
  setFlow(false);const phase=Number(p.get('c'));colorPhase=Number.isFinite(phase)?((phase%360)+360)%360:0;applyHue();locationIndex=-1;
 }
 function syncControls(){
  $('iterations').value=iterations;$('engine').value=engine;$('grid').checked=grid;$('quality').value=String(quality);$('flow').checked=flow;
  document.querySelectorAll('[data-palette]').forEach(b=>{const selected=Number(b.dataset.palette)===palette;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  document.querySelectorAll('.preset').forEach((b,i)=>{b.classList.toggle('active',i===locationIndex);b.setAttribute('aria-pressed',String(i===locationIndex));});
  const colors=[1,2,0,3,4].map(k=>TetraCore.color(k,8,palette));
  document.querySelectorAll('.legend i').forEach((el,i)=>el.style.background=`rgb(${colors[i].join(',')})`);
  $('legend').title='Artistic color from finite orbit observations; shades are not mathematical proofs.';
 }
 function fallbackGPU(failed){
  if(failed===modernGPU){modernGPU=null;webgpuStatus='lost';failed?.destroy();}
  if(failed===legacyGPU)legacyGPU=null;
  gpu=modernGPU||legacyGPU;gpuCanvas=gpu?.canvas||legacyCanvas;
 }
 function chooseMode(){
  const pixel=Number(F.text(view.span))/Math.max(dims.w,1),magnitude=Math.max(1,Math.abs(Number(F.text(view.x))),Math.abs(Number(F.text(view.y))));
  if(engine==='big')return 'big';
  if(pixel<magnitude*1e-13)return 'big';
  if(engine==='cpu'||!gpu||pixel<magnitude*64*2**(-gpu.bits))return 'cpu';
  return 'gpu';
 }
 function precision(){return Math.min(240,Math.max(40,Math.ceil(-Math.log10(Number(F.text(view.span))))+40));}
 function updateReadout(){
  const s=serialize(),depth=Math.log10(7)-Math.log10(Number(s.span));
  $('coordinatesReadout').textContent=`Re ${numFormat(Number(s.x))}  ·  Im ${numFormat(Number(s.y))}`;
  $('coordinatesReadout').title=`Re ${s.x}\nIm ${s.y}\nSpan ${s.span}`;
  $('zoomLabel').textContent=depth>6?'10^'+depth.toFixed(1)+'×':(7/Number(s.span)).toLocaleString('en-US',{maximumFractionDigits:2})+'×';
  const ruler=window.innerWidth<=760?60:80;
  $('scaleLabel').textContent=(Number(s.span)*ruler/dims.w).toExponential(2)+' units';
  if(!coordinateDraft){$('xInput').value=s.x;$('yInput').value=s.y;$('spanInput').value=s.span;}
  $('locationTag').textContent=locationIndex<0?'Custom view':String(locationIndex+1).padStart(2,'0')+' / '+presets[locationIndex].name;
  $('viewSubtitle').textContent=locationIndex<0?'EXPLORING':presets[locationIndex].sub;
  currentMode=chooseMode();
  $('engineTag').textContent=currentMode==='gpu'?(gpu?.kind==='webgpu'?'WEBGPU · FP32':'WEBGL2 · FP32'):currentMode==='cpu'?'WORKER · FP64':`BIGINT · ${precision()} DP`;
  $('precisionNote').hidden=currentMode!=='big';
  $('precisionNote').textContent=`${precision()} decimal places · up to 72 horizontal samples. Keep moving while this view computes.`;
  $('backBtn').disabled=!history.length;$('forwardBtn').disabled=!future.length;
  drawGrid();
 }
 function drawGrid(){
  const {w,h,dpr}=dims;if(gridCanvas.width!==Math.round(w*dpr)||gridCanvas.height!==Math.round(h*dpr)){gridCanvas.width=Math.round(w*dpr);gridCanvas.height=Math.round(h*dpr);}
  gridCtx.setTransform(dpr,0,0,dpr,0,0);gridCtx.clearRect(0,0,w,h);if(!grid)return;
  const span=Number(F.text(view.span)),cx=Number(F.text(view.x)),cy=Number(F.text(view.y));
  const raw=span/6,base=10**Math.floor(Math.log10(raw)),step=base*(raw/base>5?10:raw/base>2?5:raw/base>1?2:1);
  const pixel=span/w;
  // Ordinary Number tick labels cannot represent deep differences. Use screen offsets instead.
  const deep=pixel<Math.max(1,Math.abs(cx),Math.abs(cy))*1e-12;
  gridCtx.font='9px monospace';gridCtx.lineWidth=1;gridCtx.fillStyle='#bbbbbb';gridCtx.strokeStyle='#aaaaaa33';
  if(deep){for(let x=w/2%100;x<w;x+=100){gridCtx.beginPath();gridCtx.moveTo(x,0);gridCtx.lineTo(x,h);gridCtx.stroke();}for(let y=h/2%100;y<h;y+=100){gridCtx.beginPath();gridCtx.moveTo(0,y);gridCtx.lineTo(w,y);gridCtx.stroke();}gridCtx.fillText('RELATIVE GRID · 100 px',18,h-130);return;}
  for(let i=0,v=Math.ceil((cx-span/2)/step)*step;i<20&&v<=cx+span/2;v+=step,i++){const x=(v-cx)/pixel+w/2;gridCtx.strokeStyle=Math.abs(v)<step*.0001?('#cccccc77'):('#aaaaaa33');gridCtx.beginPath();gridCtx.moveTo(x,0);gridCtx.lineTo(x,h);gridCtx.stroke();if(x>45&&x<w-45)gridCtx.fillText(numFormat(v,2),x+5,h-123);}
  const vert=span*h/w;
  for(let i=0,v=Math.ceil((cy-vert/2)/step)*step;i<30&&v<=cy+vert/2;v+=step,i++){const y=h/2-(v-cy)/pixel;gridCtx.strokeStyle=Math.abs(v)<step*.0001?('#cccccc77'):('#aaaaaa33');gridCtx.beginPath();gridCtx.moveTo(0,y);gridCtx.lineTo(w,y);gridCtx.stroke();if(y>120&&y<h-140)gridCtx.fillText(numFormat(v,2),8,y-5);}
 }
 function configureCPUCanvas(width=Math.round(dims.w*dims.dpr),height=Math.round(dims.h*dims.dpr)){
  if(cpuCanvas.width!==width||cpuCanvas.height!==height){
   const copy=document.createElement('canvas');copy.width=cpuCanvas.width;copy.height=cpuCanvas.height;copy.getContext('2d').drawImage(cpuCanvas,0,0);
   cpuCanvas.width=width;cpuCanvas.height=height;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(copy,0,0,width,height);
  }
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 }
 function seedCPUPreview(){
  configureCPUCanvas();
  if(displayCanvas!==cpuCanvas||!displayView){ctx.fillStyle='#060606';ctx.fillRect(0,0,cpuCanvas.width,cpuCanvas.height);return;}
  if(displayView.x===view.x&&displayView.y===view.y&&displayView.span===view.span)return;
  const copy=document.createElement('canvas');copy.width=cpuCanvas.width;copy.height=cpuCanvas.height;copy.getContext('2d').drawImage(cpuCanvas,0,0);
  const zoom=Number(F.text(displayView.span))/Number(F.text(view.span));
  const dx=Number(F.text(F.div(displayView.x-view.x,view.span)))*cpuCanvas.width,dy=-Number(F.text(F.div(displayView.y-view.y,view.span)))*cpuCanvas.width;
  ctx.fillStyle='#060606';ctx.fillRect(0,0,cpuCanvas.width,cpuCanvas.height);
  if(Number.isFinite(zoom+dx+dy)&&zoom<1e6&&zoom>1e-6)ctx.drawImage(copy,dx+(1-zoom)*copy.width/2,dy+(1-zoom)*copy.height/2,copy.width*zoom,copy.height*zoom);
 }
 function hue(){return (colorPhase+(flow?(performance.now()-flowStarted)/500:0))%360;}
 function applyHue(){displayCanvas.style.filter=hue()?'hue-rotate('+hue()+'deg)':'none';}
 function setFlow(enabled){
  colorPhase=hue();flow=enabled&&!document.hidden;flowStarted=performance.now();cancelAnimationFrame(flowFrame);flowFrame=0;
  if($('flow'))$('flow').checked=flow;applyHue();
  const tick=t=>{if(!flow)return;if(t-flowPaint>=33){applyHue();flowPaint=t;}flowFrame=requestAnimationFrame(tick);};
  if(flow)flowFrame=requestAnimationFrame(tick);
 }
 function reproject(){
  if(!displayView)return;
  const zoom=Number(F.text(displayView.span))/Number(F.text(view.span));
  const dx=Number(F.text(F.div(displayView.x-view.x,view.span)))*dims.w,dy=-Number(F.text(F.div(displayView.y-view.y,view.span)))*dims.w;
  if(Number.isFinite(zoom+dx+dy)&&zoom<1e6&&zoom>1e-6)displayCanvas.style.transform=`translate(${dx}px,${dy}px) scale(${zoom})`;
  else displayCanvas.style.transform='scale(0)';
 }
 function setDisplay(canvas,renderView){
  for(const c of [legacyCanvas,modernCanvas,cpuCanvas])c.style.display=c===canvas?'block':'none';
  displayCanvas=canvas;displayCanvas.style.transform='none';displayView=clone(renderView);applyHue();document.body.dataset.ready='true';
 }
 function stopWorkers(){workers.forEach(w=>w.terminate());workers=[];}
 function stopRender(){serial++;viewport.setAttribute('aria-busy','true');cancelAnimationFrame(raf);raf=0;document.body.dataset.complete='false';stopWorkers();clearTimeout(timer);cancelAnimationFrame(pendingPaint);pendingPaint=0;lastRenderComplete=false;}
 function setProgress(value){$('progressBar').style.width=value+'%';$('progressTrack').setAttribute('aria-valuenow',Math.round(value));}
 function showLoading(text){$('retryBtn').hidden=true;$('loading').hidden=false;$('loadingText').textContent=text;}
 function renderError(message){stopRender();viewport.setAttribute('aria-busy','false');$('statusText').textContent='Render interrupted';showLoading(message);$('retryBtn').hidden=false;}
 $('retryBtn').onclick=()=>changed(false);
 function finished(w,h,counts){
  lastRenderComplete=true;renderStage='complete';viewport.setAttribute('aria-busy','false');$('loading').hidden=true;setProgress(100);
  lastView=clone(view);lastImage=null;
  const elapsed=performance.now()-started;
  $('statusText').textContent=`${iterations.toLocaleString('en-US')} steps · ${elapsed<1000?Math.round(elapsed)+' ms':(elapsed/1000).toFixed(1)+' s'}`;
  $('resolutionReadout').textContent=`${w} × ${h} / ${currentMode==='big'?precision()+' DP':currentMode==='gpu'?quality===4?'ADAPTIVE AA':'1×':'FP64'}`;
  lastCompletedInfo={view:serialize(),mode:currentMode,iterations,palette,width:w,height:h,counts,elapsed,samples:currentMode==='gpu'?quality:1};
  document.body.dataset.ready='true';document.body.dataset.mode=currentMode;document.body.dataset.complete='true';updateURL();
 }
 function preview(){renderStage='moving';reproject();}
 function changed(interactive=true){
  stopRender();gpu=modernGPU||legacyGPU;gpuCanvas=gpu?.canvas||legacyCanvas;document.body.dataset.complete='false';setProgress(0);syncControls();updateReadout();
  showLoading(interactive?'Preview · release to refine':'Computing view');
  cancelAnimationFrame(raf);raf=requestAnimationFrame(preview);
  timer=setTimeout(render,interactive?120:20);
 }
 async function render(){
  if(pointerMap.size)return;
  clearTimeout(timer);cancelAnimationFrame(raf);raf=0;stopRender();const id=serial;started=performance.now();gpu=modernGPU||legacyGPU;gpuCanvas=gpu?.canvas||legacyCanvas;currentMode=chooseMode();updateReadout();
  document.body.dataset.mode=currentMode;document.body.dataset.complete='false';
  if(currentMode==='gpu'&&gpu){
   const renderer=gpu,renderView=clone(view),camera=serialize(),limit=iterations,scheme=palette,aa=quality;
   try{
    if(gpuPending)await gpuPending;if(id!==serial)return;
    const target=TetraRender.size(dims.w,dims.h,dims.dpr);
    const coarse=TetraRender.size(dims.w,dims.h,1,140000,512);
    const stages=[{...coarse,samples:1,steps:Math.min(limit,64)},{...target,samples:1,steps:limit}];
    if(aa===4)stages.push({...target,samples:4,steps:limit});
    for(let pass=0;pass<stages.length;pass++){
     if(id!==serial)return;
     const stage=stages[pass],w=stage.width,h=stage.height,edge=stage.samples===4?Math.max(64,Math.floor(128*Math.sqrt(256/Math.max(limit,256)))):192;
     const tiles=TetraRender.tiles(w,h,edge);renderStage=pass===0?'preview':pass===1?'detail':'antialias';
     const frame=renderer.beginFrame(w,h,pass&&activeRenderer===renderer?activeFrame:null,stage.samples===4);
     const display=()=>{
      renderer.presentFrame(frame);
      if(activeFrame!==frame){const old=activeFrame,oldRenderer=activeRenderer;activeFrame=frame;activeRenderer=renderer;setDisplay(renderer.canvas,renderView);if(old!==frame.seed)oldRenderer?.releaseFrame(old);}
     };
     try{
      if(pass)display();
      let lastYield=performance.now(),lastPresentation=0;
      for(let i=0;i<tiles.length;i++){
       if(id!==serial)return;
       const task=renderer.paintTile(frame,tiles[i],camera,stage.steps,scheme,stage.samples);gpuPending=task;
       try{await task;}finally{if(gpuPending===task)gpuPending=null;}
       if(id!==serial)return;
       const now=performance.now(),fraction=(i+1)/tiles.length;setProgress((pass+fraction)/stages.length*100);
       $('loadingText').textContent=pass?`${stage.samples===4?'Smoothing edges':'Resolving detail'} · ${w} × ${h} · ${Math.round(fraction*100)}%`:'Finding the view';
       $('resolutionReadout').textContent=`${w} × ${h} / ${Math.round(fraction*100)}%`;
       if(pass&&(now-lastPresentation>30||i===tiles.length-1)){display();lastPresentation=now;}
       if(now-lastYield>10){await new Promise(requestAnimationFrame);lastYield=performance.now();}
      }
      if(!pass)display();
     }finally{if(frame.seed){renderer.releaseFrame(frame.seed);frame.seed=null;}if(activeFrame!==frame)renderer.releaseFrame(frame);}
    }
    if(id===serial)finished(target.width,target.height,null);return;
   }catch(e){if(id!==serial)return;fallbackGPU(renderer);changed(false);toast('Renderer changed. Recomputing view.');return;}
  }
  seedCPUPreview();setDisplay(cpuCanvas,view);activeRenderer?.releaseFrame(activeFrame);activeFrame=null;activeRenderer=null;renderStage='detail';
  const pixelBudget=currentMode==='big'?(dims.w<761?2048:4096):1600000;
  const maximum=Math.max(12,Math.floor(Math.min(currentMode==='big'?72:2048,dims.w*dims.dpr,Math.sqrt(pixelBudget*dims.w/dims.h))));
  passes=currentMode==='big'?[12,30,maximum]:[160,420,maximum];passes=[...new Set(passes.map(w=>Math.min(w,maximum)))].sort((a,b)=>a-b);activePass=0;
  try { for(let i=0;i<poolLimit;i++)workers.push(new Worker(workerURL)); } catch {
   // A browser may allow fewer Workers than its reported core count.
   if(!workers.length){renderError('Workers unavailable. Use HTTPS or a local server.');return;}
  }
  const failed=message=>{if(id!==serial)return;renderError(message);};
  workers.forEach(w=>w.onerror=()=>failed('Worker interrupted. Lower the iteration limit or retry.'));
  function startPass(){
   if(id!==serial||!workers.length)return;
   const w=passes[activePass],h=Math.max(1,Math.round(w*dims.h/dims.w));
   const passCanvas=document.createElement('canvas');passCanvas.width=w;passCanvas.height=h;const pctx=passCanvas.getContext('2d',{alpha:false});pctx.imageSmoothingEnabled=true;pctx.drawImage(cpuCanvas,0,0,w,h);
   const progress=workers.map(()=>0),counts=workers.map(()=>[0,0,0,0,0]),completed=new Set();
   showLoading(`${currentMode==='big'?'High precision':'FP64'} · pass ${activePass+1}/${passes.length} · 0%`);
   workers.forEach((worker,index)=>{
    worker.onmessage=({data:d})=>{
     if(id!==serial||d.id!==id){d.bitmap?.close();return;}
     if(d.error){failed('Could not complete this view: '+d.error);return;}
     if(d.tile){
      if(d.bitmap){pctx.drawImage(d.bitmap,d.tile.x,d.tile.y);d.bitmap.close();workerTransfer='bitmap';}
      else{pctx.putImageData(new ImageData(d.pixels,d.tile.width,d.tile.height),d.tile.x,d.tile.y);workerTransfer='pixels';}
     }
     progress[index]=d.done;counts[index]=d.counts;
     const fraction=progress.reduce((a,b)=>a+b,0)/(w*h);
     const paint=()=>{pendingPaint=0;if(id!==serial)return;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(passCanvas,0,0,cpuCanvas.width,cpuCanvas.height);};
     if(!pendingPaint)pendingPaint=requestAnimationFrame(paint);
     setProgress((activePass+fraction)/passes.length*100);
     $('loadingText').textContent=`${currentMode==='big'?precision()+' DP':'FP64'} · pass ${activePass+1}/${passes.length} · ${Math.round(fraction*100)}%`;
     $('resolutionReadout').textContent=`${w} × ${h} / ${Math.round(fraction*100)}%`;
     if(d.complete)completed.add(index);
     if(completed.size===workers.length){
      cancelAnimationFrame(pendingPaint);paint();activePass++;
      if(activePass<passes.length)setTimeout(startPass,30);
      else{finished(w,h,counts.reduce((a,c)=>a.map((n,i)=>n+c[i]),[0,0,0,0,0]));stopWorkers();}
     }
    };
    worker.postMessage({id,...serialize(),width:w,height:h,mode:currentMode,digits:precision(),iterations,palette,index,workers:workers.length,bitmap:true});
   });
  }
  startPass();
 }
 function relative(clientX,clientY){const r=viewport.getBoundingClientRect();return {x:clientX-r.left,y:clientY-r.top};}
 function at(point,v=view){return {x:v.x+ratio(v.span,point.x-dims.w/2,dims.w),y:v.y-ratio(v.span,point.y-dims.h/2,dims.w)};}
 function limitedSpan(span){return span<minSpan?minSpan:span>maxSpan?maxSpan:span;}
 function zoom(factor,point={x:dims.w/2,y:dims.h/2}){const anchor=at(point);const span=limitedSpan(ratio(view.span,factor));if(span===view.span){toast('Zoom limit reached.');return;}view=bounded({span,x:anchor.x-ratio(span,point.x-dims.w/2,dims.w),y:anchor.y+ratio(span,point.y-dims.h/2,dims.w)});locationIndex=-1;changed();}
 function loadPreset(index){saveHistory();locationIndex=index;const p=presets[index];view={x:F.parse(p.x),y:F.parse(p.y),span:F.parse(p.span)};closeSettings();viewport.focus({preventScroll:true});changed(false);}
 presets.forEach((p,i)=>{const b=document.createElement('button');b.className='preset';b.type='button';b.setAttribute('aria-pressed',i===0?'true':'false');b.innerHTML=`<span class="preset-number">${String(i+1).padStart(2,'0')}</span><span><span class="preset-name">${p.name}</span><span class="preset-sub">${p.sub}</span></span><span class="preset-arrow">↗</span>`;b.onclick=()=>loadPreset(i);$('presets').append(b);});
 function touchSetup(){
  const values=[...pointerMap.values()];
  if(values.length>=2){const a=values[0],b=values[1],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),anchor:at(mid),view:clone(view)};drag=null;}
  else if(values.length===1){drag={point:values[0],view:clone(view)};pinch=null;}else{drag=null;pinch=null;}
 }
 viewport.addEventListener('pointerdown',e=>{
  if(e.target.closest('button')||e.button>0)return;
  viewport.focus({preventScroll:true});viewport.setPointerCapture(e.pointerId);
  if(!gestureSaved){saveHistory();gestureSaved=true;}
  pointerMap.set(e.pointerId,relative(e.clientX,e.clientY));touchSetup();
 });
 viewport.addEventListener('pointermove',e=>{
  if(!pointerMap.has(e.pointerId))return;
  pointerMap.set(e.pointerId,relative(e.clientX,e.clientY));const values=[...pointerMap.values()];
  if(pinch&&values.length>=2){const [a,b]=values,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},dist=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),span=limitedSpan(ratio(pinch.view.span,pinch.distance,dist));view=bounded({span,x:pinch.anchor.x-ratio(span,mid.x-dims.w/2,dims.w),y:pinch.anchor.y+ratio(span,mid.y-dims.h/2,dims.w)});}
  else if(drag){const p=values[0];view=bounded({...drag.view,x:drag.view.x-ratio(drag.view.span,p.x-drag.point.x,dims.w),y:drag.view.y+ratio(drag.view.span,p.y-drag.point.y,dims.w)});}
  locationIndex=-1;changed();
 });
 function pointerEnd(e){if(!pointerMap.has(e.pointerId))return;pointerMap.delete(e.pointerId);touchSetup();if(!pointerMap.size){gestureSaved=false;clearTimeout(timer);timer=setTimeout(render,40);updateURL();}}
 viewport.addEventListener('pointerup',pointerEnd);viewport.addEventListener('pointercancel',pointerEnd);viewport.addEventListener('lostpointercapture',pointerEnd);
 let lastWheel=-Infinity;
 viewport.addEventListener('wheel',e=>{if(e.target.closest('button'))return;e.preventDefault();if(performance.now()-lastWheel>500)saveHistory();lastWheel=performance.now();const dy=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?dims.h:1);zoom(Math.exp(Math.max(-1.1,Math.min(1.1,dy*.0018))),relative(e.clientX,e.clientY));},{passive:false});
 viewport.addEventListener('dblclick',e=>{if(e.target.closest('button'))return;e.preventDefault();saveHistory();zoom(.4,relative(e.clientX,e.clientY));});
 $('zoomIn').onclick=()=>{saveHistory();zoom(.5);};$('zoomOut').onclick=()=>{saveHistory();zoom(2);};$('homeBtn').onclick=()=>loadPreset(0);$('brand').onclick=e=>{e.preventDefault();loadPreset(0);};
 $('backBtn').onclick=()=>{if(!history.length)return;future.push(clone(view));view=history.pop();locationIndex=-1;changed(false);};
 $('forwardBtn').onclick=()=>{if(!future.length)return;history.push(clone(view));view=future.pop();locationIndex=-1;changed(false);};
 viewport.addEventListener('keydown',e=>{
  if(e.target.closest('button,input,select,textarea'))return;
  if(['+','=','-','_','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();else return;
  if(e.altKey&&e.key==='ArrowLeft'){$('backBtn').click();return;}
  if(e.altKey&&e.key==='ArrowRight'){$('forwardBtn').click();return;}
  if(e.key==='Home'){loadPreset(0);return;}
  saveHistory();if(e.key==='+'||e.key==='=')zoom(.5);else if(e.key==='-'||e.key==='_')zoom(2);else{const step=view.span/(e.shiftKey?3n:10n);view=bounded({...view,x:view.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0n),y:view.y+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0n)});locationIndex=-1;changed();}
 });
 $('iterations').onchange=e=>{iterations=Number(e.target.value);changed(false);};$('engine').onchange=e=>{engine=e.target.value;changed(false);};
 document.querySelectorAll('[data-palette]').forEach(b=>b.onclick=()=>{palette=Number(b.dataset.palette);changed(false);});
 $('quality').onchange=e=>{quality=Number(e.target.value);changed(false);};
 $('flow').onchange=e=>{setFlow(e.target.checked);updateURL();};
 $('grid').onchange=e=>{grid=e.target.checked;drawGrid();updateURL();};
 ['xInput','yInput','spanInput'].forEach(id=>$(id).addEventListener('input',()=>coordinateDraft=true));
 $('coordinateForm').onsubmit=e=>{e.preventDefault();try{const v=validate({x:F.parse($('xInput').value.trim()),y:F.parse($('yInput').value.trim()),span:F.parse($('spanInput').value.trim())});saveHistory();view=v;coordinateDraft=false;locationIndex=-1;closeSettings();viewport.focus({preventScroll:true});changed(false);}catch(error){toast(error.message);}};
 $('shareBtn').onclick=async()=>{
  updateURL();const url=location.href;
  if(location.protocol==='file:'){$('shareMessage').textContent='This is a local file. Append these coordinates to the same hosted app to reopen the view.';$('shareText').value='#'+hashString();$('shareDialog').showModal();$('shareText').select();return;}
  try{if(navigator.share&&matchMedia('(pointer:coarse)').matches){await navigator.share({title:'TETRA',text:'Explore this view.',url});return;}if(!navigator.clipboard)throw Error('No clipboard');await navigator.clipboard.writeText(url);toast('View link copied.');}
  catch(error){if(error.name==='AbortError')return;$('shareMessage').textContent='Copy this link to reopen the same view.';$('shareText').value=url;$('shareDialog').showModal();$('shareText').select();}
 };
 $('copyLinkBtn').onclick=async()=>{try{await navigator.clipboard.writeText($('shareText').value);toast('View link copied.');}catch{$('shareText').focus();$('shareText').select();toast('Select and copy the link.');}};
 $('exportBtn').onclick=async()=>{
  const captured={view:serialize(),mode:currentMode,iterations,palette,complete:lastRenderComplete,hue:hue()};
  const gridCopy=grid?document.createElement('canvas'):null;if(gridCopy){gridCopy.width=gridCanvas.width;gridCopy.height=gridCanvas.height;gridCopy.getContext('2d').drawImage(gridCanvas,0,0);}
  const transform=displayView?{zoom:Number(F.text(displayView.span))/Number(F.text(view.span)),x:Number(F.text(F.div(displayView.x-view.x,view.span))),y:-Number(F.text(F.div(displayView.y-view.y,view.span)))}:null;
  let source=displayCanvas;
  try{if(activeFrame&&displayCanvas!==cpuCanvas)source=await activeRenderer.capture(activeFrame);}catch{toast('Wait for a completed view, then export again.');return;}
  const out=document.createElement('canvas');out.width=Math.max(1,source.width);out.height=Math.max(1,source.height);const c=out.getContext('2d');
  c.fillStyle='#060606';c.fillRect(0,0,out.width,out.height);c.save();
  if(transform){c.translate(out.width/2+transform.x*out.width,out.height/2+transform.y*out.width);c.scale(transform.zoom,transform.zoom);c.translate(-out.width/2,-out.height/2);}
  if('filter' in c)c.filter=`hue-rotate(${captured.hue}deg)`;
  c.drawImage(source,0,0);c.restore();source.close?.();
  if(!('filter' in c)&&captured.hue){const pixels=c.getImageData(0,0,out.width,out.height);TetraRender.huePixels(pixels.data,captured.hue);c.putImageData(pixels,0,0);}
  if(gridCopy)c.drawImage(gridCopy,0,0,out.width,out.height);
  c.fillStyle='#0a0a0aeb';c.fillRect(0,out.height-43,out.width,43);c.fillStyle='#eeeeee';c.font='10px monospace';c.fillText(`TETRA / ${captured.mode.toUpperCase()} / ${captured.iterations} LIMIT / ${captured.complete?'COMPLETED':'PARTIAL PREVIEW'}`,12,out.height-26);c.font='8px monospace';c.fillStyle='#bbbbbb';c.fillText(`Re ${captured.view.x}  Im ${captured.view.y}  Span ${captured.view.span}`,12,out.height-10,out.width-24);
  out.toBlob(blob=>{if(!blob){toast('Could not export this image.');return;}const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='tetra-'+Date.now()+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);toast(captured.complete?'PNG exported.':'Partial preview exported.');},'image/png');
 };
 $('fullscreenBtn').onclick=async()=>{closeSettings();try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('Fullscreen is unavailable in this browser.');}catch{toast('Could not enter fullscreen.');}};
 $('helpBtn').onclick=()=>$('helpDialog').showModal();$('mobileHelpBtn').onclick=()=>{closeSettings();$('helpDialog').showModal();};document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
 document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
 function openSettings(){if(!$('sidebar').open)$('sidebar').showModal();$('settingsBtn').setAttribute('aria-expanded','true');}
 function closeSettings(){if($('sidebar').open)$('sidebar').close();}
 $('sidebar').addEventListener('close',()=>{$('settingsBtn').setAttribute('aria-expanded','false');coordinateDraft=false;updateReadout();});
 $('settingsBtn').onclick=openSettings;$('closeSettings').onclick=closeSettings;
 function focusMode(enabled){
  document.body.classList.toggle('focus-mode',enabled);$('focusBtn').setAttribute('aria-pressed',String(enabled));$('focusBtn').setAttribute('aria-label',enabled?'Exit focus mode':'Enter focus mode');$('exitFocusBtn').hidden=!enabled;viewport.focus({preventScroll:true});
 }
 $('focusBtn').onclick=()=>focusMode(!document.body.classList.contains('focus-mode'));
 $('exitFocusBtn').onclick=()=>focusMode(false);
 function loadSaved(){try{savedViews=TetraSaved.decode(localStorage.getItem(TetraSaved.KEY));}catch{savedViews=[];}drawSaved();}
 function writeSaved(next){try{localStorage.setItem(TetraSaved.KEY,TetraSaved.encode(next));savedViews=next;drawSaved();return true;}catch{toast('Storage unavailable. Share a link to keep this view.');return false;}}
 function drawSaved(){
  $('savedViews').replaceChildren();$('savedCount').textContent=savedViews.length+' / '+TetraSaved.LIMIT;$('savedEmpty').hidden=!!savedViews.length;
  savedViews.forEach(item=>{
   const row=document.createElement('div');row.className='saved-view';
   const open=document.createElement('button');open.className='saved-open';open.type='button';const name=document.createElement('span');name.textContent=item.name;
   const detail=document.createElement('small'),params=new URLSearchParams(item.hash);detail.textContent='span '+params.get('s');open.append(name,detail);
   open.onclick=()=>{try{saveHistory();readHash(item.hash);closeSettings();viewport.focus({preventScroll:true});changed(false);}catch{toast('This saved view is not valid.');}};
   const remove=document.createElement('button');remove.className='saved-delete';remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+item.name);remove.onclick=()=>{if(writeSaved(savedViews.filter(v=>v.id!==item.id))){$('bookmarkName').focus();toast('Saved view removed.');}};
   row.append(open,remove);$('savedViews').append(row);
  });
 }
 $('bookmarkForm').onsubmit=e=>{
  e.preventDefault();if(savedViews.length>=TetraSaved.LIMIT){toast('24 views saved. Remove one before saving another.');return;}
  const name=$('bookmarkName').value.trim()||(locationIndex>=0?presets[locationIndex].name:'View '+String(savedViews.length+1).padStart(2,'0'));
  const item={id:globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2),name:name.slice(0,48),hash:hashString()};
  if(writeSaved([...savedViews,item])){$('bookmarkName').value='';toast('View saved on this device.');}
 };
 $('saveViewBtn').onclick=()=>{openSettings();$('bookmarkName').focus();};
 window.addEventListener('storage',e=>{if(e.key===TetraSaved.KEY)loadSaved();});loadSaved();
 document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')||e.target.closest('input,select,textarea,[contenteditable=true]')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='Escape'&&document.body.classList.contains('focus-mode')){focusMode(false);return;}
  const key=e.key.toLowerCase(),actions={f:()=>$('focusBtn').click(),c:openSettings,b:()=>$('saveViewBtn').click(),s:()=>$('shareBtn').click(),e:()=>$('exportBtn').click(),g:()=>{$('grid').checked=!grid;$('grid').dispatchEvent(new Event('change'));},'?':()=>$('helpBtn').click()};
  if(actions[key]){e.preventDefault();actions[key]();}else if(/^[1-4]$/.test(key)){e.preventDefault();loadPreset(Number(key)-1);}
 });
 let resumeFlow=false;
 document.addEventListener('visibilitychange',()=>{if(document.hidden){resumeFlow=flow;setFlow(false);stopRender();}else{if(resumeFlow)setFlow(true);changed(false);}});
 const motionPreference=matchMedia('(prefers-reduced-motion:reduce)');motionPreference.addEventListener('change',e=>{if(e.matches)setFlow(false);});
 window.addEventListener('pagehide',()=>stopRender());
 window.addEventListener('pageshow',e=>{if(e.persisted)changed(false);});
 window.addEventListener('hashchange',()=>{try{saveHistory();readHash();changed(false);}catch(error){toast(error.message);}});
 const observer=new ResizeObserver(()=>{const r=viewport.getBoundingClientRect();if(!r.width||!r.height)return;dims={w:r.width,h:r.height,dpr:Math.min(devicePixelRatio||1,2)};changed(false);});
 legacyCanvas.addEventListener('webglcontextlost',e=>{e.preventDefault();const wasActive=gpu===legacyGPU;legacyGPU=null;if(!wasActive)return;fallbackGPU(gpu);toast('GPU context lost. Switched to CPU.');changed(false);});
 try{readHash();}catch(error){toast('Could not open this view. '+error.message);}
 try{legacyGPU=new TetraGPU(legacyCanvas);gpu=legacyGPU;}catch(error){console.warn('WebGL2 unavailable; using Worker FP64.',error.message);}
 $('gestureHint').textContent=matchMedia('(pointer:coarse)').matches?'DRAG TO PAN / PINCH TO ZOOM':'DRAG TO PAN / SCROLL TO ZOOM';
 syncControls();observer.observe(viewport);
 TetraWebGPU.create(modernCanvas,failed=>{if(failed!==modernGPU)return;fallbackGPU(failed);if(!document.hidden)changed(false);toast('WebGPU device lost. Switched renderer.');})
  .then(renderer=>{modernGPU=renderer;webgpuStatus='ready';if(!document.hidden&&engine==='auto'&&!pointerMap.size)changed(false);})
  .catch(()=>{webgpuStatus='unavailable';});
 // Read-only diagnostic snapshots for reproducible tests; no network or telemetry.
 Object.defineProperty(window,'tetraDiagnostics',{get:()=>({view:serialize(),mode:currentMode,digits:precision(),iterations,palette,complete:lastRenderComplete,lastCompleted:lastCompletedInfo,backend:currentMode==='gpu'?gpu?.kind:currentMode,webgpuStatus,workers:workers.length,poolLimit,workerTransfer,savedCount:savedViews.length,focus:document.body.classList.contains('focus-mode'),version:'0.5.0',renderStage,quality,colorPhase:hue(),flow,displayWidth:displayCanvas.width,displayHeight:displayCanvas.height})});
})();
