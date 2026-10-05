/* Finite numerical experiment: w0=1; w[n+1]=exp(w[n]*Log(z)).
 * Principal argument is (-pi, pi]. A threshold crossing is not a proof of
 * divergence; repeated closeness is not a proof of convergence/periodicity. */
(function (root) {
  'use strict';
  const STATUS = { UNRESOLVED: 0, FIXED: 1, PERIOD2: 2, THRESHOLD: 3, NUMERIC: 4 };
  // One sampling pattern for GPU AA and Worker fallback. The first four cells
  // are the rotated grid; all sixteen form the stratified 4x4 Ultra pattern.
  const aaRows = [1, 3, 0, 2], aaSets = [0, 2, 1, 3];
  const AA = {rows: aaRows, sets: aaSets, offsets: Array.from({length: 16}, (_, n) => {
    const j = n & 3, i = (aaRows[j] + aaSets[n >> 2]) & 3;
    return [(i + 0.5) * 0.25 - 0.5, (j + 0.5) * 0.25 - 0.5];
  })};
  function within64(dx, dy, tolerance) {
    const x = Math.abs(dx), y = Math.abs(dy);
    // max(|x|,|y|) <= hypot(x,y) <= |x|+|y|. Wide margins
    // avoid changing the native rounding decision near the actual threshold.
    if (x > 2 * tolerance || y > 2 * tolerance) return false;
    if (x + y < 0.5 * tolerance) return true;
    return Math.hypot(dx, dy) < tolerance;
  }
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
      fixed = within64(nr - wr, ni - wi, tolerance) ? fixed + 1 : 0;
      periodic = n > 2 && within64(nr - oldr, ni - oldi, tolerance) ? periodic + 1 : 0;
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
  /* Classification limits. GPU rules match the FP32 shaders so the direct and
   * perturbation renderers agree when the camera crosses between them; CPU rules
   * match orbit64. Each mode stays internally consistent at every zoom depth. */
  const RULES = {
    gpu: { lowA: -80, maxB: 1e6, tol: 2e-6 },
    cpu: { lowA: -700, maxB: 1e12, tol: 1e-10 },
  };
  const LOG_R = Math.log(1e10);
  // Smith's complex division; avoids squaring tiny or huge components.
  function cdiv(ar, ai, br, bi) {
    if (Math.abs(br) >= Math.abs(bi)) {
      const r = bi / br, d = br + bi * r;
      return [(ar + ai * r) / d, (ai - ar * r) / d];
    }
    const r = br / bi, d = bi + br * r;
    return [(ar * r + ai) / d, (ai * r - ar) / d];
  }
  /* Bilinear approximation (BLA) for deep views. While |eps| stays below epsMax, one
   * perturbation step is linear in the offset:
   *   d[k+1] = A d[k] + B dL,  A = V[k+1] L0,  B = V[k+1] V[k],
   * and runs of steps compose: A = A2 A1, B = A2 B1 + B2. Level j holds entries for
   * k = m 2^j (m >= 1) covering steps k .. k + 2^j - 1, each with the largest |d| for
   * which every covered step stays linear for all pixels with |dL| <= dLmax. Steps
   * where the reference is near the escape, numeric, fixed-point or period tests
   * get radius 0, so a skip can never pass a step that would have ended the orbit;
   * inside a skip |d| <= epsMax |V|, so no rebase is skipped either. The dropped
   * d dL term needs dLmax <= epsMax |L0| / 2. Each entry: [Re A, Im A, Re B, Im B, R]. */
  function blaTable(ref, dLmax, rules, epsMax) {
    const V = ref.V, T = ref.T, ReA = ref.ReA, ImA = ref.ImA, L0r = ref.L0[0], L0i = ref.L0[1], l0 = Math.hypot(L0r, L0i);
    const n = Math.min(ref.values - 1, ref.length);
    if (!(l0 >= 1e-3) || !(dLmax >= 0) || !(dLmax <= epsMax * l0 / 2) || n < 4) return null;
    const {tol, lowA, maxB} = rules, single = new Float64Array(5 * n);
    for (let k = 1; k < n; k++) {
      const vr = V[2 * k], vi = V[2 * k + 1], wr = V[2 * k + 2], wi = V[2 * k + 3], pr = V[2 * k - 2], pi = V[2 * k - 1];
      const vn = Math.hypot(wr, wi), margin = 4 * tol * (1 + vn) + 4 * epsMax * (vn + 1 / l0);
      const ar = wr * L0r - wi * L0i, ai = wr * L0i + wi * L0r, br = wr * vr - wi * vi, bi = wr * vi + wi * vr;
      const R = (epsMax - Math.hypot(vr, vi) * dLmax) / (l0 + dLmax);
      if (T[k] > 1 && ReA[k] >= lowA + 1 && Math.abs(ImA[k]) <= maxB - 1 && Math.hypot(wr - vr, wi - vi) > margin &&
          Math.hypot(wr - pr, wi - pi) > margin && Number.isFinite(ar + ai + br + bi) && R > 0) single.set([ar, ai, br, bi, R], 5 * k);
    }
    let levels = 0, total = 0;
    const base = [0];
    while (2 ** (levels + 2) <= n) { levels++; base.push(total); total += ((n - 1) >> levels) + 1; }
    const data = new Float64Array(5 * total);
    for (let j = 1; j <= levels; j++) {
      const len = 2 ** j, count = ((n - 1) >> j) + 1;
      for (let m = 1; m < count && m * len + len <= n; m++) {
        const k = m * len, x = j === 1 ? 5 * k : 5 * (base[j - 1] + 2 * m), y = j === 1 ? 5 * (k + 1) : x + 5;
        const src = j === 1 ? single : data, Rx = src[x + 4], Ry = src[y + 4];
        if (!(Rx > 0 && Ry > 0)) continue;
        const axr = src[x], axi = src[x + 1], bxr = src[x + 2], bxi = src[x + 3], ayr = src[y], ayi = src[y + 1];
        const ar = ayr * axr - ayi * axi, ai = ayr * axi + ayi * axr;
        const br = ayr * bxr - ayi * bxi + src[y + 2], bi = ayr * bxi + ayi * bxr + src[y + 3];
        const R = Math.min(Rx, (Ry - Math.hypot(bxr, bxi) * dLmax) / Math.hypot(axr, axi));
        if (R > 0 && Number.isFinite(ar + ai + br + bi)) data.set([ar, ai, br, bi, R], 5 * (base[j] + m));
      }
    }
    return levels ? {levels, base, data, n, dLmax, epsMax} : null;
  }
  // Steps that a pixel at |dL| = dLmax skips from the start before its offset outgrows
  // the table, carrying the bound |d| <= |A| |d| + |B| dLmax through every step.
  function blaReach(bla, ref) {
    const {levels, base, data, n, dLmax} = bla, V = ref.V, l0 = Math.hypot(ref.L0[0], ref.L0[1]);
    let k = 2, d = Math.hypot(V[4], V[5]) * dLmax * 1.01, reach = 0;
    while (k < n) {
      if ((k & 1) === 0) {
        let j = 1, skip = 0;
        while (j < levels && (k & ((2 << j) - 1)) === 0) j++;
        for (; j >= 1; j--) {
          const e = 5 * (base[j] + (k >> j)), R = data[e + 4];
          if (R > 0 && d < R) { d = Math.hypot(data[e], data[e + 1]) * d + Math.hypot(data[e + 2], data[e + 3]) * dLmax; skip = 1 << j; break; }
          if (j === 1 && R > 0) return reach;
        }
        if (skip) { k += skip; reach += skip; continue; }
      }
      // One plain step: |d'| ~ |V'| |eps| with |eps| <= |V| dLmax + |d| (|L0| + dLmax).
      d = Math.hypot(V[2 * k + 2], V[2 * k + 3]) * (Math.hypot(V[2 * k], V[2 * k + 1]) * dLmax + d * (l0 + dLmax)) * 1.01;
      k++;
    }
    return reach;
  }
  // Largest |c - c0| over a view whose lower-half pixels use the mirrored offset.
  // (dx, dy) and (dx, dym): view centre and its conjugate minus c0; yc: Im of the
  // centre; hw, hh: half width and height. Any common unit.
  function offsetBound(dx, dy, dym, yc, hw, hh) {
    let m = 0;
    const corners = (ey, y0, y1) => { for (const qx of [-hw, hw]) for (const qy of [y0, y1]) m = Math.max(m, Math.hypot(dx + qx, ey + qy)); };
    if (yc + hh >= 0) corners(dy, Math.max(-hh, -yc), hh);
    if (yc - hh < 0) corners(dym, -Math.min(hh, -yc), hh);
    return m;
  }
  // Bound on |dL| = |log1p(x)| from |x| = |c - c0| / |c0|; Infinity when too far for BLA.
  function logOffsetBound(x) { return x >= 0 && x < 0.5 ? x / (1 - x) : Infinity; }
  /* FP64 perturbation from an exact reference orbit (TetraReference.compute).
   * (dcr, dci) is c - c0 for a pixel in the closed upper half plane; callers mirror
   * lower-half pixels (the orbit of conj(c) is the conjugate orbit) and conjugate
   * the returned value. With V = reference value and d = w - V:
   *   eps = V dL + d L, where L = L0 + dL and dL = log1p((c - c0) / c0)
   *   w'  = V' exp(eps),  d' = V' expm1(eps)
   * Threshold crossing uses the exact difference T = ln(1e10) - Re(L0 V).
   * The full value is formed from exp(eps), never as V + d, so an orbit falling
   * towards zero keeps its relative precision. When |w| < |d| the pixel rebases to
   * the virtual start V[0] = 0; it also rebases when the reference ends. An optional
   * BLA table (blaTable) skips runs of linear steps while |d| is small. */
  function perturb64(ref, dcr, dci, iterations, rules = RULES.cpu, bla = null) {
    const V = ref.V, T = ref.T, ReA = ref.ReA, ImA = ref.ImA, length = ref.length, values = ref.values;
    const [xr, xi] = cdiv(dcr, dci, ref.c0[0], ref.c0[1]);
    const dLr = 0.5 * Math.log1p(2 * xr + xr * xr + xi * xi), dLi = Math.atan2(xi + 0, 1 + xr);
    if (!Number.isFinite(dLr) || !Number.isFinite(dLi)) return { kind: 4, steps: 0, re: NaN, im: NaN };
    const Lr = ref.L0[0] + dLr, Li = ref.L0[1] + dLi, lowA = rules.lowA, maxB = rules.maxB, tolerance = rules.tol;
    const levels = bla ? bla.levels : 0, base = bla?.base, table = bla?.data;
    let k = 1, dr = 0, di = 0, wr = 1, wi = 0, oldr = 0, oldi = 0, fixed = 0, periodic = 0, linear = levels > 0;
    for (let n = 1; n <= iterations; n++) {
      if (k >= length) { dr = wr; di = wi; k = 0; }
      if (k === 0) linear = levels > 0;
      if (linear && k > 1 && (k & 1) === 0 && fixed === 0 && periodic === 0) {
        // Largest aligned run whose radius still contains |d|.
        const d = Math.hypot(dr, di);
        let j = 1, skip = 0;
        while (j < levels && (k & ((2 << j) - 1)) === 0) j++;
        for (; j >= 1; j--) {
          const len = 1 << j;
          if (n + len - 1 > iterations) continue;
          const e = 5 * (base[j] + (k >> j)), R = table[e + 4];
          if (R > 0 && d < R) {
            const ar = table[e], ai = table[e + 1], br = table[e + 2], bi = table[e + 3];
            const nr = ar * dr - ai * di + br * dLr - bi * dLi;
            di = ar * di + ai * dr + br * dLi + bi * dLr; dr = nr;
            skip = len;
            break;
          }
          if (j === 1 && R > 0) linear = false;
        }
        if (skip) {
          // Skipped steps stay within epsMax of the reference, so V + d loses nothing here.
          k += skip; n += skip - 1;
          wr = V[2 * k] + dr; wi = V[2 * k + 1] + di; oldr = V[2 * k - 2]; oldi = V[2 * k - 1];
          continue;
        }
      }
      const vr = V[2 * k], vi = V[2 * k + 1];
      const er = vr * dLr - vi * dLi + dr * Lr - di * Li, ei = vr * dLi + vi * dLr + dr * Li + di * Lr;
      if (er > T[k]) return { kind: 3, steps: n + Math.min(1, (er - T[k]) / LOG_R), re: wr, im: wi };
      const a = ReA[k] + er, b = ImA[k] + ei;
      if (!(a >= lowA) || !(Math.abs(b) <= maxB)) return { kind: 4, steps: n, re: wr, im: wi };
      let nr, ni;
      if (k + 1 >= values) {
        const r = Math.exp(a);
        nr = r * Math.cos(b); ni = r * Math.sin(b); dr = nr; di = ni; k = 0;
      } else {
        const Wr = V[2 * k + 2], Wi = V[2 * k + 3], ex = Math.exp(er), c = Math.cos(ei), s = Math.sin(ei), h = Math.sin(ei / 2);
        const mr = Math.expm1(er) * c - 2 * h * h, mi = ex * s;
        dr = Wr * mr - Wi * mi; di = Wr * mi + Wi * mr;
        nr = ex * (Wr * c - Wi * s); ni = ex * (Wr * s + Wi * c);
        k++;
      }
      const r = Math.hypot(nr, ni), tol = tolerance * (1 + r);
      fixed = Math.hypot(nr - wr, ni - wi) < tol ? fixed + 1 : 0;
      periodic = n > 2 && Math.hypot(nr - oldr, ni - oldi) < tol ? periodic + 1 : 0;
      oldr = wr; oldi = wi; wr = nr; wi = ni;
      if (fixed >= 8) return { kind: 1, steps: n, re: wr, im: wi };
      if (periodic >= 12) return { kind: 2, steps: n, re: wr, im: wi };
      if (k && nr * nr + ni * ni < dr * dr + di * di) { dr = nr; di = ni; k = 0; }
    }
    return { kind: 0, steps: iterations, re: wr, im: wi };
  }
  // Direct FP64 orbit using arbitrary rules; the GPU rule set mirrors the FP32 shader exactly.
  function orbitRules(cr, ci, iterations, rules) {
    if (!Number.isFinite(cr + ci) || (cr === 0 && ci === 0)) return { kind: 4, steps: 0, re: NaN, im: NaN };
    const lr = Math.log(Math.hypot(cr, ci)), li = ci === 0 && cr < 0 ? Math.PI : Math.atan2(ci, cr);
    let wr = 1, wi = 0, oldr = 0, oldi = 0, fixed = 0, periodic = 0;
    for (let n = 1; n <= iterations; n++) {
      const a = wr * lr - wi * li, b = wr * li + wi * lr;
      if (!Number.isFinite(a + b)) return { kind: 4, steps: n, re: wr, im: wi };
      if (a > LOG_R) return { kind: 3, steps: n + Math.min(1, (a - LOG_R) / LOG_R), re: wr, im: wi };
      if (a < rules.lowA || Math.abs(b) > rules.maxB) return { kind: 4, steps: n, re: wr, im: wi };
      const r = Math.exp(a), nr = r * Math.cos(b), ni = r * Math.sin(b), tol = rules.tol * (1 + r);
      fixed = Math.hypot(nr - wr, ni - wi) < tol ? fixed + 1 : 0;
      periodic = n > 2 && Math.hypot(nr - oldr, ni - oldi) < tol ? periodic + 1 : 0;
      oldr = wr; oldi = wi; wr = nr; wi = ni;
      if (fixed >= 8) return { kind: 1, steps: n, re: wr, im: wi };
      if (periodic >= 12) return { kind: 2, steps: n, re: wr, im: wi };
    }
    return { kind: 0, steps: iterations, re: wr, im: wi };
  }
  /* Find a detailed place to show: start from a random structured region, then
   * repeatedly zoom into the most varied cell of a coarse FP64 grid. `random`
   * returns numbers in [0, 1). Stays above FP64 precision; deeper zoom is manual. */
  function discover(random, options = {}) {
    const rules = RULES.gpu, iterations = options.iterations || 384, W = 32, H = 20, cells = 4;
    const regions = [[-2.5, 0.2, 2.4], [-1.84, 0.09, 0.9], [-0.72, 0.36, 1.2], [-0.2, 0.9, 1.6], [0.2, 1.4, 1.6], [1.3, 1.6, 1.4], [-1.2, 1.2, 1.4]];
    const levels = options.levels ?? 4 + Math.floor(random() * 9);
    const pick = regions[Math.floor(random() * regions.length)];
    let x = pick[0] + (random() - 0.5) * pick[2] * 0.5, y = pick[1] + (random() - 0.5) * pick[2] * 0.5, span = pick[2];
    const visited = [];
    for (let level = 0; level <= levels; level++) {
      const grid = new Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const r = orbitRules(x + (i + 0.5 - W / 2) / W * span, y + (H / 2 - j - 0.5) / W * span, iterations, rules);
        grid[j * W + i] = r.kind * 100000 + Math.floor(r.steps);
      }
      const scored = [];
      for (let cj = 0; cj < cells; cj++) for (let ci = 0; ci < cells; ci++) {
        const set = new Set();
        for (let j = cj * H / cells; j < (cj + 1) * H / cells; j++) for (let i = ci * W / cells; i < (ci + 1) * W / cells; i++) set.add(grid[j * W + i]);
        scored.push({ci, cj, score: set.size - 0.4 * (Math.abs(ci - 1.5) + Math.abs(cj - 1.5)) + random()});
      }
      visited.push({x, y, span, distinct: new Set(grid).size});
      if (level === levels || span < 1e-11) break;
      scored.sort((a, b) => b.score - a.score);
      const cell = scored[Math.floor(random() * Math.min(3, scored.length))];
      x += ((cell.ci + 0.5) / cells - 0.5) * span;
      y += (0.5 - (cell.cj + 0.5) / cells) * H / W * span;
      span /= 3 + random() * 5;
    }
    // The deepest level that still shows most of the detail found on the way down.
    const most = Math.max(...visited.map(v => v.distinct));
    const best = visited.filter(v => v.distinct >= Math.max(40, most * 0.6)).at(-1) || visited[0];
    return {x: best.x, y: best.y, span: best.span, distinct: best.distinct};
  }
  // Cyclic, smoothly interpolated palettes shared by the CPU and both shaders.
  const ramps = [
    [[10,8,35],[51,25,122],[138,38,197],[240,76,148],[255,172,104],[138,239,220],[42,154,211],[24,50,133]],
    [[24,5,27],[86,11,78],[189,35,103],[250,92,55],[255,203,116],[174,216,200],[67,96,165],[60,24,110]],
    [[3,13,32],[13,40,100],[18,90,185],[22,178,204],[157,235,202],[227,245,210],[101,148,209],[45,37,139]]
  ];
  /* Escape bands: the log term separates the first bands near the overview; the
   * linear term keeps colours cycling at depth, where every pixel needs thousands
   * of steps and a pure logarithm would compress the whole view into one shade. */
  function color(kind, steps, palette = 0, re = 0, im = 0) {
    const s = Math.max(steps, 1);
    if (palette === 3) {
      const v = Math.round(kind===3?48+184*(.5-.5*Math.cos((Math.log2(s+1)*.2801+s/160)*2*Math.PI)):[6,18,32,0,86][kind]);
      return [v,v,v];
    }
    if(kind===4)return [42,31,47];
    if(kind===0)return [10,9,24];
    let t,light=1;
    if(kind===3)t=Math.log2(s+1)*.42+s/160+.08;
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
    float s=max(steps,1.);
    if(uPalette==3){float v=kind==3?48.+184.*(.5-.5*cos(fract(log2(s+1.)*.2801+s/160.)*6.28318530718)):kind==1?18.:kind==2?32.:kind==4?86.:6.;return vec3(v/255.);}
    if(kind==4)return vec3(42.,31.,47.)/255.;
    if(kind==0)return vec3(10.,9.,24.)/255.;
    if(kind==3)return ramp(log2(s+1.)*.42+s/160.+.08);
    if(kind==2)return ramp(.27)*.22;
    // Some GPU drivers return pi for atan(-0., x > 0.); resolve the real axis explicitly.
    float m=min(log2(1.+length(w)),3.);float angle=abs(w.y)>1e-37?atan(w.y,w.x):(w.x<0.?3.14159265359:0.);
    return ramp(.59+angle/6.28318530718*.5+m*.12)*(.14+m*.07);
  }`;
  /* Linearisation bounds per engine: about one rounding unit of the arithmetic that
   * applies the table (FP32 mantissas on the GPU, FP64 in Workers). */
  const BLA_EPS = { gpu: 2 ** -24, cpu: 2 ** -53 };
  root.TetraCore = { STATUS, AA, RULES, LOG_R, BLA_EPS, orbit64, orbitRules, perturb64, blaTable, blaReach, offsetBound, logOffsetBound, cdiv, discover, makePreciseOrbit, color, paletteGLSL };
  if (typeof module !== 'undefined') module.exports = root.TetraCore;
})(globalThis);
