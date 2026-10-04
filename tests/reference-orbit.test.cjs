'use strict';
// Exact reference orbits (binary fixed point) against the independent decimal BigInt arithmetic.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createFixed} = require('../src/precision.js');
const Ref = require('../src/reference.js');

// Decimal exp over a wide range: split large arguments, flush values below the precision.
function wideExp(f, a) {
  if (a < -BigInt(f.digits * 2) * f.Q) return 0n;
  let parts = 0;
  while (a > 30n * f.Q) { a /= 2n; parts++; }
  let r = f.exp(a);
  for (let i = 0; i < parts; i++) r = f.mul(r, r);
  return r;
}
// Decimal reference orbit with the same convention: V0 = 0, V1 = 1, V[k+1] = exp(L0 V[k]).
function decimalOrbit(x, y, steps, digits) {
  const f = createFixed(digits), {mul, abs} = f;
  const cr = f.parse(x), ci = f.parse(y);
  const scale = abs(cr) > abs(ci) ? abs(cr) : abs(ci);
  const xr = f.div(cr, scale), xi = f.div(ci, scale);
  const lr = f.ln(scale) + f.ln(mul(xr, xr) + mul(xi, xi)) / 2n, li = f.atan2(ci, cr);
  const logR = f.ln(f.parse('10000000000'));
  const out = [{re: 0n, im: 0n}];
  let wr = 0n, wi = 0n;
  const T = [];
  for (let k = 0; k < steps; k++) {
    const a = mul(wr, lr) - mul(wi, li), b = mul(wr, li) + mul(wi, lr);
    T.push(logR - a);
    if (a > 80n * f.Q) break;
    const r = wideExp(f, a), [s, c] = f.sincos(b);
    wr = mul(r, c); wi = mul(r, s);
    out.push({re: wr, im: wi});
  }
  return {f, out, T};
}
const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), Number.MIN_VALUE);

test('binary constants agree with the decimal library to 240 digits', () => {
  const bits = 900, c = Ref.constants(bits), f = createFixed(256);
  const toDecimal = v => (v * f.Q) >> BigInt(bits);
  const near = (actual, expected, digits) => assert.ok(f.abs(actual - expected) < f.parse('1e-' + digits), f.text(actual - expected));
  near(toDecimal(c.pi), f.pi(), 240);
  near(toDecimal(c.ln2), f.ln(f.parse('2')), 240);
  near(toDecimal(c.logR), f.ln(f.parse('10000000000')), 238);
  near(toDecimal(c.twoPi), 2n * f.pi(), 240);
});

test('toNumber rounds binary fixed point to the nearest double, including tiny and huge values', () => {
  const bits = 300, one = 1n << 300n;
  for (const value of [1, -1, 0.1, 3.141592653589793, 1e-80, -2.5e-60, 1e30, 7.25e80, 2 ** -250]) {
    const scaled = BigInt(Math.round(value * 2 ** 40)) * one / (1n << 40n);
    const exact = value * 2 ** 40 === Math.round(value * 2 ** 40);
    if (exact) assert.equal(Ref.toNumber(scaled, bits), value);
  }
  assert.equal(Ref.toNumber(0n, bits), 0);
  assert.equal(Ref.toNumber(one / 3n, bits), 1 / 3);
  assert.equal(Ref.toNumber(-(one * 7n) / 3n, bits), -7 / 3);
  assert.ok(relative(Ref.toNumber((one << 600n) / 3n, bits), 2 ** 600 / 3) < 1e-15);
  assert.equal(Ref.toNumber(1n << 300n, 1300), 2 ** -1000);
  assert.ok(relative(Ref.toNumber((1n << 300n) / 3n, 1400), 2 ** -1100 / 3) < 1e-15);
});

test('complex exp matches the decimal exp, sin and cos to the working precision', () => {
  const digits = 80, bits = Ref.bitsForDigits(digits), cexp = Ref.createComplexExp(bits), f = createFixed(100);
  const toBinary = v => (v << BigInt(bits)) / f.Q, toDecimal = v => (v * f.Q) >> BigInt(bits);
  for (const [a, b] of [['0', '0'], ['1', '1'], ['-3.5', '2.25'], ['23.4', '-41.2'], ['-75.5', '123456.789'], ['0.000001', '-0.0000001'], ['79.9', '1e6']]) {
    const [re, im] = cexp(toBinary(f.parse(a)), toBinary(f.parse(b)));
    const r = wideExp(f, f.parse(a)), [s, c] = f.sincos(f.parse(b));
    const er = f.mul(r, c), ei = f.mul(r, s);
    const tolerance = f.mul(f.parse('1e-' + (digits - 4)), f.Q + r);
    assert.ok(f.abs(toDecimal(re) - er) < tolerance, `re exp(${a}+${b}i)`);
    assert.ok(f.abs(toDecimal(im) - ei) < tolerance, `im exp(${a}+${b}i)`);
  }
  assert.deepEqual(cexp(-(BigInt(bits + 20) << BigInt(bits)), 0n), [0n, 0n]);
});

for (const [label, x, y, digits] of [
  ['complex boundary', '-0.6051379389723798914088658610885875', '0.43774044207480056919425292437637833332899567139', 60],
  ['negative real axis', '-2.5', '0', 50],
  ['positive real fixed point', '0.5', '0', 40],
  ['large modulus', '123456.75', '9876.5', 50],
  ['tiny modulus', '0.0000000000000000000003', '0.0000000000000000000001', 70],
  ['deep 200 digit point', '-0.6051379389723799009718170481321474982499502978158566284917489088582249922906803637117030014923449057255165281822059', '0.43774044207480056296942658666911315580801220130731934060992556137664811305119071089459189602731503449925369509247480', 224],
]) {
  test(`reference orbit equals decimal BigInt orbit to double rounding: ${label}`, () => {
    const steps = 24, ref = Ref.compute({x, y, digits, iterations: steps});
    const {f, out, T} = decimalOrbit(x, y, Math.min(steps, ref.length), Math.min(256, digits + 16));
    assert.ok(ref.length >= 1 && ref.values >= 2);
    for (let k = 0; k < Math.min(ref.values, out.length); k++) {
      const re = f.number(out[k].re), im = f.number(out[k].im), scale = Math.hypot(re, im);
      if (scale < 1e-300) continue;
      assert.ok(Math.abs(ref.V[2 * k] - re) <= scale * 4e-16 && Math.abs(ref.V[2 * k + 1] - im) <= scale * 4e-16, `${label} V[${k}] ${ref.V[2 * k]},${ref.V[2 * k + 1]} vs ${re},${im}`);
    }
    for (let k = 0; k < Math.min(ref.length, T.length); k++) {
      const expected = f.number(T[k]);
      assert.ok(Math.abs(ref.T[k] - expected) <= Math.max(Math.abs(expected) * 4e-16, 1e-300), `${label} T[${k}] ${ref.T[k]} vs ${expected}`);
    }
  });
}

test('threshold differences stay exact when the reference crosses exactly at the threshold', () => {
  // This point was bisected onto the threshold boundary at step 5: Re(A) - ln(1e10) is about 1e-16.
  const ref = Ref.compute({x: '-0.739910843481751397921170598', y: '0.260848220317312956665545163', digits: 120, iterations: 40});
  const {f, T} = decimalOrbit('-0.739910843481751397921170598', '0.260848220317312956665545163', 8, 136);
  assert.ok(Math.abs(ref.T[5]) < 1e-12, ref.T[5]);
  assert.ok(relative(ref.T[5], f.number(T[5])) < 1e-12, `${ref.T[5]} vs ${f.number(T[5])}`);
});

test('reference continues past its own threshold crossing until exp leaves the representable range', () => {
  const ref = Ref.compute({x: '2', y: '0', digits: 40, iterations: 100, maxRe: 80});
  assert.ok(ref.T.slice(0, ref.length).some(t => t < 0), 'the reference crosses the threshold');
  assert.ok(ref.length < 100, 'and then ends');
  assert.ok(ref.ReA[ref.length - 1] > 80 || Math.abs(ref.ImA[ref.length - 1]) > 1.2e12);
  for (let k = 0; k < ref.values; k++) assert.ok(Number.isFinite(ref.V[2 * k]) && Number.isFinite(ref.V[2 * k + 1]));
});

test('underflowing values keep floating magnitude and phase instead of becoming zero', () => {
  // exp(-200) is below the binary precision at 30 digits but representable in FP64.
  const bits = Ref.bitsForDigits(30), cexp = Ref.createComplexExp(bits);
  assert.deepEqual(cexp(-(200n << BigInt(bits)), 0n), [0n, 0n]);
  const ref = Ref.compute({x: '0.00000001', y: '0.00000001', digits: 30, iterations: 30, maxRe: 700});
  for (let k = 0; k < ref.values; k++) assert.ok(Number.isFinite(ref.V[2 * k]));
});

test('invalid reference points are rejected', () => {
  assert.throws(() => Ref.compute({x: '0', y: '0', digits: 40, iterations: 10}), /nonzero/);
  assert.throws(() => Ref.compute({x: '0.5', y: '-0.1', digits: 40, iterations: 10}), /upper half/);
  assert.throws(() => Ref.compute({x: 'NaN', y: '0', digits: 40, iterations: 10}));
});

test('reference orbit computation is fast enough for interactive deep zoom', () => {
  const x = '-0.6051379389723798914088658610885875', y = '0.43774044207480056919425292437637833332899567139';
  Ref.compute({x, y, digits: 60, iterations: 64});
  for (const [digits, limit] of [[60, 2500], [240, 9000]]) {
    const started = performance.now();
    const ref = Ref.compute({x, y, digits, iterations: 2048, maxRe: 80});
    const elapsed = performance.now() - started;
    assert.ok(elapsed < limit, `${digits} digits, ${ref.values} values took ${elapsed} ms`);
  }
});

test('reference orbits agree with the independent 300-digit mpmath fixtures', () => {
  const fixtures = require('./orbit-reference.json').cases;
  for (const item of fixtures) {
    const lower = item.y.startsWith('-'), y = lower ? item.y.slice(1) : item.y;
    const ref = Ref.compute({x: item.x, y, digits: 240, iterations: item.iterations + 1});
    const k = item.iterations + 1, re = Number(item.re), im = Number(item.im);
    const vr = ref.V[2 * k], vi = (lower ? -1 : 1) * ref.V[2 * k + 1], scale = Math.hypot(re, im);
    assert.ok(Math.abs(vr - re) <= scale * 3e-16 && Math.abs(vi - im) <= scale * 3e-16, `${item.label}: ${vr},${vi} vs ${re},${im}`);
  }
});
