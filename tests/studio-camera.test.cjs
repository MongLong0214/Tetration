'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/precision.js');require('../src/render.js');const M=require('../src/studio-model.js'),C=require('../src/studio-camera.js'),F=globalThis.createFixed(256);
const shot=()=>M.createProject({x:'-0.5',y:'0',span:'8'});
test('independent 310-digit mpmath fixtures reproduce extreme and near-equal camera paths',()=>{
 for(const row of require('./studio-camera-fixtures.json').cases){
  const p=shot();p.shot.motion='travel';p.shot.frameCount=61;p.shot.easing=row.easing;p.shot.start.x=row.x;p.shot.end.x=row.y;p.shot.start.span=row.a;p.shot.end.span=row.b;
  const result=C.evaluateFrame(p,row.k).camera;
  const span=F.parse(row.expectedSpan),pixelTolerance=span/BigInt(1920*1024);
  assert.ok(F.abs(F.parse(result.span)-span)<pixelTolerance,JSON.stringify(row));
  assert.ok(F.abs(F.parse(result.x)-F.parse(row.expectedX))<F.parse('1e-245'),JSON.stringify(row));
 }
});
test('fixed log span and zoom-aware centers include exact endpoints and ignore call order',()=>{
 const p=shot();p.shot.motion='travel';p.shot.frameCount=61;p.shot.easing='linear';p.shot.end={x:'1.5',y:'1',span:'2',rollDeg:90};
 const evaluate=C.createEvaluator(p),middle=evaluate(30);assert.ok(F.abs(F.parse(middle.camera.span)-F.parse('4'))<F.parse('1e-240'));
 assert.ok(F.abs(F.parse(middle.camera.x)-F.div(F.Q*5n,6n*F.Q))<F.parse('1e-239'));
 assert.deepEqual(evaluate(0).camera,p.shot.start);assert.deepEqual(evaluate(60).camera,p.shot.end);assert.equal(middle.camera.rollDeg,45);
 const sequential=Array.from({length:61},(_,k)=>evaluate(k));for(const k of [60,3,29,0,1,46,12,30])assert.deepEqual(evaluate(k),sequential[k]);
 let previous=F.parse('8');for(const frame of sequential){const span=F.parse(frame.camera.span);assert.ok(span<=previous);previous=span;}
});
test('Hold keeps unused B; equal spans use linear center interpolation; roll follows saved difference',()=>{
 const p=shot();p.shot.end.x='1.5';p.shot.end.rollDeg=180;const hold=C.createEvaluator(p);assert.deepEqual(hold(299).camera,p.shot.start);
 p.shot.motion='travel';p.shot.easing='linear';p.shot.frameCount=61;p.shot.start.rollDeg=-180;
 const frame=C.evaluateFrame(p,30);assert.equal(frame.camera.x,'0.5');assert.equal(frame.camera.span,'8');assert.equal(frame.camera.rollDeg,0);assert.equal(frame.seconds,1);assert.equal(frame.timestampUs,1000000);
 const reverse=C.reverseEndpoints(p);assert.deepEqual(reverse.look,p.look);assert.deepEqual(reverse.output,p.output);assert.equal(reverse.shot.start.rollDeg,180);assert.deepEqual(C.reverseEndpoints(reverse),p);
 const match=C.matchEndSpan({...p,shot:{...p.shot,end:{...p.shot.end,span:'2'}}});assert.equal(match.shot.end.span,'8');
});
test('deep decimal deltas, extreme spans and the near-equal policy remain precise',()=>{
 const p=shot();p.shot.motion='travel';p.shot.easing='linear';p.shot.frameCount=61;p.shot.start={x:'0',y:'1e-210',span:'1e-200',rollDeg:0};p.shot.end={x:'1e-210',y:'2e-210',span:'1e12',rollDeg:0};
 const frame=C.evaluateFrame(p,30);assert.ok(F.abs(F.parse(frame.camera.span)-F.parse('1e-94'))<F.parse('1e-200'));
 for(const span of ['8','8.000004','8.000016']){
  p.shot.start.span='8';p.shot.end.span=span;const center=C.evaluateFrame(p,30).camera.x;
  const value=F.parse(center);assert.ok(value>0n&&value<F.parse('1e-210'));if(span==='8.000004')assert.equal(center,F.text(F.parse('5e-211')));
 }
 for(const easing of M.ENUMS.easing){p.shot.easing=easing;assert.doesNotThrow(()=>C.evaluateFrame(p,30));}
});
test('roll overscan covers all planned corners and preserves world pixel spacing',()=>{
 for(const output of [{aspect:'16:9',resolution:1080},{aspect:'9:16',resolution:1080},{aspect:'1:1',resolution:720}]){
  const {width:W,height:H}=M.dimensions(output);assert.deepEqual(C.sourceExtent(W,H,[0]),{width:W,height:H,identity:true});
  const rolls=[0,45,90,-180,...Array.from({length:601},(_,n)=>n*360/600-180)],extent=C.sourceExtent(W,H,rolls);
  assert.equal(extent.width%2,0);assert.equal(extent.height%2,0);
  for(const roll of rolls){const angle=roll*Math.PI/180;assert.ok(extent.width>=W*Math.abs(Math.cos(angle))+H*Math.abs(Math.sin(angle))+2-1e-9);assert.ok(extent.height>=W*Math.abs(Math.sin(angle))+H*Math.abs(Math.cos(angle))+2-1e-9);}
  const p=shot(),camera=C.sourceCamera(p.shot.start,W,extent);assert.ok(F.abs(F.parse(camera.span)*BigInt(W)-F.parse(p.shot.start.span)*BigInt(extent.width))<BigInt(W));
  for(const roll of [0,45,90]){const center=C.screenToWorld({...p.shot.start,rollDeg:roll},W/2,H/2,W,H);assert.deepEqual(center,{x:'-0.5',y:'0'});}
  assert.equal(C.screenToWorld({...p.shot.start,rollDeg:90},W/2+W/8,H/2,W,H).y,'1');
 }
});
test('plans fix cap and extent, remain FX independent, and cancel at yield boundaries',async()=>{
 const p=shot();p.shot.motion='travel';p.shot.end.span='1e-100';const first=await C.plan(p,{yieldTask:async()=>{}});
 const q=JSON.parse(JSON.stringify(p));q.look.kaleido.enabled=true;q.look.wave.speed=-1;q.look.palette='mono';const second=await C.plan(q,{yieldTask:async()=>{}});
 assert.deepEqual(first.frames,second.frames);assert.deepEqual(first.extent,second.extent);assert.equal(first.iterations,4096);
 const controller=new AbortController();await assert.rejects(C.plan(p,{signal:controller.signal,yieldTask:async()=>controller.abort()}),{name:'AbortError'});
 assert.equal(first.frames.length,300);assert.equal(first.frames.at(-1).durationUs,33333);
});
test('held framing plans keep every exact timestamp without video-length timer waits',async()=>{
 const p=shot();p.shot.frameCount=600;let yields=0;
 const plan=await C.plan(p,{yieldTask:async()=>{yields++;}});
 assert.equal(yields,0);assert.equal(plan.frames.length,600);
 for(const k of [0,1,299,599])assert.deepEqual(plan.frames[k],C.evaluateFrame(p,k));
 const aborted=new AbortController();aborted.abort();await assert.rejects(C.plan(p,{signal:aborted.signal}),{name:'AbortError'});
});
test('camera reprojection preserves world points including rotated deep decimal deltas',()=>{
 const from={x:'-2.5',y:'0.437',span:'1e-200',rollDeg:45},to={...from,x:F.text(F.parse(from.x)+F.parse('2e-202')),y:F.text(F.parse(from.y)-F.parse('3e-202')),span:'8e-201',rollDeg:-30},W=720,H=1280;
 const [a,b,c,d,tx,ty]=C.screenMatrix(from,to,W,H);
 for(const [x,y]of [[360,640],[100,200],[620,1050]]){
  const expected=C.screenToWorld(from,x,y,W,H),actual=C.screenToWorld(to,a*x+c*y+tx,b*x+d*y+ty,W,H);
  assert.ok(F.abs(F.parse(expected.x)-F.parse(actual.x))<F.parse('1e-213'));assert.ok(F.abs(F.parse(expected.y)-F.parse(actual.y))<F.parse('1e-213'));
 }
 assert.deepEqual(C.screenMatrix(from,from,W,H),[1,0,-0,1,0,0]);
});

test('hold tail stays exactly on End while travel interpolates over the moving frames',()=>{
 const base=shot();base.shot.motion='travel';base.shot.end={x:'1.5',y:'1',span:'2',rollDeg:90};
 for(const easing of M.ENUMS.easing){
  const plain={...base,shot:{...base.shot,easing,frameCount:61}},held={...base,shot:{...base.shot,easing,frameCount:91,holdFrames:30}};
  const evaluate=C.createEvaluator(held),reference=C.createEvaluator(plain);
  for(let k=0;k<=60;k++)assert.deepEqual(evaluate(k).camera,reference(k).camera,easing+' '+k);
  for(let k=60;k<91;k++)assert.deepEqual(evaluate(k).camera,held.shot.end,easing+' '+k);
  assert.equal(evaluate(90).seconds,3);assert.equal(evaluate(90).timestampUs,3000000);
 }
 const still=shot();still.shot.holdFrames=60;assert.deepEqual(C.evaluateFrame(still,299).camera,still.shot.start);
});
test('zoom rate reports total zoom, eased peaks and the 1.15x per-frame length guide',()=>{
 const horizon=(fps,seconds,easing='linear')=>{const p=M.setDuration(M.setFps(shot(),fps),seconds);p.shot.motion='travel';p.shot.end.span='7e-100';p.shot.easing=easing;return p;};
 const near=(actual,expected,tolerance)=>assert.ok(Math.abs(actual-expected)<=tolerance,actual+' vs '+expected);
 const a=C.zoomRate(horizon(24,20));near(a.decades,100.058,0.001);assert.ok(a.total>1e100&&a.total<1.2e100);near(a.peakRatio,1.616,0.002);near(a.peakDecadesPerSecond,5.01,0.01);
 near(C.zoomRate(horizon(30,20)).peakRatio,1.468,0.002);near(C.zoomRate(horizon(30,60)).peakRatio,1.137,0.002);
 const guide=C.zoomRate(horizon(30,20));assert.equal(guide.guideRatio,1.15);near(guide.recommendedSeconds,55,0.1);assert.equal(guide.recommendedFrames,1650);
 const close=horizon(30,5);close.shot.start.span='1.12e-98';const c=C.zoomRate(close);near(c.total,16,1e-9);near(c.decades,Math.log10(16),1e-9);near(c.peakRatio,1.0188,0.0002);
 // The reported peak is the real largest adjacent-frame ratio of the evaluator, easing included.
 for(const easing of M.ENUMS.easing){
  const p=close;p.shot.easing=easing;const evaluate=C.createEvaluator(p),ln=value=>Number(value)/Number(F.Q);let measured=0;for(let k=1;k<p.shot.frameCount;k++)measured=Math.max(measured,Math.abs(ln(F.ln(F.parse(evaluate(k).camera.span))-F.ln(F.parse(evaluate(k-1).camera.span)))));
  near(Math.exp(measured),C.zoomRate(p).peakRatio,1e-9);
 }
 close.shot.easing='linear';const linear=C.zoomRate(close).peakRatio;for(const [easing,slope] of [['ease-in',2],['ease-out',2],['ease-in-out',1.5]]){close.shot.easing=easing;const r=C.zoomRate(close);assert.ok(r.peakRatio>linear);near(Math.log(r.peakRatio)/Math.log(linear),slope,0.03);}
 // Following the recommendation reaches the guide; one frame fewer does not (linear).
 for(const easing of M.ENUMS.easing){
  const p=horizon(30,20,easing),r=C.zoomRate(p),frames=r.recommendedFrames,fit={...p,shot:{...p.shot,frameCount:frames}},short={...p,shot:{...p.shot,frameCount:frames-1}};
  assert.ok(C.zoomRate(fit).peakRatio<=1.15+1e-12,easing);if(easing==='linear')assert.ok(C.zoomRate(short).peakRatio>1.15);
 }
 const held=horizon(30,60);held.shot.holdFrames=300;near(C.zoomRate(held).recommendedSeconds,65,0.1);assert.ok(C.zoomRate(held).peakRatio>C.zoomRate(horizon(30,60)).peakRatio);
 for(const flat of [shot(),Object.assign(horizon(30,20),{shot:{...horizon(30,20).shot,motion:'hold'}}),Object.assign(horizon(30,20),{shot:{...horizon(30,20).shot,end:{...horizon(30,20).shot.start,x:'1'}}})]){const r=C.zoomRate(flat);assert.equal(r.zooming,false);assert.equal(r.peakRatio,1);assert.equal(r.recommendedSeconds,null);}
 const out=horizon(30,60);[out.shot.start,out.shot.end]=[out.shot.end,out.shot.start];near(C.zoomRate(out).peakRatio,1.137,0.002);
});
