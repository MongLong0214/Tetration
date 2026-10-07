/* WebGPU compute for the final (still-camera) stages. The WebGL programs give each fragment one whole
 * pixel, so a SIMD group waits for its longest orbit and a tile for its slowest group. Here persistent
 * lanes take one sample at a time from an atomic queue and start the next as soon as one ends, in a
 * single flattened loop. The arithmetic is the WebGL programs' (gpu.js), ported to WGSL; results land
 * in the WebGL frames, which keep presentation and reuse. Live frames accumulate here too (mask and resolve
 * read the previous live image). A finite FP32 observation.
 * Lanes run in rounds of at most STEPS loop iterations and keep their sample in a buffer between
 * rounds: macOS aborts compute whose threadgroups run for tens of milliseconds while WebGL or the
 * compositor waits for the GPU (measured), and a short round also lets live frames in sooner. */
(function (root) {
  'use strict';
  const {AA, paletteWGSL} = root.TetraCore;
  // Samples per dispatch: 12 bytes of colour each, plus the queue entry. LANES workgroups of 64 cover
  // the resident threads of 64 Apple GPU cores; STEPS iterations keep a round to about ten milliseconds (a round also costs ~0.3 ms of dispatch, so shorter ones are slower).
  const CAPACITY = 1 << 21, LANES = 1024, STEPS = 4096, FLAT = 0xffffffff;
  // Readback counters of a batch with one sample still queued: what remains if a submission never ran.
  const UNFINISHED = new Uint32Array([1, 0, 1, 0, 0, 0, 0, 0]);
  // gpu.js polyCosSin: range-reduced cos/sin from multiply-adds, for drivers whose builtins err.
  const polySinCos = `
 fn polyCosSin(x: f32) -> vec2f {
  let q = floor(x*.636619772367581 + .5); let r = ((x - q*1.5703125) - q*4.837512969970703e-4) - q*7.549789954891882e-8; let r2 = r*r;
  let s = r + r*r2*(-1.6666654611e-1 + r2*(8.3321608736e-3 + r2*-1.9515295891e-4));
  let c = 1. - .5*r2 + r2*r2*(4.166664568298827e-2 + r2*(-1.388731625493765e-3 + r2*2.443315711809948e-5));
  let n = i32(q - 4.*floor(q*.25));
  if (n == 0) { return vec2f(c, s); } if (n == 1) { return vec2f(-s, c); } if (n == 2) { return vec2f(-c, -s); } return vec2f(s, -c);
 }`;
  const header = precise => `
 struct Params {
  size: vec2f, shift: vec2f, step: vec2f, center: vec2f, L0: vec2f, inv: vec2f, delta: vec2f, deltaMirror: vec2f,
  span: f32, aspect: f32, lowA: f32, maxB: f32, tol: f32, threshold: f32, imCenter: f32, spanMant: f32,
  grid: i32, iterations: i32, palette: i32, samples: i32, adaptive: i32, refLength: i32, refValues: i32, scale: i32,
  invExp: i32, blaLevels: i32, rects: u32, pixels: u32, blaBase: array<vec4i, 4>,
  hshift: vec2f, hscale: vec2f, hoffset: vec2f, hsize: vec2f, hcount: f32, hcap: f32, accum: i32, hmode: i32, interleave: i32, phase: i32,
 };
 @group(0) @binding(0) var<uniform> p: Params;
 // Batch rectangles (GL orientation: row 0 at the bottom) and their first batch pixel.
 @group(0) @binding(1) var<storage, read> rects: array<vec4i>;
 @group(0) @binding(2) var<storage, read> starts: array<u32>;
 @group(0) @binding(3) var<storage, read> seeds: array<u32>;
 @group(0) @binding(4) var<storage, read_write> works: array<u32>;
 // Queue length, claims, lanes still holding a sample after the round, orbit steps taken, approach blocks, samples finished.
 @group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, 6>;
 @group(0) @binding(6) var<storage, read_write> bases: array<u32>;
 @group(0) @binding(7) var<storage, read_write> cols: array<f32>;
 @group(0) @binding(8) var<storage, read_write> image: array<u32>;
 @group(0) @binding(9) var<storage, read_write> packed: array<u32>;
 @group(0) @binding(10) var<storage, read> orbit: array<vec4f>;
 @group(0) @binding(11) var<storage, read> bla: array<vec4f>;
 const LOG_R = 23.025850929940457;
 const FLAT = ${FLAT}u;
 // WGSL may assume finite floats; test the bits so NaN and infinity checks survive optimisation.
 fn bad(x: f32) -> bool { return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u; }
 fn isNan(x: f32) -> bool { return (bitcast<u32>(x) & 0x7fffffffu) > 0x7f800000u; }
 ${polySinCos}
 fn cosSin(x: f32) -> vec2f { ${precise ? 'return polyCosSin(x);' : 'return vec2f(cos(x), sin(x));'} }
 ${paletteWGSL}
 fn cell(n: u32) -> vec2f {
  var rows = array<u32, 4>(${AA.rows.map(v => v + 'u').join(', ')}); var sets = array<u32, 4>(${AA.sets.map(v => v + 'u').join(', ')});
  let j = n & 3u; let i = (rows[j] + sets[n >> 2u]) & 3u;
  return (vec2f(f32(i), f32(j)) + .5)*.25 - .5;
 }
 fn locate(bp: u32) -> vec2i {
  var lo = 0u; var hi = p.rects;
  loop { if (hi - lo <= 1u) { break; } let mid = (lo + hi) >> 1u; if (starts[mid] <= bp) { lo = mid; } else { hi = mid; } }
  let r = rects[lo]; let li = i32(bp - starts[lo]);
  return vec2i(r.x + li % r.z, r.y + li / r.z);
 }
 fn seedAt(q: vec2i) -> vec4f { let s = vec2i(p.size); let c = clamp(q, vec2i(0), s - 1); return unpack4x8unorm(seeds[u32(c.y*s.x + c.x)]); }
 fn samplePoint(slot: u32) -> vec2f { let item = works[slot]; return vec2f(locate(item >> 4u)) + .5 + select(cell(item & 15u), vec2f(0.), p.samples == 1 && p.accum == 0); }
 fn reused(q: vec2i) -> bool { return p.samples == 16 && p.adaptive == 1 && abs(seedAt(q).a - 64./255.) < .5/255.; }
 // Live accumulation (gpu.js history() and its uAccum branch): the previous estimate of a pixel (mean, samples),
 // carried by an integer shift (hmode 1) or resampled from another grid (hmode 2), from the history in seeds.
 fn histAt(q: vec2i) -> vec4f { return unpack4x8unorm(seeds[u32(q.y*i32(p.hsize.x) + q.x)]); }
 fn history(q: vec2i) -> vec4f {
  let s = vec2i(p.hsize); let point = vec2f(q) + .5;
  if (p.hmode == 1) {
   let h = vec2i(floor(point + p.hshift));
   if (any(h < vec2i(0)) || any(h >= s)) { return vec4f(0.); }
   let c = histAt(h); return vec4f(c.rgb, floor(c.a*255. + .5));
  }
  if (p.hmode == 2) {
   let t = point*p.hscale + p.hoffset - .5;
   if (t.x < 0. || t.y < 0. || t.x > f32(s.x - 1) || t.y > f32(s.y - 1)) { return vec4f(0.); }
   let b = vec2i(floor(t)); let e = min(b + 1, s - 1); let f = t - vec2f(b);
   let c = mix(mix(histAt(b).rgb, histAt(vec2i(e.x, b.y)).rgb, f.x), mix(histAt(vec2i(b.x, e.y)).rgb, histAt(e).rgb, f.x), f.y);
   return vec4f(c, min(select(floor(histAt(vec2i(t + .5)).a*255. + .5), p.hcount, p.hcount > 0.), p.hcap));
  }
  return vec4f(0.);
 }
 // New samples a live pixel with n takes: none once converged, or outside this frame's phase of the world-locked
 // 2x2 pattern of 8x8 blocks (interleaved, pixels with history only).
 fn takes(q: vec2i, n: u32) -> u32 {
  if (n >= 16u) { return 0u; }
  if (p.interleave == 1 && n > 0u) { let a = vec2i(floor(vec2f(q) + .5 + p.shift)) >> vec2u(3u); if ((a.x & 1) + 2*(a.y & 1) != p.phase) { return 0u; } }
  return min(16u, n + u32(p.samples)) - n;
 }`;

  // Per batch pixel: keep a flat seed, or queue its samples (a 16x pixel seeded by a 4x pixel queues 12).
  const resolveSource = precise => header(precise) + `
 @compute @workgroup_size(64) fn mask(@builtin(global_invocation_id) g: vec3u) {
  let bp = g.x; if (bp >= p.pixels) { return; }
  let q = locate(bp);
  if (p.accum == 1) {
   let n = u32(history(q).w); let count = takes(q, n);
   if (count == 0u) { bases[bp] = FLAT; return; }
   let b = atomicAdd(&counters[0], count); bases[bp] = b;
   for (var j = 0u; j < count; j++) { works[b + j] = (bp << 4u) | (n + j); }
   return;
  }
  if (p.adaptive == 1) {
   let center = seedAt(q).rgb; var contrast = 0.;
   for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) { let d = abs(center - seedAt(q + vec2i(x, y)).rgb); contrast = max(contrast, max(d.r, max(d.g, d.b))); } }
   if (contrast < p.threshold) { bases[bp] = FLAT; return; }
  }
  let first = select(0u, 4u, reused(q)); let count = u32(p.samples) - first;
  let b = atomicAdd(&counters[0], count); bases[bp] = b;
  for (var j = 0u; j < count; j++) { works[b + j] = (bp << 4u) | (first + j); }
 }
 // The WebGL sample loop's sum, in its order, then its RGBA8 rounding.
 @compute @workgroup_size(64) fn resolve(@builtin(global_invocation_id) g: vec3u) {
  let bp = g.x; if (bp >= p.pixels) { return; }
  let q = locate(bp); let at = u32(q.y*i32(p.size.x) + q.x); let b = bases[bp];
  var value: u32;
  if (p.accum == 1) {
   // Running mean: converged and off-phase pixels keep their history, the rest add their new cells.
   let h = history(q);
   if (b == FLAT) { value = pack4x8unorm(vec4f(h.rgb, min(h.w, 16.)/255.)); }
   else {
    let count = takes(q, u32(h.w)); var rgb = h.rgb*h.w;
    for (var c = 0u; c < count; c++) { let o = 3u*(b + c); rgb += vec3f(cols[o], cols[o + 1u], cols[o + 2u]); }
    value = pack4x8unorm(vec4f(rgb*(1./(h.w + f32(count))), (h.w + f32(count))/255.));
   }
  }
  else if (b == FLAT) { value = seeds[at]; }
  else {
   var rgb = vec3f(0.); var first = 0u; var weight = 1.; var alpha = 1.;
   if (p.samples == 16) { weight = .0625; if (reused(q)) { rgb = seedAt(q).rgb*4.; first = 4u; } }
   else if (p.samples == 4) { weight = .25; alpha = 64./255.; }
   for (var c = 0u; c < u32(p.samples) - first; c++) { let o = 3u*(b + c); rgb += vec3f(cols[o], cols[o + 1u], cols[o + 2u]); }
   value = pack4x8unorm(vec4f(rgb*weight, alpha));
  }
  image[at] = value; packed[bp] = value;
 }`;

  // Persistent lanes: each loop iteration is one orbit step of the current sample, or its end and the next sample's start.
  // state: the kernel's [name, type] variables that a sample carries from one round to the next.
  const persistent = (state, init, step, final, after = '') => {
    const vars = [['busy', 'bool'], ['slot', 'u32'], ['phase', 'i32'], ['kind', 'i32'], ['steps', 'f32'], ['w', 'vec2f'], ['i', 'i32'], ...state];
    return `
 struct Lane { ${vars.map(([name, type]) => `${name}: ${type === 'bool' ? 'u32' : type}`).join(', ')} }
 @group(0) @binding(12) var<storage, read_write> lanes: array<Lane>;
 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  let total = atomicLoad(&counters[0]); let N = p.iterations;
  ${vars.map(([name, type]) => `var ${name}: ${type};`).join(' ')}
  let held = lanes[g.x].busy != 0u;
  if (held) { let saved = lanes[g.x]; ${vars.map(([name, type]) => `${name} = ${type === 'bool' ? `saved.${name} != 0u` : `saved.${name}`};`).join(' ')} }
  var left = ${STEPS}; var finished = 0u;
  loop {
   if (!busy) {
    // A load first: rounds after the queue empties then cost no contended claims.
    if (atomicLoad(&counters[1]) >= total) { break; }
    slot = atomicAdd(&counters[1], 1u);
    if (slot >= total) { break; }
    ${init}
    busy = true;
   }
   ${step}
   if (phase == DONE) { let rgb = palette(kind, steps, ${final}); cols[3u*slot] = rgb.r; cols[3u*slot + 1u] = rgb.g; cols[3u*slot + 2u] = rgb.b; busy = false; finished++; }${after}
   left--; if (left == 0) { break; }
  }
  if (left < ${STEPS}) { atomicAdd(&counters[3], u32(${STEPS} - left)); }
  if (finished > 0u) { atomicAdd(&counters[5], finished); }
  if (busy) { atomicAdd(&counters[2], 1u); lanes[g.x] = Lane(${vars.map(([name, type]) => type === 'bool' ? `select(0u, 1u, ${name})` : name).join(', ')}); }
  else if (held) { lanes[g.x].busy = 0u; }
 }`;
  };

  const direct = precise => header(precise) + `
 const RUN = 0; const DONE = 4;` + persistent([
    ['l', 'vec2f'], ['old', 'vec2f'], ['cycW', 'vec2f'], ['fc', 'i32'], ['pc', 'i32'], ['cycS', 'i32'], ['cycD', 'i32'], ['sumA', 'f32'], ['cycA', 'f32'], ['logL', 'f32'],
  ], `
    let point = samplePoint(slot);
    let cp = p.center + select((point/p.size - .5)*vec2f(p.span, p.span*p.aspect), (point - p.size*.5 + p.shift)*p.step, p.grid == 1);
    let radius = length(cp); kind = 0; steps = f32(N); w = vec2f(1., 0.); phase = RUN;
    if (radius < 1e-30) { kind = 4; steps = 0.; w = vec2f(0.); phase = DONE; }
    else {
     l = vec2f(log(radius), select(atan2(cp.y, cp.x), 3.141592653589793, cp.y == 0. && cp.x < 0.));
     old = vec2f(0.); cycW = vec2f(1e30); fc = 0; pc = 0; cycS = 0; cycD = 1; sumA = 0.; cycA = 0.; logL = log(length(l)); i = 1;
    }`, `
   if (phase == RUN) {
    if (i > N) { phase = DONE; }
    else {
     let a = w.x*l.x - w.y*l.y; let b = w.x*l.y + w.y*l.x;
     if (bad(a) || bad(b)) { kind = 4; steps = f32(i); phase = DONE; }
     else if (a > LOG_R) { kind = 3; steps = f32(i) + min(1., (a - LOG_R)/LOG_R); phase = DONE; }
     else if (a < p.lowA || abs(b) > p.maxB) { kind = 4; steps = f32(i); phase = DONE; }
     else {
      let r = exp(a); let next = r*cosSin(b); let tol = p.tol*(1. + r);
      fc = select(0, fc + 1, length(next - w) < tol);
      pc = select(0, pc + 1, i > 2 && length(next - old) < tol);
      sumA += a;
      if (i - cycS > 2 && fc == 0 && pc == 0 && length(next - cycW) < tol && sumA - cycA + f32(i - cycS)*logL < -1.3863 && length(next - w) >= 4.*tol && length(next - old) >= 4.*tol) { steps = f32(N); phase = DONE; }
      else {
       if (i - cycS >= cycD) { cycW = next; cycA = sumA; cycS = i; cycD *= 2; }
       old = w; w = next;
       if (fc >= 8) { kind = 1; steps = f32(i); phase = DONE; }
       else if (pc >= 12) { kind = 2; steps = f32(i); phase = DONE; }
       else { i++; }
      }
     }
    }
   }`, 'w');

  const perturbHelpers = `
 fn pow2(e: i32) -> f32 { if (e < -126) { return 0.; } return bitcast<f32>((min(e, 127) + 127) << 23u); }
 fn expOf(v: vec2f) -> i32 { let m = max(abs(v.x), abs(v.y)); if (m == 0.) { return -1000; } return ((bitcast<i32>(m) >> 23u) & 255) - 127; }
 fn scaled(m: vec2f, e: i32) -> vec2f { if (all(m == vec2f(0.))) { return m; } return m*pow2(e >> 1u)*pow2(e - (e >> 1u)); }
 fn normalizeExp(m: ptr<function, vec2f>, e: ptr<function, i32>) { let k = expOf(*m); if (k == -1000) { *m = vec2f(0.); *e = -1000; return; } *m = scaled(*m, -k); *e += k; }
 fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
 fn expm1s(x: f32) -> f32 { if (abs(x) < .5) { return x*(1. + x*(.5 + x*(1./6. + x*(1./24. + x*(1./120. + x*(1./720. + x*(1./5040. + x*(1./40320.)))))))); } return exp(x) - 1.; }
 // (sin x, cos x, sin x/2)
 fn sincosh(x: f32) -> vec3f {
  if (abs(x) < .5) { let x2 = x*x; let y = .5*x; let y2 = y*y;
   return vec3f(x*(1. - x2*(1./6. - x2*(1./120. - x2*(1./5040. - x2*(1./362880.))))), 1. - x2*(.5 - x2*(1./24. - x2*(1./720. - x2*(1./40320.)))), y*(1. - y2*(1./6. - y2*(1./120. - y2*(1./5040.))))); }
  let cs = cosSin(x); return vec3f(cs.y, cs.x, cosSin(.5*x).y);
 }
 fn log1ps(v: f32) -> f32 { if (abs(v) < .25) { let t = v/(2. + v); let t2 = t*t; return 2.*t*(1. + t2*(1./3. + t2*(1./5. + t2*(1./7. + t2*(1./9. + t2*(1./11.)))))); } return log(1. + v); }
 fn atan2s(y: f32, x: f32) -> f32 {
  if (x > 0. && abs(y) < .1*x) { let t = y/x; let t2 = t*t; return t*(1. - t2*(1./3. - t2*(1./5. - t2*(1./7. - t2*(1./9.))))); }
  if (y == 0. && x < 0.) { return 3.141592653589793; }
  return atan2(y, x);
 }
 const LINEAR = 0; const TOP = 1; const FE = 2; const PLAIN = 3; const DONE = 4; const SKIP = 5;`;
  // gpu.js perturbStep (floatexp d = dm 2^de) and plainStep (d plain), as one step each.
  const feStep = `
    if (k >= p.refLength) { d = w; de = 0; normalizeExp(&d, &de); k = 0; cur = vec4f(0., 0., LOG_R, 0.); }
    let V = cur.xy; let t1 = cmul(V, dLm); let t2 = cmul(d, L);
    let E = max(expOf(t1) + dLe, expOf(t2) + de);
    let em = scaled(t1, max(dLe - E, -200)) + scaled(t2, max(de - E, -200));
    let Ee = expOf(em) + E;
    let unit = pow2(clamp(E, -200, 100)); let reEps = em.x*unit; let imEps = em.y*unit;
    if (reEps > cur.z) { kind = 3; steps = f32(i) + min(1., (reEps - cur.z)/LOG_R); phase = DONE; }
    else {
     let a = cur.w + reEps; let b = p.L0.x*V.y + p.L0.y*V.x + imEps;
     if (bad(a) || bad(b) || a < p.lowA || abs(b) > p.maxB) { kind = 4; steps = f32(i); phase = DONE; }
     else {
      var next: vec2f;
      if (k + 1 >= p.refValues) { next = exp(a)*cosSin(b); d = next; de = 0; normalizeExp(&d, &de); k = 0; cur = vec4f(0., 0., LOG_R, 0.); }
      else {
       let nx = orbit[k + 1]; let Vn = nx.xy;
       if (Ee < -12) {
        let eu = em*unit; let f = vec2f(1., 0.) + .5*eu + cmul(eu, eu)*(1./6.);
        d = cmul(Vn, cmul(em, f)); de = E; normalizeExp(&d, &de);
        next = Vn + scaled(d, max(de, -200)); k++; cur = nx;
       } else {
        let h = sincosh(imEps); let hx = exp(.5*reEps);
        next = cmul(Vn*hx, vec2f(h.y, h.x))*hx;
        if (reEps > 40.) { d = next; de = 0; normalizeExp(&d, &de); k = 0; cur = vec4f(0., 0., LOG_R, 0.); }
        else { d = cmul(Vn, vec2f(expm1s(reEps)*h.y - 2.*h.z*h.z, hx*hx*h.x)); de = 0; normalizeExp(&d, &de); k++; cur = nx; }
       }
      }
      let r = length(next); let tol = p.tol*(1. + r);
      fc = select(0, fc + 1, length(next - w) < tol);
      pc = select(0, pc + 1, i > 2 && length(next - old) < tol);
      old = w; w = next;
      if (fc >= 8) { kind = 1; steps = f32(i); phase = DONE; }
      else if (pc >= 12) { kind = 2; steps = f32(i); phase = DONE; }
      else if (k > 0 && de > -126 && de < 120) { let ws = scaled(w, -de); if (dot(ws, ws) < dot(d, d)) { d = w; de = 0; normalizeExp(&d, &de); k = 0; cur = vec4f(0., 0., LOG_R, 0.); } }
     }
    }`;
  // Once inside the plain loop, a bit-identical repeat of the full FP32 state skips whole cycles (iterations >= 8192).
  const cycleStep = `
       if (cycS > 2 && k == cycK && fc == cycF && pc == cycP && all(bitcast<vec2u>(d) == bitcast<vec2u>(cycD)) && all(bitcast<vec2u>(w) == bitcast<vec2u>(cycW)) && all(bitcast<vec2u>(old) == bitcast<vec2u>(cycO))) {
        let cycle = i - cycS; i += ((N - i)/cycle)*cycle;
       } else if (i - cycS >= cycDist) { cycD = d; cycW = w; cycO = old; cycK = k; cycF = fc; cycP = pc; cycS = i; cycDist *= 2; }`;
  const plainStep = cycle => `
    if (k >= p.refLength) { d = w; k = 0; cur = vec4f(0., 0., LOG_R, 0.); }
    let V = cur.xy; let eps = cmul(V, dLp) + cmul(d, L);
    if (eps.x > cur.z) { kind = 3; steps = f32(i) + min(1., (eps.x - cur.z)/LOG_R); phase = DONE; }
    else {
     let a = cur.w + eps.x; let b = p.L0.x*V.y + p.L0.y*V.x + eps.y;
     if (bad(a) || bad(b) || a < p.lowA || abs(b) > p.maxB) { kind = 4; steps = f32(i); phase = DONE; }
     else {
      var next: vec2f;
      if (k + 1 >= p.refValues) { next = exp(a)*cosSin(b); d = next; k = 0; cur = vec4f(0., 0., LOG_R, 0.); }
      else {
       let nx = orbit[k + 1]; let Vn = nx.xy;
       if (max(abs(eps.x), abs(eps.y)) < 2.44140625e-4) { d = cmul(Vn, cmul(eps, vec2f(1., 0.) + .5*eps + cmul(eps, eps)*(1./6.))); next = Vn + d; k++; cur = nx; }
       else {
        let h = sincosh(eps.y); let hx = exp(.5*eps.x);
        next = cmul(Vn*hx, vec2f(h.y, h.x))*hx;
        if (eps.x > 40.) { d = next; k = 0; cur = vec4f(0., 0., LOG_R, 0.); }
        else { d = cmul(Vn, vec2f(expm1s(eps.x)*h.y - 2.*h.z*h.z, hx*hx*h.x)); k++; cur = nx; }
       }
      }
      let r = length(next); let tol = p.tol*(1. + r);
      fc = select(0, fc + 1, length(next - w) < tol);
      pc = select(0, pc + 1, i > 2 && length(next - old) < tol);
      old = w; w = next;
      if (fc >= 8) { kind = 1; steps = f32(i); phase = DONE; }
      else if (pc >= 12) { kind = 2; steps = f32(i); phase = DONE; }
      else {
       if (k > 0 && dot(w, w) < dot(d, d)) { d = w; k = 0; cur = vec4f(0., 0., LOG_R, 0.); }
       // Far below the FP32 range: back to floatexp.
       if (dot(d, d) < 1e-40) { i++; de = 0; normalizeExp(&d, &de); phase = FE; }
       else {${cycle ? cycleStep : ''} i++; }
      }
     }
    }`;
  // The BLA approach (gpu.js perturbBla): aligned runs of 2^j linear steps while |d| is inside their radius.
  const blaStep = `
    if (k > 1 && (k & 1) == 0 && fc == 0 && pc == 0) {
     let ld = select(f32(de) + log2(length(d)), -1e30, expOf(d) == -1000);
     var j = 1; var skip = 0;
     loop { if (!(j < p.blaLevels && (k & ((2 << u32(j)) - 1)) == 0)) { break; } j++; }
     for (; j >= 1; j--) {
      let len = 1 << u32(j);
      if (i + len - 1 > N) { continue; }
      let e = p.blaBase[j >> 2u][j & 3] + (k >> u32(j)); let s = bla[2*e + 1];
      if (s.z > -1e29 && ld < s.z) {
       let c = bla[2*e]; let ae = i32(s.x) + de; let be = i32(s.y) + dLe; let E = max(ae, be);
       d = scaled(cmul(c.xy, d), max(ae - E, -200)) + scaled(cmul(c.zw, dLm), max(be - E, -200)); de = E; normalizeExp(&d, &de);
       skip = len; break;
      }
      if (j == 1 && s.z > -1e29) { lin = false; }
     }
     // Inside a run |d| <= 2^-24 |V|, so V + d is exact enough for the next tests.
     if (skip > 0) { k += skip; i += skip; cur = orbit[k]; old = orbit[k - 1].xy; w = cur.xy + scaled(d, clamp(de, -200, 120)); fe = false; }
    }`;
  // Per-sample variables of the perturbation kernels.
  const perturbState = [
    ['mirrored', 'bool'], ['L', 'vec2f'], ['dLm', 'vec2f'], ['dLe', 'i32'], ['dLp', 'vec2f'], ['lin', 'bool'], ['k', 'i32'], ['de', 'i32'], ['d', 'vec2f'], ['old', 'vec2f'], ['cur', 'vec4f'],
    ['fc', 'i32'], ['pc', 'i32'], ['cycD', 'vec2f'], ['cycW', 'vec2f'], ['cycO', 'vec2f'], ['cycK', 'i32'], ['cycF', 'i32'], ['cycP', 'i32'], ['cycS', 'i32'], ['cycDist', 'i32'],
  ];
  const perturbInit = useBla => `
    let point = samplePoint(slot);
    let g = select((point/p.size - .5)*vec2f(1., p.aspect)*p.spanMant, (point - p.size*.5 + p.shift)*p.step, p.grid == 1);
    mirrored = p.imCenter + g.y < 0.;
    let dc = select(p.delta + g, p.deltaMirror + vec2f(g.x, -g.y), mirrored);
    // x = dc 2^scale / c0 as mantissa and exponent; dL = log1p(x).
    var xm = cmul(dc, p.inv); var xe = p.scale + p.invExp; dLm = vec2f(0.); dLe = -1000;
    var failed = false;
    if (expOf(xm) != -1000) {
     normalizeExp(&xm, &xe);
     if (xe < -12) { let xu = scaled(xm, max(xe, -200)); dLm = cmul(xm, vec2f(1., 0.) - .5*xu + cmul(xu, xu)*(1./3.)); dLe = xe; normalizeExp(&dLm, &dLe); }
     else {
      let xu = scaled(xm, min(xe, 120)); dLm = vec2f(.5*log1ps(2.*xu.x + xu.x*xu.x + xu.y*xu.y), atan2s(xu.y, 1. + xu.x)); dLe = 0;
      if (bad(dLm.x) || isNan(dLm.y)) { failed = true; } else { normalizeExp(&dLm, &dLe); }
     }
    }
    if (failed) { kind = 4; steps = 0.; w = vec2f(0.); mirrored = false; phase = DONE; }
    else {
     L = p.L0 + scaled(dLm, max(dLe, -200));
     k = 1; de = -1000; kind = 0; fc = 0; pc = 0; d = vec2f(0.); w = vec2f(1., 0.); old = vec2f(0.); steps = f32(N);
     cur = orbit[1]; i = 1; lin = true; phase = ${useBla ? 'LINEAR' : 'TOP'};
    }`;
  // One orbit step in any phase; plain = false leaves out the plain loop (the approach kernel stops on entering it).
  const perturbBody = (useBla, cycle, plain) => `${useBla ? `
   if (phase == LINEAR && !(lin && i <= N)) { phase = TOP; }` : ''}
   if (phase == TOP) {
    if (i > N) { phase = DONE; }
    // A zero d with dL in range starts plain: the floatexp first step differs only by exact powers of two,
    // and lanes no longer stall their SIMD group on each new sample's floatexp step (about 30% at 1e-5).
    else if ((de >= -60 && de < 100) || (de == -1000 && dLe >= -60 && dLe < 100)) {
     d = scaled(d, de); dLp = scaled(dLm, max(dLe, -200)); phase = PLAIN;
     cycD = vec2f(0.); cycW = vec2f(0.); cycO = vec2f(0.); cycK = 0; cycF = 0; cycP = 0; cycS = 0; cycDist = 1;
    }
    else { phase = FE; }
   }
   var fe = false;
   ${useBla ? `if (phase == LINEAR) { fe = true; ${blaStep} }
   else ` : ''}if (phase == FE) { if (i > N) { phase = DONE; } else { fe = true; } }${plain ? `
   else if (phase == PLAIN) { if (i > N) { phase = DONE; } else { ${plainStep(cycle)} } }` : ''}
   if (fe) {
    ${feStep}
    ${useBla ? `if (phase == LINEAR) { i++; if (k == 0 || !lin) { phase = TOP; } }
    else ` : ''}if (phase == FE) { i++; if (de >= -60 && de < 100) { phase = TOP; } }
   }`;
  /* Two kernels per perturbation scene. The approach (BLA runs and floatexp steps) takes one thread per sample in
   * queue order, so neighbouring samples advance in step as WebGL fragments do; it hands each sample over at its
   * first plain step (or after STEPS, as floatexp). The persistent lanes then run mostly plain steps. One flattened
   * loop with every phase made a whole SIMD group execute the approach whenever any lane was in it. */
  const perturb = (precise, useBla, cycle) => {
    const final = 'select(w, vec2f(w.x, -w.y), mirrored)';
    return header(precise) + perturbHelpers + `
 // flags: fc, pc << 4, mirrored << 8, floatexp << 9, de << 16. i == 0: the approach finished the sample.
 struct Handoff { i: i32, k: i32, flags: u32, dLe: i32, d: vec2f, w: vec2f, old: vec2f, dLm: vec2f }
 @group(0) @binding(13) var<storage, read_write> handoff: array<Handoff>;
 var<workgroup> block: u32;
 // Dispatched in rounds of LANES workgroups, each taking the next 64 queue entries.
 @compute @workgroup_size(64) fn approach(@builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { block = atomicAdd(&counters[4], 64u); }
  let slot = workgroupUniformLoad(&block) + lane; if (slot >= atomicLoad(&counters[0])) { return; }
  let N = p.iterations; var phase: i32; var kind: i32; var steps: f32; var w: vec2f; var i: i32;
  ${perturbState.map(([name, type]) => `var ${name}: ${type};`).join(' ')}
  ${perturbInit(useBla)}
  var left = ${STEPS};
  loop { if (phase == PLAIN || phase == DONE || left == 0) { break; } ${perturbBody(useBla, false, false)} left--; }
  if (phase == DONE) { let rgb = palette(kind, steps, ${final}); cols[3u*slot] = rgb.r; cols[3u*slot + 1u] = rgb.g; cols[3u*slot + 2u] = rgb.b; handoff[slot].i = 0; }
  else { handoff[slot] = Handoff(i, k, u32(fc) | (u32(pc) << 4u) | select(0u, 256u, mirrored) | select(0u, 512u, phase != PLAIN) | (bitcast<u32>(de) << 16u), dLe, d, w, old, dLm); }
 }` + persistent(perturbState, `
    let h = handoff[slot];
    if (h.i == 0) { phase = SKIP; }
    else {
     i = h.i; k = h.k; fc = i32(h.flags & 15u); pc = i32((h.flags >> 4u) & 15u); mirrored = (h.flags & 256u) != 0u;
     dLe = h.dLe; dLm = h.dLm; d = h.d; w = h.w; old = h.old; de = bitcast<i32>(h.flags) >> 16u; kind = 0; steps = f32(N);
     L = p.L0 + scaled(dLm, max(dLe, -200)); dLp = scaled(dLm, max(dLe, -200));
     cur = select(orbit[k], vec4f(0., 0., LOG_R, 0.), k == 0); phase = select(PLAIN, TOP, (h.flags & 512u) != 0u);
     cycD = vec2f(0.); cycW = vec2f(0.); cycO = vec2f(0.); cycK = 0; cycF = 0; cycP = 0; cycS = 0; cycDist = 1;
    }`, perturbBody(false, cycle, true), final, `
   else if (phase == SKIP) { busy = false; finished++; }`);
  };

  const SOURCES = {
    resolve: resolveSource, direct,
    perturb: precise => perturb(precise, false, false), perturbBla: precise => perturb(precise, true, false),
    perturbCycle: precise => perturb(precise, false, true), perturbBlaCycle: precise => perturb(precise, true, true),
  };
  // Bindings each entry point uses (auto layouts include only those).
  const ORBIT = [0, 1, 2, 4, 5, 7, 12], PLAIN = [0, 5, 7, 10, 12, 13], APPROACH = [0, 1, 2, 4, 5, 7, 10, 13];
  const BINDINGS = {mask: [0, 1, 2, 3, 4, 5, 6], resolve: [0, 1, 2, 3, 6, 7, 8, 9], direct: ORBIT,
    perturb: PLAIN, perturbCycle: PLAIN, perturbBla: PLAIN, perturbBlaCycle: PLAIN,
    'perturb@approach': APPROACH, 'perturbCycle@approach': APPROACH, 'perturbBla@approach': [...APPROACH, 11], 'perturbBlaCycle@approach': [...APPROACH, 11]};

  class TetraCompute {
    static async create() {
      const gpu = root.navigator?.gpu;
      if (!gpu) return null;
      const adapter = await gpu.requestAdapter({powerPreference: 'high-performance'});
      if (!adapter) return null;
      const compute = new TetraCompute(await adapter.requestDevice());
      compute.precise = await compute.probeTrig();
      for (const name of ['mask', 'resolve', ...Object.keys(BINDINGS).filter(name => name !== 'mask' && name !== 'resolve')]) compute.pipeline(name);
      return compute;
    }
    constructor(device) {
      this.device = device; this.failed = false; this.precise = true;
      this.modules = {}; this.pipelines = {}; this.pending = new Set();
      this.buffers = null; this.slots = [{buffer: null, owner: null}, {buffer: null, owner: null}];
      this.reference = null; this.bla = null; this.batches = 0;
      device.lost.then(info => { this.failed = true; if (info.reason !== 'destroyed') console.warn('WebGPU device lost:', info.message); });
      device.addEventListener?.('uncapturederror', event => { this.failed = true; console.warn('WebGPU error:', event.error?.message); });
    }
    /* Builtin cos/sin against the multiply-add version over |x| <= 60, as TetraGPU.probeTrig does
     * for WebGL: true (use the polynomial) when the builtins err by more than 4e-6 anywhere. */
    async probeTrig() {
      const device = this.device, out = device.createBuffer({size: 2048, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
      const read = device.createBuffer({size: 2048, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
      const module = device.createShaderModule({code: polySinCos + `
 @group(0) @binding(0) var<storage, read_write> probe: array<u32>;
 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  let n = g.x; if (n >= 512u) { return; }
  let x = (f32(n & 255u) + .5 - 128.)*select(.025, .47, n >= 256u) + .0137; let a = vec2f(cos(x), sin(x)); let b = polyCosSin(x);
  probe[n] = select(0u, 1u, max(abs(a.x - b.x), abs(a.y - b.y)) > 4e-6);
 }`});
      try {
        const pipeline = await device.createComputePipelineAsync({layout: 'auto', compute: {module, entryPoint: 'main'}});
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: out}}]}));
        pass.dispatchWorkgroups(8); pass.end(); encoder.copyBufferToBuffer(out, 0, read, 0, 2048); device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        return new Uint32Array(read.getMappedRange()).some(Boolean);
      } catch { return true; } finally { out.destroy(); read.destroy(); }
    }
    // Pipeline for a kernel, compiled in the background on first request (null until then).
    pipeline(name) {
      if (this.pipelines[name]) return this.pipelines[name];
      const source = name === 'mask' ? 'resolve' : name.split('@')[0];
      if (this.failed || this.pending.has(name)) return null;
      this.pending.add(name);
      const module = this.modules[source] || (this.modules[source] = this.device.createShaderModule({code: SOURCES[source](this.precise)}));
      this.device.createComputePipelineAsync({layout: 'auto', compute: {module, entryPoint: name === 'mask' || name === 'resolve' ? name : name.split('@')[1] || 'main'}})
        .then(pipeline => { this.pipelines[name] = pipeline; }, error => { this.failed = true; console.warn('WebGPU pipeline failed:', error?.message || error); })
        .finally(() => this.pending.delete(name));
      return null;
    }
    // The orbit kernel for a scene, or '' while it (or the shared passes) still compiles.
    kernel(scene, levels) {
      const name = scene.mode === 'direct' ? 'direct' : (levels ? 'perturbBla' : 'perturb') + (scene.iterations >= 8192 ? 'Cycle' : '');
      const ready = [this.pipeline('mask'), this.pipeline('resolve'), this.pipeline(name), name === 'direct' || this.pipeline(name + '@approach')].every(Boolean);
      return ready && !this.failed ? name : '';
    }
    // The frame-sized copy of a seed frame's last stage, or -1 when that stage did not run here.
    seedSlot(frame) {
      if (!frame.seed) return -1;
      const seed = frame.seed, index = this.slots.findIndex(slot => slot.owner === seed);
      return index >= 0 && seed.computed === this && seed.width === frame.width && seed.height === frame.height ? index : null;
    }
    // Samples per batch: perturbation also holds a 48-byte handoff per sample.
    capacity(kernel) { return kernel === 'direct' ? CAPACITY : CAPACITY / 2; }
    // A completed stage: the next stage may read this frame's copy as its seed.
    complete(frame) { frame.computed = this; }
    // A live frame's history: its slot when it was computed here, else one readback (a WebGL or reused frame).
    historySlot(renderer, history) {
      const index = this.slots.findIndex(slot => slot.owner === history);
      if (index >= 0 && history.computed === this) return index;
      this.adopt(renderer, history);
      return 0;
    }
    // A seed that WebGL drew (its stage ran before these pipelines were ready): one readback into a slot.
    adopt(renderer, seed) {
      const slot = this.slots[0];
      this.slotBuffer(slot, seed.width * seed.height * 4);
      this.device.queue.writeBuffer(slot.buffer, 0, renderer.readFrame(seed));
      slot.owner = seed; seed.computed = this;
    }
    slotBuffer(slot, bytes) {
      if (!slot.buffer || slot.buffer.size < bytes) { slot.buffer?.destroy(); slot.buffer = this.device.createBuffer({size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST}); }
    }
    // Fixed buffers; the per-sample and per-pixel ones grow with the largest batch so far.
    allocate() {
      const device = this.device, usage = GPUBufferUsage, make = (size, flags) => device.createBuffer({size, usage: flags});
      this.buffers = {
        params: make(272, usage.UNIFORM | usage.COPY_DST), counters: make(32, usage.STORAGE | usage.COPY_DST | usage.COPY_SRC),
        lanes: make(LANES * 64 * 256, usage.STORAGE | usage.COPY_DST), empty: make(16, usage.STORAGE),
      };
    }
    grow(name, bytes, flags) {
      const old = this.buffers[name];
      if (old && old.size >= bytes) return old;
      old?.destroy();
      return this.buffers[name] = this.device.createBuffer({size: Math.max(256, 2 ** Math.ceil(Math.log2(bytes))), usage: flags});
    }
    upload(name, data) {
      const buffer = this.grow(name, data.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    }
    /* Compute these tiles (top-down {x, y, width, height}) of a stage into the WebGL frame:
     * the WebGL draw's samples, adaptive seed and threshold, uploaded with texSubImage2D.
     * live: a live frame's accumulation (scene.accum in gpu.js), its history read in place of a seed. */
    async draw(renderer, frame, scene, samples, threshold, tiles, kernel, levels, live = null) {
      if (!this.buffers) this.allocate();
      const device = this.device, b = this.buffers, gl = renderer.gl, history = live?.mode ? live.frame : null;
      if (history === frame) throw Error('Live history cannot be its own target');
      const seedIndex = history ? this.historySlot(renderer, history) : this.seedSlot(frame), outIndex = seedIndex === 0 ? 1 : 0, slot = this.slots[outIndex];
      if (seedIndex === null) throw Error('Seed frame was not computed here');
      this.slotBuffer(slot, frame.width * frame.height * 4);
      if (slot.owner !== frame) { slot.owner = frame; frame.computed = null; }
      const rects = new Int32Array(tiles.length * 4), starts = new Uint32Array(tiles.length + 1);
      tiles.forEach((t, n) => { rects.set([t.x, frame.height - t.y - t.height, t.width, t.height], 4 * n); starts[n + 1] = starts[n] + t.width * t.height; });
      const pixels = starts[tiles.length];
      if (pixels * samples > this.capacity(kernel)) throw Error('Compute batch too large');
      const f = new Float32Array(68), i = new Int32Array(f.buffer), u = new Uint32Array(f.buffer);
      const grid = scene.grid, perturb = scene.mode === 'perturb';
      f.set([frame.width, frame.height, ...(grid ? grid.shift : [0, 0]), ...(grid ? grid.step : [0, 0]), ...(scene.center || [0, 0])]);
      if (perturb) {
        renderer.useReference(scene.ref);
        if (this.reference !== renderer.referenceData) { this.upload('orbit', renderer.referenceData); this.reference = renderer.referenceData; }
        if (levels && this.bla !== renderer.bla.data) { this.upload('bla', renderer.bla.data); this.bla = renderer.bla.data; }
        f.set([...scene.ref.L0, ...scene.inv, ...scene.delta, ...scene.deltaMirror], 8);
      }
      f.set([scene.span || 0, scene.aspect || frame.height / frame.width, scene.rules.lowA, scene.rules.maxB, scene.rules.tol, threshold, scene.imCenter || 0, scene.spanMant || 0], 16);
      i.set([grid ? 1 : 0, scene.iterations, scene.palette, samples, !live && seedIndex >= 0 ? 1 : 0, perturb ? scene.ref.length : 0, perturb ? scene.ref.values : 0, scene.scale || 0, scene.invExp || 0, levels], 24);
      u[34] = tiles.length; u[35] = pixels;
      if (levels) i.set(renderer.bla.base, 36);
      if (live) {
        f.set([...(live.shift || [0, 0]), ...(live.scale || [1, 1]), ...(live.offset || [0, 0]), history ? history.width : 0, history ? history.height : 0, live.count || 0, live.cap ?? 16], 52);
        i.set([1, live.mode || 0, live.phase === undefined ? 0 : 1, live.phase ?? 0], 62);
      }
      device.queue.writeBuffer(b.params, 0, f);
      const storage = GPUBufferUsage.STORAGE, n = pixels * samples, packed = this.grow('packed', pixels * 4, storage | GPUBufferUsage.COPY_SRC);
      const read = this.grow('read', pixels * 4 + 32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      const resources = {
        0: b.params, 1: this.upload('rects', rects), 2: this.upload('starts', starts), 3: seedIndex >= 0 ? this.slots[seedIndex].buffer : b.empty,
        4: this.grow('works', n * 4, storage), 5: b.counters, 6: this.grow('bases', pixels * 4, storage), 7: this.grow('cols', n * 12, storage),
        8: slot.buffer, 9: packed, 10: b.orbit, 11: b.bla, 12: b.lanes, 13: perturb ? this.grow('handoff', n * 48, storage) : null,
      };
      const bind = name => { const layout = this.pipelines[name].getBindGroupLayout(0); return device.createBindGroup({layout, entries: BINDINGS[name].map(binding => ({binding, resource: {buffer: resources[binding]}}))}); };
      const pass = (encoder, name, group, count) => { const p = encoder.beginComputePass(); p.setPipeline(this.pipelines[name]); p.setBindGroup(0, group); p.dispatchWorkgroups(count); p.end(); };
      const lanes = bind(kernel), resolve = bind('resolve'), groups = Math.ceil(pixels / 64);
      // Rounds for the expected orbit steps (the last batch's mean, else the cap), plus the longest sample's tail.
      const key = kernel + '|' + samples + '|' + scene.iterations, mean = this.mean?.key === key ? this.mean.steps : scene.iterations;
      let rounds = Math.ceil(1.25 * pixels * samples * mean / (LANES * 64 * STEPS)) + Math.ceil(scene.iterations / STEPS) + 1, done = 0;
      let encoder = device.createCommandEncoder();
      // A drained batch leaves every lane idle, but only in its own kernel's Lane layout: another kernel would
      // read stale fields as a held sample.
      if (this.dirty || this.laneKernel !== kernel) encoder.clearBuffer(b.lanes);
      this.laneKernel = kernel;
      encoder.clearBuffer(b.counters); pass(encoder, 'mask', bind('mask'), groups);
      if (perturb) { const approach = bind(kernel + '@approach'); for (let r = 0; r < Math.ceil(pixels * samples / (LANES * 64)); r++) pass(encoder, kernel + '@approach', approach, LANES); }
      this.dirty = true;
      for (;;) {
        for (let r = 0; r < rounds; r++) { encoder.clearBuffer(b.counters, 8, 4); pass(encoder, kernel, lanes, LANES); }
        done += rounds;
        pass(encoder, 'resolve', resolve, groups);
        encoder.copyBufferToBuffer(packed, 0, read, 0, pixels * 4); encoder.copyBufferToBuffer(b.counters, 0, read, pixels * 4, 32);
        // Counters that are never drained, in case the GPU aborts this submission before its copy.
        device.queue.writeBuffer(read, pixels * 4, UNFINISHED);
        device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
        device.queue.submit([encoder.finish()]);
        const errors = Promise.all([device.popErrorScope(), device.popErrorScope()]);
        await read.mapAsync(GPUMapMode.READ, 0, pixels * 4 + 32);
        const error = (await errors).find(Boolean);
        let drained = false;
        try {
          if (error || this.failed) throw Error(error?.message || 'WebGPU device failed');
          if (gl.isContextLost()) throw Error('GPU context lost');
          // Queue length, claims, lanes still holding a sample, orbit steps, approach blocks, samples finished.
          // An aborted round loses the samples its lanes held, so every sample must also have finished.
          const range = read.getMappedRange(0, pixels * 4 + 32), queue = new Uint32Array(range, pixels * 4, 8);
          drained = queue[1] >= queue[0] && queue[2] === 0 && queue[5] === queue[0];
          if (drained) {
            if (queue[0]) this.mean = {key, steps: queue[3] / queue[0]};
            const data = new Uint8Array(range, 0, pixels * 4);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frame.texture);
            for (let n = 0; n < tiles.length; n++) gl.texSubImage2D(gl.TEXTURE_2D, 0, rects[4 * n], rects[4 * n + 1], rects[4 * n + 2], rects[4 * n + 3], gl.RGBA, gl.UNSIGNED_BYTE, data, starts[n] * 4);
            gl.bindTexture(gl.TEXTURE_2D, null);
          }
        } finally { read.unmap(); }
        if (drained) break;
        // An aborted round leaves the queue unfinished for good; anything else just needs more rounds.
        if (done > 4 * Math.ceil(pixels * samples * scene.iterations / (LANES * 64 * STEPS)) + 64) throw Error('Compute queue did not drain');
        encoder = device.createCommandEncoder(); rounds *= 2;
      }
      this.dirty = false;
      this.batches++;
    }
    destroy() {
      this.failed = true;
      for (const buffer of Object.values(this.buffers || {})) buffer?.destroy();
      for (const slot of this.slots) slot.buffer?.destroy();
      this.device.destroy();
    }
  }
  root.TetraCompute = TetraCompute;
})(globalThis);
