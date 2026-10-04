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
  if(uPalette==2)return kind==3?vec3(232,235,226)/255.:kind==4?vec3(95,90,98)/255.:vec3(9,14,17)/255.;
  if(kind!=3){
   if(uPalette==0){
    if(kind==1)return vec3(21,44,43)/255.;if(kind==2)return vec3(27,36,49)/255.;if(kind==4)return vec3(78,52,68)/255.;return vec3(8,15,18)/255.;
   }
   if(kind==1)return vec3(19,33,64)/255.;if(kind==2)return vec3(39,24,57)/255.;if(kind==4)return vec3(92,56,96)/255.;return vec3(9,12,23)/255.;
  }
  float pos=fract(log2(max(steps,1.)+1.)*.28)*6.;int i=int(floor(pos));float k=fract(pos);
  vec3 a,b;
  if(uPalette==0){
   if(i==0){a=vec3(9,24,31);b=vec3(39,79,89);}else if(i==1){a=vec3(39,79,89);b=vec3(81,130,132);}else if(i==2){a=vec3(81,130,132);b=vec3(213,204,167);}else if(i==3){a=vec3(213,204,167);b=vec3(234,142,82);}else if(i==4){a=vec3(234,142,82);b=vec3(110,60,59);}else{a=vec3(110,60,59);b=vec3(30,32,46);}
  }else{
   if(i==0){a=vec3(13,16,44);b=vec3(34,63,147);}else if(i==1){a=vec3(34,63,147);b=vec3(69,151,199);}else if(i==2){a=vec3(69,151,199);b=vec3(191,223,226);}else if(i==3){a=vec3(191,223,226);b=vec3(192,122,205);}else if(i==4){a=vec3(192,122,205);b=vec3(89,48,139);}else{a=vec3(89,48,139);b=vec3(16,20,58);}
  }
  return mix(a,b,k)/255.;
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
   if(!gl)throw Error('WebGL2를 사용할 수 없어 CPU로 계산합니다.');
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
