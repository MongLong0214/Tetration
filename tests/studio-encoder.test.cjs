'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../src/studio-encoder.js');
const config={width:320,height:180,fps:30,container:'mp4',frameCount:2},canvas=()=>({width:320,height:180});
const grid=k=>({timestampUs:Math.round(1e6*k/30),durationUs:Math.round(1e6*(k+1)/30)-Math.round(1e6*k/30)});
function fake({add,finalize,start,write}={}){
 const calls={adds:[],cancels:0};let source;
 const media={Quality:class{},Mp4OutputFormat:class{},WebMOutputFormat:class{},StreamTarget:class{constructor(writable){this.writable=writable;}},
  CanvasSource:class{constructor(canvas,options){this.options=options;source=this;calls.canvas=canvas;calls.options=options;}add(...args){calls.adds.push(args);return add?.(...args)||Promise.resolve();}},
  Output:class{constructor(options){this.writer=options.target.writable.getWriter();}addVideoTrack(source,metadata){calls.metadata=metadata;}start(){source.options.onEncoderConfig({codec:'avc1.42001f'});return start?.()||Promise.resolve();}async finalize(){await finalize?.();await this.writer.write(write||{position:0,data:new Uint8Array([0,1,2,3])});}cancel(){calls.cancels++;return Promise.resolve();}}};return {media,calls};
}
test('bounded collector supports gaps, backpatch, overlap and page boundaries',async()=>{
 const c=E.createCollector();c.write(E.PAGE_BYTES-2,new Uint8Array([10,11,12,13]));c.write(0,new Uint8Array([1,2,3]));c.write(1,new Uint8Array([8]));assert.equal(c.bytes,E.PAGE_BYTES+2);assert.equal(c.allocatedBytes,2*E.PAGE_BYTES);
 const bytes=new Uint8Array(await c.blob('video/mp4').arrayBuffer());assert.deepEqual([...bytes.slice(0,5)],[1,8,3,0,0]);assert.deepEqual([...bytes.slice(-4)],[10,11,12,13]);c.clear();assert.equal(c.allocatedBytes,0);assert.throws(()=>c.write(0,new Uint8Array(1)));
 const small=E.createCollector(4);small.write(0,new Uint8Array(4));assert.throws(()=>small.write(3,new Uint8Array(2)),{code:'OUTPUT_TOO_LARGE'});assert.equal(small.bytes,4);
 for(const position of [-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>small.write(position,new Uint8Array(1)));assert.equal(small.allocatedBytes,E.PAGE_BYTES);
});
test('sink uses CanvasSource configuration, integer frame grid and awaited finalization',async()=>{
 const {media,calls}=fake(),sink=await E.createSink(canvas(),config,{media});await sink.addFrame(grid(0));await sink.addFrame(grid(1));const result=await sink.finish();
 assert.equal(result.submittedFrames,2);assert.equal(result.durationUs,66667);assert.equal(result.mimeType,'video/mp4');assert.equal(result.extension,'mp4');assert.equal(result.bytes,4);assert.equal(sink.state,'ready');
 assert.deepEqual(calls.adds,[[0,0.033333],[0.033333,0.033334]]);assert.deepEqual(calls.metadata,{frameRate:30});assert.equal(calls.options.transform,undefined);assert.equal(calls.options.sizeChangeBehavior,'deny');assert.equal(calls.options.alpha,'discard');assert.equal(calls.options.keyFrameInterval,2);assert.equal(calls.options.fullCodecString,undefined);
 await sink.cancel();assert.equal(calls.cancels,0);
});
test('concurrent add aborts one sink and consumes the delayed previous result',async()=>{
 let release;const {media,calls}=fake({add:()=>new Promise(resolve=>{release=resolve;})}),sink=await E.createSink(canvas(),config,{media});
 const first=sink.addFrame(grid(0));const firstCheck=assert.rejects(first,{code:'CONCURRENT_ADD'});await new Promise(resolve=>setTimeout(resolve,0));await assert.rejects(sink.addFrame(grid(1)),{code:'CONCURRENT_ADD'});release();await firstCheck;assert.equal(calls.adds.length,1);assert.equal(calls.cancels,1);assert.equal(sink.state,'failed');
});
test('abort during add or finalize cannot yield a ready result',async()=>{
 for(const phase of ['add','finalize']){
  let resolve,started;const entered=new Promise(r=>{started=r;}),operation=()=>{started();return new Promise(r=>{resolve=r;});};
  const {media,calls}=fake(phase==='add'?{add:operation}:{finalize:operation}),controller=new AbortController(),sink=await E.createSink(canvas(),{...config,frameCount:1},{media,signal:controller.signal});
  let pending;if(phase==='add')pending=sink.addFrame(grid(0));else{await sink.addFrame(grid(0));pending=sink.finish();}
  const rejected=assert.rejects(pending,{code:'CANCELED'});await entered;controller.abort();await rejected;resolve();await sink.cancel();assert.equal(sink.state,'canceled');assert.equal(calls.cancels,1);
 }
});
test('late rejection, deadline, malformed timing, incomplete frames, resize and writer cap fail cleanly',async()=>{
 const scenarios=[{options:{add:()=>Promise.reject(Error('codec failed'))},operation:s=>s.addFrame(grid(0))},
  {options:{add:()=>new Promise((resolve,reject)=>setTimeout(()=>reject(Error('late rejection')),30))},operation:s=>s.addFrame(grid(0)),deadlineMs:5},
  {options:{},operation:s=>s.addFrame({timestampUs:0,durationUs:1})},
  {options:{},operation:s=>s.finish()},
  {options:{write:{position:4,data:new Uint8Array(1)}},operation:async s=>{await s.addFrame(grid(0));await s.addFrame(grid(1));return s.finish();},maxBytes:4}];
 for(const scenario of scenarios){const {media,calls}=fake(scenario.options),sink=await E.createSink(canvas(),config,{media,deadlineMs:scenario.deadlineMs||100,maxBytes:scenario.maxBytes});await assert.rejects(scenario.operation(sink));assert.equal(sink.state,'failed');assert.equal(calls.cancels,1);}
 const {media}=fake(),c=canvas(),sink=await E.createSink(c,config,{media});c.width++;await assert.rejects(sink.addFrame(grid(0)),{code:'CANVAS_SIZE_CHANGED'});
 const f=fake({finalize:()=>new Promise(()=>{})}),s=await E.createSink(canvas(),{...config,frameCount:1},{media:f.media,deadlineMs:5});await s.addFrame(grid(0));await assert.rejects(s.finish(),{code:'MEDIA_TIMEOUT'});assert.equal(s.state,'failed');
 await new Promise(resolve=>setTimeout(resolve,35));
});
test('configuration retains dimensions and detects unsupported API',async()=>{
 assert.equal(E.normalizeConfig({width:720,height:1280,fps:24,resolution:720,container:'webm'}).bitrate,6000000);
 for(const bad of [{fps:60},{width:0},{container:'gif'},{codec:'vp9'}])assert.throws(()=>E.normalizeConfig({...config,...bad}));
 const result=await E.probe(config,undefined,{media:{}});assert.equal(result.supported,false);assert.equal(result.code,'UNSUPPORTED_API');
});
test('probe pins the actual codec, caches exact configurations and invalidates all profile aliases',async()=>{
 const original=globalThis.VideoEncoder;globalThis.VideoEncoder=class{};
 try{
  const {media}=fake();let queries=0;media.canEncodeVideo=async()=>{queries++;return true;};
  const createCanvas=()=>({...canvas(),getContext:()=>({fillRect(){}})});
  const input={...config,width:322};
  const first=await E.probe(input,undefined,{media,createCanvas});assert.equal(first.supported,true);assert.equal(first.config.fullCodecString,'avc1.42001f');assert.equal(first.config.frameCount,2);
  const cached=await E.probe({...input,frameCount:60},undefined,{media,createCanvas});assert.equal(queries,1);assert.equal(cached.config.frameCount,60);
  E.invalidate(cached.config);await E.probe(input,undefined,{media,createCanvas});assert.equal(queries,2);
  let codecs=[];media.canEncodeVideo=async codec=>{codecs.push(codec);return false;};E.invalidate(input);
  const unsupported=await E.probe(input,undefined,{media,createCanvas});assert.equal(unsupported.supported,false);assert.deepEqual(codecs,['avc']);assert.match(unsupported.alternative,/WebM/);
 }finally{if(original===undefined)delete globalThis.VideoEncoder;else globalThis.VideoEncoder=original;}
});

test('per-frame QP keeps a repeated frame, encodes a still start finer and steers toward the bitrate',async()=>{
 const rc=E.createRateControl({width:320,height:180,fps:30,bitrate:1200000}),frameBits=40000,qs=[];
 // Frames at twice the target raise QP, then frames at half of it lower it: one step per frame after calibration.
 for(let k=0;k<20;k++){qs.push(rc.next({key:!k}));rc.encoded({byteLength:frameBits/4,type:k?'delta':'key'});}
 for(let k=20;k<40;k++){qs.push(rc.next());rc.encoded({byteLength:frameBits/16,type:'delta'});}
 assert.equal(qs[0],21);assert.equal(E.createRateControl({width:1920,height:1080,fps:30,bitrate:12e6}).initial,32);assert.equal(qs[1],rc.initial+3,'QP holds until an inter frame calibrates it');assert.ok(qs[2]>qs[1],qs.join());
 const dense=E.createRateControl({width:320,height:180,fps:30,bitrate:1200000});dense.next({key:true});dense.encoded({byteLength:frameBits*4,type:'key'});dense.next();dense.encoded({byteLength:frameBits*4,type:'delta'});assert.equal(dense.next(),51,'a coarser calibration is not capped');
 const sparse=E.createRateControl({width:320,height:180,fps:30,bitrate:1200000});sparse.next({key:true});sparse.encoded({byteLength:100,type:'key'});sparse.next();sparse.encoded({byteLength:100,type:'delta'});assert.equal(sparse.next(),18,'a finer calibration moves at most 6 QP');for(let k=3;k<40;k++)assert.ok(Math.abs(qs[k]-qs[k-1])<=1,qs.join());
 for(let k=3;k<20;k++)assert.ok(qs[k]>=qs[k-1],qs.join());const peak=Math.max(...qs);assert.ok(peak>qs[3]&&qs[39]<peak,qs.join());
 const still=rc.next({still:true});assert.ok(still>=qs[39]-7&&still<=qs[39]-5,still);rc.encoded({byteLength:frameBits/8,type:'delta'});
 for(let k=0;k<5;k++){assert.equal(rc.next({repeat:true}),still,'a repeated frame keeps the QP of the frame it repeats');rc.encoded({byteLength:k===2?frameBits:4,type:k===2?'key':'delta'});}
 const moving=rc.next(),key=rc.next({key:true});assert.ok(key>=moving-4&&key<=moving-2,key+' '+moving);
 // 0.69 bit/pixel starts key frames at QP 21 and inter frames at 24; without encoder feedback QP stays there: a still start is
 // 6 finer, its repeats keep it, and each 2 s key frame is 3 finer. The densest measured content (Horizon) caps the start.
 const {media,calls}=fake(),sink=await E.createSink(canvas(),{...config,frameCount:61,bitrate:1200000,rateControl:'frame'},{media});media.Quality=class{};
 await sink.addFrame(grid(0),{still:true});await sink.addFrame(grid(1),{repeat:true});for(let k=2;k<61;k++)await sink.addFrame(grid(k));
 assert.equal(E.createRateControl({...config,bitrate:1200000}).initial,21);assert.deepEqual([0,1,2,59,60].map(k=>calls.adds[k][2].avc.quantizer),[18,18,24,24,21]);assert.equal(typeof calls.options.onEncodedPacket,'function');
 const plain=fake(),vbr=await E.createSink(canvas(),{...config,frameCount:1},{media:plain.media});await vbr.addFrame(grid(0),{repeat:true});assert.deepEqual(plain.calls.adds,[[0,0.033333]]);assert.equal(plain.calls.options.onEncodedPacket,undefined);
 assert.throws(()=>E.normalizeConfig({...config,container:'webm',rateControl:'frame'}),{code:'INVALID_CONFIG'});
});
test('probe confirms per-frame QP only when the encoder actually runs in quantizer mode',async()=>{
 const original=globalThis.VideoEncoder;globalThis.VideoEncoder=class{};
 try{
  const createCanvas=()=>({...canvas(),getContext:()=>({fillRect(){}})});
  for(const [mode,expected] of [['quantizer','frame'],['variable','encoder']]){
   const {media,calls}=fake();media.canEncodeVideo=async()=>true;media.Output=class extends media.Output{start(){calls.options.onEncoderConfig({codec:'avc1.640028',bitrateMode:mode});return Promise.resolve();}};
   const result=await E.probe({...config,width:330+(mode==='quantizer'?0:2)},undefined,{media,createCanvas});assert.equal(result.config.rateControl,expected);assert.equal(calls.adds[0][2].avc.quantizer>0,true,'the probe exercises the per-frame path');
  }
  const {media}=fake();media.canEncodeVideo=async()=>true;const vp9=await E.probe({...config,container:'webm',width:336},undefined,{media,createCanvas});assert.equal(vp9.config.rateControl,'encoder');
 }finally{if(original===undefined)delete globalThis.VideoEncoder;else globalThis.VideoEncoder=original;}
});

test('frame count reaches 120 s at 30 fps and the bitrate option is passed through every stage',async()=>{
 assert.equal(E.normalizeConfig({...config,frameCount:3600}).frameCount,3600);assert.throws(()=>E.normalizeConfig({...config,frameCount:3601}),{code:'INVALID_CONFIG'});assert.equal(E.normalizeConfig({...config,bitrate:40000000}).bitrate,40000000);
 const original=globalThis.VideoEncoder;globalThis.VideoEncoder=class{};
 try{
  const {media,calls}=fake(),queried=[];media.Quality=class{constructor(options){this.bitrate=options.bitrate;}};media.canEncodeVideo=async(codec,options)=>{queried.push(options.quality.bitrate);return true;};
  const createCanvas=()=>({...canvas(),getContext:()=>({fillRect(){}})}),input={...config,width:324,frameCount:3600};
  const standard=await E.probe({...input,bitrate:12000000},undefined,{media,createCanvas}),high=await E.probe({...input,bitrate:24000000},undefined,{media,createCanvas});
  assert.equal(standard.config.bitrate,12000000);assert.equal(high.config.bitrate,24000000);assert.equal(high.config.frameCount,3600);assert.deepEqual(queried,[12000000,24000000]);assert.equal(calls.options.quality.bitrate,24000000);
  await E.probe({...input,bitrate:24000000},undefined,{media,createCanvas});assert.equal(queried.length,2,'the same bitrate is served from the probe cache');
 }finally{if(original===undefined)delete globalThis.VideoEncoder;else globalThis.VideoEncoder=original;}
});
function fileTarget({write,close,abort}={}){const calls={writes:[],closes:0,aborts:0};return {calls,write(chunk){calls.writes.push(chunk);return write?.(chunk)||Promise.resolve();},close(){calls.closes++;return close?.()||Promise.resolve();},abort(){calls.aborts++;return abort?.()||Promise.resolve();}};}
test('a file stream receives positioned writes, closes on finish and returns no in-memory blob',async()=>{
 const target=fileTarget(),{media}=fake({write:{position:6,data:new Uint8Array([9,8,7])}}),sink=await E.createSink(canvas(),config,{media,fileStream:target,maxBytes:4});
 await sink.addFrame(grid(0));await sink.addFrame(grid(1));const result=await sink.finish();
 assert.equal(target.calls.writes.length,1);assert.equal(target.calls.writes[0].type,'write');assert.equal(target.calls.writes[0].position,6);assert.deepEqual([...target.calls.writes[0].data],[9,8,7]);
 assert.equal(result.file,true);assert.equal(result.blob,undefined);assert.equal(result.bytes,9,'bytes are the file high-water mark, beyond the 4 byte in-memory cap');assert.equal(result.submittedFrames,2);assert.equal(result.extension,'mp4');
 assert.equal(target.calls.closes,1);assert.equal(target.calls.aborts,0);assert.equal(sink.state,'ready');await sink.cancel();assert.equal(target.calls.aborts,0,'a finished file is never aborted');
});
test('a file stream is aborted, never closed, on encoder failure, cancel or close failure',async()=>{
 {const target=fileTarget(),{media}=fake({add:()=>Promise.reject(Error('codec failed'))}),sink=await E.createSink(canvas(),config,{media,fileStream:target});await assert.rejects(sink.addFrame(grid(0)),/codec failed/);assert.equal(target.calls.aborts,1);assert.equal(target.calls.closes,0);assert.equal(sink.state,'failed');}
 {const target=fileTarget(),{media}=fake(),sink=await E.createSink(canvas(),config,{media,fileStream:target});await sink.addFrame(grid(0));await sink.cancel();assert.equal(target.calls.aborts,1);assert.equal(target.calls.closes,0);assert.equal(sink.state,'canceled');await sink.cancel();assert.equal(target.calls.aborts,1);}
 {const controller=new AbortController(),target=fileTarget(),{media}=fake(),sink=await E.createSink(canvas(),config,{media,fileStream:target,signal:controller.signal});controller.abort();await sink.cancel();assert.equal(target.calls.aborts,1);}
 {const target=fileTarget({close:()=>Promise.reject(Error('disk full')),abort:()=>Promise.reject(Error('already closed'))}),{media}=fake(),sink=await E.createSink(canvas(),config,{media,fileStream:target});await sink.addFrame(grid(0));await sink.addFrame(grid(1));await assert.rejects(sink.finish(),/disk full/);assert.equal(target.calls.aborts,1);assert.equal(sink.state,'failed');}
 {const target=fileTarget({write:()=>Promise.reject(Error('write failed'))}),{media}=fake(),sink=await E.createSink(canvas(),config,{media,fileStream:target});await sink.addFrame(grid(0));await sink.addFrame(grid(1));await assert.rejects(sink.finish());assert.equal(target.calls.closes,0);assert.equal(target.calls.aborts,1);}
});
