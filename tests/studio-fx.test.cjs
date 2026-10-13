'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/precision.js');const M=require('../src/studio-model.js'),FX=require('../src/studio-fx.js');
const project=()=>M.createProject({x:'-0.5',y:'0',span:'8',palette:'ember'});
test('four presets reset hidden FX, validate all fields and preserve camera/time/output',()=>{
 const p=project();p.look.wave.enabled=true;p.look.wave.speed=-1;
 for(const name of FX.PRESET_NAMES){const result=FX.applyPreset(p,name);assert.equal(FX.presetName(result),name);assert.deepEqual(result.shot,p.shot);assert.deepEqual(result.output,p.output);assert.deepEqual(result.numerics,p.numerics);assert.doesNotThrow(()=>M.deserialize(M.serialize(result)));}
 const neutral=FX.applyPreset(p,'Neutral');assert.equal(neutral.look.palette,'ember');assert.deepEqual(neutral.look,M.neutralLook('ember'));
 const neon=FX.applyPreset(p,'Neon Pulse');assert.equal(neon.look.bloom.intensity,0.65);assert.equal(neon.look.bloom.radiusRatio,0.012);assert.equal(neon.look.pulse.strength,0.55);assert.equal(neon.look.prism.offsetRatio,0.002);assert.equal(neon.look.wave.enabled,false);
 const prism=FX.applyPreset(p,'Prism Wave');assert.equal(prism.look.kaleido.blend,0.7);assert.equal(prism.look.wave.fieldCycles,2);assert.equal(prism.look.pulse.enabled,false);
 neon.look.pulse.strength=0.5;assert.equal(FX.presetName(neon),'Custom');
});
test('frame time, hue, Pulse and Wave remain identical across 24/30fps and random seeks',()=>{
 const look=FX.applyPreset(project(),'Neon Pulse').look;look.hueRate=0.125;look.wave.enabled=true;
 for(const seconds of [0,0.5,1,2,4]){const a=FX.evaluateLook(look,seconds*24,24),b=FX.evaluateLook(look,seconds*30,30);assert.deepEqual(a,b);assert.equal(FX.waveEV(look,a.seconds,0.3,0.8,720,1280),FX.waveEV(look,b.seconds,0.3,0.8,720,1280));}
 const zero=FX.evaluateLook(look,0,30),period=FX.evaluateLook(look,30,30);assert.equal(zero.pulseAmplitude,period.pulseAmplitude);assert.equal(FX.evaluateLook(look,15,30).pulseAmplitude,0.55);
 const expected=Array.from({length:300},(_,k)=>FX.evaluateLook(look,k,30));for(const k of [299,0,20,2,98,299,20])assert.deepEqual(FX.evaluateLook(look,k,30),expected[k]);
 look.pulse.enabled=false;assert.equal(FX.evaluateLook(look,15,30).pulseAmplitude,0);assert.equal(look.pulse.strength,0.55);
});
test('zero/off/Original identity preserves fields, encoded transfer round trips and mirror extension',()=>{
 const look=M.neutralLook('ember');assert.equal(FX.identity(look),true);look.prism.enabled=true;look.prism.amount=0;assert.equal(FX.identity(look),true);look.prism.amount=0.5;assert.equal(FX.identity(look),false);assert.equal(FX.identity(look,0,30,true),true);look.amount=0;assert.equal(FX.identity(look),true);assert.equal(look.prism.amount,0.5);
 for(let value=0;value<=255;value++)assert.ok(Math.abs(FX.linearToSrgb(FX.srgbToLinear(value/255))-value/255)<1e-12);
 for(const value of [-2.25,-0.25,0.25,1.75,2.25])assert.equal(FX.mirror(value),0.25);
});
test('Kaleidoscope keeps radial distance/aspect and finite center; Prism has no center offset',()=>{
 for(const [W,H]of [[1920,1080],[1080,1920],[1080,1080]])for(const segments of M.RULES['kaleido.segments'].values){
  assert.deepEqual(FX.foldUV(0.5,0.5,W,H,segments,45),[0.5,0.5]);const [u,v]=FX.foldUV(0.15,0.8,W,H,segments,30),L=Math.min(W,H);
  assert.ok(Math.abs(Math.hypot((u-0.5)*W/L,(v-0.5)*H/L)-Math.hypot(-0.35*W/L,0.3*H/L))<1e-12);
  assert.deepEqual(FX.prismOffset(0.5,0.5,W,H,0.01),[0,0]);const offset=FX.prismOffset(0.75,0.75,W,H,0.01);assert.ok(offset.every(Number.isFinite));
 }
});
test('static reuse depends on every effective time effect, including identity at frame zero',()=>{
 const look=M.neutralLook();assert.equal(FX.timeInvariant(look),true);
 look.hueRate=.1;assert.equal(FX.identity(look,0),true);assert.equal(FX.timeInvariant(look),false);look.hueRate=0;
 look.pulse.enabled=true;assert.equal(FX.identity(look,0),true);assert.equal(FX.timeInvariant(look),false);
 look.pulse.exposureEV=0;assert.equal(FX.timeInvariant(look),true);look.bloom.enabled=true;assert.equal(FX.timeInvariant(look),false);
 look.bloom.intensity=0;assert.equal(FX.timeInvariant(look),true);look.wave.enabled=true;assert.equal(FX.timeInvariant(look),false);
 look.wave.speed=0;assert.equal(FX.timeInvariant(look),true);look.wave.speed=.25;look.amount=0;assert.equal(FX.timeInvariant(look),true);look.amount=1;assert.equal(FX.timeInvariant(look,true),true);
});
