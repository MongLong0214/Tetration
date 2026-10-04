'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createFixed}=require('../src/precision.js');const {makePreciseOrbit}=require('../src/core.js');
const refs=require('./orbit-reference.json');const f=createFixed(240),orbit=makePreciseOrbit(240);
for(const item of refs.cases)test(`240-digit orbit vs independent 300-digit reference: ${item.label}`,()=>{
 const actual=orbit(item.x,item.y,item.iterations);
 assert.equal(actual.kind,0,JSON.stringify(actual));
 for(const key of ['re','im']){
  const expected=f.parse(item[key]);const error=f.abs(f.parse(actual[key])-expected);
  const tolerance=f.parse('1e-221')*(f.Q+f.abs(expected))/f.Q;
  assert.ok(error<tolerance,`${item.label} ${key}: ${f.text(error)}`);
 }
});
test('240-digit orbits distinguish coordinates separated below Number precision',()=>{
 const a=refs.cases.find(x=>x.label==='deep-center'),b=refs.cases.find(x=>x.label==='deep-displaced');
 assert.equal(Number(a.x),Number(b.x));const aa=orbit(a.x,a.y,4),bb=orbit(b.x,b.y,4);assert.notEqual(aa.im,bb.im);
});
