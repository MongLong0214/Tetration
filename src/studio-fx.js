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
 function timeInvariant(look,original=false){
  if(original||look.amount===0)return true;
  const pulse=look.pulse,bloom=look.bloom,wave=look.wave;
  return look.hueRate===0&&!(pulse.enabled&&pulse.strength>0&&(pulse.exposureEV>0||(bloom.enabled&&bloom.radiusRatio>0&&bloom.intensity>0&&pulse.bloomGain>0)))&&!(wave.enabled&&wave.strengthEV>0&&wave.speed!==0);
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
 // All sampling uses texel-centre-clamped mirror extension. Manual bilinear
 // fetches also work on RGBA16F devices without float linear filtering.
 const COMMON=`#version 300 es
 precision highp float;
 uniform sampler2D Source;
 uniform vec2 Size;
 out vec4 Color;
 const float TAU=6.283185307179586;
 vec2 mirrored(vec2 uv){return 1.-abs(mod(uv,2.)-1.);}
 vec3 sampleAt(sampler2D image,vec2 uv){
  ivec2 s=textureSize(image,0);vec2 p=clamp(mirrored(uv)*vec2(s)-.5,vec2(0),vec2(s)-1.);
  ivec2 a=ivec2(floor(p)),b=min(a+1,s-1);vec2 f=fract(p);
  return mix(mix(texelFetch(image,a,0).rgb,texelFetch(image,ivec2(b.x,a.y),0).rgb,f.x),mix(texelFetch(image,ivec2(a.x,b.y),0).rgb,texelFetch(image,b,0).rgb,f.x),f.y);
 }
 vec3 linearRGB(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
 vec3 encodedRGB(vec3 c){return mix(12.92*c,1.055*pow(max(c,vec3(0)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
 `;
 const SHADERS={
  motion:COMMON+`uniform sampler2D History;uniform vec3 MapX;uniform vec3 MapY;uniform float Feedback;
   void main(){ivec2 p=ivec2(gl_FragCoord.xy),s=textureSize(Source,0);vec3 current=texelFetch(Source,p,0).rgb,lo=current,hi=current;
    // Reject stale colours at real edges; retain subpixel detail in the noisy
    // neighbourhood rather than blending unaligned frames or time effects.
    const ivec2 taps[4]=ivec2[4](ivec2(-1,0),ivec2(1,0),ivec2(0,-1),ivec2(0,1));
    for(int i=0;i<4;i++){vec3 v=texelFetch(Source,clamp(p+taps[i],ivec2(0),s-1),0).rgb;lo=min(lo,v);hi=max(hi,v);}
    vec3 q=vec3(gl_FragCoord.xy,1.);vec2 old=vec2(dot(MapX,q),dot(MapY,q));
    bool valid=all(greaterThanEqual(old,vec2(.5)))&&all(lessThanEqual(old,Size-.5));
    vec3 history=clamp(sampleAt(History,old/Size),lo,hi);
    Color=vec4(mix(current,history,valid?Feedback:0.),1.);}`,
  frame:COMMON+`uniform float Roll;uniform vec2 SourceSize;
   void main(){vec2 p=gl_FragCoord.xy-Size*.5;float c=cos(Roll),s=sin(Roll);vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);Color=vec4(sampleAt(Source,(q+SourceSize*.5)/SourceSize),1.);}`,
  effect:COMMON+`uniform vec4 Kaleido;uniform vec3 Prism;uniform vec3 Tone;uniform vec3 Wave;uniform float Seconds;
   // Axis guards avoid atan(0,0), and this one-argument form is stable on
   // ANGLE/Metal implementations that miscompile two-argument atan.
   float angleOf(vec2 q){if(q.x==0.)return q.y>=0.?TAU*.25:-TAU*.25;if(q.y==0.)return q.x>=0.?0.:TAU*.5;
    if(abs(q.x)>=abs(q.y)){float a=atan(q.y/q.x);return q.x<0.?a+(q.y>0.?TAU*.5:-TAU*.5):a;}
    return (q.y>0.?TAU*.25:-TAU*.25)-atan(q.x/q.y);}
   vec3 folded(vec2 uv){vec3 original=sampleAt(Source,uv);if(Kaleido.x==0.||Kaleido.z==0.)return original;
    float L=min(Size.x,Size.y);vec2 q=(uv-.5)*Size/L;float r=length(q);if(r==0.)return original;
    float a=mod(angleOf(q)-Kaleido.w,TAU),sector=TAU/Kaleido.y,index=floor(a/sector),local=a-index*sector;
    if(mod(index,2.)==1.)local=sector-local;local+=Kaleido.w;
    return mix(original,sampleAt(Source,.5+r*vec2(cos(local),sin(local))*L/Size),Kaleido.z);}
   vec3 hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
    vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y),e=1.e-10;
    return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x);}
   vec3 rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
   void main(){vec2 uv=gl_FragCoord.xy/Size;float L=min(Size.x,Size.y);vec2 q=(uv-.5)*Size/L;float r=length(q);vec3 c=folded(uv);
    if(Prism.x!=0.&&Prism.y!=0.&&Prism.z!=0.){vec2 d=r==0.?vec2(0.):q/r*Prism.z*L/Size*smoothstep(0.,.75,r);
     c=mix(c,vec3(folded(uv+d).r,c.g,folded(uv-d).b),Prism.y);}
    if(Tone.x!=0.||Tone.y!=1.){vec3 h=hsv(c);h.x=fract(h.x+Tone.x);h.y=clamp(h.y*Tone.y,0.,1.);c=rgb(h);}
    float crest=pow(.5+.5*cos(TAU*(Wave.y*r-Wave.z*Seconds)),2.);
    Color=vec4(linearRGB(c)*exp2(Tone.z+Wave.x*(crest-.375)),1.);
   }`,
  bright:COMMON+`uniform float Threshold;void main(){vec3 c=sampleAt(Source,gl_FragCoord.xy/Size);Color=vec4(max(c-vec3(Threshold),vec3(0)),1.);}`,
  blur:COMMON+`uniform vec2 Step;void main(){vec2 uv=gl_FragCoord.xy/Size;vec3 c=sampleAt(Source,uv)*70.;
   c+=(sampleAt(Source,uv-Step)+sampleAt(Source,uv+Step))*56.;c+=(sampleAt(Source,uv-2.*Step)+sampleAt(Source,uv+2.*Step))*28.;
   c+=(sampleAt(Source,uv-3.*Step)+sampleAt(Source,uv+3.*Step))*8.;c+=sampleAt(Source,uv-4.*Step)+sampleAt(Source,uv+4.*Step);Color=vec4(c/256.,1.);}`,
  finish:COMMON+`uniform sampler2D Original;uniform sampler2D Glow;uniform float Amount;uniform float GlowGain;
   void main(){vec2 uv=gl_FragCoord.xy/Size;vec3 c=sampleAt(Source,uv);if(GlowGain>0.)c+=GlowGain*sampleAt(Glow,uv);
    c=mix(linearRGB(sampleAt(Original,uv)),c,Amount);Color=vec4(encodedRGB(clamp(c,0.,1.)),1.);}`
 };
 function createCompositor(renderer,{width,height,canvas}={}){
  if(!renderer||renderer.lost())throw Error('FX requires a working WebGL2 GPU');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>renderer.maxTexture||height>renderer.maxTexture)throw Error('Invalid FX output size');
  const gl=renderer.gl,programs={},targets={},output=canvas||document.createElement('canvas');output.width=width;output.height=height;
  const ctx=output.getContext('2d',{alpha:false});if(!ctx)throw Error('The video canvas is unavailable');
  let active=false,disposed=false,drain=Promise.resolve(),done=null,compositions=0,motionHistory=null,motionPasses=0,cached=null,cacheHits=0,composeMs=0;
  function program(name){
   if(programs[name])return programs[name];const shaders=[];let linked=null;
   try{
    for(const [type,source]of [[gl.VERTEX_SHADER,root.TetraGPU.sources.vertex],[gl.FRAGMENT_SHADER,SHADERS[name]]]){
     const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
     if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('FX shader failed: '+gl.getShaderInfoLog(shader));
    }
    linked=gl.createProgram();shaders.forEach(shader=>gl.attachShader(linked,shader));gl.linkProgram(linked);
    if(!gl.getProgramParameter(linked,gl.LINK_STATUS))throw Error('FX shader link failed: '+gl.getProgramInfoLog(linked));
    const uniforms={};for(let i=0;i<gl.getProgramParameter(linked,gl.ACTIVE_UNIFORMS);i++){const info=gl.getActiveUniform(linked,i);uniforms[info.name]=gl.getUniformLocation(linked,info.name);}
    programs[name]={program:linked,uniforms};return programs[name];
   }catch(error){if(linked)gl.deleteProgram(linked);throw error;}finally{shaders.forEach(shader=>gl.deleteShader(shader));}
  }
  function target(name,w=width,h=height,float=false){
   if(targets[name])return targets[name];if(float&&!renderer.floatColor)throw Error('This look requires half-float GPU targets. Neutral and Original remain available.');
   const texture=gl.createTexture(),buffer=gl.createFramebuffer();gl.bindTexture(gl.TEXTURE_2D,texture);
   gl.texStorage2D(gl.TEXTURE_2D,1,float?gl.RGBA16F:gl.RGBA8,w,h);renderer.setNearest();
   gl.bindFramebuffer(gl.FRAMEBUFFER,buffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE||gl.getError()!==gl.NO_ERROR){gl.deleteFramebuffer(buffer);gl.deleteTexture(texture);throw Error('FX image allocation failed');}
   return targets[name]={texture,buffer,width:w,height:h,bytes:w*h*(float?8:4)};
  }
  function draw(name,destination,textures,values={}){
   const p=program(name);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,destination.buffer);gl.viewport(0,0,destination.width,destination.height);gl.useProgram(p.program);
   let slot=0;for(const [key,frame]of Object.entries(textures)){gl.activeTexture(gl.TEXTURE0+slot);gl.bindTexture(gl.TEXTURE_2D,frame.texture);gl.uniform1i(p.uniforms[key],slot++);}
   const fields={Size:[destination.width,destination.height],...values};
   for(const [key,value]of Object.entries(fields)){const u=p.uniforms[key];if(u===undefined)continue;if(Array.isArray(value))gl['uniform'+value.length+'fv'](u,value);else gl.uniform1f(u,value);}
   gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function check(signal){if(signal?.aborted||disposed)throw new DOMException('FX composition canceled','AbortError');if(renderer.lost())throw Error('GPU lost during FX composition');}
  return {
   canvas:output,
   diagnostics(){return {active,compositions,cacheHits,composeMs,motionPasses,targets:Object.keys(targets).length,bytes:Object.values(targets).reduce((sum,frame)=>sum+frame.bytes,0),programs:Object.keys(programs).length};},
   async compose(source,{look,k=0,fps=30,rollDeg=0,original=false,framing=false,motion=false,sequence=0,signal}={}){
    if(active)throw Error('Only one FX frame may compose at a time');check(signal);if(!source.complete||source.renderer!==renderer)throw Error('FX requires a completed owned source frame');
    const applied=framing?{...look,prism:{...look.prism,enabled:false},kaleido:{...look.kaleido,enabled:false}}:look;
    // Only the offline renderer's immutable content identity can certify reuse.
    // A pooled texture object alone can contain an entirely different frame.
    const key=!motion&&source.contentKey&&timeInvariant(applied,original)?JSON.stringify([source.camera,rollDeg,applied,original,framing,fps]):null;
    if(key&&cached?.content===source.contentKey&&cached.key===key){cacheHits++;return output;}
    cached=null;active=true;drain=new Promise(resolve=>{done=resolve;});const started=performance.now();let snapshot=null,nextHistory=null;
    try{
     const base=source.frame;renderer.refreshFrame(base);let frame=base;
     if(rollDeg!==0||base.width!==width||base.height!==height){frame=target('framed');draw('frame',frame,{Source:base},{Roll:rollDeg*Math.PI/180,SourceSize:[base.width,base.height]});}
     if(motion&&!framing&&!original&&source.camera){
      const previous=motionHistory,camera=source.camera,key=JSON.stringify(camera),step=previous?k-previous.k:0;
      if(previous&&previous.sequence===sequence&&previous.key===key&&k>=previous.k)frame=previous.frame;
      else{
       const next=target(previous?.name==='motionA'?'motionB':'motionA');let matrix=[1,0,0,1,0,0],feedback=0;
       if(previous&&previous.sequence===sequence&&previous.fps===fps&&step>0&&step<=4){
        const candidate=root.TetraStudioCamera.screenMatrix(camera,previous.camera,width,height),scale=Math.hypot(candidate[0],candidate[1]);
        if(scale>=.8&&scale<=1.25&&candidate.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)){matrix=candidate;feedback=Math.pow(.7,step);}
       }
       const [a,b,c,d,tx,ty]=matrix;
       draw('motion',next,{Source:frame,History:previous?.frame||frame},{MapX:[a,-c,c*height+tx],MapY:[-b,d,height-d*height-ty],Feedback:feedback});
       frame=next;nextHistory={frame:next,name:next===targets.motionA?'motionA':'motionB',camera:{...camera},key,k,fps,sequence};motionPasses++;
      }
     }else motionHistory=null;
     let final=frame;
     if(!identity(applied,k,fps,original)){
      const time=evaluateLook(applied,k,fps),effect=target('effect',width,height,true),{prism,kaleido,wave,bloom}=applied;
      draw('effect',effect,{Source:frame},{Kaleido:[kaleido.enabled?1:0,kaleido.segments,kaleido.blend,kaleido.angleDeg*Math.PI/180],Prism:[prism.enabled?1:0,prism.amount,prism.offsetRatio],Tone:[time.hueDeg/360,applied.saturation,time.exposureEV],Wave:[wave.enabled?wave.strengthEV:0,wave.fieldCycles,wave.speed],Seconds:time.seconds});
      let glow=effect;
      if(time.bloomIntensity>0){
       const w=Math.max(1,Math.ceil(width/2)),h=Math.max(1,Math.ceil(height/2)),a=target('bright',w,h,true),b=target('blur',w,h,true);
       draw('bright',a,{Source:effect},{Threshold:bloom.threshold});const radius=bloom.radiusRatio*Math.min(width,height);
       draw('blur',b,{Source:a},{Step:[radius/(4*width),0]});draw('blur',a,{Source:b},{Step:[0,radius/(4*height)]});glow=a;
      }
      final=target('final');draw('finish',final,{Source:effect,Original:frame,Glow:glow},{Amount:applied.amount,GlowGain:time.bloomIntensity});
     }
     // Drain GPU writes before presenting. capture invokes createImageBitmap
     // immediately, before the browser may clear the transient drawing buffer.
     await renderer.fence();check(signal);snapshot=await renderer.capture(final);check(signal);ctx.drawImage(snapshot,0,0);if(nextHistory)motionHistory=nextHistory;compositions++;
     if(key)cached={content:source.contentKey,key};
     return output;
    }finally{snapshot?.close?.();composeMs+=performance.now()-started;active=false;done();}
   },
   async dispose(){disposed=true;await drain;cached=null;motionHistory=null;for(const frame of Object.values(targets)){gl.deleteFramebuffer(frame.buffer);gl.deleteTexture(frame.texture);}for(const p of Object.values(programs))gl.deleteProgram(p.program);Object.keys(targets).forEach(key=>delete targets[key]);Object.keys(programs).forEach(key=>delete programs[key]);}
  };
 }
 root.TetraStudioFX={PRESET_NAMES:Object.keys(PRESETS),applyPreset,presetName,evaluateLook,identity,timeInvariant,waveEV,foldUV,prismOffset,mirror,srgbToLinear,linearToSrgb,createCompositor};
 if(typeof module!=='undefined')module.exports=root.TetraStudioFX;
})(globalThis);
