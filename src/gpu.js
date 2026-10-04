/* WebGL2 is an interactive, finite-precision preview, not a numerical proof. */
(function(root){
 'use strict';
 const vertex = `#version 300 es
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
 const fragment = `#version 300 es
 precision highp float;
 uniform vec2 uSize,uCenter,uOffset;
 uniform float uSpan;
 uniform int uIterations,uPalette,uSamples,uAdaptive;
 uniform sampler2D uSource;
 out vec4 pixel;
 ${TetraCore.paletteGLSL}
 vec3 orbitColor(vec2 point){
  vec2 c=uCenter+(point-uSize*.5)*(uSpan/uSize.x);
  float radius=length(c);int kind=0;float steps=float(uIterations);
  if(radius<1e-30){return palette(4,0.,vec2(0.));}
  vec2 l=vec2(log(radius),c.y==0.&&c.x<0.?3.141592653589793:atan(c.y,c.x));
  vec2 w=vec2(1.,0.),old=vec2(0.);int fixedCount=0,periodCount=0;
  for(int i=1;i<=1024;i++){
   if(i>uIterations)break;
   float a=w.x*l.x-w.y*l.y,b=w.x*l.y+w.y*l.x;
   if(isnan(a)||isnan(b)||isinf(a)||isinf(b)){kind=4;steps=float(i);break;}
   if(a>23.02585092994){kind=3;steps=float(i)+min(1.,(a-23.02585092994)/23.02585092994);break;}
   if(a< -80.||abs(b)>1e6){kind=4;steps=float(i);break;}
   float r=exp(a);vec2 next=r*vec2(cos(b),sin(b));float tol=2e-6*(1.+r);
   fixedCount=length(next-w)<tol?fixedCount+1:0;
   periodCount=i>2&&length(next-old)<tol?periodCount+1:0;
   old=w;w=next;
   if(fixedCount>=8){kind=1;steps=float(i);break;}
   if(periodCount>=12){kind=2;steps=float(i);break;}
  }
  return palette(kind,steps,w);
 }
 void main(){
  vec2 point=gl_FragCoord.xy+uOffset;
  if(uSamples==4&&uAdaptive==1){
   ivec2 p=ivec2(gl_FragCoord.xy),size=textureSize(uSource,0);vec3 center=texelFetch(uSource,p,0).rgb;float contrast=0.;
   for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 delta=abs(center-texelFetch(uSource,clamp(p+ivec2(x,y),ivec2(0),size-1),0).rgb);contrast=max(contrast,max(delta.r,max(delta.g,delta.b)));}
   if(contrast<.035){pixel=vec4(center,1.);return;}
  }
  vec3 rgb;
  if(uSamples==4)rgb=(orbitColor(point+vec2(-.25,-.25))+orbitColor(point+vec2(.25,-.25))+orbitColor(point+vec2(-.25,.25))+orbitColor(point+vec2(.25,.25)))*.25;
  else rgb=orbitColor(point);
  pixel=vec4(rgb,1.);
 }`;
 class TetraGPU {
  constructor(canvas){
   const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
   if(!gl)throw Error('WebGL2 unavailable; using CPU.');
   this.gl=gl;this.canvas=canvas;this.kind='webgl2';
   const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const m=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(m);}return s;};
   const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),p=gl.createProgram();
   gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
   if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error(message);}
   this.program=p;this.u={};for(const n of ['Size','Center','Span','Iterations','Palette','Offset','Samples','Adaptive','Source'])this.u[n]=gl.getUniformLocation(p,'u'+n);
   this.empty=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.empty);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
   this.bits=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision||0;
   if(this.bits<20){gl.deleteProgram(p);throw Error('Insufficient fragment precision');}
  }
  async render(view,width,height,iterations,palette,capture=true,options={}){
   const gl=this.gl,c=this.canvas;if(gl.isContextLost())throw Error('GPU context lost');
   if(c.width!==width||c.height!==height){c.width=width;c.height=height;}
   gl.viewport(0,0,width,height);gl.useProgram(this.program);
   gl.uniform2f(this.u.Size,...(options.size||[width,height]));gl.uniform2f(this.u.Offset,...(options.offset||[0,0]));
   gl.uniform2f(this.u.Center,Number(view.x),Number(view.y));gl.uniform1f(this.u.Span,Number(view.span));gl.uniform1i(this.u.Iterations,iterations);gl.uniform1i(this.u.Palette,palette);gl.uniform1i(this.u.Samples,options.samples||1);gl.uniform1i(this.u.Adaptive,0);gl.bindTexture(gl.TEXTURE_2D,this.empty);gl.drawArrays(gl.TRIANGLES,0,3);
   if(!capture)return;
   const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
   try{await new Promise((resolve,reject)=>{const poll=()=>{
    if(gl.isContextLost()){reject(Error('GPU context lost'));return;}
    const status=gl.clientWaitSync(sync,0,0);
    if(status===gl.WAIT_FAILED)reject(Error('GPU fence failed'));
    else if(status===gl.TIMEOUT_EXPIRED)setTimeout(poll,0);else resolve();
   };poll();});}finally{gl.deleteSync(sync);}
   if(typeof createImageBitmap==='function')return createImageBitmap(c);
   const copy=document.createElement('canvas');copy.width=width;copy.height=height;copy.getContext('2d').drawImage(c,0,0);return copy;
  }
  beginFrame(width,height,seed=null,adaptive=false){
   const gl=this.gl,texture=gl.createTexture(),buffer=gl.createFramebuffer();
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);
   gl.bindFramebuffer(gl.FRAMEBUFFER,buffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('GPU image allocation failed');
   if(seed){gl.bindFramebuffer(gl.READ_FRAMEBUFFER,seed.buffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,buffer);gl.blitFramebuffer(0,0,seed.width,seed.height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.LINEAR);}
   return {width,height,texture,buffer,seed:adaptive?seed:null};
  }
  async paintTile(frame,tile,view,iterations,palette,samples){
   const gl=this.gl;if(gl.isContextLost())throw Error('GPU context lost');
   gl.bindFramebuffer(gl.FRAMEBUFFER,frame.buffer);gl.viewport(0,0,frame.width,frame.height);gl.useProgram(this.program);
   gl.uniform2f(this.u.Size,frame.width,frame.height);gl.uniform2f(this.u.Offset,0,0);gl.uniform2f(this.u.Center,Number(view.x),Number(view.y));gl.uniform1f(this.u.Span,Number(view.span));gl.uniform1i(this.u.Iterations,iterations);gl.uniform1i(this.u.Palette,palette);gl.uniform1i(this.u.Samples,samples);gl.uniform1i(this.u.Adaptive,frame.seed?1:0);gl.uniform1i(this.u.Source,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,frame.seed?.texture||this.empty);
   gl.enable(gl.SCISSOR_TEST);gl.scissor(tile.x,frame.height-tile.y-tile.height,tile.width,tile.height);gl.drawArrays(gl.TRIANGLES,0,3);gl.disable(gl.SCISSOR_TEST);
   const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
   try{await new Promise((resolve,reject)=>{const poll=()=>{if(gl.isContextLost()){reject(Error('GPU context lost'));return;}const status=gl.clientWaitSync(sync,0,0);if(status===gl.WAIT_FAILED)reject(Error('GPU fence failed'));else if(status===gl.TIMEOUT_EXPIRED)setTimeout(poll,0);else resolve();};poll();});}finally{gl.deleteSync(sync);}
  }
  presentFrame(frame){
   const gl=this.gl,c=this.canvas;if(c.width!==frame.width||c.height!==frame.height){c.width=frame.width;c.height=frame.height;}
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,frame.buffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
   gl.blitFramebuffer(0,0,frame.width,frame.height,0,0,frame.width,frame.height,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  capture(frame){
   this.presentFrame(frame);
   if(typeof createImageBitmap==='function')return createImageBitmap(this.canvas);
   const copy=document.createElement('canvas');copy.width=frame.width;copy.height=frame.height;copy.getContext('2d').drawImage(this.canvas,0,0);return Promise.resolve(copy);
  }
  releaseFrame(frame){if(!frame)return;this.gl.deleteFramebuffer(frame.buffer);this.gl.deleteTexture(frame.texture);}

 }
 TetraGPU.sources={vertex,fragment};
 root.TetraGPU=TetraGPU;
})(globalThis);
