'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../src/core.js');
require('../src/gpu.js');

test('a pending GPU fence rejects before teardown and retires only after completion',async t=>{
 let complete=false,deleted=0,lost=0,clock=0,calls=0,finish,notice;
 const retired=new Promise(resolve=>{finish=resolve;});
 const checkedPending=new Promise(resolve=>{notice=resolve;});
 const sync={};
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,TIMEOUT_EXPIRED:2,WAIT_FAILED:3,ALREADY_SIGNALED:4,CONDITION_SATISFIED:5,
  fenceSync:()=>sync,flush:()=>{},isContextLost:()=>false,
  clientWaitSync:(f,flags,timeout)=>{assert.equal(f,sync);assert.equal(flags,0);assert.equal(timeout,0);clock=10001;if(++calls>1&&!complete)notice();return complete?4:2;},
  deleteSync:f=>{assert.equal(f,sync);assert.ok(complete,'Deleting an unfinished GPU fence can wait on the driver');deleted++;}};
 const renderer={gl,contextLoss:{loseContext:()=>{assert.ok(complete,'Destroying an unfinished context can block CPU recovery');lost++;finish();}}};
 t.mock.method(performance,'now',()=>clock);
 await assert.rejects(globalThis.TetraGPU.prototype.fence.call(renderer),/GPU completion timed out/);
 assert.equal(renderer.failed,true);assert.equal(deleted,0);assert.equal(lost,0);
 await checkedPending;
 assert.equal(deleted,0);assert.equal(lost,0);
 complete=true;
 // A real timer must let the rejection/caller run before native retirement.
 await retired;
 assert.equal(deleted,1);assert.equal(lost,1);
});

test('orbit programs, the BLA one included, are linked twice so a first visit gets the program-cache binary',()=>{
 const proto=globalThis.TetraGPU.prototype,made=[],deleted=[];
 const renderer=()=>({gl:{deleteProgram:p=>deleted.push(p)},programs:{},blaMode:'auto',pendingBla:null,parallel:null,relink:proto.relink,link:()=>{const link={program:made.length};made.push(link);return link;}});
 const plain=renderer(),bla=renderer(),pending=renderer();
 assert.equal(proto.program.call(plain,'direct'),made[1]);
 assert.deepEqual(deleted,[0]);
 assert.equal(proto.program.call(plain,'direct'),made[1],'a linked program is reused');
 assert.equal(proto.blaProgram.call(bla),made[3]);
 assert.deepEqual(deleted,[0,2]);
 pending.pendingBla={};pending.finishLink=()=>{const link={program:made.length};made.push(link);return link;};
 assert.equal(proto.blaProgram.call(pending),made[5]);
 assert.deepEqual(deleted,[0,2,4]);
});
