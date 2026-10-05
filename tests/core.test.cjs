'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createFixed}=require('../src/precision.js');const {orbit64,orbitRules,RULES,makePreciseOrbit,color}=require('../src/core.js');
const refs=require('./reference.json');const f=createFixed(120);
const near=(actual,expected,digits=70)=>assert.ok(f.abs(actual-f.parse(expected))<f.parse('1e-'+digits),`Expected ${expected}; got ${f.text(actual)}`);
test('decimal camera preserves differences invisible to Number',()=>{const camera=createFixed(256);const a=camera.parse('1'),b=a+camera.parse('1e-200');assert.notEqual(a,b);assert.equal(camera.parse(camera.text(b)),b);assert.equal(Number(camera.text(a)),Number(camera.text(b)));});
test('decimal notation, round trips, truncation and signed zero',()=>{for(const v of ['1e-200','-2.456789','00004.5000','-0','1.01e12','-4.3e-100']){const n=f.parse(v);assert.equal(f.parse(f.text(n)),n);}assert.equal(f.text(f.parse('-0')),'0');assert.equal(f.parse('1e-150'),0n);});
test('invalid decimal and excessive exponents are rejected',()=>{for(const v of ['', '.', 'NaN', 'Infinity', '1e9999','<script>', '0x12', '1e'])assert.throws(()=>f.parse(v));assert.throws(()=>createFixed(10));assert.throws(()=>createFixed(257));});
test('Machin pi agrees with mpmath reference to 90 decimal places',()=>near(f.pi(),refs.pi,90));
for(const [x,y]of Object.entries(refs.ln))test(`log(${x}) agrees with mpmath`,()=>near(f.ln(f.parse(x)),y,70));
for(const [x,y]of Object.entries(refs.exp))test(`exp(${x}) agrees with mpmath`,()=>near(f.exp(f.parse(x)),y,70));
for(const [x,ys]of Object.entries(refs.sincos))test(`sincos(${x}) agrees with mpmath`,()=>{const out=f.sincos(f.parse(x));near(out[0],ys[0],70);near(out[1],ys[1],70);});
for(const [x,y]of Object.entries(refs.sqrt))test(`sqrt(${x}) agrees with mpmath`,()=>near(f.sqrt(f.parse(x)),y,70));
for(const [y,x,v]of refs.atan2)test(`atan2(${y},${x}) agrees with mpmath`,()=>near(f.atan2(f.parse(y),f.parse(x)),v,70));
test('arithmetic domain errors are explicit',()=>{assert.throws(()=>f.div(f.Q,0n));assert.throws(()=>f.ln(0n));assert.throws(()=>f.sqrt(-f.Q));assert.throws(()=>f.exp(f.parse('40')));assert.throws(()=>f.atan2(0n,0n));});
test('known real orbits: fixed point, period two, threshold, undefined origin',()=>{assert.equal(orbit64(Math.SQRT2,0,512).kind,1);assert.ok(Math.abs(orbit64(Math.SQRT2,0,512).re-2)<1e-8);assert.equal(orbit64(.01,0,512).kind,2);assert.equal(orbit64(2,0).kind,3);assert.equal(orbit64(0,0).kind,4);assert.equal(orbit64(NaN,1).kind,4);assert.equal(orbit64(.5,0,2).kind,0);});
test('FP64 respects conjugation away from branch cut',()=>{for(const [x,y]of [[.5,.25],[-.2,.7],[2,3],[-1,.2]]){const a=orbit64(x,y),b=orbit64(x,-y);assert.equal(a.kind,b.kind);assert.equal(a.steps,b.steps);if(Number.isFinite(a.im)&&Number.isFinite(b.im))assert.ok(Math.abs(a.im+b.im)<1e-8);}});
test('BigInt orbit matches known stable and threshold classifications',()=>{const orbit=makePreciseOrbit(60);for(const [x,kind]of [['0.01',2],['0.5',1],['1',1],['1.414213562373095048801688724209698078569671875376948',1],['2',3],['0',4]])assert.equal(orbit(x,'0',512).kind,kind,x);});
test('complex BigInt orbit agrees with FP64 on selected non-boundary inputs',()=>{const orbit=makePreciseOrbit(60);for(const [x,y]of [['0.5','0.25'],['2','3'],['-1','0.2'],['-0.2','0.7']]){assert.equal(orbit(x,y,2048).kind,orbit64(Number(x),Number(y),2048).kind,`${x}+${y}i`);}});
test('all palettes return finite RGB bytes',()=>{for(let p=0;p<3;p++)for(let k=0;k<5;k++)for(const n of [0,1,5,32,256,1025]){const c=color(k,n,p);assert.equal(c.length,3);c.forEach(x=>assert.ok(Number.isInteger(x)&&x>=0&&x<=255));}});

test('finite classification can differ with convergence tolerance',()=>{assert.equal(orbit64(-.2,.7,512).kind,1);assert.equal(makePreciseOrbit(60)('-0.2','0.7',512).kind,0);});
test('FP64 distance bounds preserve complete native-hypot orbit results',()=>{
 // orbitRules keeps the direct Euclidean predicates: compare classification,
 // exact stopping step and final complex value, including long unresolved runs.
 const compare=(x,y,n)=>assert.deepEqual(orbit64(x,y,n),orbitRules(x,y,n,RULES.cpu),`${x}+${y}i / ${n}`);
 for(let y=0;y<24;y++)for(let x=0;x<40;x++)compare(-1.84+(x+.5-20)*.46/40,.09+(12-y-.5)*.46/40,16384);
 let seed=0x12345678;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<10000;i++)compare((random()-.5)*12,(random()-.5)*8,256);
 for(const x of [0,.01,.5,1,Math.SQRT2,Math.exp(1/Math.E),Math.exp(-Math.E),-1,1e-300,1e12])
  for(const y of [0,-0,1e-14,-1e-14])compare(x,y,16384);
});
