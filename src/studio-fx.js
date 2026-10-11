/* Frame-time FX math and looks. GPU composition is kept separate from orbit work.
 * Adaptation reference: MongLong0214/video-art @ 4f373208f95689b11cb068ee8db2018a65083373
 * effect-composer.ts kaleidoFragmentShader / lensDistortionFragmentShader: polar
 * sector folding and channel sampling concepts; actual aspect, angle and mirror
 * extension replace fixed image assumptions. layer.frag glow-wave crest: one
 * analytic radial phase, seconds-based speed and EV modulation replace phase
 * PNGs, loop-duration speed and additive brightness. No noise/Ashima code,
 * Three.js, postprocessing, source assets or feedback shaders are copied.
 */
(function(root){
 'use strict';
 const M=root.TetraStudioModel,TAU=2*Math.PI;
 const PRESETS={
  Neutral:{},
  'Neon Pulse':{palette:'aurora',saturation:1.2,bloom:{enabled:true,intensity:0.65,radiusRatio:0.012,threshold:0.6},pulse:{enabled:true,period:1,strength:0.55,sharpness:2,phase:0,exposureEV:0.35,bloomGain:0.8},prism:{enabled:true,amount:0.25,offsetRatio:0.002}},
  'Deep Ambient':{palette:'tidal',hueRate:0.015,saturation:0.95,exposureEV:-0.15,bloom:{enabled:true,intensity:0.25,radiusRatio:0.01,threshold:0.7}},
  'Prism Wave':{palette:'aurora',hueRate:0.025,saturation:1.15,bloom:{enabled:true,intensity:0.5,radiusRatio:0.01,threshold:0.65},prism:{enabled:true,amount:0.55,offsetRatio:0.005},kaleido:{enabled:true,segments:6,blend:0.7,angleDeg:0},wave:{enabled:true,strengthEV:0.45,fieldCycles:2,speed:0.25}}
 };
 const mod=(value,period)=>(value%period+period)%period;
 function applyPreset(project,name){
  if(!Object.hasOwn(PRESETS,name))throw Error('Unknown look preset');
  const next=M.validate(project),look=M.neutralLook(next.look.palette);
  for(const [key,value]of Object.entries(PRESETS[name]))if(value&&typeof value==='object')Object.assign(look[key],value);else look[key]=value;
  next.look=look;return M.validate(next);
 }
 function presetName(project){const look=M.validate(project).look;for(const name of Object.keys(PRESETS))if(JSON.stringify(look)===JSON.stringify(applyPreset(project,name).look))return name;return 'Custom';}
 function evaluateLook(look,k,fps){
  if(!Number.isInteger(k)||k<0||!M.ENUMS.fps.includes(fps))throw Error('Invalid FX frame time');
  const seconds=k/fps,pulse=look.pulse,env=(0.5-0.5*Math.cos(TAU*(seconds/pulse.period+pulse.phase)))**pulse.sharpness;
  const pulseAmplitude=pulse.enabled?pulse.strength*env:0,hueDeg=mod(look.hueDeg+360*look.hueRate*seconds,360);
  return {seconds,hueDeg,pulseAmplitude,exposureEV:look.exposureEV+pulseAmplitude*pulse.exposureEV,
   bloomIntensity:look.bloom.enabled&&look.bloom.radiusRatio>0?look.bloom.intensity*(1+pulseAmplitude*pulse.bloomGain):0};
 }
 function identity(look,k=0,fps=30,original=false){
  if(original||look.amount===0)return true;const time=evaluateLook(look,k,fps);
  return time.hueDeg===0&&look.saturation===1&&time.exposureEV===0&&time.bloomIntensity===0&&(!look.prism.enabled||look.prism.amount===0||look.prism.offsetRatio===0)&&(!look.kaleido.enabled||look.kaleido.blend===0)&&(!look.wave.enabled||look.wave.strengthEV===0);
 }
 function waveEV(look,seconds,u,v,width,height){
  if(!look.wave.enabled||look.wave.strengthEV===0)return 0;
  const L=Math.min(width,height),radius=Math.hypot((u-0.5)*width/L,(v-0.5)*height/L);
  const crest=(0.5+0.5*Math.cos(TAU*(look.wave.fieldCycles*radius-look.wave.speed*seconds)))**2;
  return look.wave.strengthEV*(crest-3/8);
 }
 function foldUV(u,v,width,height,segments,angleDeg=0){
  const L=Math.min(width,height),x=(u-0.5)*width/L,y=(v-0.5)*height/L,radius=Math.hypot(x,y);
  if(radius===0)return [0.5,0.5];const offset=angleDeg*Math.PI/180,angle=mod(Math.atan2(y,x)-offset,TAU),sector=TAU/segments,index=Math.floor(angle/sector);
  let local=angle-index*sector;if(index%2)local=sector-local;local+=offset;
  return [0.5+Math.cos(local)*radius*L/width,0.5+Math.sin(local)*radius*L/height];
 }
 function prismOffset(u,v,width,height,offsetRatio){
  const L=Math.min(width,height),x=(u-0.5)*width/L,y=(v-0.5)*height/L,radius=Math.hypot(x,y);if(radius===0)return [0,0];
  const t=Math.max(0,Math.min(1,radius/0.75)),weight=t*t*(3-2*t),offset=offsetRatio*weight;
  return [x/radius*offset*L/width,y/radius*offset*L/height];
 }
 const mirror=value=>1-Math.abs(mod(value,2)-1);
 const srgbToLinear=value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;
 const linearToSrgb=value=>value<=0.0031308?12.92*value:1.055*value**(1/2.4)-0.055;
 root.TetraStudioFX={PRESET_NAMES:Object.keys(PRESETS),applyPreset,presetName,evaluateLook,identity,waveEV,foldUV,prismOffset,mirror,srgbToLinear,linearToSrgb};
 if(typeof module!=='undefined')module.exports=root.TetraStudioFX;
})(globalThis);
