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
test('stage timings exclude suspension, stay monotonic, and cover finalize and cleanup before file ready',async()=>{
 let clock=0,adds=0,hidden=false;const add=deferred(),first=deferred(),finalize=deferred(),finishing=deferred();
 const f=fixture({now:()=>clock,isHidden:()=>hidden,
  prepare:async p=>{clock+=20;return {backend:'webgl',plan:{extent:M.dimensions(p.output),iterations:384,frames:Array.from({length:60},()=>({camera:p.shot.start}))},renderBase:async()=>{clock+=10;return {release(){}};},dispose:async()=>{clock+=4;}};},
  createCompositor:()=>({canvas:{},compose:async()=>{clock+=5;},dispose:async()=>{clock+=3;}}),
  createSink:async()=>({addFrame:async()=>{clock+=2;if(++adds===1){first.resolve();await add.promise;}},finish:async()=>{finishing.resolve();await finalize.promise;clock+=30;return {blob:new Blob(['ok']),bytes:2,extension:'mp4'};},cancel:async()=>{}})});
 const work=f.exporter.start(f.p,f.resources);await first.promise;hidden=true;f.exporter.hidden();add.resolve();await tick();
 const before=f.exporter.snapshot();assert.equal(before.state,'suspended');clock+=100000;
 const during=f.exporter.snapshot();assert.equal(during.activeMs,before.activeMs);assert.equal(during.fps,before.fps);assert.equal(during.etaMs,null);assert.equal(during.suspendedMs,100000);
 hidden=false;f.exporter.resume();await finishing.promise;const finalizing=f.exporter.snapshot();assert.equal(finalizing.state,'finalizing');assert.equal(finalizing.submitted,60);assert.equal(finalizing.result,null);assert.equal(finalizing.etaMs,null);
 finalize.resolve();const result=await work;assert.equal(result.state,'ready');assert.deepEqual(result.timings,{prepareMs:20,renderMs:600,fxMs:300,encodeMs:120,finalizeMs:30,cleanupMs:7});assert.equal(result.activeMs,1077);assert.equal(result.elapsedMs,101077);assert.equal(result.completedFrames,60);
 let previous=0;for(const s of f.states.filter(s=>s.active||s.state==='ready')){assert.ok(s.activeMs>=previous);previous=s.activeMs;for(const value of [s.fps,s.elapsedMs,s.activeMs,...Object.values(s.timings)])assert.ok(Number.isFinite(value)&&value>=0);}
 clock+=5000;assert.equal(f.exporter.snapshot().elapsedMs,result.elapsedMs);f.exporter.clearResult();
});

test('the selected bitrate reaches both probes and the cache-keyed sink configuration',async()=>{
 for(const [bitrate,expected] of [['standard',12e6],['high',24e6],['master',40e6]]){
  const probes=[];const f=fixture({probe:async config=>{probes.push(config.bitrate);return {supported:true,config:{...config,container:'mp4',codec:'avc'}};}});
  f.p.output.bitrate=bitrate;const state=await f.exporter.start(f.p,f.resources);assert.equal(state.state,'ready');assert.deepEqual(probes,[expected]);assert.equal(state.config.bitrate,expected);
 }
 const probes=[],f=fixture({probe:async config=>{probes.push([config.container,config.bitrate,config.resolution]);return config.container==='mp4'?{supported:false,reason:'No AVC'}:{supported:true,config:{...config,codec:'vp9'}};}});
 f.p.output.container='mp4';f.p.output.resolution=720;f.p.output.bitrate='master';await f.exporter.start(f.p,f.resources);assert.deepEqual(probes,[['mp4',20e6,720],['webm',20e6,720]]);
});
// Real-shaped OPFS: a writable replaces a file's bytes only when it closes (abort discards them),
// removeEntry fails while a writable is open, and Web Locks mark files that a page still uses.
function opfs({quota=1e12,usage=0}={}){
 const files=new Map(),open=new Set(),log=[],faults={},picks=[],held=new Set();
 const missing=()=>Object.assign(Error('missing'),{name:'NotFoundError'});
 const handle=name=>({name:name.split('/').pop(),
  async getFile(){if(!files.has(name))throw missing();return new Blob([files.get(name)]);},
  async createWritable(){if(!files.has(name))throw missing();open.add(name);const parts=[];let done=false;const finish=()=>{done=true;open.delete(name);};
   return new WritableStream({write(chunk){if(faults.write&&name.startsWith('picked/')){finish();throw Error('disk full');}parts.push(new Uint8Array(chunk.data??chunk));},
    close(){if(faults.close&&name.startsWith('picked/')){finish();throw Error('close failed');}files.set(name,new Uint8Array(Buffer.concat(parts)));finish();log.push('close '+name);},abort(){if(!done){finish();log.push('abort '+name);}}});}});
 const directory={async getFileHandle(name,{create=false}={}){if(!files.has(name)){if(!create)throw missing();files.set(name,new Uint8Array());}return handle(name);},
  async removeEntry(name){if(faults.remove)throw Object.assign(Error('entry is locked'),{name:'NoModificationAllowedError'});if(open.has(name))throw Object.assign(Error('open writable'),{name:'NoModificationAllowedError'});if(!files.has(name))throw missing();files.delete(name);log.push('remove '+name);},
  async *entries(){for(const name of [...files.keys()].filter(name=>!name.includes('/')))yield [name,handle(name)];}};
 const locks={async request(name,options,callback){if(typeof options==='function'){callback=options;options={};}if(held.has(name)){if(options.ifAvailable)return callback(null);throw Error('lock contention in test');}held.add(name);try{return await callback({name});}finally{held.delete(name);}}};
 files.set('picked/empty.mp4',new Uint8Array());files.set('picked/content.mp4',new Uint8Array(Buffer.from('SENTINEL')));
 return {files,open,log,faults,picks,held,locks,storage:{getDirectory:async()=>directory,estimate:async()=>({quota,usage})},
  pickFile:async options=>{picks.push(options);if(faults.pick)throw Object.assign(Error('The user aborted a request.'),{name:'AbortError'});return handle('picked/'+(faults.target||'content.mp4'));},
  temps:()=>[...files.keys()].filter(name=>name.startsWith(Export.TEMP_PREFIX)),
  sentinels:()=>({empty:files.get('picked/empty.mp4')?.length,content:files.has('picked/content.mp4')?Buffer.from(files.get('picked/content.mp4')).toString():null})};
}
const VIDEO=new Uint8Array([0,0,0,24,102,116,121,112,1,2,3,4]);
const streamingSink=(fs,overrides={})=>async(canvas,config,options)=>{assert.ok(options.fileStream instanceof WritableStream);const writer=options.fileStream.getWriter();
 return {addFrame:async()=>{await overrides.add?.();},finish:async()=>{await overrides.finish?.();await writer.write({type:'write',position:0,data:VIDEO});await writer.close();return {file:true,bytes:VIDEO.length,extension:'mp4',mimeType:'video/mp4',submittedFrames:60};},
  cancel:async()=>{await writer.abort().catch(()=>{});}};};
const large=(fs,overrides={})=>fixture({maxBytes:1000,storage:fs.storage,locks:fs.locks,pickFile:fs.pickFile,createSink:streamingSink(fs),...overrides});
test('without OPFS, Web Locks or a picker, an estimate above the in-memory limit fails before any GPU work',async()=>{
 const p=M.setDuration(M.createProject({x:'0',y:'0',span:'8'}),60);p.output.bitrate='high';
 assert.ok(Export.estimateBytes(p)>1.8e8&&Export.estimateBytes(p)<1.9e8);assert.equal(Export.estimateBytes(M.setDuration(M.createProject({x:'0',y:'0',span:'8'}),40))<64*1024*1024,true);
 const fs=opfs();
 for(const missing of [{storage:null},{locks:null},{pickFile:null}]){
  const f=fixture({maxBytes:64*1024*1024,storage:fs.storage,locks:fs.locks,pickFile:fs.pickFile,...missing}),rejected=await f.exporter.start(p,f.resources);
  assert.equal(rejected.state,'failed');assert.equal(rejected.errorCode,'OUTPUT_TOO_LARGE_ESTIMATE');assert.match(rejected.error,/Shorten the duration.*lower bitrate.*720p/);assert.match(rejected.error,/\b17\d MiB|\b18\d MiB/);
  assert.equal(f.counters.renders,0);assert.ok(!f.events.includes('drain')&&!f.events.includes('export')&&!f.events.includes('prepare'));assert.equal(f.events.at(-1),'studio');assert.equal(rejected.active,false);assert.equal(f.exporter.largeOutput(),false);
 }
 assert.deepEqual(fs.temps(),[]);assert.equal(fs.picks.length,0);
});
test('a large export renders into a private temporary file and writes a picked file only when Save succeeds',async()=>{
 const fs=opfs(),f=large(fs),done=await f.exporter.start(f.p,f.resources);
 assert.equal(done.state,'ready');assert.equal(done.result.file,true);assert.ok(done.result.temp);assert.equal(done.result.filename,'Untitled shot.mp4');assert.ok(done.url.startsWith('blob:'));
 assert.equal(fs.picks.length,0,'no picker before Save');assert.deepEqual(fs.sentinels(),{empty:0,content:'SENTINEL'});
 const [temp]=fs.temps();assert.match(temp,/^tetra-export-.+\.mp4$/);assert.deepEqual([...fs.files.get(temp)],[...VIDEO]);assert.ok(fs.held.has(temp),'the temporary file is locked while in use');
 const saved=await f.exporter.save();
 assert.equal(fs.picks.length,1);assert.equal(fs.picks[0].suggestedName,'Untitled shot.mp4');assert.deepEqual([...fs.files.get('picked/content.mp4')],[...VIDEO]);
 assert.equal(saved.result.savedAs,'content.mp4');assert.equal(saved.url,null);assert.equal(saved.saving,false);assert.deepEqual(fs.temps(),[]);assert.equal(fs.held.size,0);
 await assert.rejects(f.exporter.save(),/no finished video/);await f.exporter.clearResult();assert.equal(fs.picks.length,1);
});
test('a failure or cancel at any stage before Save never touches picked files and leaves no temporary file',async()=>{
 const stages={
  quota:fs=>({storage:{...fs.storage,estimate:async()=>({quota:5000,usage:4500})}}),
  probe:()=>({probe:async()=>{throw Error('probe fault');}}),
  prepare:()=>({prepare:async()=>{throw Error('prepare fault');}}),
  sink:()=>({createSink:async()=>{throw Error('sink fault');}}),
  render:fs=>({createSink:streamingSink(fs,{add:async()=>{throw Error('render fault');}})}),
  finalize:fs=>({createSink:streamingSink(fs,{finish:async()=>{throw Error('finalize fault');}})}),
 };
 for(const [stage,overrides] of Object.entries(stages)){
  const fs=opfs(),f=large(fs,overrides(fs)),state=await f.exporter.start(f.p,f.resources);
  assert.equal(state.state,'failed',stage);assert.equal(state.result,null);assert.equal(state.url,null);assert.equal(fs.picks.length,0,stage);
  assert.deepEqual(fs.sentinels(),{empty:0,content:'SENTINEL'},stage);assert.deepEqual(fs.temps(),[],stage);assert.equal(fs.open.size,0,stage);assert.equal(fs.held.size,0,stage);
  if(stage==='quota'){assert.equal(state.errorCode,'STORAGE_QUOTA');assert.match(state.error,/only 0 MiB of browser storage/);assert.equal(f.counters.renders,0);assert.ok(!f.events.includes('drain'));}
  else assert.match(state.error,new RegExp(stage+' fault'));
 }
 for(const stage of ['render','finalize']){
  const fs=opfs(),gate=deferred(),reached=deferred(),hook=async()=>{reached.resolve();await gate.promise;};
  const f=large(fs,{createSink:streamingSink(fs,stage==='render'?{add:hook}:{finish:hook})}),work=f.exporter.start(f.p,f.resources);
  await reached.promise;const canceled=f.exporter.cancel();gate.resolve();await canceled;const state=await work;
  assert.equal(state.state,'canceled',stage);assert.equal(fs.picks.length,0);assert.deepEqual(fs.sentinels(),{empty:0,content:'SENTINEL'});assert.deepEqual(fs.temps(),[],stage);assert.equal(fs.held.size,0);
 }
 const fs=opfs();fs.faults.remove=true;const f=large(fs,{createSink:streamingSink(fs,{add:async()=>{throw Error('render fault');}})}),state=await f.exporter.start(f.p,f.resources);
 assert.equal(state.state,'failed');assert.match(state.error,/render fault.*Could not delete the temporary video file tetra-export-/,'a failed deletion is reported, not ignored');assert.equal(fs.held.size,0);
});
test('a canceled picker, a failed write or a failed close keeps the temporary video for another Save',async()=>{
 const fs=opfs(),f=large(fs);await f.exporter.start(f.p,f.resources);const [temp]=fs.temps();
 for(const [fault,code,pattern] of [['pick','SAVE_ABORTED',/no location was chosen/],['write','SAVE_FAILED',/disk full/],['close','SAVE_FAILED',/close failed/]]){
  fs.faults[fault]=true;fs.faults.target=fault==='write'?'empty.mp4':'content.mp4';
  await assert.rejects(f.exporter.save(),error=>error.code===code&&pattern.test(error.message)&&/The video is kept/.test(error.message),fault);fs.faults[fault]=false;
  const state=f.exporter.snapshot();assert.equal(state.saving,false);assert.match(state.saveError,pattern);assert.ok(state.result.temp);assert.ok(state.url);
  assert.deepEqual(fs.temps(),[temp]);assert.deepEqual(fs.sentinels(),{empty:0,content:'SENTINEL'},fault);assert.equal(fs.open.size,0);
 }
 fs.faults.target='empty.mp4';const saved=await f.exporter.save();assert.equal(saved.result.savedAs,'empty.mp4');assert.equal(saved.saveError,null);assert.deepEqual([...fs.files.get('picked/empty.mp4')],[...VIDEO]);
 assert.equal(fs.sentinels().content,'SENTINEL');assert.deepEqual(fs.temps(),[]);
});
test('closing or redoing a result deletes its temporary file, reports a failed deletion and refuses to discard during Save',async()=>{
 const fs=opfs(),f=large(fs);await f.exporter.start(f.p,f.resources);assert.equal(fs.temps().length,1);
 await f.exporter.clearResult();assert.deepEqual(fs.temps(),[]);assert.equal(f.exporter.snapshot().state,'idle');assert.equal(fs.held.size,0);
 await f.exporter.start(f.p,f.resources);assert.equal(fs.temps().length,1);const redo=await f.exporter.start(f.p,f.resources);assert.equal(redo.state,'ready');assert.equal(fs.temps().length,1,'redo replaced the previous temporary file');
 fs.faults.remove=true;await assert.rejects(f.exporter.clearResult(),error=>error.code==='TEMP_DELETE_FAILED'&&/Could not delete the temporary video file/.test(error.message));assert.equal(fs.held.size,0,'a file that could not be deleted is left for the next sweep');
 fs.faults.remove=false;assert.equal(await f.exporter.sweep(),1);assert.deepEqual(fs.temps(),[]);
 const slow=opfs(),pick=deferred(),g=large(slow,{pickFile:async()=>{await pick.promise;return {name:'x.mp4',createWritable:async()=>new WritableStream()};}});await g.exporter.start(g.p,g.resources);
 const saving=g.exporter.save();assert.equal(g.exporter.snapshot().saving,true);await assert.rejects(g.exporter.clearResult(),/finish saving/);assert.throws(()=>g.exporter.start(g.p,g.resources),/finish saving/);pick.resolve();await saving;assert.deepEqual(slow.temps(),[]);
});
test('sweep removes only temporary video files that no page holds',async()=>{
 const fs=opfs(),f=large(fs);for(const name of ['tetra-export-stale.mp4','tetra-export-busy.webm','notes.txt'])fs.files.set(name,new Uint8Array([1]));
 const release=deferred(),busy=fs.locks.request('tetra-export-busy.webm',()=>release.promise);
 assert.equal(await f.exporter.sweep(),1);assert.deepEqual([...fs.files.keys()].filter(name=>!name.includes('/')).sort(),['notes.txt','tetra-export-busy.webm']);
 release.resolve();await busy;assert.equal(await f.exporter.sweep(),1);assert.deepEqual(fs.temps(),[]);assert.ok(fs.files.has('picked/content.mp4'));
 assert.equal(await fixture({pickFile:null}).exporter.sweep(),0);
});
test('Stable passes the motion filter with one constant sequence; Raw and Hold do not',async()=>{
 const run=async(temporal,motion)=>{
  const options=[];const f=fixture({createCompositor:()=>({canvas:{},compose:async(frame,option)=>{options.push(option);},dispose:async()=>{}})});
  f.p.output.temporal=temporal;f.p.shot.motion=motion;if(motion==='travel')f.p.shot.end.span='4';const state=await f.exporter.start(f.p,f.resources);assert.equal(state.state,'ready');return options;
 };
 const stable=await run('stable','travel');assert.equal(stable.length,60);assert.ok(stable.every(o=>o.motion===true&&o.sequence===1));assert.deepEqual(stable.map(o=>o.k),Array.from({length:60},(_,k)=>k));
 for(const options of [await run('raw','travel'),await run('stable','hold'),await run('raw','hold')])assert.ok(options.every(o=>!('motion' in o)&&!('sequence' in o)));
});
test('every exported frame records its numerical path, backend and render time without changing the grid',async()=>{
 let clock=0;const calls=[],states=Array.from({length:60},(_,k)=>k<20?{mode:'direct',descriptor:null}:{mode:'perturb',descriptor:k<40?0:1});
 const f=fixture({now:()=>clock,prepare:async value=>({backend:'webgpu',numerical:{states},plan:{size:M.dimensions(value.output),extent:M.dimensions(value.output),iterations:384,frames:Array.from({length:60},()=>({camera:value.shot.start}))},renderBase:async(k,profile,signal,option)=>{calls.push([k,profile,option]);clock+=k+1;return {release(){}};},dispose:async()=>{}})});
 const state=await f.exporter.start(f.p,f.resources);assert.equal(state.state,'ready');const frames=state.profile.frames;assert.equal(frames.length,60);
 for(const [k,row] of frames.entries()){assert.deepEqual(row,{k,mode:states[k].mode,descriptor:states[k].descriptor,backend:'webgpu',renderMs:k+1});}
 assert.deepEqual(frames.map(row=>row.descriptor).filter((value,index,all)=>value!==all[index-1]),[null,0,1]);assert.equal(state.timings.renderMs,frames.reduce((sum,row)=>sum+row.renderMs,0));
 assert.ok(calls.every(([k,profile,option],index)=>k===index&&profile==='final'&&option.fenceBatch===4),'only export asks for batched fences');assert.equal(f.frames.length,60);
 const plain=await fixture().exporter.start(M.setDuration(M.createProject({x:'0',y:'0',span:'8'}),2),{renderer:{}});assert.equal(plain.profile.frames.length,60);assert.equal(plain.profile.frames[0].mode,null);
});
test('a tab that becomes visible again is resumed by one resume() call without losing or repeating frames',async()=>{
 const add=deferred(),started=deferred();let adds=0;const ks=[];const f=fixture({createSink:async()=>({addFrame:async time=>{adds++;ks.push(time.timestampUs);if(adds===1){started.resolve();await add.promise;}},finish:async()=>({blob:new Blob(['encoded']),bytes:7,extension:'mp4'}),cancel:async()=>{}})});
 const work=f.exporter.start(f.p,f.resources);await started.promise;f.hide(true);add.resolve();await tick();assert.equal(f.exporter.snapshot().state,'suspended');
 f.exporter.resume();await tick();assert.equal(f.exporter.snapshot().state,'suspended','still hidden: nothing resumes');
 f.hide(false);await tick();assert.equal(f.exporter.snapshot().state,'suspended','becoming visible does not resume by itself; the UI calls resume() on visibilitychange');
 f.exporter.resume();f.exporter.resume();assert.equal((await work).state,'ready');assert.equal(adds,60);assert.deepEqual(ks,Array.from({length:60},(_,k)=>M.timing(f.frozen,k).timestampUs));
 f.exporter.resume();assert.equal(f.exporter.snapshot().state,'ready');f.exporter.clearResult();
});
