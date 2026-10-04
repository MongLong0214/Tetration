/* Finite numerical experiment: w0=1; w[n+1]=exp(w[n]*Log(z)).
 * Principal argument is (-pi, pi]. A threshold crossing is not a proof of
 * divergence; repeated closeness is not a proof of convergence/periodicity. */
(function (root) {
  'use strict';
  const STATUS = { UNRESOLVED: 0, FIXED: 1, PERIOD2: 2, THRESHOLD: 3, NUMERIC: 4 };
  function orbit64(cr, ci, iterations = 256, logR = Math.log(1e10)) {
    if (!Number.isFinite(cr + ci) || (cr === 0 && ci === 0)) return { kind: 4, steps: 0, re: NaN, im: NaN };
    const lr = Math.log(Math.hypot(cr, ci));
    const li = ci === 0 && cr < 0 ? Math.PI : Math.atan2(ci, cr);
    let wr = 1, wi = 0, oldr = NaN, oldi = NaN, fixed = 0, periodic = 0;
    for (let n = 1; n <= iterations; n++) {
      const a = wr * lr - wi * li, b = wr * li + wi * lr;
      if (!Number.isFinite(a + b)) return { kind: 4, steps: n, re: wr, im: wi };
      if (a > logR) return { kind: 3, steps: n + Math.min(1, (a - logR) / Math.max(logR, 1)), re: wr, im: wi };
      // Beyond this argument the numerical phase becomes too uncertain to label.
      if (a < -700 || Math.abs(b) > 1e12) return { kind: 4, steps: n, re: wr, im: wi };
      const r = Math.exp(a), nr = r * Math.cos(b), ni = r * Math.sin(b);
      const tolerance = 1e-10 * (1 + r);
      fixed = Math.hypot(nr - wr, ni - wi) < tolerance ? fixed + 1 : 0;
      periodic = n > 2 && Math.hypot(nr - oldr, ni - oldi) < tolerance ? periodic + 1 : 0;
      oldr = wr; oldi = wi; wr = nr; wi = ni;
      if (fixed >= 8) return { kind: 1, steps: n, re: wr, im: wi };
      if (periodic >= 12) return { kind: 2, steps: n, re: wr, im: wi };
    }
    return { kind: 0, steps: iterations, re: wr, im: wi };
  }
  function makePreciseOrbit(digits) {
    const f = root.createFixed(digits), { Q, mul, abs } = f;
    const logR = f.ln(10000000000n * Q);
    const epsilon = f.parse('1e-' + Math.min(32, digits - 16));
    return function (real, imaginary, iterations = 256) {
      let wr = Q, wi = 0n, oldr = 0n, oldi = 0n, fixed = 0, periodic = 0, step = 0;
      try {
        const cr = f.parse(real), ci = f.parse(imaginary);
        if (!cr && !ci) return { kind: 4, steps: 0 };
        // Avoid squaring tiny inputs at fixed precision: normalize by max norm.
        const scale = abs(cr) > abs(ci) ? abs(cr) : abs(ci);
        const xr = f.div(cr, scale), xi = f.div(ci, scale);
        const lr = f.ln(scale) + f.ln(mul(xr, xr) + mul(xi, xi)) / 2n;
        const li = f.atan2(ci, cr);
        for (let n = 1; n <= iterations; n++) {
          step = n;
          const a = mul(wr, lr) - mul(wi, li), b = mul(wr, li) + mul(wi, lr);
          if (a > logR) return { kind: 3, steps: n + Math.min(1, f.number(f.div(a - logR, logR))) };
          // Limit reduction cost; preserve the distinction from a threshold crossing.
          if (abs(b) > 1000000000000000n * Q) return { kind: 4, steps: n };
          const r = f.exp(a), [s, c] = f.sincos(b), nr = mul(r, c), ni = mul(r, s);
          const tolerance = mul(epsilon, Q + r);
          fixed = abs(nr - wr) + abs(ni - wi) < tolerance ? fixed + 1 : 0;
          periodic = n > 2 && abs(nr - oldr) + abs(ni - oldi) < tolerance ? periodic + 1 : 0;
          oldr = wr; oldi = wi; wr = nr; wi = ni;
          if (fixed >= 8) return { kind: 1, steps: n, re: f.text(wr), im: f.text(wi) };
          if (periodic >= 12) return { kind: 2, steps: n, re: f.text(wr), im: f.text(wi) };
        }
        return { kind: 0, steps: iterations, re: f.text(wr), im: f.text(wi) };
      } catch (error) {
        return { kind: 4, steps: step, reason: String(error.message) };
      }
    };
  }
  // Cyclic, smoothly interpolated palettes shared by the CPU and both shaders.
  const ramps = [
    [[10,8,35],[51,25,122],[138,38,197],[240,76,148],[255,172,104],[138,239,220],[42,154,211],[24,50,133]],
    [[24,5,27],[86,11,78],[189,35,103],[250,92,55],[255,203,116],[174,216,200],[67,96,165],[60,24,110]],
    [[3,13,32],[13,40,100],[18,90,185],[22,178,204],[157,235,202],[227,245,210],[101,148,209],[45,37,139]]
  ];
  function color(kind, steps, palette = 0, re = 0, im = 0) {
    if (palette === 3) {
      const v = Math.round(kind===3?48+184*(.5-.5*Math.cos(Math.log2(Math.max(steps,1)+1)*1.76)):[6,18,32,0,86][kind]);
      return [v,v,v];
    }
    if(kind===4)return [42,31,47];
    if(kind===0)return [10,9,24];
    let t,light=1;
    if(kind===3)t=Math.log2(Math.max(steps,1)+1)*.42+.08;
    else if(kind===2){t=.27;light=.22;}
    else{const magnitude=Math.min(Math.log2(1+Math.hypot(Number(re)||0,Number(im)||0)),3);t=.59+Math.atan2(Number(im)||0,Number(re)||0)/(2*Math.PI)*.5+magnitude*.12;light=.14+magnitude*.07;}
    const position=((t%1+1)%1)*8,index=Math.floor(position),f=position-index,k=f*f*(3-2*f),ramp=ramps[palette]||ramps[0];
    return ramp[index].map((v,c)=>Math.round((v+(ramp[(index+1)%8][c]-v)*k)*light));
  }
  const vectors=(dialect,p)=>ramps[p].map(v=>`${dialect}(${v.map(n=>n+'.').join(',')})`).join(',');
  const paletteGLSL=`
  vec3 ramp(float t){
    vec3 stops[8]=vec3[8](${vectors('vec3',0)});
    if(uPalette==1)stops=vec3[8](${vectors('vec3',1)});
    if(uPalette==2)stops=vec3[8](${vectors('vec3',2)});
    float p=fract(t)*8.;int i=int(floor(p));float k=fract(p);k=k*k*(3.-2.*k);
    return mix(stops[i],stops[(i+1)%8],k)/255.;
  }
  vec3 palette(int kind,float steps,vec2 w){
    if(uPalette==3){float v=kind==3?48.+184.*(.5-.5*cos(log2(max(steps,1.)+1.)*1.76)):kind==1?18.:kind==2?32.:kind==4?86.:6.;return vec3(v/255.);}
    if(kind==4)return vec3(42.,31.,47.)/255.;
    if(kind==0)return vec3(10.,9.,24.)/255.;
    if(kind==3)return ramp(log2(max(steps,1.)+1.)*.42+.08);
    if(kind==2)return ramp(.27)*.22;
    float m=min(log2(1.+length(w)),3.);float angle=length(w)==0.?0.:atan(w.y,w.x);
    return ramp(.59+angle/6.28318530718*.5+m*.12)*(.14+m*.07);
  }`;
  const paletteWGSL=`
  fn ramp(t:f32)->vec3f{
    var stops=array<vec3f,8>(${vectors('vec3f',0)});
    if(u.palette==1u){stops=array<vec3f,8>(${vectors('vec3f',1)});}
    if(u.palette==2u){stops=array<vec3f,8>(${vectors('vec3f',2)});}
    let p=fract(t)*8.;let i=u32(floor(p));let f=fract(p);let k=f*f*(3.-2.*f);
    return mix(stops[i],stops[(i+1u)%8u],k)/255.;
  }
  fn color(kind:u32,steps:f32,w:vec2f)->vec3f{
    if(u.palette==3u){var v=select(select(select(6.,18.,kind==1u),32.,kind==2u),86.,kind==4u);if(kind==3u){v=48.+184.*(.5-.5*cos(log2(max(steps,1.)+1.)*1.76));}return vec3f(v/255.);}
    if(kind==4u){return vec3f(42.,31.,47.)/255.;}
    if(kind==0u){return vec3f(10.,9.,24.)/255.;}
    if(kind==3u){return ramp(log2(max(steps,1.)+1.)*.42+.08);}
    if(kind==2u){return ramp(.27)*.22;}
    let m=min(log2(1.+length(w)),3.);var angle=0.;if(length(w)>0.){angle=atan2(w.y,w.x);}
    return ramp(.59+angle/6.28318530718*.5+m*.12)*(.14+m*.07);
  }`;
  root.TetraCore = { STATUS, orbit64, makePreciseOrbit, color, paletteGLSL, paletteWGSL };
  if (typeof module !== 'undefined') module.exports = root.TetraCore;
})(globalThis);
