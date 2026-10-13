'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../src/precision.js');require('../src/studio-frame.js');
const source=fs.readFileSync(require.resolve('../src/main.js'),'utf8');

test('shared reference cache retains requested digits when compute omits them and preserves explicit digits',async()=>{
 const start=source.indexOf('  function ensureReferenceOptions('),end=source.indexOf('\n  // ---------- GPU rendering',start),F=globalThis.createFixed(256),references={cache:[],computed:0,inflight:new Map()},digits=[undefined,140];
 const sandbox={F,references,referenceWorker:()=>null,setTimeout,TetraReference:{compute:options=>({iterations:options.iterations,...(digits[references.computed]===undefined?{}:{digits:digits[references.computed]})})}};
 vm.runInNewContext(source.slice(start,end)+'; globalThis.reference=ensureReferenceOptions;',sandbox);
 const options={x:'-0.25',y:'0.4',digits:100,iterations:64};
 const a=await sandbox.reference(options);assert.equal(a.digits,100);assert.equal(await sandbox.reference(options),a);assert.equal(references.computed,1);
 const b=await sandbox.reference({...options,x:'-0.5',digits:120});assert.equal(b.digits,140);assert.equal(await sandbox.reference({...options,x:'-0.5',digits:130}),b);assert.equal(references.computed,2);
});

test('applyCamera and zoom store the old view in history before camera mutation',()=>{
 const start=source.indexOf('    applyCamera(camera,'),end=source.indexOf('    async enter()',start),F=globalThis.createFixed(256),initial={x:F.parse('0.12345678901234567890123456789'),y:F.parse('-0.4'),span:F.parse('8')},history=[];
 const sandbox={globalThis:{TetraStudioFrame:globalThis.TetraStudioFrame},F,dims:{w:1440,h:820},view:{...initial},visual:{...initial},clone:v=>({...v}),same:(a,b)=>a.x===b.x&&a.y===b.y&&a.span===b.span,validate:v=>v,stopMotion:()=>{},changed:()=>{},viewport:{focus:()=>{}},saveHistory:v=>history.push({...v}),zoomAt:()=>{sandbox.view.span/=2n;return true;}};
 vm.runInNewContext('bridge={'+source.slice(start,end)+'};',sandbox);
 sandbox.bridge.applyCamera({x:'0.8',y:'-0.2',span:'2',rollDeg:45},9/16);assert.deepEqual(history[0],initial);
 const before={...sandbox.view};sandbox.bridge.zoom(.5);assert.deepEqual(history[1],before);
});
