'use strict';
/* Per-pixel orbit statistics with the FP64 perturbation (the GPU rule set), no browser needed:
 * class counts, step quantiles, and loop iterations per pixel without and with BLA (the work a
 * GPU pixel does). Usage: node tools/perf/orbit_work.cjs [view ...] [--grid 64x40] */
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.resolve(__dirname, '../..');
const {createFixed} = require(path.join(root, 'src/precision.js'));
const Ref = require(path.join(root, 'src/reference.js'));
// A copy of core.js that counts loop iterations of perturb64 (one per step or BLA skip).
const source = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
const start = source.indexOf('function perturb64'), loop = 'for (let n = 1; n <= iterations; n++) {', at = source.indexOf(loop, start) + loop.length;
const counted = path.join(os.tmpdir(), 'tetra-core-counted.cjs');
fs.writeFileSync(counted, source.slice(0, at) + ' globalThis.__work = (globalThis.__work || 0) + 1;' + source.slice(at));
const core = require(counted);
global.TetraCore = core;
const render = require(path.join(root, 'src/render.js'));

const views = JSON.parse(fs.readFileSync(path.join(__dirname, 'views.json'), 'utf8'));
const args = process.argv.slice(2), gridArg = args.indexOf('--grid');
const [W, H] = gridArg >= 0 ? args.splice(gridArg, 2)[1].split('x').map(Number) : [64, 40];
const names = args.length ? args : ['plume', 'abyss', 'horizon'];
const AUTO = [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384];
const F = createFixed(256);

for (const name of names) {
  const {x, y, span} = views[name], ns = Number(span);
  // Same automatic iteration limit as the app (main.js iterationsFor).
  const N = AUTO.find(n => n >= 320 + 34 * Math.max(0, Math.log10(7 / ns))) || AUTO.at(-1);
  const view = {x: F.parse(x), y: F.parse(y), span: F.parse(span)}, point = render.referencePoint(F, view);
  const t0 = Date.now();
  const ref = Ref.compute({x: F.text(point.x), y: F.text(point.y), digits: Math.min(256, Math.ceil(-Math.log10(ns)) + 30), iterations: N, maxRe: 80});
  const refMs = Date.now() - t0;
  const dx = F.number(view.x - point.x), dy = F.number(view.y - point.y), dym = F.number(-view.y - point.y), yc = F.number(view.y);
  const dL = core.logOffsetBound(core.offsetBound(dx, dy, dym, yc, ns / 2, ns * H / W / 2) / Math.hypot(ref.c0[0], ref.c0[1]));
  const bla = core.blaTable(ref, dL, core.RULES.gpu, core.BLA_EPS.gpu);
  const kinds = [0, 0, 0, 0, 0], steps = [];
  const run = table => {
    globalThis.__work = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const ox = (i + 0.5 - W / 2) / W * ns, oy = (H / 2 - j - 0.5) / W * ns, mirrored = yc + oy < 0;
      const p = core.perturb64(ref, dx + ox, mirrored ? dym - oy : dy + oy, N, core.RULES.gpu, table);
      if (!table) { kinds[p.kind]++; steps.push(p.steps); }
    }
    return globalThis.__work / (W * H);
  };
  const plain = run(null), withBla = bla ? run(bla) : null;
  steps.sort((a, b) => a - b);
  const q = f => Math.round(steps[Math.floor(f * (steps.length - 1))]);
  console.log(JSON.stringify({view: name, iterations: N, refLength: ref.length, refMs, kinds: {cap: kinds[0], fixed: kinds[1], periodic: kinds[2], escaped: kinds[3], collapsed: kinds[4]},
    steps: {p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1)}, blaReach: bla ? core.blaReach(bla, ref) : 0,
    workPerPixel: {plain: Math.round(plain), bla: withBla === null ? null : Math.round(withBla)}}));
}
