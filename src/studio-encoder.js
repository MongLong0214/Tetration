/* Single CanvasSource path. Library owns encoders; the app owns bounded bytes. */
(function(root){
 'use strict';
 const MAX_BYTES=64*1024*1024,PAGE_BYTES=1024*1024,DEADLINE_MS=60000,cache=new Map();
 function error(code,message){const e=new Error(message);e.code=code;if(code==='CANCELED')e.name='AbortError';return e;}
 function checkSignal(signal){if(signal?.aborted)throw error('CANCELED','Video export canceled');}
 function waitFor(operation,{signal,deadlineMs=DEADLINE_MS}={}){
  if(!Number.isFinite(deadlineMs)||deadlineMs<=0)return Promise.reject(error('INVALID_CONFIG','Invalid media deadline'));
  return new Promise((resolve,reject)=>{
   let timer,settled=false;
   const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
   const abort=()=>finish(reject,error('CANCELED','Video export canceled'));
   if(signal?.aborted){abort();return;}
   signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>finish(reject,error('MEDIA_TIMEOUT','The video encoder did not respond in time. Retry from the beginning.')),deadlineMs);
   // Both late success and late rejection are consumed after cancellation/deadline.
   Promise.resolve().then(()=>{checkSignal(signal);return operation();}).then(value=>finish(resolve,value),reason=>finish(reject,reason));
  });
 }
 function createCollector(maxBytes=MAX_BYTES){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES)throw error('INVALID_CONFIG','Invalid output byte limit');
  const pages=new Map();let highWater=0,closed=false;
  return {
   get bytes(){return highWater;},get allocatedBytes(){return pages.size*PAGE_BYTES;},
   write(position,data){
    if(closed)throw error('WRITER_CLOSED','Video byte collector is closed');
    if(!(data instanceof Uint8Array)||!Number.isSafeInteger(position)||position<0)throw error('INVALID_WRITE','Invalid video write');
    const end=position+data.byteLength;
    if(!Number.isSafeInteger(end)||end>maxBytes)throw error('OUTPUT_TOO_LARGE','Video exceeds the output byte limit (maximum 64 MiB).');
    let offset=0;while(offset<data.byteLength){
     const index=Math.floor((position+offset)/PAGE_BYTES),local=(position+offset)%PAGE_BYTES,count=Math.min(PAGE_BYTES-local,data.byteLength-offset);
     if(!pages.has(index))pages.set(index,new Uint8Array(PAGE_BYTES));pages.get(index).set(data.subarray(offset,offset+count),local);offset+=count;
    }
    highWater=Math.max(highWater,end);
   },
   blob(mimeType){
    if(closed)throw error('WRITER_CLOSED','Video byte collector is closed');
    const parts=[];for(let position=0;position<highWater;position+=PAGE_BYTES){const count=Math.min(PAGE_BYTES,highWater-position);parts.push((pages.get(position/PAGE_BYTES)||new Uint8Array(count)).subarray(0,count));}
    return new Blob(parts,{type:mimeType});
   },
   clear(){closed=true;pages.clear();highWater=0;}
  };
 }
 function normalizeConfig(input){
  const {width,height,fps,container='mp4',resolution=1080,fullCodecString,frameCount}=input;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>8192||height>8192||![24,30].includes(fps)||!['auto','mp4','webm'].includes(container))throw error('INVALID_CONFIG','Invalid video dimensions, frame rate or container');
  const bitrate=input.bitrate??(resolution===720?6000000:12000000);
  if(!Number.isSafeInteger(bitrate)||bitrate<=0||(frameCount!==undefined&&(!Number.isInteger(frameCount)||frameCount<1||frameCount>600)))throw error('INVALID_CONFIG','Invalid bitrate or frame count');
  if(fullCodecString!==undefined&&(typeof fullCodecString!=='string'||!fullCodecString))throw error('INVALID_CONFIG','Invalid codec profile');
  const codec=container==='webm'?'vp9':'avc';
  if(input.codec!==undefined&&input.codec!==codec)throw error('INVALID_CONFIG','Codec does not match the container');
  return {width,height,fps,container,codec,bitrate,...(fullCodecString?{fullCodecString}:{}),...(frameCount===undefined?{}:{frameCount})};
 }
 const keyOf=config=>JSON.stringify([config.width,config.height,config.fps,config.codec,config.bitrate,config.fullCodecString||'']);
 function invalidate(config){
  const target=normalizeConfig(config);
  // Remove both the capability-query key and its confirmed-profile alias.
  for(const [key,value]of cache)if(['width','height','fps','codec','bitrate'].every(field=>value.config[field]===target[field]))cache.delete(key);
 }
 async function createSink(canvas,input,{signal,maxBytes=MAX_BYTES,deadlineMs=DEADLINE_MS,media=root.TetraMedia,onEncoderConfig}={}){
  checkSignal(signal);const config=normalizeConfig(input);
  if(config.container==='auto')throw error('INVALID_CONFIG','Probe and confirm the actual container before exporting');
  if(!media)throw error('UNSUPPORTED_API','Video encoding is unavailable in this browser');
  if(canvas.width!==config.width||canvas.height!==config.height)throw error('CANVAS_SIZE_CHANGED','Output canvas dimensions do not match the video configuration');
  const collector=createCollector(maxBytes),internal=new AbortController();
  let output,source,terminal=null,phase='starting',pending=false,submittedFrames=0,endUs=0,cleanupPromise=null,encoderConfig=null;
  const detach=()=>signal?.removeEventListener('abort',onAbort);
  function cleanup(){
   if(!cleanupPromise)cleanupPromise=waitFor(()=>output?.cancel(),{deadlineMs}).catch(()=>{}).finally(()=>collector.clear());
   return cleanupPromise;
  }
  function stop(reason){
   if(phase==='ready'){return Promise.resolve();}
   if(!terminal){terminal=reason instanceof Error?reason:error('CANCELED',String(reason||'Video export canceled'));phase=terminal.code==='CANCELED'?'canceled':'failed';internal.abort();detach();invalidate(config);}
   return cleanup();
  }
  function onAbort(){void stop(error('CANCELED','Video export canceled'));}
  function assertActive(){if(terminal)throw terminal;checkSignal(signal);if(phase!=='open')throw error('SINK_CLOSED','Video sink is not accepting frames');}
  function assertSize(){if(canvas.width!==config.width||canvas.height!==config.height)throw error('CANVAS_SIZE_CHANGED','Output canvas size changed during export');}
  try{
   const format=config.container==='mp4'?new media.Mp4OutputFormat({fastStart:false}):new media.WebMOutputFormat();
   const writable=new WritableStream({write({position,data}){collector.write(position,data);}});
   output=new media.Output({format,target:new media.StreamTarget(writable,{chunked:true,chunkSize:PAGE_BYTES})});
   source=new media.CanvasSource(canvas,{codec:config.codec,quality:new media.Quality({bitrate:config.bitrate}),alpha:'discard',sizeChangeBehavior:'deny',hardwareAcceleration:'no-preference',keyFrameInterval:2,
    ...(config.fullCodecString?{fullCodecString:config.fullCodecString}:{}),onEncoderConfig(value){encoderConfig={...value};onEncoderConfig?.(encoderConfig);}});
   output.addVideoTrack(source,{frameRate:config.fps});
   signal?.addEventListener('abort',onAbort,{once:true});checkSignal(signal);
   await waitFor(()=>output.start(),{signal:internal.signal,deadlineMs});if(terminal)throw terminal;phase='open';
  }catch(reason){await stop(reason);throw terminal||reason;}
  return {
   get submittedFrames(){return submittedFrames;},get state(){return phase;},get encoderConfig(){return encoderConfig;},
   async addFrame({timestampUs,durationUs}){
    try{
     assertActive();if(pending)throw error('CONCURRENT_ADD','Only one video frame may be submitted at a time');assertSize();
     if(!Number.isSafeInteger(timestampUs)||timestampUs<0||!Number.isSafeInteger(durationUs)||durationUs<=0||timestampUs!==endUs)throw error('INVALID_TIMESTAMP','Video frames must have contiguous integer microsecond timestamps');
     const expected=Math.round(1e6*submittedFrames/config.fps),next=Math.round(1e6*(submittedFrames+1)/config.fps);
     if(timestampUs!==expected||durationUs!==next-expected||(config.frameCount!==undefined&&submittedFrames>=config.frameCount))throw error('INVALID_TIMESTAMP','Video frames must follow the selected frame grid');
     pending=true;await waitFor(()=>{if(terminal)throw terminal;return source.add(timestampUs/1e6,durationUs/1e6);},{signal:internal.signal,deadlineMs});
     if(terminal)throw terminal;assertSize();submittedFrames++;endUs=next;
    }catch(reason){await stop(reason);throw terminal||reason;}finally{pending=false;}
   },
   async finish(){
    try{
     assertActive();if(pending)throw error('CONCURRENT_ADD','Wait for the last video frame before finalizing');assertSize();
     if(!submittedFrames||(config.frameCount!==undefined&&submittedFrames!==config.frameCount))throw error('INCOMPLETE_VIDEO','The video is missing input frames');
     phase='finalizing';await waitFor(()=>output.finalize(),{signal:internal.signal,deadlineMs});if(terminal)throw terminal;
     const mimeType=config.container==='mp4'?'video/mp4':'video/webm',extension=config.container==='mp4'?'mp4':'webm',blob=collector.blob(mimeType);
     if(!blob.size)throw error('EMPTY_VIDEO','The encoder produced an empty video');
     phase='ready';detach();collector.clear();return {blob,mimeType,extension,bytes:blob.size,submittedFrames,durationUs:endUs,config,encoderConfig};
    }catch(reason){await stop(reason);throw terminal||reason;}
   },
   cancel(reason){return stop(error('CANCELED',String(reason||'Video export canceled')));}
  };
 }
 async function probe(input,signal,{media=root.TetraMedia,deadlineMs=DEADLINE_MS,createCanvas=()=>root.document.createElement('canvas')}={}){
  checkSignal(signal);const requested=normalizeConfig(input);
  if(!media||typeof root.VideoEncoder==='undefined')return {supported:false,code:'UNSUPPORTED_API',reason:'This browser does not provide WebCodecs video encoding. Project JSON and Explorer remain available.'};
  const candidates=requested.container==='auto'?['mp4','webm']:[requested.container],failures=[];
  for(const container of candidates){
   const config=normalizeConfig({...input,container}),key=keyOf(config);
   if(cache.has(key))return {...cache.get(key),requestedContainer:requested.container,config:{...cache.get(key).config,...(input.frameCount===undefined?{}:{frameCount:input.frameCount})}};
   let sink,canvas;
   try{
    const available=await waitFor(()=>media.canEncodeVideo(config.codec,{width:config.width,height:config.height,frameRate:config.fps,quality:new media.Quality({bitrate:config.bitrate}),hardwareAcceleration:'no-preference',...(config.fullCodecString?{fullCodecString:config.fullCodecString}:{})}),{signal,deadlineMs});
    if(!available){failures.push(container+': the requested codec configuration is unsupported');continue;}
    canvas=createCanvas();canvas.width=config.width;canvas.height=config.height;
    const context=canvas.getContext('2d',{alpha:false});if(!context)throw error('UNSUPPORTED_CANVAS','Cannot create a video probe canvas');
    context.fillStyle='#808080';context.fillRect(0,0,canvas.width,canvas.height);
    sink=await createSink(canvas,{...config,frameCount:2},{signal,deadlineMs,media});
    for(let k=0;k<2;k++){const timestampUs=Math.round(1e6*k/config.fps);await sink.addFrame({timestampUs,durationUs:Math.round(1e6*(k+1)/config.fps)-timestampUs});}
    const result=await sink.finish(),fullCodecString=result.encoderConfig?.codec;
    if(!fullCodecString)throw error('ENCODER_CONFIG','The encoder did not report its actual codec profile');
    const confirmed={...config,fullCodecString};delete confirmed.frameCount;
    const success={supported:true,config:confirmed,requestedContainer:requested.container};cache.set(key,success);cache.set(keyOf(confirmed),success);
    return {...success,config:{...confirmed,...(input.frameCount===undefined?{}:{frameCount:input.frameCount})}};
   }catch(reason){if(signal?.aborted||reason.code==='CANCELED')throw reason;failures.push(container+': '+reason.message);}finally{await sink?.cancel();if(canvas){canvas.width=1;canvas.height=1;}}
  }
  return {supported:false,code:'UNSUPPORTED_CONFIG',reason:failures.join('; '),alternative:requested.container==='mp4'?'Try WebM after checking support.':null};
 }
 root.TetraStudioEncoder={MAX_BYTES,PAGE_BYTES,DEADLINE_MS,createCollector,normalizeConfig,waitFor,createSink,probe,invalidate};
 if(typeof module!=='undefined')module.exports=root.TetraStudioEncoder;
})(globalThis);
