const {test}=require('node:test'),assert=require('node:assert/strict');
const Preview=require('../src/studio-preview.js');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
test('Quick/Detailed size follows actual display, density, output, aspect and GPU budgets',()=>{
 const args={width:960,height:540,aspect:'16:9',outputWidth:1920,outputHeight:1080,dpr:2};
 assert.deepEqual(Preview.sizeFor({...args,detailed:true}),{width:1536,height:864});
 assert.deepEqual(Preview.sizeFor(args),{width:512,height:288});
 assert.deepEqual(Preview.sizeFor({...args,outputWidth:1280,outputHeight:720,detailed:true}),{width:1280,height:720});
 assert.deepEqual(Preview.sizeFor({...args,dpr:.5,detailed:true}),{width:480,height:270});
 assert.deepEqual(Preview.sizeFor({...args,width:0,detailed:true}),null);
 const mobile=Preview.sizeFor({...args,width:366,height:500,aspect:'9:16',outputWidth:1080,outputHeight:1920,dpr:3,detailed:true});
 assert.equal(mobile.width/mobile.height,9/16);assert.ok(mobile.height<=1000&&mobile.width<=732);
 const limited=Preview.sizeFor({...args,maxTexture:512,rolled:true,detailed:true});assert.ok(Math.hypot(limited.width,limited.height)+2<=512);
});
test('resolution generation cancels old work and presents only the completed latest size',async()=>{
 const requests=[],shown=[];const preview=Preview.create({frameCount:60,fps:30,renderBase:(k,meta)=>new Promise(resolve=>requests.push({meta,resolve:()=>resolve({release(){}})})),compose:async()=>({}),present:(canvas,meta)=>shown.push(meta.request)});
 preview.setRequest({width:512,height:288});preview.setRequest({width:1536,height:864});assert.ok(requests[0].meta.signal.aborted);
 requests[0].resolve();await flush();requests[1].resolve();await flush();assert.deepEqual(shown,[{width:1536,height:864}]);await preview.dispose();
});
test('idle thumbnail work drains on cancellation before a newer frame, and failure does not poison suspend',async()=>{
 let complete;const f=fixture();f.preview.seek(0);await f.complete();
 const idle=f.preview.idleTask(signal=>new Promise((resolve,reject)=>{complete=()=>signal.aborted?reject(new Error('thumbnail failed')):resolve();}));
 await flush();const suspended=f.preview.suspend();complete();await assert.rejects(idle,/thumbnail failed/);await suspended;
 assert.equal(f.preview.state().inFlight,0);f.preview.resume();await f.complete();await f.preview.dispose();
});
function fixture(){
 let clock=0,tick=null;const requests=[],shown=[],composed=[];
 const preview=Preview.create({frameCount:60,fps:30,now:()=>clock,requestTick:fn=>{tick=fn;return 1;},cancelTick:()=>{tick=null;},renderBase:(k,{signal})=>new Promise(resolve=>requests.push({k,signal,resolve:()=>resolve({k,release(){}})})),compose:async(base,meta)=>{composed.push(meta);return base;},present:(canvas,{k})=>shown.push(k)});
 return {preview,requests,shown,composed,advance(ms){clock+=ms;const fn=tick;tick=null;fn?.();},async complete(){requests.at(-1).resolve();await flush();}};
}
test('60 Hz clock with 100 ms source work displays useful frames without tick cancellation',async()=>{
 const f=fixture();f.preview.play();
 for(let frame=0;frame<20;frame++){for(let t=0;t<6;t++)f.advance(100/6);assert.equal(f.requests.at(-1).signal.aborted,false);await f.complete();}
 while(f.preview.state().inFlight)await f.complete();
 assert.ok(f.shown.length>=20);assert.ok(f.shown.every((k,i)=>!i||k>=f.shown[i-1]));assert.equal(f.shown.at(-1),59);assert.equal(f.preview.state().playing,false);await f.preview.dispose();
});
test('100 explicit seeks keep only the latest target and discard the previous generation',async()=>{
 const f=fixture();f.preview.seek(0);for(let i=0;i<100;i++)f.preview.seek(i%60);
 assert.equal(f.requests.length,1);assert.equal(f.preview.state().queued,1);assert.equal(f.requests[0].signal.aborted,true);
 await f.complete();assert.equal(f.requests.at(-1).k,39);await f.complete();assert.deepEqual(f.shown,[39]);await f.preview.dispose();
});
test('look edits keep the pending base and use latest look; hide blocks submissions and autoplay',async()=>{
 const f=fixture();f.preview.seek(23);f.preview.refresh();f.preview.refresh();assert.equal(f.requests[0].signal.aborted,false);
 await f.complete();assert.equal(f.composed[0].lookRevision,2);assert.equal(f.composed[0].k,23);
 await f.complete();const hidden=f.preview.suspend();await hidden;const count=f.requests.length;f.advance(2000);assert.equal(f.requests.length,count);
 f.preview.resume();assert.equal(f.preview.state().playing,false);await f.complete();await f.preview.dispose();
});
test('Pause completes chosen frame while timing changes retain normalized playhead',async()=>{
 const f=fixture();f.preview.seek(30);f.preview.pause();assert.equal(f.requests[0].signal.aborted,false);await f.complete();assert.deepEqual(f.shown,[30]);
 f.preview.setTiming(48,24);assert.equal(f.preview.state().desiredK,24);await f.complete();await f.preview.dispose();
});
test('look arriving during composition cannot display old look',async()=>{
 let finish,first=true;const shown=[];const preview=Preview.create({frameCount:60,fps:30,renderBase:async()=>({release(){}}),compose:async(base,{lookRevision})=>{if(first){first=false;await new Promise(resolve=>{finish=resolve;});}return lookRevision;},present:canvas=>shown.push(canvas)});
 preview.seek(10);await flush();preview.refresh();finish();await flush();assert.ok(shown.every(revision=>revision===1));await preview.dispose();
});
