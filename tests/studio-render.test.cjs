'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/precision.js');require('../src/core.js');require('../src/render.js');const M=require('../src/studio-model.js');require('../src/studio-camera.js');const R=require('../src/studio-render.js');
const project=()=>M.createProject({x:'-0.5',y:'0',span:'8'});
function renderer({fence=async()=>{},lost=()=>false}={}){
 const calls={draws:[],releases:[],allocations:0};
 return {calls,maxTexture:8192,floatColor:true,lost,program(){},warm:()=>true,blaPolicy:()=>0,effectiveIterations:scene=>scene.iterations,
  beginFrame(width,height,seed,adaptive){calls.allocations++;assert.equal(seed,null);assert.equal(adaptive,false);return {width,height,seed:null};},
  prepare(frame,scene,samples,threshold){calls.draws.push({samples,threshold,scene});},drawTile(){},fence,
  releaseFrame(frame){assert.ok(!calls.releases.includes(frame),'double release');calls.releases.push(frame);}
 };
}
test('complete frames use requested samples without adaptive seeds; Hold has one cached base',async()=>{
 const p=project(),gpu=renderer();p.output.samples=16;
 const session=await R.prepare(p,{renderer:gpu,size:{width:64,height:64},yieldTask:async()=>{}}),first=await session.renderBase(0);
 assert.equal(first.complete,true);assert.equal(first.samples,16);assert.equal(gpu.calls.draws[0].threshold,0);assert.equal(gpu.calls.draws[0].samples,16);first.release();first.release();
 const again=await session.renderBase(299);assert.equal(again.frame,first.frame);again.release();assert.equal(session.diagnostics().cacheHits,1);assert.equal(session.diagnostics().cachedFrames,1);
 await session.dispose();assert.equal(gpu.calls.releases.length,1);assert.equal(session.diagnostics().cachedFrames,0);await assert.rejects(session.renderBase(0),{name:'AbortError'});
});
test('cancel waits for an in-flight GPU fence before returning its frame to the pool',async()=>{
 let resolve,entered;const started=new Promise(r=>{entered=r;}),gpu=renderer({fence:()=>{entered();return new Promise(r=>{resolve=r;});}}),controller=new AbortController();
 const session=await R.prepare(project(),{renderer:gpu,size:{width:64,height:64},yieldTask:async()=>{}}),frame=session.renderBase(0,'final',controller.signal);
 const rejected=assert.rejects(frame,{name:'AbortError'});await started;controller.abort();assert.equal(gpu.calls.releases.length,0);resolve();await rejected;assert.equal(gpu.calls.releases.length,1);assert.equal(session.diagnostics().completedFrames,0);await session.dispose();
});
test('dispose aborts a delayed reference without waiting for or applying its late result',async()=>{
 const p=project();p.shot.start.span=p.shot.end.span='1e-20';p.shot.start.x=p.shot.end.x='-2';
 let resolve,entered;const started=new Promise(r=>{entered=r;}),gpu=renderer(),session=await R.prepare(p,{renderer:gpu,size:{width:64,height:64},yieldTask:async()=>{},reference:()=>{entered();return new Promise(r=>{resolve=r;});}});
 const work=session.renderBase(0),rejected=assert.rejects(work,{name:'AbortError'});await started;await session.dispose();await rejected;resolve({});await Promise.resolve();assert.equal(gpu.calls.allocations,0);assert.equal(session.diagnostics().references,0);
});
test('canceled WebGPU batch drains queued WebGL writes before returning its frame',async()=>{
 let resolve,entered;const started=new Promise(r=>{entered=r;}),gpu=renderer({fence:()=>{entered();return new Promise(r=>{resolve=r;});}}),controller=new AbortController();
 const compute={failed:false,pending:new Map(),pipeline(){},kernel:()=> 'direct',capacity:()=>65536,draw:async()=>{controller.abort();return false;},complete(){}};
 const session=await R.prepare(project(),{renderer:gpu,compute,size:{width:32,height:32}}),work=session.renderBase(0,'final',controller.signal),rejected=assert.rejects(work,{name:'AbortError'});
 await started;assert.equal(gpu.calls.releases.length,0);resolve();await rejected;assert.equal(gpu.calls.releases.length,1);await session.dispose();
});
test('reference descriptors are deterministic and independent of visiting or Look fields',async()=>{
 const p=project();p.shot.motion='travel';p.shot.end.span='1e-100';const first=await R.prepare(p,{renderer:renderer(),size:{width:64,height:64},yieldTask:async()=>{}});
 p.look.kaleido.enabled=true;p.look.wave.speed=-1;p.look.bloom.radiusRatio=0.03;
 const second=await R.prepare(p,{renderer:renderer(),size:{width:64,height:64},yieldTask:async()=>{}});assert.deepEqual(first.numerical,second.numerical);assert.ok(first.numerical.descriptors.length>1);assert.ok(first.numerical.descriptors.length<300);
 for(const state of first.numerical.states)if(state.mode==='perturb')assert.ok(first.numerical.descriptors[state.descriptor]);await first.dispose();await second.dispose();
});
test('unsupported source size, float target or device loss fail without reducing output',async()=>{
 const p=project(),gpu=renderer();gpu.maxTexture=1024;await assert.rejects(R.prepare(p,{renderer:gpu,yieldTask:async()=>{}}),/image limit/);
 const unavailable=renderer();unavailable.floatColor=false;p.numerics.iterations='fixed';p.numerics.fixedIterations=8192;await assert.rejects(R.prepare(p,{renderer:unavailable,size:{width:64,height:64},yieldTask:async()=>{}}),/float render targets/);
 let lost=false;const failing=renderer({lost:()=>lost});p.numerics.fixedIterations=1024;const session=await R.prepare(p,{renderer:failing,size:{width:64,height:64},yieldTask:async()=>{}});lost=true;await assert.rejects(session.renderBase(0),/device was lost/);assert.equal(failing.calls.draws.length,0);await session.dispose();
});
test('offline WebGPU fills every requested sample within capacity and retains compatible measured rates',async()=>{
 const p=project();p.shot.motion='travel';p.shot.end.span='4';const gpu=renderer(),batches=[];
 const compute={failed:false,pending:new Map(),pipeline(){},kernel:()=> 'direct',capacity:()=>256,draw:async(renderer,frame,scene,samples,threshold,tiles)=>{
  const pixels=tiles.reduce((sum,t)=>sum+t.width*t.height,0);assert.ok(pixels*samples<=256);assert.equal(samples,4);assert.equal(threshold,0);assert.equal(scene.blaPolicy,'deterministic');batches.push(pixels);return true;
 },complete(){}};
 const session=await R.prepare(p,{renderer:gpu,compute,size:{width:31,height:17}});
 for(const k of [0,1]){const before=batches.length,frame=await session.renderBase(k);frame.release();assert.equal(batches.slice(before).reduce((a,b)=>a+b,0),31*17);}
 assert.equal(session.diagnostics().completedFrames,2);await session.dispose();
});
test('offline rendering preserves higher precision metadata on a shared reference',async()=>{
 const p=project(),gpu=renderer();p.shot.start.span=p.shot.end.span='1e-20';
 let shared;
 const session=await R.prepare(p,{renderer:gpu,size:{width:16,height:16},reference:options=>{shared={digits:140,iterations:options.iterations};return shared;}});
 const frame=await session.renderBase(0);frame.release();assert.equal(shared.digits,140);await session.dispose();
});
