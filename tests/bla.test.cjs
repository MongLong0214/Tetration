'use strict';
// Bilinear approximation (BLA): table algebra, radius semantics, refusal conditions,
// equality with plain perturbation in structured views and fidelity in chaotic ones.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createFixed} = require('../src/precision.js');
global.createFixed = createFixed;
const Ref = require('../src/reference.js');
const core = require('../src/core.js');
global.TetraCore = core;
const render = require('../src/render.js');
const LOG_R = Math.log(1e10);

// Deterministic generator so failures reproduce.
function generator(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const abs = a => Math.hypot(a[0], a[1]);
const V = (ref, k) => [ref.V[2 * k], ref.V[2 * k + 1]];
const entry = (bla, j, k) => {
  const e = 5 * (bla.base[j] + (k >> j));
  return {A: [bla.data[e], bla.data[e + 1]], B: [bla.data[e + 2], bla.data[e + 3]], R: bla.data[e + 4]};
};

// A view, its reference and the |dL| bound used by the renderers.
function setup(cx, cy, span, iterations, rulesName, W = 48, H = 28) {
  const F = createFixed(256), view = {x: F.parse(cx), y: F.parse(cy), span: F.parse(span)}, point = render.referencePoint(F, view);
  const digits = Math.min(256, Math.max(30, Math.ceil(-Math.log10(Number(span))) + 40));
  const ref = Ref.compute({x: F.text(point.x), y: F.text(point.y), digits, iterations, maxRe: rulesName === 'gpu' ? 80 : 700});
  const ns = Number(span), dx = F.number(view.x - point.x), dy = F.number(view.y - point.y), dym = F.number(-view.y - point.y), yc = F.number(view.y);
  const dL = core.logOffsetBound(core.offsetBound(dx, dy, dym, yc, ns / 2, ns * H / W / 2) / Math.hypot(ref.c0[0], ref.c0[1]));
  const rules = core.RULES[rulesName], bla = core.blaTable(ref, dL, rules, core.BLA_EPS[rulesName]);
  const pixels = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const ox = (i + 0.5 - W / 2) / W * ns, oy = (H / 2 - j - 0.5) / W * ns, mirrored = yc + oy < 0;
    pixels.push({i, j, mirrored, dcr: dx + ox, dci: mirrored ? dym - oy : dy + oy, x: view.x + F.parse(((i + 0.5 - W / 2) / W).toPrecision(17)) * view.span / F.Q, y: view.y + F.parse(((H / 2 - j - 0.5) / W).toPrecision(17)) * view.span / F.Q});
  }
  return {F, view, point, ref, rules, bla, dL, digits, pixels};
}

const views = {
  horizon: ['-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206', '0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475', '7e-100', 4096],
  abyss: ['-0.605137938972379900971816986088586258864125', '0.437740442074800562969426507709712806289976004723289995229', '7e-25', 1536],
  threshold: ['1.3594182965158676173336178455', '2.2496614865153754494134386028', '1e-55', 512],
  fixed: ['0.5', '0', '1e-150', 512],
  lower: ['0.7', '-0.3', '1e-30', 512],
  axis: ['-2.5', '0', '1e-9', 512],
  above: ['-1.84', '0.0000000003', '3e-9', 512],
};

test('every table entry equals the composition of its single linear steps', () => {
  const {ref, bla, dL} = setup(...views.horizon, 'gpu');
  assert.ok(bla && bla.levels >= 8, 'table built');
  const random = generator(7), L0 = ref.L0;
  let checked = 0;
  for (let j = 1; j <= bla.levels; j++) for (let m = 1; m * 2 ** j + 2 ** j <= bla.n && m <= 6; m++) {
    const k = m * 2 ** j, {A, B, R} = entry(bla, j, k);
    if (!(R > 0)) continue;
    const d0 = polar(R * random(), 2 * Math.PI * random()), dl = polar(dL * random(), 2 * Math.PI * random());
    let d = d0;
    for (let s = k; s < k + 2 ** j; s++) d = cmul(V(ref, s + 1), add(cmul(V(ref, s), dl), cmul(d, L0)));
    const expected = add(cmul(A, d0), cmul(B, dl)), scale = abs(A) * abs(d0) + abs(B) * abs(dl);
    assert.ok(abs([d[0] - expected[0], d[1] - expected[1]]) <= 1e-12 * scale, `level ${j} at ${k}`);
    checked++;
  }
  assert.ok(checked >= 20, `${checked} entries checked`);
});

test('inside the radius every covered step stays linear and the run matches exact steps', () => {
  for (const rulesName of ['gpu', 'cpu']) {
    const {ref, bla, dL} = setup(...views.abyss, rulesName), eps = core.BLA_EPS[rulesName], random = generator(11);
    const L = add(ref.L0, polar(dL, 0.7)), dl = polar(dL, 0.7);
    let checked = 0;
    for (let j = 1; j <= bla.levels; j++) for (let m = 1; m * 2 ** j + 2 ** j <= bla.n && m <= 8; m++) {
      const k = m * 2 ** j, {A, B, R} = entry(bla, j, k);
      if (!(R > 0)) continue;
      const d0 = polar(R * 0.999, 2 * Math.PI * random());
      let d = d0;
      for (let s = k; s < k + 2 ** j; s++) {
        const e = add(cmul(V(ref, s), dl), cmul(d, L));
        assert.ok(abs(e) <= eps * (1 + 1e-9), `${rulesName} level ${j} at ${k} step ${s}: |eps| ${abs(e)}`);
        assert.ok(e[0] < ref.T[s], 'no threshold crossing inside a run');
        const ex = Math.expm1(e[0]), c = Math.cos(e[1]), sn = Math.sin(e[1]), h = Math.sin(e[1] / 2);
        d = cmul(V(ref, s + 1), [ex * c - 2 * h * h, (1 + ex) * sn]);
      }
      // Linearisation (eps per step) plus double rounding in both computations.
      const linear = add(cmul(A, d0), cmul(B, dl)), scale = abs(A) * abs(d0) + abs(B) * dL;
      assert.ok(abs([d[0] - linear[0], d[1] - linear[1]]) <= 2 ** j * (eps + 8 * 2 ** -52) * scale + 1e-300, `${rulesName} level ${j} at ${k}`);
      checked++;
    }
    assert.ok(checked >= 10, `${rulesName}: ${checked}`);
  }
});

test('steps near escape, near a fixed point and past the reference end are never skipped', () => {
  // The reference escapes after a few steps: only steps well before T <= 1 may be covered.
  const escaping = Ref.compute({x: '-2.5', y: '0.0000004', digits: 40, iterations: 512, maxRe: 80});
  const a = core.blaTable(escaping, 1e-12, core.RULES.gpu, core.BLA_EPS.gpu);
  if (a) for (let j = 1; j <= a.levels; j++) for (let k = 2 ** j; k < a.n; k += 2 ** j) {
    if (!(entry(a, j, k).R > 0)) continue;
    assert.ok(k + 2 ** j <= a.n, 'run inside the reference');
    for (let s = k; s < k + 2 ** j; s++) assert.ok(escaping.T[s] > 1, `step ${s} has T ${escaping.T[s]}`);
  }
  // A converging reference: once successive values agree, no run may cover the step.
  const fixed = Ref.compute({x: '0.5', y: '0.0000001', digits: 60, iterations: 2048});
  const b = core.blaTable(fixed, 1e-40, core.RULES.gpu, core.BLA_EPS.gpu);
  assert.ok(b, 'table for a convergent reference');
  const tol = core.RULES.gpu.tol;
  for (let j = 1; j <= b.levels; j++) for (let k = 2 ** j; k + 2 ** j <= b.n; k += 2 ** j) {
    if (!(entry(b, j, k).R > 0)) continue;
    for (let s = k; s < k + 2 ** j; s++) assert.ok(abs([fixed.V[2 * s + 2] - fixed.V[2 * s], fixed.V[2 * s + 3] - fixed.V[2 * s + 1]]) > 4 * tol, `step ${s}`);
  }
});

test('tables are refused for views too wide to linearise and for |L0| near zero', () => {
  const ref = Ref.compute({x: '-0.6', y: '0.43', digits: 40, iterations: 512});
  const l0 = Math.hypot(ref.L0[0], ref.L0[1]);
  assert.equal(core.blaTable(ref, core.BLA_EPS.gpu * l0, core.RULES.gpu, core.BLA_EPS.gpu), null);
  assert.ok(core.blaTable(ref, core.BLA_EPS.gpu * l0 / 4, core.RULES.gpu, core.BLA_EPS.gpu));
  assert.equal(core.blaTable(ref, Infinity, core.RULES.gpu, core.BLA_EPS.gpu), null);
  const one = Ref.compute({x: '1.0000001', y: '0.0000001', digits: 40, iterations: 512});
  assert.equal(core.blaTable(one, 1e-30, core.RULES.gpu, core.BLA_EPS.gpu), null);
  assert.equal(core.logOffsetBound(0.5), Infinity);
});

for (const [name, view] of Object.entries(views).filter(([name]) => !['horizon', 'abyss'].includes(name))) {
  test(`BLA perturbation equals plain perturbation pixel for pixel: ${name}`, () => {
    for (const rulesName of ['gpu', 'cpu']) {
      const {ref, rules, bla, pixels} = setup(...view, rulesName, 24, 14);
      for (const p of pixels) {
        const a = core.perturb64(ref, p.dcr, p.dci, view[3], rules), b = core.perturb64(ref, p.dcr, p.dci, view[3], rules, bla);
        assert.equal(b.kind, a.kind, `${rulesName} ${p.i},${p.j}`);
        assert.ok(Math.abs(b.steps - a.steps) <= 1e-9 * a.steps, `${rulesName} ${p.i},${p.j}: ${a.steps} vs ${b.steps}`);
        if (a.kind === 1 || a.kind === 2) assert.ok(Math.hypot(b.re - a.re, b.im - a.im) <= 1e-9 * (1 + Math.hypot(a.re, a.im)));
      }
    }
  });
}

// Exact orbit of one pixel (binary BigInt) classified with the given rules.
function exactKind(x, y, digits, iterations, rules) {
  const ref = Ref.compute({x, y, digits, iterations: iterations + 2, maxRe: 700});
  let wr = 1, wi = 0, oldr = 0, oldi = 0, fixed = 0, periodic = 0;
  for (let n = 1; n <= iterations; n++) {
    const a = ref.ReA[n], b = ref.ImA[n];
    if (a > LOG_R) return {kind: 3, steps: n + Math.min(1, (a - LOG_R) / LOG_R)};
    if (a < rules.lowA || Math.abs(b) > rules.maxB) return {kind: 4, steps: n};
    const nr = ref.V[2 * n + 2], ni = ref.V[2 * n + 3], tol = rules.tol * (1 + Math.hypot(nr, ni));
    fixed = Math.hypot(nr - wr, ni - wi) < tol ? fixed + 1 : 0;
    periodic = n > 2 && Math.hypot(nr - oldr, ni - oldi) < tol ? periodic + 1 : 0;
    oldr = wr; oldi = wi; wr = nr; wi = ni;
    if (fixed >= 8) return {kind: 1, steps: n};
    if (periodic >= 12) return {kind: 2, steps: n};
  }
  return {kind: 0, steps: iterations};
}

test('in a chaotic view BLA is as faithful to exact orbits as plain FP64 perturbation', () => {
  const {F, ref, rules, bla, pixels, digits} = setup(...views.abyss, 'cpu', 12, 8);
  assert.ok(bla, 'table built');
  const same = (p, q) => p.kind === q.kind && Math.abs(p.steps - q.steps) <= 1e-3 * Math.max(1, q.steps);
  let plain = 0, fast = 0;
  for (const p of pixels) {
    const e = exactKind(F.text(p.x), F.text(p.mirrored ? -p.y : p.y), digits, views.abyss[3], rules);
    if (!same(core.perturb64(ref, p.dcr, p.dci, views.abyss[3], rules), e)) plain++;
    if (!same(core.perturb64(ref, p.dcr, p.dci, views.abyss[3], rules, bla), e)) fast++;
  }
  assert.ok(fast <= plain + Math.max(3, plain * 0.25), `exact mismatches: plain ${plain}, BLA ${fast} of ${pixels.length}`);
});

test('at 1e-100 BLA skips most of the approach and renders several times faster', () => {
  const {ref, rules, bla, pixels} = setup(...views.horizon, 'gpu', 24, 14);
  assert.ok(core.blaReach(bla, ref) >= 0.6 * ref.length, `reach ${core.blaReach(bla, ref)} of ${ref.length}`);
  const kinds = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], time = [0, 0];
  for (const p of pixels) for (const [index, table] of [[0, null], [1, bla]]) {
    const t = performance.now(), r = core.perturb64(ref, p.dcr, p.dci, views.horizon[3], rules, table);
    time[index] += performance.now() - t; kinds[index][r.kind]++;
  }
  assert.ok(time[0] >= 2 * time[1], `plain ${time[0].toFixed(0)} ms, BLA ${time[1].toFixed(0)} ms`);
  for (let k = 0; k < 5; k++) assert.ok(Math.abs(kinds[0][k] - kinds[1][k]) <= 0.08 * pixels.length, `class ${k}: ${kinds[0][k]} vs ${kinds[1][k]}`);
});

test('the offset bound covers every pixel, mirrored ones included', () => {
  const random = generator(5);
  for (let n = 0; n < 200; n++) {
    const hw = 0.1 + random(), hh = 0.1 + random(), yc = (random() - 0.5) * 4, dx = (random() - 0.5) * 3, dy = (random() - 0.5) * 3, dym = (random() - 0.5) * 3;
    const bound = core.offsetBound(dx, dy, dym, yc, hw, hh);
    // Sample a grid plus the row where pixels switch to the mirrored offset (both sides).
    let worst = 0;
    const rows = Array.from({length: 21}, (_, b) => -hh + 2 * hh * b / 20);
    for (let a = 0; a <= 20; a++) {
      const qx = -hw + 2 * hw * a / 20;
      for (const qy of rows) worst = Math.max(worst, yc + qy < 0 ? Math.hypot(dx + qx, dym - qy) : Math.hypot(dx + qx, dy + qy));
      if (-yc > -hh && -yc < hh) worst = Math.max(worst, Math.hypot(dx + qx, dy - yc), Math.hypot(dx + qx, dym + yc));
    }
    assert.ok(bound >= worst * (1 - 1e-12), `case ${n}: ${bound} < ${worst}`);
    assert.ok(bound <= worst * (1 + 1e-12) + 1e-12, `case ${n}: ${bound} > ${worst}`);
  }
  for (let n = 0; n < 200; n++) {
    const [xr, xi] = polar(0.49 * random(), 2 * Math.PI * random());
    const lr = 0.5 * Math.log1p(2 * xr + xr * xr + xi * xi), li = Math.atan2(xi, 1 + xr);
    assert.ok(Math.hypot(lr, li) <= core.logOffsetBound(Math.hypot(xr, xi)) * (1 + 1e-12));
  }
});
