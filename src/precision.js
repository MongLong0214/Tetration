/* BigInt fixed-point arithmetic. Original implementation, no runtime dependencies.
 * Each arithmetic operation truncates at `digits` decimal places. This is NOT
 * interval arithmetic and does not certify the dynamics of an orbit. */
(function (root) {
  'use strict';
  function createFixed(digits = 64) {
    if (!Number.isInteger(digits) || digits < 20 || digits > 256) throw Error('Unsupported precision');
    const Q = 10n ** BigInt(digits), TWO = 2n * Q;
    const mul = (a, b) => a * b / Q;
    const div = (a, b) => { if (!b) throw Error('Division by zero'); return a * Q / b; };
    const abs = a => a < 0n ? -a : a;
    function parse(value) {
      const text = String(value);
      if (text.length > 600) throw Error('Input too long');
      const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d{1,4}))?$/i.exec(text);
      if (!m || !(m[2] || m[3])) throw Error('Invalid decimal');
      const exponent = Number(m[4] || 0);
      if (Math.abs(exponent) > 512) throw Error('Exponent out of range');
      const coefficient = BigInt((m[2] || '0') + (m[3] || ''));
      const shift = digits + exponent - (m[3] || '').length;
      const n = shift >= 0 ? coefficient * 10n ** BigInt(shift) : coefficient / 10n ** BigInt(-shift);
      return m[1] === '-' ? -n : n;
    }
    function text(n) {
      const negative = n < 0n; n = abs(n);
      const s = n.toString().padStart(digits + 1, '0');
      const fraction = s.slice(-digits).replace(/0+$/, '');
      return (negative && n ? '-' : '') + s.slice(0, -digits) + (fraction ? '.' + fraction : '');
    }
    const number = n => Number(text(n));
    function isqrt(n) {
      if (n < 0n) throw Error('Negative square root');
      if (n < 2n) return n;
      let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
      for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
    }
    const sqrt = a => isqrt(a * Q);
    function atanSeries(a) {
      const square = mul(a, a); let term = a, sum = a;
      for (let n = 1; n < digits * 8; n++) {
        term = -mul(term, square); const add = term / BigInt(2 * n + 1);
        if (add === 0n) break; sum += add;
      }
      return sum;
    }
    let piMemo, ln2Memo;
    const pi = () => piMemo ??= 16n * atanSeries(Q / 5n) - 4n * atanSeries(Q / 239n);
    function atan(a) {
      const negative = a < 0n; a = abs(a);
      const reciprocal = a > Q;
      if (reciprocal) a = div(Q, a);
      // Two half-angle reductions make the alternating series converge quickly.
      a = div(a, Q + sqrt(Q + mul(a, a)));
      a = div(a, Q + sqrt(Q + mul(a, a)));
      let result = 4n * atanSeries(a);
      if (reciprocal) result = pi() / 2n - result;
      return negative ? -result : result;
    }
    function atan2(y, x) {
      if (x > 0n) return atan(div(y, x));
      if (x < 0n) return atan(div(y, x)) + (y < 0n ? -pi() : pi());
      if (y) return y < 0n ? -pi() / 2n : pi() / 2n;
      throw Error('Undefined argument at zero');
    }
    function logSeries(a) {
      const t = div(a - Q, a + Q), square = mul(t, t);
      let term = t, sum = t;
      for (let n = 1; n < digits * 8; n++) {
        term = mul(term, square); const add = term / BigInt(2 * n + 1);
        if (add === 0n) break; sum += add;
      }
      return 2n * sum;
    }
    function ln(a) {
      if (a <= 0n) throw Error('Nonpositive logarithm');
      let k = a.toString(2).length - Q.toString(2).length;
      let m = k >= 0 ? a >> BigInt(k) : a << BigInt(-k);
      while (m < Q) { m *= 2n; k--; }
      while (m >= TWO) { m /= 2n; k++; }
      return logSeries(m) + BigInt(k) * (ln2Memo ??= logSeries(TWO));
    }
    function exp(a) {
      if (a > 32n * Q || a < -BigInt(digits * 3) * Q) throw Error('Exponential precision range');
      let reduced = a, squares = 0;
      while (abs(reduced) > Q / 8n) { reduced /= 2n; squares++; }
      let term = Q, result = Q;
      for (let n = 1; n < digits * 4; n++) {
        term = mul(term, reduced) / BigInt(n);
        if (term === 0n) break; result += term;
      }
      for (let n = 0; n < squares; n++) result = mul(result, result);
      if (result <= 0n) throw Error('Underflow at current precision');
      return result;
    }
    function sincos(a) {
      const p = pi(), full = 2n * p; a %= full;
      if (a > p) a -= full;
      if (a < -p) a += full;
      // Reduce into [-pi/2, pi/2] for less cancellation.
      let cosSign = 1n;
      if (a > p / 2n) { a = p - a; cosSign = -1n; }
      if (a < -p / 2n) { a = -p - a; cosSign = -1n; }
      const square = mul(a, a);
      let s = a, c = Q, st = a, ct = Q;
      for (let n = 1; n < digits * 4; n++) {
        st = -mul(st, square) / BigInt(2 * n * (2 * n + 1));
        ct = -mul(ct, square) / BigInt((2 * n - 1) * 2 * n);
        if (!st && !ct) break; s += st; c += ct;
      }
      return [s, cosSign * c];
    }
    return { digits, Q, parse, text, number, mul, div, abs, sqrt, pi, ln, exp, atan2, sincos };
  }
  root.createFixed = createFixed;
  if (typeof module !== 'undefined') module.exports = { createFixed };
})(globalThis);
