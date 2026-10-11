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
