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
  function color(kind, steps, palette = 0) {
    // A neutral luminance ramp; classification and orbit arithmetic are unchanged.
    let value;
    if (palette === 2) value = kind === 3 ? 238 : kind === 4 ? 96 : 8;
    else {
      value = kind === 3 ? 48 + 184 * (0.5 - 0.5 * Math.cos(Math.log2(Math.max(steps, 1) + 1) * 1.76)) : [6,18,32,0,86][kind];
      if (palette === 1) value = 255 - value;
    }
    const byte = Math.round(value);
    return [byte,byte,byte];
  }
  root.TetraCore = { STATUS, orbit64, makePreciseOrbit, color };
  if (typeof module !== 'undefined') module.exports = root.TetraCore;
})(globalThis);
