const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/precision.js');const M=require('../src/studio-model.js'),Export=require('../src/studio-export.js');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0)),deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(overrides={}){
 const p=M.setDuration(M.createProject({x:'-0.5',y:'0',span:'8'}),2),events=[],states=[],frames=[],resources={renderer:{}},canvas={},counters={renders:0,adds:0,activeAdds:0,peakAdds:0,releases:0,disposals:0};
 let frozen=null,hidden=false;
 const exporter=Export.create({isHidden:()=>hidden,notify:s=>states.push({...s}),drainPreview:async()=>{events.push('drain');},setOwner:owner=>events.push(owner),
  prepare:async(value,options)=>{frozen=value;assert.ok(options.signal);events.push('prepare');return {backend:'webgl',plan:{size:M.dimensions(value.output),extent:M.dimensions(value.output),iterations:384,frames:Array.from({length:60},()=>({camera:value.shot.start}))},renderBase:async k=>{counters.renders++;return {k,release(){counters.releases++;}};},dispose:async()=>{counters.disposals++;}};},
  createCompositor:()=>({canvas,compose:async()=>canvas,dispose:async()=>{counters.disposals++;}}),
  probe:async(config,probeSignal)=>{assert.ok(probeSignal && typeof probeSignal.aborted==='boolean');return {supported:true,config:{...config,container:'mp4',codec:'avc'}};},
  createSink:async()=>({addFrame:async time=>{counters.activeAdds++;counters.peakAdds=Math.max(counters.peakAdds,counters.activeAdds);await tick();frames.push(time);counters.adds++;counters.activeAdds--;},finish:async()=>({blob:new Blob(['encoded']),bytes:7,extension:'mp4',mimeType:'video/mp4',submittedFrames:60}),cancel:async()=>{events.push('sink cancel');}}),...overrides});
 return {p,exporter,events,states,frames,counters,resources,get frozen(){return frozen;},hide(value){hidden=value;if(value)exporter.hidden();}};
}
test('immutable project and exact frame grid, serial add and one ready result after finalize',async()=>{
 const f=fixture(),work=f.exporter.start(f.p,f.resources);f.p.shot.start.span='4';assert.throws(()=>f.exporter.start(f.p,f.resources),/already active/);
 const result=await work;assert.equal(result.state,'ready');assert.equal(f.frozen.shot.start.span,'8');assert.equal(Object.isFrozen(f.frozen.shot.start),true);
 assert.deepEqual(f.events.slice(0,3),['drain','export','prepare']);assert.equal(f.counters.peakAdds,1);assert.equal(f.frames.length,60);assert.equal(f.counters.releases,60);assert.equal(f.counters.disposals,2);
 for(let k=0;k<60;k++)assert.deepEqual(f.frames[k],M.timing(f.frozen,k));assert.equal(f.states.find(s=>s.state==='finalizing').result,null);assert.equal(result.active,false);
 f.exporter.clearResult();assert.equal(f.exporter.snapshot().url,null);assert.equal(Export.filename('../a:b?','mp4'),'..-a-b-.mp4');
});
test('cancel while finalize resolves late cannot publish a file',async()=>{
 const finish=deferred(),started=deferred();const f=fixture({createSink:async()=>({addFrame:async()=>{},finish:()=>{started.resolve();return finish.promise;},cancel:async()=>{}})});
 const work=f.exporter.start(f.p,f.resources);await started.promise;f.hide(true);assert.equal(f.exporter.snapshot().state,'finalizing');f.hide(false);assert.equal(f.exporter.snapshot().state,'finalizing');const canceled=f.exporter.cancel();finish.resolve({blob:new Blob(['late']),extension:'mp4',bytes:4});await canceled;
 const state=await work;assert.equal(state.state,'canceled');assert.equal(state.result,null);assert.equal(state.url,null);assert.equal(state.active,false);
});
test('hidden finishes current add and suspends at next frame; visible requires explicit Resume',async()=>{
 const add=deferred(),started=deferred();let adds=0;const f=fixture({createSink:async()=>({addFrame:async()=>{adds++;if(adds===1){started.resolve();await add.promise;}},finish:async()=>({blob:new Blob(['encoded']),bytes:7,extension:'mp4'}),cancel:async()=>{}})});
 const work=f.exporter.start(f.p,f.resources);await started.promise;f.hide(true);add.resolve();await tick();assert.equal(f.exporter.snapshot().state,'suspended');assert.equal(adds,1);assert.equal(f.exporter.snapshot().submitted,1);
 f.exporter.resume();await tick();assert.equal(adds,1);f.hide(false);await tick();assert.equal(adds,1);f.exporter.resume();assert.equal((await work).state,'ready');assert.equal(adds,60);f.exporter.clearResult();
});
test('unsupported, allocation, add and device failures preserve input and clean owned resources',async()=>{
 for(const overrides of [
  {probe:async()=>({supported:false,reason:'unsupported'})},
  {createCompositor:()=>{throw Error('allocation');}},
  {createSink:async()=>({addFrame:async()=>{throw Error('encoder error');},cancel:async()=>{}})},
 ]){
  const f=fixture(overrides),raw=M.serialize(f.p),state=await f.exporter.start(f.p,f.resources);assert.equal(state.state,'failed');assert.equal(state.result,null);assert.equal(M.serialize(f.p),raw);assert.equal(f.events.at(-1),'studio');assert.equal(state.active,false);
 }
 const wait=deferred(),started=deferred(),f=fixture({drainPreview:async()=>{started.resolve();await wait.promise;}}),work=f.exporter.start(M.createProject({x:'0',y:'0',span:'1'}),f.resources);
 await started.promise;f.exporter.fail('GPU lost');wait.resolve();assert.equal((await work).state,'failed');assert.equal(f.exporter.snapshot().error,'GPU lost');
});
test('unsupported codec stops before GPU owner, preparation, rendering or FX allocation',async()=>{
 let allocations=0;const f=fixture({probe:async()=>({supported:false,code:'UNSUPPORTED_CONFIG',reason:'unsupported'}),createCompositor:()=>{allocations++;}});
 const result=await f.exporter.start(f.p,f.resources);
 assert.equal(result.state,'failed');assert.equal(f.counters.renders,0);assert.equal(allocations,0);assert.ok(!f.events.includes('prepare'));assert.ok(!f.events.includes('export'));
});
test('throwing cleanup attempts every disposer, unlocks owner, and never publishes success',async()=>{
 const cleaned=[];const f=fixture({prepare:async value=>({backend:'webgl',plan:{size:M.dimensions(value.output),extent:M.dimensions(value.output),frames:Array.from({length:60},()=>({camera:value.shot.start}))},renderBase:async()=>({release(){}}),dispose:async()=>{cleaned.push('render');throw Error('render cleanup');}}),probe:async config=>({supported:true,config:{...config,container:'mp4',codec:'avc'}}),createCompositor:()=>({canvas:{},compose:async()=>{},dispose:async()=>{cleaned.push('fx');throw Error('fx cleanup');}})});
 const result=await f.exporter.start(f.p,f.resources);
 assert.deepEqual(cleaned,['fx','render']);assert.equal(result.active,false);assert.equal(f.events.at(-1),'studio');assert.equal(result.state,'failed');assert.equal(result.url,null);assert.ok(!f.states.some(s=>s.state==='ready'));
 assert.match(result.error,/cleanup/);
});
test('probe/add/finalize and each cleanup fault preserve the original cause and allow another job',async()=>{
 for(const stage of ['probe','add','finalize','cancel','fx','render']){
  const cleaned=[];let once=true;
  const fault=where=>{if(once&&where===stage){once=false;throw Error(where+' fault');}};
  const f=fixture({probe:async config=>{fault('probe');return {supported:true,config:{...config,container:'mp4',codec:'avc'}};},prepare:async value=>({backend:'webgl',plan:{size:M.dimensions(value.output),extent:M.dimensions(value.output),frames:Array.from({length:60},()=>({camera:value.shot.start}))},renderBase:async()=>({release(){}}),dispose:async()=>{cleaned.push('render');fault('render');}}),createCompositor:()=>({canvas:{},compose:async()=>{},dispose:async()=>{cleaned.push('fx');fault('fx');}}),createSink:async()=>({addFrame:async()=>{fault('add');if(stage==='cancel'&&once)throw Error('original add failure');},finish:async()=>{fault('finalize');return {blob:new Blob(['ok']),bytes:2,extension:'mp4'};},cancel:async()=>{cleaned.push('cancel');fault('cancel');}})});
  const result=await f.exporter.start(f.p,f.resources);assert.equal(result.state,'failed',stage);assert.equal(result.active,false);assert.equal(result.url,null);assert.equal(f.events.at(-1),'studio');assert.match(result.error,new RegExp(stage==='cancel'?'original add failure':stage+' fault'));
  if(stage!=='probe')assert.ok(cleaned.includes('fx')&&cleaned.includes('render'),cleaned);
  assert.equal((await f.exporter.start(f.p,f.resources)).state,'ready',stage);f.exporter.clearResult();
 }
});
test('only a confirmed WebM alternative is offered, and auto never changes format silently',async()=>{
 const f=fixture({probe:async config=>config.container==='mp4'?{supported:false,code:'UNSUPPORTED_CONFIG',reason:'No AVC'}:{supported:true,config:{...config,container:'webm',codec:'vp9'}}});
 const auto=await f.exporter.start(f.p,f.resources);assert.equal(auto.state,'failed');assert.equal(auto.errorCode,'MP4_UNAVAILABLE');assert.equal(auto.alternative.container,'webm');assert.equal(f.counters.renders,0);
 f.p.output.container='mp4';const explicit=await f.exporter.start(f.p,f.resources);assert.equal(explicit.state,'failed');assert.equal(explicit.alternative.container,'webm');assert.equal(f.counters.renders,0);
});
