'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/precision.js');const saved=require('../src/saved.js');
const hash='v=1&x=0.500000000000000000000000000001&y=0&s=1e-30&n=64&p=1&e=big&g=1';
const view={id:'view-1',name:'A boundary',hash};
test('saved coordinates survive an exact decimal round trip',()=>{assert.deepEqual(saved.decode(saved.encode([view])),[view]);});
test('saved view input rejects corrupt schemas and out-of-bounds coordinates',()=>{
 for(const raw of ['no JSON','null','{}','[]','{"version":2,"views":[]}', 'x'.repeat(65537)])assert.deepEqual(saved.decode(raw),[]);
 for(const bad of ['v=99&x=0&y=0&s=1','v=1&x=1e13&y=0&s=1','v=1&x=0&y=0&s=1e-201','v=1&x=<script>&y=0&s=1','v=1&x=0&y=0&s=0'])assert.equal(saved.validHash(bad),false);
});
test('saved view bounds prevent unbounded growth and duplicate identities',()=>{
 assert.throws(()=>saved.encode([view,view]));assert.throws(()=>saved.encode([{...view,name:'x'.repeat(49)}]));assert.throws(()=>saved.encode(Array.from({length:25},(_,i)=>({...view,id:String(i)}))));
 const raw=JSON.stringify({version:1,views:[view,{...view,id:'2',hash:'bad'}]});assert.deepEqual(saved.decode(raw),[view]);
});
test('art palettes are bounded, distinct and leave a neutral option',()=>{
 const {color}=require('../src/core.js');
 for(let p=0;p<4;p++)for(let kind=0;kind<5;kind++)for(const n of [0,1,8,12,64,256,1024]){
  const rgb=color(kind,n,p,.5,.25);for(const v of rgb)assert.ok(Number.isInteger(v)&&v>=0&&v<=255);
  if(p===3)assert.ok(rgb.every(v=>v===rgb[0]));
 }
 assert.notDeepEqual(color(3,8,0),color(3,8,1));assert.notDeepEqual(color(3,8,1),color(3,8,2));
 assert.notDeepEqual(color(1,8,0,.5,.25),color(1,8,0,.5,-.25));
});
