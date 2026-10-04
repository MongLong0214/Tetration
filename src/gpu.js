/* WebGL2 is an interactive, finite-precision preview, not a numerical proof. */
(function(root){
 'use strict';
 const vertex = `#version 300 es
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
 const fragment = `#version 300 es
 precision highp float;
 uniform vec2 uSize,uCenter;
 uniform float uSpan;
 uniform int uIterations,uPalette;
 out vec4 pixel;
 vec3 palette(int kind,float steps){
  float value;
  if(uPalette==2)value=kind==3?238.:kind==4?96.:8.;
  else{
   value=kind==3?48.+184.*(.5-.5*cos(log2(max(steps,1.)+1.)*1.76)):kind==1?18.:kind==2?32.:kind==4?86.:6.;
   if(uPalette==1)value=255.-value;
  }
  return vec3(value/255.);
 }
 void main(){
  vec2 c=uCenter+(gl_FragCoord.xy-uSize*.5)*(uSpan/uSize.x);
  float radius=length(c);int kind=0;float steps=float(uIterations);
  if(radius<1e-30){pixel=vec4(palette(4,0.),1.);return;}
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
  pixel=vec4(palette(kind,steps),1.);
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
   this.program=p;this.u={};for(const n of ['Size','Center','Span','Iterations','Palette'])this.u[n]=gl.getUniformLocation(p,'u'+n);
   this.bits=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT)?.precision||0;
   if(this.bits<20){gl.deleteProgram(p);throw Error('Insufficient fragment precision');}
  }
  render(view,width,height,iterations,palette){
   const gl=this.gl,c=this.canvas;if(gl.isContextLost())throw Error('GPU context lost');
   if(c.width!==width||c.height!==height){c.width=width;c.height=height;}
   gl.viewport(0,0,width,height);gl.useProgram(this.program);
   gl.uniform2f(this.u.Size,width,height);gl.uniform2f(this.u.Center,Number(view.x),Number(view.y));gl.uniform1f(this.u.Span,Number(view.span));gl.uniform1i(this.u.Iterations,iterations);gl.uniform1i(this.u.Palette,palette);gl.drawArrays(gl.TRIANGLES,0,3);
  }
 }
 root.TetraGPU=TetraGPU;
})(globalThis);
