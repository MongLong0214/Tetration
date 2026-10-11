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
