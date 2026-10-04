(function(){
 'use strict';
 const $=id=>document.getElementById(id),F=createFixed(256),Q=F.Q;
 const workerSource=__WORKER_SOURCE__;
 const workerURL=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
 const presets=[
  {name:'전체 지형',sub:'THE COMPLEX PLANE',x:'-0.2',y:'0',span:'7'},
  {name:'해안선',sub:'EDGE OF STABILITY',x:'0.38',y:'0.72',span:'1.8'},
  {name:'바깥의 섬',sub:'THE OUTER ISLANDS',x:'-3.6',y:'3.4',span:'4'},
  {name:'고요한 경계',sub:'A CLOSER LOOK',x:'1.43',y:'0.015',span:'0.18'}
 ];
 let view={x:F.parse(presets[0].x),y:0n,span:F.parse('7')},palette=0,iterations=256,engine='auto',grid=false;
 let gpu=null,legacyGPU=null,modernGPU=null,webgpuStatus='pending',workers=[],serial=0,timer=0,raf=0,toastTimer=0,locationIndex=0;
 let history=[],pointerMap=new Map(),pinch=null,drag=null,gestureSaved=false;
 let currentMode='gpu',lastImage=null,lastView=null,lastRenderComplete=false,started=0,activePass=0,passes=[],pendingPaint=0;
 let lastCompletedInfo=null,workerTransfer='pixels';
 const poolLimit=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1,navigator.deviceMemory&&navigator.deviceMemory<=2?2:4));
 let gpuCanvas=$('gpuCanvas');
 const legacyCanvas=gpuCanvas,modernCanvas=$('webgpuCanvas');
 const cpuCanvas=$('cpuCanvas'),gridCanvas=$('gridCanvas'),viewport=$('viewport');
 const ctx=cpuCanvas.getContext('2d',{alpha:false}),gridCtx=gridCanvas.getContext('2d');
 let dims={w:1,h:1,dpr:1};
 const minSpan=F.parse('1e-200'),maxSpan=F.parse('1e12'),maxCoordinate=F.parse('1e12');
 const serialize=(v=view)=>({x:F.text(v.x),y:F.text(v.y),span:F.text(v.span)});
 const clone=v=>({x:v.x,y:v.y,span:v.span});
 const ratio=(a,n,d=1)=>a*BigInt(Math.round(n*1e6))/BigInt(Math.max(1,Math.round(d*1e6)));
 const numFormat=(n,d=6)=>Math.abs(n)>1e7||(Math.abs(n)>0&&Math.abs(n)<1e-5)?n.toExponential(4):n.toFixed(d);
 function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3300);}
 function saveHistory(){const prev=history.at(-1);if(!prev||prev.x!==view.x||prev.y!==view.y||prev.span!==view.span){if(history.length>=80)history.shift();history.push(clone(view));}$('backBtn').disabled=!history.length;}
 function validate(v){
  if(v.span<minSpan||v.span>maxSpan)throw Error('화면 범위는 1e-200에서 1e12 사이로 입력해 주세요.');
  if(F.abs(v.x)>maxCoordinate||F.abs(v.y)>maxCoordinate)throw Error('좌표는 -1e12에서 1e12 사이로 입력해 주세요.');return v;
 }
 function bounded(v){let limit=false;if(v.span<minSpan){v.span=minSpan;limit=true;}if(v.span>maxSpan){v.span=maxSpan;limit=true;}
  for(const key of ['x','y'])if(F.abs(v[key])>maxCoordinate){v[key]=v[key]<0n?-maxCoordinate:maxCoordinate;limit=true;}
  if(limit)toast('현재 계산기의 탐색 범위 한계에 도달했어요.');return v;
 }
 function hashString(){const p=new URLSearchParams({v:'1',x:F.text(view.x),y:F.text(view.y),s:F.text(view.span),n:String(iterations),p:String(palette),e:engine,g:grid?'1':'0'});return p.toString();}
 function updateURL(){try{window.history.replaceState(null,'','#'+hashString());}catch{}}
 function readHash(){
  if(location.hash.length>2400)throw Error('공유 주소가 너무 깁니다.');
  const p=new URLSearchParams(location.hash.slice(1));if(!p.has('x'))return;
  if(p.get('v')!=='1')throw Error('지원하지 않는 공유 주소 버전입니다.');
  view=validate({x:F.parse(p.get('x')),y:F.parse(p.get('y')),span:F.parse(p.get('s'))});
  const n=Number(p.get('n'));iterations=[64,128,256,512,1024].includes(n)?n:256;
  palette=[0,1,2].includes(Number(p.get('p')))?Number(p.get('p')):0;
  engine=['auto','cpu','big'].includes(p.get('e'))?p.get('e'):'auto';grid=p.get('g')==='1';locationIndex=-1;
 }
 function syncControls(){
  $('iterations').value=iterations;$('engine').value=engine;$('grid').checked=grid;
  document.querySelectorAll('[data-palette]').forEach(b=>{const selected=Number(b.dataset.palette)===palette;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  document.querySelectorAll('.preset').forEach((b,i)=>{b.classList.toggle('active',i===locationIndex);b.setAttribute('aria-pressed',String(i===locationIndex));});
  const colors=[1,2,0,3,4].map(k=>TetraCore.color(k,8,palette));
  document.querySelectorAll('.legend i').forEach((el,i)=>el.style.background=`rgb(${colors[i].join(',')})`);
  $('legend').title=palette===2?'흑백에서는 고정점·2주기·미판정이 같은 어두운 색으로 표시됩니다.':'유한한 계산의 관측 결과입니다. 증명이 아닙니다.';
 }
 function showGPU(){legacyCanvas.style.display='none';modernCanvas.style.display='none';gpuCanvas=gpu.canvas;gpuCanvas.style.display='block';cpuCanvas.style.display='none';}
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
  $('xInput').value=s.x;$('yInput').value=s.y;$('spanInput').value=s.span;
  $('locationTag').textContent=locationIndex<0?'↗ / 자유 탐험':String(locationIndex+1).padStart(2,'0')+' / '+presets[locationIndex].name;
  $('viewSubtitle').textContent=locationIndex<0?'YOUR OWN COORDINATES':presets[locationIndex].sub;
  currentMode=chooseMode();
  $('engineTag').textContent=currentMode==='gpu'?(gpu?.kind==='webgpu'?'WEBGPU · FP32':'WEBGL2 · FP32'):currentMode==='cpu'?'WORKER · FP64':`BIGINT · ${precision()} DP`;
  $('precisionNote').hidden=currentMode!=='big';
  $('precisionNote').textContent=`고정밀 ${precision()}자리 · 타일을 나눠 계산합니다. 계산 중에도 이동·확대할 수 있어요. 수치 실험이며 정확성의 증명은 아닙니다.`;
  $('backBtn').disabled=!history.length;
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
  gridCtx.font='9px monospace';gridCtx.lineWidth=1;gridCtx.fillStyle='#c1d1bc99';gridCtx.strokeStyle='#cedac326';
  if(deep){for(let x=w/2%100;x<w;x+=100){gridCtx.beginPath();gridCtx.moveTo(x,0);gridCtx.lineTo(x,h);gridCtx.stroke();}for(let y=h/2%100;y<h;y+=100){gridCtx.beginPath();gridCtx.moveTo(0,y);gridCtx.lineTo(w,y);gridCtx.stroke();}gridCtx.fillText('RELATIVE GRID · 100 px',18,h-130);return;}
  for(let i=0,v=Math.ceil((cx-span/2)/step)*step;i<20&&v<=cx+span/2;v+=step,i++){const x=(v-cx)/pixel+w/2;gridCtx.strokeStyle=Math.abs(v)<step*.0001?'#c9d8be66':'#cedac326';gridCtx.beginPath();gridCtx.moveTo(x,0);gridCtx.lineTo(x,h);gridCtx.stroke();if(x>45&&x<w-45)gridCtx.fillText(numFormat(v,2),x+5,h-123);}
  const vert=span*h/w;
  for(let i=0,v=Math.ceil((cy-vert/2)/step)*step;i<30&&v<=cy+vert/2;v+=step,i++){const y=h/2-(v-cy)/pixel;gridCtx.strokeStyle=Math.abs(v)<step*.0001?'#c9d8be66':'#cedac326';gridCtx.beginPath();gridCtx.moveTo(0,y);gridCtx.lineTo(w,y);gridCtx.stroke();if(y>120&&y<h-140)gridCtx.fillText(numFormat(v,2),8,y-5);}
 }
 function configureCPUCanvas(){const w=Math.round(dims.w*dims.dpr),h=Math.round(dims.h*dims.dpr);if(cpuCanvas.width!==w||cpuCanvas.height!==h){cpuCanvas.width=w;cpuCanvas.height=h;}ctx.imageSmoothingEnabled=false;}
 function stopWorkers(){workers.forEach(w=>w.terminate());workers=[];}
 function stopRender(){serial++;cancelAnimationFrame(raf);raf=0;document.body.dataset.complete='false';stopWorkers();clearTimeout(timer);cancelAnimationFrame(pendingPaint);pendingPaint=0;lastRenderComplete=false;}
 function showLoading(text){$('loading').hidden=false;$('loadingText').textContent=text;}
 function finished(w,h,counts){
  lastRenderComplete=true;$('loading').hidden=true;$('progressBar').style.width='100%';
  const elapsed=performance.now()-started;
  $('statusText').textContent=`${iterations.toLocaleString()}회 한도 · ${elapsed<1000?Math.round(elapsed)+' ms':(elapsed/1000).toFixed(1)+' s'} · 수치 실험`;
  $('resolutionReadout').textContent=`${w} × ${h} / ${currentMode==='big'?precision()+' DP':currentMode==='gpu'?'GPU PREVIEW':'FP64'}`;
  const source=currentMode==='gpu'?(gpu?.frame||gpuCanvas):cpuCanvas;
  const copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;copy.getContext('2d').drawImage(source,0,0);lastImage=copy;lastView=clone(view);
  lastCompletedInfo={view:serialize(),mode:currentMode,iterations,palette,width:w,height:h,counts,elapsed};
  document.body.dataset.ready='true';document.body.dataset.mode=currentMode;document.body.dataset.complete='true';
  updateURL();
 }
 function preview(){
  const mode=chooseMode();
  if(mode==='gpu'&&gpu){
   try{showGPU();let w=Math.max(160,Math.round(Math.min(dims.w*.55,650))),h=Math.max(1,Math.round(w*dims.h/dims.w));gpu.render(serialize(),w,h,Math.min(iterations,64),palette);return;}catch(e){fallbackGPU(gpu);toast('사용 가능한 계산 방식으로 전환합니다.');}
  }
  configureCPUCanvas();legacyCanvas.style.display='none';modernCanvas.style.display='none';cpuCanvas.style.display='block';ctx.fillStyle='#081416';ctx.fillRect(0,0,cpuCanvas.width,cpuCanvas.height);
  if(lastImage&&lastView){const zoom=Number(F.text(lastView.span))/Number(F.text(view.span));const dx=Number(F.text(F.div(lastView.x-view.x,view.span)))*cpuCanvas.width,dy=-Number(F.text(F.div(lastView.y-view.y,view.span)))*cpuCanvas.width;
   if(Number.isFinite(zoom+dx+dy)&&zoom<1e6&&zoom>1e-6){const w=lastImage.width*zoom*cpuCanvas.width/lastImage.width,h=lastImage.height*zoom*cpuCanvas.width/lastImage.width;ctx.drawImage(lastImage,(cpuCanvas.width-w)/2+dx,(cpuCanvas.height-h)/2+dy,w,h);}}
 }
 function changed(interactive=true){
  stopRender();gpu=modernGPU||legacyGPU;gpuCanvas=gpu?.canvas||legacyCanvas;document.body.dataset.complete='false';$('progressBar').style.width='0';syncControls();updateReadout();
  showLoading(interactive?'탐색 중 · 놓으면 다시 계산합니다':'새로운 풍경을 계산하고 있어요');
  cancelAnimationFrame(raf);raf=requestAnimationFrame(preview);
  timer=setTimeout(render,interactive?300:40);
 }
 async function render(){
  clearTimeout(timer);cancelAnimationFrame(raf);raf=0;stopRender();const id=serial;started=performance.now();gpu=modernGPU||legacyGPU;gpuCanvas=gpu?.canvas||legacyCanvas;currentMode=chooseMode();updateReadout();
  document.body.dataset.mode=currentMode;document.body.dataset.complete='false';
  if(currentMode==='gpu'&&gpu){
   try{showGPU();const budget=Math.floor(900000*Math.min(1,256/iterations));let w=Math.round(dims.w*Math.min(dims.dpr,1.35)),h=Math.round(w*dims.h/dims.w);const shrink=Math.min(1,Math.sqrt(budget/(w*h)));w=Math.max(1,Math.round(w*shrink));h=Math.max(1,Math.round(h*shrink));const renderer=gpu;renderer.render(serialize(),w,h,iterations,palette);if(renderer.kind==='webgpu')await renderer.device.queue.onSubmittedWorkDone();if(id!==serial)return;finished(w,h,null);return;}
   catch(e){if(id!==serial)return;fallbackGPU(gpu);changed(false);toast('사용 가능한 계산 방식으로 전환했어요.');return;}
  }
  configureCPUCanvas();legacyCanvas.style.display='none';modernCanvas.style.display='none';cpuCanvas.style.display='block';
  const pixelBudget=currentMode==='big'?(dims.w<761?2048:4096):(dims.w<761?180000:320000);
  const maximum=Math.max(12,Math.floor(Math.min(currentMode==='big'?72:800,dims.w*dims.dpr,Math.sqrt(pixelBudget*dims.w/dims.h))));
  passes=currentMode==='big'?[12,30,maximum]:[160,420,maximum];passes=[...new Set(passes.map(w=>Math.min(w,maximum)))].sort((a,b)=>a-b);activePass=0;
  try { for(let i=0;i<poolLimit;i++)workers.push(new Worker(workerURL)); } catch {
   // A browser may allow fewer Workers than its reported core count.
   if(!workers.length){$('loading').hidden=true;$('precisionNote').hidden=false;$('precisionNote').textContent='브라우저가 Worker 생성을 차단했습니다. HTTPS 주소나 로컬 정적 서버에서 열어 주세요.';return;}
  }
  const failed=message=>{if(id!==serial)return;stopWorkers();$('loading').hidden=true;$('statusText').textContent='계산 오류 · 설정을 바꾸면 다시 시도합니다';toast(message);};
  workers.forEach(w=>w.onerror=()=>failed('브라우저가 Worker 계산을 중단했어요. 설정을 낮추고 다시 시도해 주세요.'));
  function startPass(){
   if(id!==serial||!workers.length)return;
   const w=passes[activePass],h=Math.max(1,Math.round(w*dims.h/dims.w));
   const passCanvas=document.createElement('canvas');passCanvas.width=w;passCanvas.height=h;const pctx=passCanvas.getContext('2d',{alpha:false});pctx.imageSmoothingEnabled=false;pctx.drawImage(cpuCanvas,0,0,w,h);
   const progress=workers.map(()=>0),counts=workers.map(()=>[0,0,0,0,0]),completed=new Set();
   showLoading(`${currentMode==='big'?'고정밀':'CPU'} 계산 · ${activePass+1}/${passes.length}단계 · 0%`);
   workers.forEach((worker,index)=>{
    worker.onmessage=({data:d})=>{
     if(id!==serial||d.id!==id){d.bitmap?.close();return;}
     if(d.error){failed('계산을 완료하지 못했어요: '+d.error);return;}
     if(d.tile){
      if(d.bitmap){pctx.drawImage(d.bitmap,d.tile.x,d.tile.y);d.bitmap.close();workerTransfer='bitmap';}
      else{pctx.putImageData(new ImageData(d.pixels,d.tile.width,d.tile.height),d.tile.x,d.tile.y);workerTransfer='pixels';}
     }
     progress[index]=d.done;counts[index]=d.counts;
     const fraction=progress.reduce((a,b)=>a+b,0)/(w*h);
     const paint=()=>{pendingPaint=0;if(id!==serial)return;ctx.imageSmoothingEnabled=false;ctx.drawImage(passCanvas,0,0,cpuCanvas.width,cpuCanvas.height);};
     if(!pendingPaint)pendingPaint=requestAnimationFrame(paint);
     $('progressBar').style.width=((activePass+fraction)/passes.length*100)+'%';
     $('loadingText').textContent=`${currentMode==='big'?'고정밀 '+precision()+'자리':'CPU'} · ${activePass+1}/${passes.length}단계 · ${Math.round(fraction*100)}%`;
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
 function zoom(factor,point={x:dims.w/2,y:dims.h/2}){const anchor=at(point);const span=limitedSpan(ratio(view.span,factor));if(span===view.span){toast('현재 계산기의 확대·축소 한계입니다.');return;}view=bounded({span,x:anchor.x-ratio(span,point.x-dims.w/2,dims.w),y:anchor.y+ratio(span,point.y-dims.h/2,dims.w)});locationIndex=-1;changed();}
 function loadPreset(index){saveHistory();locationIndex=index;const p=presets[index];view={x:F.parse(p.x),y:F.parse(p.y),span:F.parse(p.span)};closeSettings();changed(false);}
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
 function pointerEnd(e){if(!pointerMap.has(e.pointerId))return;pointerMap.delete(e.pointerId);touchSetup();if(!pointerMap.size){gestureSaved=false;clearTimeout(timer);timer=setTimeout(render,80);updateURL();}}
 viewport.addEventListener('pointerup',pointerEnd);viewport.addEventListener('pointercancel',pointerEnd);viewport.addEventListener('lostpointercapture',pointerEnd);
 let lastWheel=-Infinity;
 viewport.addEventListener('wheel',e=>{if(e.target.closest('button'))return;e.preventDefault();if(performance.now()-lastWheel>500)saveHistory();lastWheel=performance.now();const dy=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?dims.h:1);zoom(Math.exp(Math.max(-1.1,Math.min(1.1,dy*.0018))),relative(e.clientX,e.clientY));},{passive:false});
 viewport.addEventListener('dblclick',e=>{if(e.target.closest('button'))return;e.preventDefault();saveHistory();zoom(.4,relative(e.clientX,e.clientY));});
 $('zoomIn').onclick=()=>{saveHistory();zoom(.5);};$('zoomOut').onclick=()=>{saveHistory();zoom(2);};$('homeBtn').onclick=()=>loadPreset(0);$('brand').onclick=e=>{e.preventDefault();loadPreset(0);};
 $('backBtn').onclick=()=>{if(!history.length)return;view=history.pop();locationIndex=-1;changed(false);};
 viewport.addEventListener('keydown',e=>{
  if(e.target.closest('button,input,select,textarea'))return;
  if(['+','=','-','_','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();else return;
  if(e.altKey&&e.key==='ArrowLeft'){$('backBtn').click();return;}
  if(e.key==='Home'){loadPreset(0);return;}
  saveHistory();if(e.key==='+'||e.key==='=')zoom(.5);else if(e.key==='-'||e.key==='_')zoom(2);else{const step=view.span/(e.shiftKey?3n:10n);view=bounded({...view,x:view.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0n),y:view.y+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0n)});locationIndex=-1;changed();}
 });
 $('iterations').onchange=e=>{iterations=Number(e.target.value);changed(false);};$('engine').onchange=e=>{engine=e.target.value;changed(false);};
 document.querySelectorAll('[data-palette]').forEach(b=>b.onclick=()=>{palette=Number(b.dataset.palette);changed(false);});
 $('grid').onchange=e=>{grid=e.target.checked;drawGrid();updateURL();};
 $('coordinateForm').onsubmit=e=>{e.preventDefault();try{const v=validate({x:F.parse($('xInput').value.trim()),y:F.parse($('yInput').value.trim()),span:F.parse($('spanInput').value.trim())});saveHistory();view=v;locationIndex=-1;closeSettings();changed(false);}catch(error){toast(error.message);}};
 $('shareBtn').onclick=async()=>{
  updateURL();const url=location.href;
  if(location.protocol==='file:'){$('shareMessage').textContent='로컬 파일은 다른 기기에서 바로 열리지 않아요. 배포 후 주소를 공유하거나, 아래 위치 데이터를 같은 HTML 파일의 주소 뒤에 붙여 주세요.';$('shareText').value='#'+hashString();$('shareDialog').showModal();$('shareText').select();return;}
  try{if(!navigator.clipboard)throw Error('No clipboard');await navigator.clipboard.writeText(url);toast('현재 위치의 링크를 복사했어요.');}
  catch{$('shareMessage').textContent='이 주소를 복사하면 같은 좌표로 돌아올 수 있어요.';$('shareText').value=url;$('shareDialog').showModal();$('shareText').select();}
 };
 $('exportBtn').onclick=()=>{
  const out=document.createElement('canvas');const source=lastRenderComplete&&lastImage?lastImage:currentMode==='gpu'?(gpu?.frame||gpuCanvas):cpuCanvas;out.width=Math.max(1,source.width);out.height=Math.max(1,source.height);const c=out.getContext('2d');c.drawImage(source,0,0);if(grid)c.drawImage(gridCanvas,0,0,out.width,out.height);
  c.fillStyle='#0a151deb';c.fillRect(0,out.height-43,out.width,43);c.fillStyle='#d8c39b';c.font='10px monospace';c.fillText(`TETRA / ${currentMode.toUpperCase()} / ${iterations} ITER / ${lastRenderComplete?'COMPLETED':'PARTIAL PREVIEW'}`,12,out.height-26);c.font='8px monospace';c.fillStyle='#9ab4af';c.fillText(`Re ${F.text(view.x)}  Im ${F.text(view.y)}  Span ${F.text(view.span)}`,12,out.height-10,out.width-24);
  out.toBlob(blob=>{if(!blob){toast('이미지를 저장하지 못했어요.');return;}const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='tetra-'+Date.now()+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);toast(lastRenderComplete?'현재 풍경을 PNG로 저장했어요.':'계산 중인 미리보기를 PNG로 저장했어요.');},'image/png');
 };
 $('fullscreenBtn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('이 브라우저는 전체 화면을 지원하지 않아요.');}catch{toast('전체 화면을 사용할 수 없어요.');}};
 $('helpBtn').onclick=()=>$('helpDialog').showModal();$('mobileHelpBtn').onclick=()=>{closeSettings();$('helpDialog').showModal();};document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
 document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
 const mobileLayout=matchMedia('(max-width: 760px)');
 function syncDrawer(){
  const mobile=mobileLayout.matches,open=mobile&&$('sidebar').classList.contains('open');
  $('sidebar').inert=mobile&&!open;viewport.inert=open;
  document.querySelector('.topbar').inert=open;document.querySelector('.statusbar').inert=open;
  $('scrim').hidden=!open;$('settingsBtn').setAttribute('aria-expanded',String(open));
  $('sidebar').setAttribute('aria-hidden',String(mobile&&!open));
  if(open){$('sidebar').setAttribute('role','dialog');$('sidebar').setAttribute('aria-modal','true');}
  else{$('sidebar').removeAttribute('role');$('sidebar').removeAttribute('aria-modal');}
 }
 function closeSettings(){const restore=mobileLayout.matches&&$('sidebar').contains(document.activeElement);$('sidebar').classList.remove('open');syncDrawer();if(restore)$('settingsBtn').focus();}
 $('settingsBtn').onclick=()=>{$('sidebar').classList.toggle('open');syncDrawer();if($('sidebar').classList.contains('open'))$('closeSettings').focus();};
 $('settingsBtn').setAttribute('aria-controls','sidebar');$('scrim').onclick=closeSettings;$('closeSettings').onclick=closeSettings;
 $('sidebar').addEventListener('keydown',e=>{
  if(!mobileLayout.matches||!$('sidebar').classList.contains('open')||e.key!=='Tab')return;
  const items=[...$('sidebar').querySelectorAll('button,input,select,summary,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);
  const first=items[0],last=items.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 });
 mobileLayout.addEventListener('change',()=>{if(!mobileLayout.matches)$('sidebar').classList.remove('open');syncDrawer();});syncDrawer();
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSettings();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stopRender();}else changed(false);});
 window.addEventListener('pagehide',()=>stopRender());
 window.addEventListener('pageshow',e=>{if(e.persisted)changed(false);});
 window.addEventListener('hashchange',()=>{try{saveHistory();readHash();changed(false);}catch(error){toast(error.message);}});
 const observer=new ResizeObserver(()=>{const r=viewport.getBoundingClientRect();if(!r.width||!r.height)return;dims={w:r.width,h:r.height,dpr:Math.min(devicePixelRatio||1,1.5)};changed(false);});
 legacyCanvas.addEventListener('webglcontextlost',e=>{e.preventDefault();const wasActive=gpu===legacyGPU;legacyGPU=null;if(!wasActive)return;fallbackGPU(gpu);toast('GPU 연결이 끊겨 CPU로 전환했어요.');changed(false);});
 try{readHash();}catch(error){toast('공유 위치를 불러오지 못했어요. '+error.message);}
 try{legacyGPU=new TetraGPU(legacyCanvas);gpu=legacyGPU;}catch(error){console.warn('WebGL2 unavailable; using Worker FP64.',error.message);}
 syncControls();observer.observe(viewport);
 TetraWebGPU.create(modernCanvas,failed=>{if(failed!==modernGPU)return;fallbackGPU(failed);if(!document.hidden)changed(false);toast('WebGPU 연결이 끊겨 다른 계산 방식으로 전환했어요.');})
  .then(renderer=>{modernGPU=renderer;webgpuStatus='ready';if(!document.hidden&&engine==='auto'&&!pointerMap.size)changed(false);})
  .catch(()=>{webgpuStatus='unavailable';});
 // Read-only diagnostic snapshots for reproducible tests; no network or telemetry.
 Object.defineProperty(window,'tetraDiagnostics',{get:()=>({view:serialize(),mode:currentMode,digits:precision(),iterations,palette,complete:lastRenderComplete,lastCompleted:lastCompletedInfo,backend:currentMode==='gpu'?gpu?.kind:currentMode,webgpuStatus,workers:workers.length,poolLimit,workerTransfer,version:'0.3.0'})});
})();
