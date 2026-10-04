'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = ['precision.js', 'reference.js', 'core.js', 'worker.js'].map(p => fs.readFileSync(path.join(__dirname, '../src', p), 'utf8')).join('\n');

function workerContext(onMessage, yieldAPI) {
  let clock = 0, yields = 0;
  const self = {postMessage: onMessage, scheduler: yieldAPI ? {yield: async () => { yields++; }} : undefined};
  const context = vm.createContext({self, Uint8ClampedArray, Float64Array, performance: {now: () => clock += 20}, setTimeout: f => { yields++; f(); }, Date});
  vm.runInContext(source, context);
  return {self, yields: () => yields};
}
function referenceFor(x, y, digits, iterations) {
  let ref = null;
  const {self} = workerContext(d => { assert.ok(!d.error, d.error); ref = d.ref; });
  self.onmessage({data: {type: 'reference', id: 7, options: {x, y, digits, iterations, maxRe: 700}}});
  return ref;
}
async function render(job, parallel, yieldAPI) {
  const {width, height} = job, pixels = new Uint8ClampedArray(width * height * 4), covered = new Uint8Array(width * height), counts = [0, 0, 0, 0, 0];
  let yields = 0;
  await Promise.all(Array.from({length: parallel}, async (_, index) => {
    let complete = false;
    const ctx = workerContext(d => {
      assert.ok(!d.error, d.error);
      if (d.tile) {
        let p = 0;
        for (let y = d.tile.y; y < d.tile.y + d.tile.height; y++) for (let x = d.tile.x; x < d.tile.x + d.tile.width; x++) {
          const offset = y * width + x; covered[offset]++; pixels.set(d.pixels.slice(p, p + 4), offset * 4); p += 4;
        }
      }
      if (d.complete) { complete = true; d.counts.forEach((n, i) => { counts[i] += n; }); }
    }, yieldAPI);
    await ctx.self.onmessage({data: {...job, id: 1, index, workers: parallel, bitmap: false}});
    yields += ctx.yields();
    assert.ok(complete);
  }));
  assert.ok(covered.every(n => n === 1), 'each pixel computed exactly once');
  assert.equal(counts.reduce((a, b) => a + b), width * height);
  return {pixels, counts, yields};
}
const base = {x: '0.5', y: '0.1', span: '0.15', width: 29, height: 17, digits: 40, iterations: 64, palette: 1};

for (const mode of ['cpu', 'exact']) test(`${mode} worker pool matches serial pixels and counts across partial edge tiles`, async () => {
  const serial = await render({...base, mode}, 1, false), parallel = await render({...base, mode}, 4, true);
  assert.deepEqual(parallel.pixels, serial.pixels); assert.deepEqual(parallel.counts, serial.counts);
  assert.ok(serial.yields + parallel.yields > 0);
});

test('exact mode really evaluates decimal BigInt orbits, not FP64', async () => {
  // Below FP64 resolution: FP64 sees one point, the exact mode sees distinct coordinates.
  const deep = {...base, x: '0.500000000000000000000000000001', y: '0', span: '1e-28', width: 6, height: 4, digits: 70, iterations: 48};
  const exact = await render({...deep, mode: 'exact'}, 1, false);
  assert.equal(exact.counts.reduce((a, b) => a + b), 24);
  const fp64 = await render({...deep, mode: 'cpu'}, 1, false);
  assert.equal(fp64.counts[1], 24);
});

test('FP64 perturbation tiles agree with exact per-pixel orbits at 1e-20', async () => {
  const x = '-2.2930579295544318305441661605091000001', y = '0.3320804455708052447815830562499', span = '5e-21';
  const ref = referenceFor(x, y, 60, 384);
  assert.ok(ref && ref.length > 1);
  const job = {...base, x, y, span, width: 12, height: 8, iterations: 384, palette: 0, mode: 'cpu-perturb',
    ref, deltaRe: 0, deltaIm: 0, deltaMirror: -2 * Number(y), imCenter: Number(y), digits: 60};
  const serial = await render(job, 1, false), parallel = await render(job, 3, true);
  assert.deepEqual(parallel.pixels, serial.pixels);
  const exact = await render({...job, mode: 'exact', ref: undefined}, 1, false);
  let differing = 0;
  for (let i = 0; i < serial.pixels.length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(serial.pixels[i + c] - exact.pixels[i + c]))) > 1) differing++;
  assert.ok(differing <= 2, `${differing} of 96 pixels differ from exact orbits`);
});

test('a newer job supersedes a running one at the next yield', async () => {
  const posted = [];
  const {self} = workerContext(d => posted.push(d), true);
  const first = self.onmessage({data: {...base, mode: 'exact', width: 40, height: 30, id: 1, index: 0, workers: 1, bitmap: false}});
  await self.onmessage({data: {type: 'cancel'}});
  await first;
  assert.ok(!posted.some(d => d.id === 1 && d.complete), 'cancelled job never reports completion');
});

test('reference requests transfer exact orbit arrays', () => {
  const ref = referenceFor('-0.6051379389723798914088658610885875', '0.43774044207480056919425292437637833332899567139', 60, 128);
  assert.equal(ref.digits, 60); assert.ok(ref.V instanceof Float64Array && ref.T.length === ref.length);
  let error = null;
  const {self} = workerContext(d => { error = d.error; });
  self.onmessage({data: {type: 'reference', id: 2, options: {x: '0', y: '0', digits: 40, iterations: 10}}});
  assert.match(error, /nonzero/);
});

test('discover returns a detailed, reproducible place within FP64 range', () => {
  const places = [];
  for (const seed of [1, 2, 3]) {
    let place = null;
    const {self} = workerContext(d => { assert.ok(!d.error, d.error); place = d.place; });
    self.onmessage({data: {type: 'discover', id: 3, seed}});
    places.push(place);
    assert.ok(Number.isFinite(place.x) && Number.isFinite(place.y) && place.span > 1e-12 && place.span < 0.5, JSON.stringify(place));
    assert.ok(place.distinct >= 40, `seed ${seed} found only ${place.distinct} distinct classes`);
  }
  let again = null;
  const {self} = workerContext(d => { again = d.place; });
  self.onmessage({data: {type: 'discover', id: 4, seed: 2}});
  assert.equal(JSON.stringify(again), JSON.stringify(places[1]));
  assert.notEqual(JSON.stringify(places[0]), JSON.stringify(places[2]));
});
