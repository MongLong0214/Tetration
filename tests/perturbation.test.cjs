'use strict';
// FP64 perturbation from exact references against exact per-pixel orbits using identical rules.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createFixed} = require('../src/precision.js');
const Ref = require('../src/reference.js');
const core = require('../src/core.js');
global.TetraCore = core;
const render = require('../src/render.js');
const LOG_R = Math.log(1e10);

// Exact orbit with configurable rules and the Euclidean tolerance used by the FP paths.
function exactOrbit(x, y, iterations, rules, digits) {
  const f = createFixed(digits), {Q, mul, abs} = f;
  const logR = f.ln(f.parse('10000000000'));
  const cr = f.parse(x), ci = f.parse(y);
  if (!cr && !ci) return {kind: 4, steps: 0};
  const scale = abs(cr) > abs(ci) ? abs(cr) : abs(ci);
  const xr = f.div(cr, scale), xi = f.div(ci, scale);
  const lr = f.ln(scale) + f.ln(mul(xr, xr) + mul(xi, xi)) / 2n, li = f.atan2(ci, cr);
  const low = f.parse(String(rules.lowA)), maxB = f.parse(String(rules.maxB)), tol = f.parse(String(rules.tol));
  let wr = Q, wi = 0n, oldr = 0n, oldi = 0n, fixed = 0, periodic = 0;
  for (let n = 1; n <= iterations; n++) {
    const a = mul(wr, lr) - mul(wi, li), b = mul(wr, li) + mul(wi, lr);
    if (a > logR) return {kind: 3, steps: n + Math.min(1, f.number(f.div(a - logR, logR)))};
    if (a < low || abs(b) > maxB) return {kind: 4, steps: n};
    const r = f.exp(a), [s, c] = f.sincos(b), nr = mul(r, c), ni = mul(r, s);
    const t = mul(tol, Q + r), t2 = mul(t, t);
    fixed = mul(nr - wr, nr - wr) + mul(ni - wi, ni - wi) < t2 ? fixed + 1 : 0;
    periodic = n > 2 && mul(nr - oldr, nr - oldr) + mul(ni - oldi, ni - oldi) < t2 ? periodic + 1 : 0;
    oldr = wr; oldi = wi; wr = nr; wi = ni;
    if (fixed >= 8) return {kind: 1, steps: n, re: f.number(wr), im: f.number(wi)};
    if (periodic >= 12) return {kind: 2, steps: n, re: f.number(wr), im: f.number(wi)};
  }
  return {kind: 0, steps: iterations, re: f.number(wr), im: f.number(wi)};
}

// Compare a W x H grid. Returns mismatches split by orbit length.
function compareGrid(cx, cy, span, {W = 10, H = 6, iterations = 512, rules = core.RULES.gpu, offset = [0, 0]} = {}) {
  const F = createFixed(256);
  const view = {x: F.parse(cx), y: F.parse(cy), span: F.parse(span)};
  const point = render.referencePoint(F, view);
  point.x += F.parse(String(offset[0])) * view.span / F.Q;
  point.y += F.parse(String(offset[1])) * view.span / F.Q;
  if (point.y < 0n) point.y = -point.y;
  const digits = Math.min(256, Math.max(30, Math.ceil(-Math.log10(Number(span))) + 24));
  const ref = Ref.compute({x: F.text(point.x), y: F.text(point.y), digits, iterations, maxRe: rules === core.RULES.gpu ? 80 : 700});
  const result = {total: 0, short: [], long: 0, kinds: [0, 0, 0, 0, 0], ref};
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const ox = (i + 0.5 - W / 2) / W, oy = (H / 2 - j - 0.5) / W;
    const px = view.x + F.parse(ox.toPrecision(17)) * view.span / F.Q, py = view.y + F.parse(oy.toPrecision(17)) * view.span / F.Q;
    const mirrored = py < 0n, my = mirrored ? -py : py;
    const p = core.perturb64(ref, F.number(px - point.x), F.number(my - point.y), iterations, rules);
    if (mirrored && p.im !== undefined) p.im = -p.im;
    const e = exactOrbit(F.text(px), F.text(py), iterations, rules, digits + 16);
    result.total++; result.kinds[e.kind]++;
    let ok = p.kind === e.kind && Math.abs(p.steps - e.steps) <= 1e-6 * Math.max(1, e.steps);
    if (ok && (e.kind === 1 || e.kind === 2)) ok = Math.hypot(p.re - e.re, p.im - e.im) <= 1e-6 * (1 + Math.hypot(e.re, e.im));
    if (!ok) {
      if (Math.max(p.steps, e.steps) > iterations / 2) result.long++;
      else result.short.push({i, j, p, e});
    }
  }
  return result;
}

const views = [
  ['deep feather 1e-11', '-0.60513793897125000390886586125', '0.437740442074166660860919591166666666662329', '7e-12'],
  ['deep feather 1e-24', '-0.605137938972379900971816986088586258864125', '0.437740442074800562969426507709712806289976004723289995229', '7e-25'],
  ['coral plume 1e-10', '-2.2930579295624999999999991', '0.33208044555625', '5e-11'],
  ['negative real axis straddle', '-2.5', '0', '1e-9'],
  ['straddle with reference above axis', '-1.84', '0.0000000003', '3e-9'],
  ['view containing the origin', '0', '0', '1e-20'],
  ['lower half plane only', '0.7', '-0.3', '1e-30'],
  ['threshold boundary at 1e-55', '1.3594182965158676173336178455', '2.2496614865153754494134386028', '1e-55'],
  ['fixed-point interior at 1e-150', '0.5', '0', '1e-150'],
];
for (const [label, x, y, span] of views) {
  test(`FP64 perturbation equals exact orbits: ${label}`, () => {
    const r = compareGrid(x, y, span);
    assert.deepEqual(r.short, [], `${label}: short-orbit disagreement ${JSON.stringify(r.short.slice(0, 3))}`);
    // Long chaotic orbits are sensitive to any finite precision; keep them rare.
    assert.ok(r.long <= Math.ceil(r.total * 0.05), `${label}: ${r.long} long-orbit disagreements of ${r.total}`);
  });
}

test('an off-centre reference (rebasing and reference exhaustion) gives the same image', () => {
  const r = compareGrid('-0.60513793897125000390886586125', '0.437740442074166660860919591166666666662329', '7e-12', {offset: [0.45, -0.3]});
  assert.deepEqual(r.short, []);
  assert.ok(r.long <= 3, r.long);
});

test('CPU classification rules (underflow to -700) also agree at depth', () => {
  const r = compareGrid('-2.2930579295624999999999991', '0.33208044555625', '5e-13', {rules: core.RULES.cpu, W: 8, H: 5});
  assert.deepEqual(r.short, []);
  assert.ok(r.long <= 2, r.long);
});

test('a reference that escapes early still renders surviving pixels correctly', () => {
  // Centre escapes at step 7; most of the view survives longer and must rebase.
  const r = compareGrid('-2.5', '0.0000004', '2e-6', {W: 8, H: 5});
  assert.ok(r.ref.length < 40, `reference length ${r.ref.length}`);
  assert.deepEqual(r.short, []);
});

test('pixel at the reference follows the reference orbit; pixel at the origin is a numerical limit', () => {
  const ref = Ref.compute({x: '0.5', y: '0', digits: 40, iterations: 256});
  const p = core.perturb64(ref, 0, 0, 256, core.RULES.gpu);
  const direct = core.orbitRules(0.5, 0, 256, core.RULES.gpu);
  assert.equal(p.kind, direct.kind); assert.equal(p.steps, direct.steps);
  assert.ok(Math.abs(p.re - direct.re) < 1e-12);
  assert.equal(core.perturb64(ref, -0.5, 0, 256).kind, 4);
});

test('perturbation agrees with direct FP64 in smooth regions at shallow depth', () => {
  for (const [x, y] of [[0.3, 0.2], [1.2, 0.1], [-0.2, 0.7]]) {
    const ref = Ref.compute({x: String(x), y: String(y), digits: 40, iterations: 512, maxRe: 700});
    for (const [dx, dy] of [[1e-3, 0], [0, -1e-3], [-7e-4, 5e-4]]) {
      const p = core.perturb64(ref, dx, dy, 512, core.RULES.cpu), d = core.orbit64(x + dx, y + dy, 512);
      assert.equal(p.kind, d.kind, `${x},${y}`);
      if (d.kind === 1) assert.ok(Math.hypot(p.re - d.re, p.im - d.im) < 1e-9);
      else assert.equal(p.steps, d.steps);
    }
  }
});

test('conjugate symmetry: mirrored pixels give conjugate fixed points and identical escapes', () => {
  const ref = Ref.compute({x: '-0.2', y: '0.7', digits: 40, iterations: 512});
  const up = core.perturb64(ref, 1e-4, 2e-4, 512), dir = core.orbitRules(-0.2 + 1e-4, -(0.7 + 2e-4), 512, core.RULES.gpu);
  assert.equal(up.kind, dir.kind);
  if (up.kind === 1) assert.ok(Math.abs(up.im + dir.im) < 1e-9 && Math.abs(up.re - dir.re) < 1e-9);
});

test('GPU scene offsets keep FP32-sized mantissas at any depth', () => {
  const F = createFixed(256);
  for (const span of ['7', '1e-30', '7e-100', '1e-200']) {
    const view = {x: F.parse('-0.6051379389723799'), y: F.parse('0.4377404420748005'), span: F.parse(span)};
    const point = render.referencePoint(F, view), scene = render.perturbScene(F, view, point.x, point.y);
    assert.ok(scene.spanMant >= 1 && scene.spanMant < 2.0000001, `${span}: ${scene.spanMant}`);
    assert.ok(Math.abs(2 ** scene.scale * scene.spanMant - Number(span)) <= Number(span) * 1e-12);
    // The reference sits at the centre unless the view also contains the origin.
    if (Number(span) < 0.5) assert.deepEqual(scene.delta, [0, 0]);
    else assert.ok(Math.hypot(...scene.delta) < 2 * scene.spanMant);
    const inv = core.cdiv(1, 0, F.number(point.x), F.number(point.y));
    assert.ok(Math.abs(scene.inv[0] * 2 ** scene.invExp - inv[0]) < 1e-12 && Math.abs(scene.inv[1] * 2 ** scene.invExp - inv[1]) < 1e-12);
    assert.ok(Math.max(Math.abs(scene.inv[0]), Math.abs(scene.inv[1])) >= 1 && Math.max(Math.abs(scene.inv[0]), Math.abs(scene.inv[1])) < 2);
  }
  // A view centred on the origin moves its reference away from the singular point.
  const origin = {x: 0n, y: 0n, span: F.parse('1e-20')}, p = render.referencePoint(F, origin);
  assert.ok(p.x !== 0n && p.y > 0n);
  // Lower half-plane views use the conjugate reference; mirrored pixels then need no offset.
  const lower = {x: F.parse('0.7'), y: F.parse('-0.3'), span: F.parse('1e-30')}, q = render.referencePoint(F, lower);
  assert.equal(F.text(q.y), '0.3');
  assert.deepEqual(render.perturbScene(F, lower, q.x, q.y).deltaMirror, [0, 0]);
});

test('escape-band colours keep cycling at depth and stay bounded', () => {
  const shades = new Set();
  for (let steps = 2700; steps < 3600; steps += 60) shades.add(core.color(3, steps + 0.5, 0).join(','));
  assert.ok(shades.size >= 12, `deep escape counts produce ${shades.size} distinct colours`);
  for (const palette of [0, 1, 2, 3]) for (const steps of [1, 2.5, 40, 1000.25, 16384]) {
    for (const v of core.color(3, steps, palette)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
  }
  assert.ok(Math.abs(LOG_R - core.LOG_R) < 1e-15);
});
