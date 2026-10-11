const {test}=require('node:test'),assert=require('node:assert/strict');
const Preview=require('../src/studio-preview.js');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
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
