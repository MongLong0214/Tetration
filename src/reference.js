/* Exact-precision reference orbits for perturbation rendering.
 * One high-precision orbit V[k] is computed per view; every pixel is then iterated
 * as a small offset from it in ordinary floating point. Binary fixed point keeps
 * each operation a multiply and a shift. Each step truncates at the working
 * precision; this is not interval arithmetic and certifies nothing. */
(function (root) {
  'use strict';
  const LOG_R = Math.log(1e10);
  const constantsCache = new Map();

  function bitLength(value) {
    return value === 0n ? 0 : value.toString(16).length * 4;
  }

  // Round a binary fixed-point value with `bits` fractional bits to the nearest double.
  function toNumber(value, bits) {
    if (value === 0n) return 0;
    const negative = value < 0n, magnitude = negative ? -value : value;
    const drop = Math.max(0, bitLength(magnitude) - 64);
    const top = Number(magnitude >> BigInt(drop));
    let exponent = drop - bits, result = top;
    while (exponent < -1000) { result *= 2 ** -1000; exponent += 1000; }
    while (exponent > 1000) { result *= 2 ** 1000; exponent -= 1000; }
    result *= 2 ** exponent;
    return negative ? -result : result;
  }

  // sum 1/((2k+1) n^(2k+1)), optionally alternating: atanh(1/n) or atan(1/n).
  function inverseSeries(n, one, alternating) {
    const square = BigInt(n * n);
    let term = one / BigInt(n), sum = term;
    for (let k = 1; term; k++) {
      term /= square;
      const part = term / BigInt(2 * k + 1);
      if (!part) break;
      sum += alternating && k % 2 ? -part : part;
    }
    return sum;
  }

  function constants(bits) {
    let cached = constantsCache.get(bits);
    if (cached) return cached;
    const guard = 48, wide = bits + 64 + guard, one = 1n << BigInt(wide);
    const pi = 16n * inverseSeries(5, one, true) - 4n * inverseSeries(239, one, true);
    const ln2 = 2n * inverseSeries(3, one, false);
    const ln10 = 3n * ln2 + 2n * inverseSeries(9, one, false);
    const down = value => value >> BigInt(wide - bits);
    cached = {
      pi: down(pi),
      twoPi: down(2n * pi),
      twoPiWide: (2n * pi) >> BigInt(guard),
      wideShift: 64n,
      ln2: down(ln2),
      logR: down(10n * ln10),
    };
    constantsCache.set(bits, cached);
    return cached;
  }

  function createComplexExp(bits) {
    const SHIFT = BigInt(bits), ONE = 1n << SHIFT;
    const {pi, twoPi, twoPiWide, wideShift, ln2} = constants(bits);
    const halvings = Math.max(8, Math.round(Math.sqrt(2 * bits)));
    const H = BigInt(halvings), underflow = -BigInt(bits + 8) * ln2;
    return function cexp(a, b) {
      if (a < underflow) return [0n, 0n];
      const half = ln2 >> 1n;
      const m = a >= 0n ? (a + half) / ln2 : -((half - a) / ln2);
      const r = a - m * ln2;
      const q = (b >= 0n ? b + pi : b - pi) / twoPi;
      const t = b - ((q * twoPiWide) >> wideShift);
      const zr = r >> H, zi = t >> H;
      let sr = ONE + zr, si = zi, tr = zr, ti = zi;
      for (let n = 2n; ; n++) {
        const nr = (tr * zr - ti * zi) >> SHIFT, ni = (tr * zi + ti * zr) >> SHIFT;
        tr = nr / n; ti = ni / n;
        if (!tr && !ti) break;
        sr += tr; si += ti;
      }
      for (let i = 0; i < halvings; i++) {
        const re = ((sr + si) * (sr - si)) >> SHIFT;
        si = (sr * si) >> (SHIFT - 1n);
        sr = re;
      }
      if (m > 0n) return [sr << m, si << m];
      if (m < 0n) return [sr >> -m, si >> -m];
      return [sr, si];
    };
  }

  function bitsForDigits(digits) {
    return Math.ceil(digits * Math.log2(10)) + 64;
  }

  /* Reference orbit for c0 = x + iy (decimal strings, y >= 0):
   * V[0] = 0 (virtual start, used for rebasing), V[1] = 1, V[k+1] = exp(L0 V[k]).
   * For each k with a computed exponent A[k] = L0 V[k]:
   *   T[k] = ln(1e10) - Re A[k] (exact difference, then rounded), ReA[k], ImA[k].
   * The orbit continues past the reference's own threshold crossing while
   * exp(A) stays representable, so neighbouring pixels can keep using it. */
  function compute(options) {
    const started = Date.now();
    const {x, y, iterations} = options;
    const digits = Math.max(30, Math.min(256, Math.ceil(options.digits)));
    const maxRe = options.maxRe ?? 80, maxIm = options.maxIm ?? 1.2e12;
    const bits = bitsForDigits(digits), SHIFT = BigInt(bits);
    const decimal = root.createFixed(Math.min(256, digits + 8));
    const cr = decimal.parse(x), ci = decimal.parse(y);
    if (!cr && !ci) throw Error('Reference point must be nonzero');
    if (ci < 0n) throw Error('Reference point must be in the closed upper half plane');
    const scale = decimal.abs(cr) > decimal.abs(ci) ? decimal.abs(cr) : decimal.abs(ci);
    const xr = decimal.div(cr, scale), xi = decimal.div(ci, scale);
    const lnModulus = decimal.ln(scale) + decimal.ln(decimal.mul(xr, xr) + decimal.mul(xi, xi)) / 2n;
    const argument = decimal.atan2(ci, cr);
    const toBinary = value => (value << SHIFT) / decimal.Q;
    const Lr = toBinary(lnModulus), Li = toBinary(argument);
    const {logR} = constants(bits);
    const cexp = createComplexExp(bits);
    const limitRe = BigInt(maxRe) << SHIFT, limitIm = BigInt(Math.round(maxIm)) << SHIFT;
    const V = new Float64Array(2 * (iterations + 2));
    const T = new Float64Array(iterations + 1), ReA = new Float64Array(iterations + 1), ImA = new Float64Array(iterations + 1);
    let vr = 0n, vi = 0n, length = 0, values = 1;
    for (let k = 0; k <= iterations; k++) {
      const ar = (vr * Lr - vi * Li) >> SHIFT, ai = (vr * Li + vi * Lr) >> SHIFT;
      T[k] = toNumber(logR - ar, bits); ReA[k] = toNumber(ar, bits); ImA[k] = toNumber(ai, bits);
      length = k + 1;
      if (ar > limitRe || ai > limitIm || -ai > limitIm) break;
      [vr, vi] = cexp(ar, ai);
      if (vr || vi) {
        V[2 * (k + 1)] = toNumber(vr, bits); V[2 * (k + 1) + 1] = toNumber(vi, bits);
      } else {
        // Below the binary precision: keep the tiny value's magnitude and phase in floating point.
        const magnitude = Math.exp(ReA[k]);
        V[2 * (k + 1)] = magnitude * Math.cos(ImA[k]); V[2 * (k + 1) + 1] = magnitude * Math.sin(ImA[k]);
      }
      values = k + 2;
    }
    return {
      x, y, digits, bits, iterations, length, values,
      V: V.slice(0, 2 * values), T: T.slice(0, length), ReA: ReA.slice(0, length), ImA: ImA.slice(0, length),
      L0: [toNumber(Lr, bits), toNumber(Li, bits)],
      c0: [Number(x), Number(y)],
      elapsed: Date.now() - started,
    };
  }

  root.TetraReference = {compute, toNumber, bitsForDigits, createComplexExp, constants, LOG_R};
  if (typeof module !== 'undefined') module.exports = root.TetraReference;
})(globalThis);
