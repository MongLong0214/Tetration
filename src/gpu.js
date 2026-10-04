/* WebGL2 renderer: a direct FP32 orbit for shallow views and FP32 perturbation from
 * an exact reference orbit for deep views. Both are finite observations, not proofs. */
(function (root) {
  'use strict';
  const vertex = `#version 300 es
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;

  // Shared by both programs: sampling, adaptive edge pass and palette.
  const header = `#version 300 es
 precision highp float;
 precision highp int;
 precision highp sampler2D;
 uniform vec2 uSize,uOffset;
 uniform int uIterations,uPalette,uSamples,uAdaptive;
 uniform float uLowA,uMaxB,uTol,uThreshold;
 uniform sampler2D uSource;
 out vec4 pixel;
 const float LOG_R=23.025850929940457;
 ${TetraCore.paletteGLSL}`;

  // Rotated-grid and stratified sample offsets in pixels.
  const footer = `
 const vec2 RG[4]=vec2[4](vec2(-.125,-.375),vec2(.375,-.125),vec2(.125,.375),vec2(-.375,.125));
 void main(){
  vec2 point=gl_FragCoord.xy+uOffset;
  if(uAdaptive==1){
   ivec2 p=ivec2(gl_FragCoord.xy),size=textureSize(uSource,0);vec3 center=texelFetch(uSource,p,0).rgb;float contrast=0.;
   for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 delta=abs(center-texelFetch(uSource,clamp(p+ivec2(x,y),ivec2(0),size-1),0).rgb);contrast=max(contrast,max(delta.r,max(delta.g,delta.b)));}
   if(contrast<uThreshold){pixel=vec4(center,1.);return;}
  }
  vec3 rgb=vec3(0.);
  if(uSamples==16){for(int j=0;j<4;j++)for(int i=0;i<4;i++)rgb+=orbitColor(point+(vec2(float(i),float(j))+.5)*.25-.5);rgb*=.0625;}
  else if(uSamples==4){for(int i=0;i<4;i++)rgb+=orbitColor(point+RG[i]);rgb*=.25;}
  else rgb=orbitColor(point);
  pixel=vec4(rgb,1.);
 }`;

  const direct = header + `
 uniform vec2 uCenter;
 uniform float uSpan;
 vec3 orbitColor(vec2 point){
  vec2 c=uCenter+(point-uSize*.5)*(uSpan/uSize.x);
  float radius=length(c);int kind=0;float steps=float(uIterations);
  if(radius<1e-30){return palette(4,0.,vec2(0.));}
  vec2 l=vec2(log(radius),c.y==0.&&c.x<0.?3.141592653589793:atan(c.y,c.x));
  vec2 w=vec2(1.,0.),old=vec2(0.);int fixedCount=0,periodCount=0;
  for(int i=1;i<=uIterations;i++){
   float a=w.x*l.x-w.y*l.y,b=w.x*l.y+w.y*l.x;
   if(isnan(a)||isnan(b)||isinf(a)||isinf(b)){kind=4;steps=float(i);break;}
   if(a>LOG_R){kind=3;steps=float(i)+min(1.,(a-LOG_R)/LOG_R);break;}
   if(a<uLowA||abs(b)>uMaxB){kind=4;steps=float(i);break;}
   float r=exp(a);vec2 next=r*vec2(cos(b),sin(b));float tol=uTol*(1.+r);
   fixedCount=length(next-w)<tol?fixedCount+1:0;
   periodCount=i>2&&length(next-old)<tol?periodCount+1:0;
   old=w;w=next;
   if(fixedCount>=8){kind=1;steps=float(i);break;}
   if(periodCount>=12){kind=2;steps=float(i);break;}
  }
  return palette(kind,steps,w);
 }` + footer;

  /* Perturbation: each sample is c = c0 + dc with dc = 2^uScale * (offset + q * spanMant).
   * Offsets d = w - V are stored as a mantissa vec2 and an integer exponent, so
   * spans far below the FP32 range keep full relative precision. Small arguments
   * use series instead of GPU builtins; the full value always comes from exp(eps). */
  const perturbHead = header + `
 uniform highp sampler2D uRef,uBla;
 uniform int uRefLength,uRefValues,uScale,uInvExp,uBlaLevels;
 uniform int uBlaBase[16];
 uniform vec2 uL0,uInv,uDelta,uDeltaMirror;
 uniform float uImCenter,uSpanMant;
 float pow2(int e){if(e<-126)return 0.;return intBitsToFloat((min(e,127)+127)<<23);}
 int expOf(vec2 v){float m=max(abs(v.x),abs(v.y));if(m==0.)return -1000;return ((floatBitsToInt(m)>>23)&255)-127;}
 vec2 scaled(vec2 m,int e){return m*pow2(e>>1)*pow2(e-(e>>1));}
 void normalizeExp(inout vec2 m,inout int e){int k=expOf(m);if(k==-1000){m=vec2(0.);e=-1000;return;}m=scaled(m,-k);e+=k;}
 vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
 vec4 refAt(int k){return texelFetch(uRef,ivec2(k&1023,k>>10),0);}
 // BLA entry e: texel 0 = (A, B) mantissas, texel 1 = (A exponent, B exponent, log2 radius).
 vec4 blaAt(int e,int t){return texelFetch(uBla,ivec2(((e&511)<<1)+t,e>>9),0);}
 float expm1s(float x){if(abs(x)<.5)return x*(1.+x*(.5+x*(1./6.+x*(1./24.+x*(1./120.+x*(1./720.+x*(1./5040.+x*(1./40320.)))))))) ;return exp(x)-1.;}
 void sincosh(float x,out float s,out float c,out float h){
  if(abs(x)<.5){float x2=x*x,y=.5*x,y2=y*y;
   s=x*(1.-x2*(1./6.-x2*(1./120.-x2*(1./5040.-x2*(1./362880.)))));
   c=1.-x2*(.5-x2*(1./24.-x2*(1./720.-x2*(1./40320.))));
   h=y*(1.-y2*(1./6.-y2*(1./120.-y2*(1./5040.))));}
  else{s=sin(x);c=cos(x);h=sin(.5*x);}
 }
 float log1ps(float v){if(abs(v)<.25){float t=v/(2.+v),t2=t*t;return 2.*t*(1.+t2*(1./3.+t2*(1./5.+t2*(1./7.+t2*(1./9.+t2*(1./11.))))));}return log(1.+v);}
 float atan2s(float y,float x){
  if(x>0.&&abs(y)<.1*x){float t=y/x,t2=t*t;return t*(1.-t2*(1./3.-t2*(1./5.-t2*(1./7.-t2*(1./9.)))));}
  if(y==0.&&x<0.)return 3.141592653589793;
  return atan(y,x);
 }
 vec3 orbitColor(vec2 point){
  vec2 q=(point-uSize*.5)/uSize.x;
  bool mirrored=uImCenter+q.y*uSpanMant<0.;
  vec2 dc=mirrored?uDeltaMirror+vec2(q.x,-q.y)*uSpanMant:uDelta+q*uSpanMant;
  // x = dc * 2^uScale / c0 as mantissa and exponent; dL = log1p(x).
  vec2 xm=cmul(dc,uInv),dLm=vec2(0.);int xe=uScale+uInvExp,dLe=-1000;
  if(expOf(xm)!=-1000){
   normalizeExp(xm,xe);
   if(xe<-12){vec2 xu=scaled(xm,max(xe,-200));dLm=cmul(xm,vec2(1.,0.)-.5*xu+cmul(xu,xu)*(1./3.));dLe=xe;normalizeExp(dLm,dLe);}
   else{vec2 xu=scaled(xm,min(xe,120));dLm=vec2(.5*log1ps(2.*xu.x+xu.x*xu.x+xu.y*xu.y),atan2s(xu.y,1.+xu.x));dLe=0;
    if(isinf(dLm.x)||isnan(dLm.x)||isnan(dLm.y))return palette(4,0.,vec2(0.));normalizeExp(dLm,dLe);}
  }
  vec2 L=uL0+scaled(dLm,max(dLe,-200));
  int k=1,de=-1000,kind=0,fixedCount=0,periodCount=0;vec2 dm=vec2(0.),w=vec2(1.,0.),old=vec2(0.);float steps=float(uIterations);
  vec4 cur=refAt(1);`;
  // One perturbation step as iteration i; every `break` ends the orbit with its class.
  const perturbStep = `
   if(k>=uRefLength){dm=w;de=0;normalizeExp(dm,de);k=0;cur=vec4(0.,0.,LOG_R,0.);}
   vec2 V=cur.xy,t1=cmul(V,dLm),t2=cmul(dm,L);
   int E=max(expOf(t1)+dLe,expOf(t2)+de);
   vec2 em=scaled(t1,max(dLe-E,-200))+scaled(t2,max(de-E,-200));
   int Ee=expOf(em)+E;
   float unit=pow2(clamp(E,-200,100)),reEps=em.x*unit,imEps=em.y*unit;
   if(reEps>cur.z){kind=3;steps=float(i)+min(1.,(reEps-cur.z)/LOG_R);break;}
   float a=cur.w+reEps,b=uL0.x*V.y+uL0.y*V.x+imEps;
   if(isnan(a)||isnan(b)||isinf(a)||isinf(b)||a<uLowA||abs(b)>uMaxB){kind=4;steps=float(i);break;}
   vec2 next;
   if(k+1>=uRefValues){
    next=exp(a)*vec2(cos(b),sin(b));dm=next;de=0;normalizeExp(dm,de);k=0;cur=vec4(0.,0.,LOG_R,0.);
   }else{
    vec4 nx=refAt(k+1);vec2 Vn=nx.xy;
    if(Ee<-12){
     vec2 eu=em*unit,f=vec2(1.,0.)+.5*eu+cmul(eu,eu)*(1./6.);
     dm=cmul(Vn,cmul(em,f));de=E;normalizeExp(dm,de);
     next=Vn+scaled(dm,max(de,-200));k++;cur=nx;
    }else{
     float s,c,h;sincosh(imEps,s,c,h);float hx=exp(.5*reEps);
     next=cmul(Vn*hx,vec2(c,s))*hx;
     if(reEps>40.){dm=next;de=0;normalizeExp(dm,de);k=0;cur=vec4(0.,0.,LOG_R,0.);}
     else{dm=cmul(Vn,vec2(expm1s(reEps)*c-2.*h*h,hx*hx*s));de=0;normalizeExp(dm,de);k++;cur=nx;}
    }
   }
   float r=length(next),tol=uTol*(1.+r);
   fixedCount=length(next-w)<tol?fixedCount+1:0;
   periodCount=i>2&&length(next-old)<tol?periodCount+1:0;
   old=w;w=next;
   if(fixedCount>=8){kind=1;steps=float(i);break;}
   if(periodCount>=12){kind=2;steps=float(i);break;}
   if(k>0&&de>-126&&de<120){vec2 ws=scaled(w,-de);if(dot(ws,ws)<dot(dm,dm)){dm=w;de=0;normalizeExp(dm,de);k=0;cur=vec4(0.,0.,LOG_R,0.);}}`;
  const perturbTail = `
  if(mirrored)w.y=-w.y;
  return palette(kind,steps,w);
 }` + footer;
  const perturb = perturbHead + `
  for(int i=1;i<=uIterations;i++){${perturbStep}
  }` + perturbTail;
  /* The same orbit with bilinear approximation (TetraCore.blaTable): while d is tiny
   * the pixel follows the reference, so aligned runs of 2^j linear steps are applied
   * at once as d = A d + B dL. The approach loop ends when |d| outgrows the shortest
   * run, at the first rebase, or with the orbit; the plain loop does the rest. A
   * separate program, because extra loop code slows the plain loop on some drivers. */
  const perturbBla = perturbHead + `
  int i=1;bool done=false,linear=true;
  while(linear&&i<=uIterations){
   if(k>1&&(k&1)==0&&fixedCount==0&&periodCount==0){
    float ld=expOf(dm)==-1000?-1e30:float(de)+log2(length(dm));
    int j=1,skip=0;
    while(j<uBlaLevels&&(k&((2<<j)-1))==0)j++;
    for(;j>=1;j--){
     int len=1<<j;
     if(i+len-1>uIterations)continue;
     int e=uBlaBase[j]+(k>>j);vec4 s=blaAt(e,1);
     if(s.z>-1e29&&ld<s.z){
      vec4 c=blaAt(e,0);int ae=int(s.x)+de,be=int(s.y)+dLe,E=max(ae,be);
      dm=scaled(cmul(c.xy,dm),max(ae-E,-200))+scaled(cmul(c.zw,dLm),max(be-E,-200));de=E;normalizeExp(dm,de);
      skip=len;break;
     }
     if(j==1&&s.z>-1e29)linear=false;
    }
    // Inside a run |d| <= 2^-24 |V|, so V + d is exact enough for the next tests.
    if(skip>0){k+=skip;i+=skip;cur=refAt(k);old=refAt(k-1).xy;w=cur.xy+scaled(dm,clamp(de,-200,120));continue;}
   }${perturbStep.replace(/break;/g, 'done=true;break;')}
   i++;
   if(k==0)break;
  }
  if(!done)for(;i<=uIterations;i++){${perturbStep}
  }` + perturbTail;

  // Macrotask hop without timer clamping, so short GPU work is noticed promptly.
  // Created on first use: an idle open port would keep Node test processes alive.
  let channel = null;
  const queue = [];
  function nextTask(task) {
    if (!channel && typeof MessageChannel === 'function') {
      channel = new MessageChannel();
      channel.port1.onmessage = () => { const next = queue.shift(); if (next) next(); };
    }
    if (!channel) { setTimeout(task, 0); return; }
    queue.push(task); channel.port2.postMessage(0);
  }

  const COMMON = ['Size', 'Offset', 'Iterations', 'Palette', 'Samples', 'Adaptive', 'Source', 'LowA', 'MaxB', 'Tol', 'Threshold'];
  const UNIFORMS = {
    direct: [...COMMON, 'Center', 'Span'],
    perturb: [...COMMON, 'Ref', 'RefLength', 'RefValues', 'Scale', 'InvExp', 'L0', 'Inv', 'Delta', 'DeltaMirror', 'ImCenter', 'SpanMant'],
  };
  UNIFORMS.perturbBla = [...UNIFORMS.perturb, 'Bla', 'BlaLevels', 'BlaBase'];
  const SOURCES = {direct, perturb, perturbBla};

  class TetraGPU {
    constructor(canvas) {
      // preserveDrawingBuffer keeps the last presented image on screen while tiles draw into offscreen frames.
      const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
      if (!gl) throw Error('WebGL2 unavailable; using CPU.');
      this.gl = gl; this.canvas = canvas; this.kind = 'webgl2';
      this.bits = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision || 0;
      if (this.bits < 23) throw Error('Insufficient fragment precision');
      this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      // The BLA program links on first use (deep views only).
      this.programs = {direct: this.link(direct, UNIFORMS.direct), perturb: this.link(perturb, UNIFORMS.perturb)};
      this.empty = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.empty);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      this.setNearest();
      this.pool = []; this.reference = null; this.referenceTexture = null; this.live = 0;
      // blaMode: 'auto' uses BLA where it saves enough steps, 'on' wherever a table exists, 'off' never.
      this.bla = null; this.blaTexture = null; this.blaMode = 'auto';
    }
    link(fragmentSource, names) {
      const gl = this.gl;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw Error(message || 'Shader compilation failed');
        }
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragmentSource), program = gl.createProgram();
      gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw Error(message || 'Shader link failed');
      }
      const uniforms = {};
      for (const name of names) uniforms[name] = gl.getUniformLocation(program, 'u' + name);
      return {program, uniforms};
    }
    setNearest() {
      const gl = this.gl;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    lost() { return this.gl.isContextLost(); }
    // Upload a reference orbit as RGBA32F texels (V.re, V.im, T, Re A), 1024 per row.
    useReference(ref) {
      if (this.reference === ref) return;
      const gl = this.gl, rows = Math.ceil(ref.values / 1024), data = new Float32Array(rows * 1024 * 4);
      for (let k = 0; k < ref.values; k++) {
        data[4 * k] = ref.V[2 * k]; data[4 * k + 1] = ref.V[2 * k + 1];
        if (k < ref.length) { data[4 * k + 2] = ref.T[k]; data[4 * k + 3] = ref.ReA[k]; }
      }
      if (!this.referenceTexture) this.referenceTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.referenceTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, rows, 0, gl.RGBA, gl.FLOAT, data);
      this.setNearest(); gl.activeTexture(gl.TEXTURE0);
      this.reference = ref;
    }
    program(name) {
      return this.programs[name] || (this.programs[name] = this.link(SOURCES[name], UNIFORMS[name]));
    }
    // The BLA program, linked on demand; a driver that rejects it keeps the plain program.
    blaProgram() {
      if (this.blaMode === 'off') return null;
      try { return this.program('perturbBla'); } catch { this.blaMode = 'off'; return null; }
    }
    // Compile the BLA program while idle (one 1x1 draw also triggers lazy driver compilation),
    // so the first deep view does not wait for it.
    warm() {
      if (this.programs.perturbBla || this.lost()) return;
      const bla = this.blaProgram();
      if (!bla) return;
      const gl = this.gl, frame = this.beginFrame(1, 1), u = bla.uniforms;
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame.buffer); gl.viewport(0, 0, 1, 1); gl.useProgram(bla.program);
      gl.uniform2f(u.Size, 1, 1); gl.uniform1i(u.Iterations, 0); gl.uniform1i(u.Samples, 1); gl.uniform1i(u.Adaptive, 0);
      for (const [unit, name] of [[0, 'Source'], [1, 'Ref'], [2, 'Bla']]) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.empty); gl.uniform1i(u[name], unit); }
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.releaseFrame(frame);
    }
    /* BLA table for a reference and the view's largest |dL| (TetraCore.blaTable),
     * as RGBA32F floatexp texels. A table built for a larger |dL| stays valid, so it
     * is rebuilt only when the view grows past it or shrinks 64-fold. */
    useBla(ref, rules, dL) {
      const cached = this.bla;
      if (cached && cached.ref === ref && cached.rules === rules && dL <= cached.dL && dL * 64 >= cached.dL) return cached;
      const bound = 2 ** Math.ceil(Math.log2(Math.max(dL, 1e-300)));
      const table = TetraCore.blaTable(ref, bound, rules, TetraCore.BLA_EPS.gpu);
      this.bla = {ref, rules, dL: bound, levels: 0, reach: 0, base: null};
      if (!table) return this.bla;
      // Lookups can reach one entry past the table; every unused slot reads as radius 0.
      const gl = this.gl, source = table.data, entries = source.length / 5, rows = Math.ceil((entries + 1) / 512), data = new Float32Array(rows * 1024 * 4);
      for (let o = 6; o < data.length; o += 8) data[o] = -1e30;
      // Mantissa with its largest component in [1, 2) and a power-of-two exponent.
      const split = (re, im, at) => {
        const m = Math.max(Math.abs(re), Math.abs(im));
        if (!(m > 0)) return 0;
        const e = Math.floor(Math.log2(m)), half = Math.trunc(-e / 2), f = 2 ** half * 2 ** (-e - half);
        data[at] = re * f; data[at + 1] = im * f;
        return e;
      };
      for (let e = 0; e < entries; e++) {
        const s = 5 * e, o = 8 * e, R = source[s + 4];
        if (!(R > 0)) continue;
        data[o + 4] = split(source[s], source[s + 1], o);
        data[o + 5] = split(source[s + 2], source[s + 3], o + 2);
        data[o + 6] = Math.log2(R);
      }
      if (!this.blaTexture) this.blaTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.blaTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, rows, 0, gl.RGBA, gl.FLOAT, data);
      this.setNearest(); gl.activeTexture(gl.TEXTURE0);
      Object.assign(this.bla, {levels: table.levels, reach: TetraCore.blaReach(table, ref), base: Int32Array.from({length: 16}, (_, j) => table.base[j] || 0)});
      return this.bla;
    }
    // Expected plain steps per pixel, for sizing draws: BLA skips most of a deep approach.
    effectiveIterations(scene, width, height) {
      if (scene.mode !== 'perturb' || !this.blaLevels({width, height}, scene)) return scene.iterations;
      return Math.max(64, Math.round(scene.iterations - 0.75 * Math.min(this.bla.reach, scene.iterations)));
    }
    // BLA levels to use for a perturbation draw into this frame (0 = plain program).
    blaLevels(frame, scene) {
      if (this.blaMode === 'off') return 0;
      // Largest |dL| over the frame, half a pixel beyond its edges for subpixel samples.
      const pad = 1 / frame.width, offset = TetraCore.offsetBound(scene.delta[0], scene.delta[1], scene.deltaMirror[1], scene.imCenter,
        scene.spanMant * (0.5 + pad), scene.spanMant * (0.5 * frame.height / frame.width + pad));
      const dL = TetraCore.logOffsetBound(offset * Math.hypot(scene.inv[0], scene.inv[1]) * 2 ** (scene.scale + scene.invExp));
      if (!(dL < Infinity)) return 0;
      const bla = this.useBla(scene.ref, scene.rules, dL);
      // Worth the larger program only when the edge pixel alone skips a quarter of a typical orbit.
      if (!bla.levels || (this.blaMode === 'auto' && bla.reach < Math.max(32, 0.25 * Math.min(scene.ref.length, scene.iterations)))) return 0;
      return this.blaProgram() ? bla.levels : 0;
    }
    beginFrame(width, height, seed = null, adaptive = false) {
      const gl = this.gl;
      if (width > this.maxTexture || height > this.maxTexture) throw Error('GPU image limit');
      let frame = null;
      const index = this.pool.findIndex(item => item.width === width && item.height === height);
      if (index >= 0) frame = this.pool.splice(index, 1)[0];
      else {
        const texture = gl.createTexture(), buffer = gl.createFramebuffer();
        gl.bindTexture(gl.TEXTURE_2D, texture); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height); this.setNearest();
        gl.bindFramebuffer(gl.FRAMEBUFFER, buffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          gl.deleteFramebuffer(buffer); gl.deleteTexture(texture); throw Error('GPU image allocation failed');
        }
        frame = {width, height, texture, buffer};
        this.live++;
      }
      frame.seed = adaptive ? seed : null;
      if (seed) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, seed.buffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, frame.buffer);
        gl.blitFramebuffer(0, 0, seed.width, seed.height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, seed.width === width && seed.height === height ? gl.NEAREST : gl.LINEAR);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, frame.buffer); gl.clearColor(0.024, 0.024, 0.024, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return frame;
    }
    // Issue one scissored draw into the frame. Returns immediately; use fence() to wait.
    draw(frame, tile, scene, samples, threshold = 0.035) {
      this.prepare(frame, scene, samples, threshold);
      this.drawTile(frame, tile);
    }
    // Bind a frame and set every uniform once; drawTile() then only moves the scissor.
    prepare(frame, scene, samples, threshold = 0.035) {
      const gl = this.gl;
      if (gl.isContextLost()) throw Error('GPU context lost');
      const levels = scene.mode === 'perturb' ? this.blaLevels(frame, scene) : 0;
      const {program, uniforms: u} = this.program(levels ? 'perturbBla' : scene.mode);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame.buffer); gl.viewport(0, 0, frame.width, frame.height); gl.useProgram(program);
      gl.uniform2f(u.Size, frame.width, frame.height); gl.uniform2f(u.Offset, 0, 0);
      gl.uniform1i(u.Iterations, scene.iterations); gl.uniform1i(u.Palette, scene.palette);
      gl.uniform1i(u.Samples, samples); gl.uniform1i(u.Adaptive, frame.seed ? 1 : 0); gl.uniform1f(u.Threshold, threshold);
      gl.uniform1f(u.LowA, scene.rules.lowA); gl.uniform1f(u.MaxB, scene.rules.maxB); gl.uniform1f(u.Tol, scene.rules.tol);
      gl.uniform1i(u.Source, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frame.seed ? frame.seed.texture : this.empty);
      if (scene.mode === 'direct') {
        gl.uniform2f(u.Center, scene.center[0], scene.center[1]); gl.uniform1f(u.Span, scene.span);
      } else {
        this.useReference(scene.ref);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.referenceTexture); gl.uniform1i(u.Ref, 1); gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(u.RefLength, scene.ref.length); gl.uniform1i(u.RefValues, scene.ref.values);
        gl.uniform1i(u.Scale, scene.scale); gl.uniform1i(u.InvExp, scene.invExp);
        gl.uniform2f(u.L0, scene.ref.L0[0], scene.ref.L0[1]); gl.uniform2f(u.Inv, scene.inv[0], scene.inv[1]);
        gl.uniform2f(u.Delta, scene.delta[0], scene.delta[1]); gl.uniform2f(u.DeltaMirror, scene.deltaMirror[0], scene.deltaMirror[1]);
        gl.uniform1f(u.ImCenter, scene.imCenter); gl.uniform1f(u.SpanMant, scene.spanMant);
        if (levels) {
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.blaTexture); gl.uniform1i(u.Bla, 2); gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(u.BlaLevels, levels); gl.uniform1iv(u.BlaBase, this.bla.base);
        }
      }
    }
    drawTile(frame, tile) {
      const gl = this.gl;
      gl.enable(gl.SCISSOR_TEST); gl.scissor(tile.x, frame.height - tile.y - tile.height, tile.width, tile.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.SCISSOR_TEST);
    }
    // Resolve once the GPU has finished all submitted work, without blocking the main thread.
    fence() {
      const gl = this.gl, sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      return new Promise((resolve, reject) => {
        let polls = 0;
        const poll = () => {
          if (gl.isContextLost()) { gl.deleteSync(sync); reject(Error('GPU context lost')); return; }
          const status = gl.clientWaitSync(sync, 0, 0);
          if (status === gl.WAIT_FAILED) { gl.deleteSync(sync); reject(Error('GPU fence failed')); return; }
          if (status === gl.TIMEOUT_EXPIRED) {
            // A few immediate task hops catch short draws; longer work polls at timer rate.
            polls++;
            if (polls < 6) nextTask(poll); else setTimeout(poll, 1);
            return;
          }
          gl.deleteSync(sync); resolve();
        };
        poll();
      });
    }
    presentFrame(frame) {
      const gl = this.gl, c = this.canvas;
      if (c.width !== frame.width || c.height !== frame.height) { c.width = frame.width; c.height = frame.height; }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, frame.buffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, frame.width, frame.height, 0, 0, frame.width, frame.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // Copy a frame into a 2D canvas (top row first) for export.
    capture(frame) {
      this.presentFrame(frame);
      if (typeof createImageBitmap === 'function') return createImageBitmap(this.canvas);
      const copy = document.createElement('canvas'); copy.width = frame.width; copy.height = frame.height;
      copy.getContext('2d').drawImage(this.canvas, 0, 0);
      return Promise.resolve(copy);
    }
    // Synchronous RGBA readback (bottom row first); used by tests and diagnostics.
    readFrame(frame, x = 0, y = 0, width = frame.width, height = frame.height) {
      const gl = this.gl, out = new Uint8Array(width * height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame.buffer); gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    }
    releaseFrame(frame) {
      if (!frame || this.gl.isContextLost() || this.pool.includes(frame)) return;
      frame.seed = null;
      this.pool.push(frame);
      while (this.pool.length > 3) {
        const old = this.pool.shift();
        this.gl.deleteFramebuffer(old.buffer); this.gl.deleteTexture(old.texture); this.live--;
      }
    }
    destroy() {
      const gl = this.gl;
      for (const frame of this.pool) { gl.deleteFramebuffer(frame.buffer); gl.deleteTexture(frame.texture); }
      this.pool = [];
      for (const {program} of Object.values(this.programs)) gl.deleteProgram(program);
      gl.deleteTexture(this.empty); if (this.referenceTexture) gl.deleteTexture(this.referenceTexture); if (this.blaTexture) gl.deleteTexture(this.blaTexture);
    }
  }
  TetraGPU.sources = {vertex, ...SOURCES};
  root.TetraGPU = TetraGPU;
})(globalThis);
