'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');

test('a rebased perturbation cycle retains its native FP64 phase and finite cap', () => {
  for (const ci of [.22225, -.22225, 0, -0]) {
    const cr = -1.9837500000000001;
    const ref = {c0: [cr, ci], L0: [Math.log(Math.hypot(cr, ci)), ci === 0 ? Math.PI : Math.atan2(ci, cr)],
      length: 1, values: 1, V: new Float64Array(2), T: [core.LOG_R], ReA: [0], ImA: [0]};
    for (const cap of [2, 3, 31, 8192, 8193, 16383, 16384]) {
      assert.deepEqual(core.perturb64(ref, 0, 0, cap), core.orbitRules(cr, ci, cap, core.RULES.cpu));
    }
    if (ci === .22225) {
      const exp = Math.exp; let calls = 0, result;
      Math.exp = value => { calls++; return exp(value); };
      try { result = core.perturb64(ref, 0, 0, 16384); } finally { Math.exp = exp; }
      assert.equal(result.kind, 0); assert.equal(result.steps, 16384);
      assert.ok(calls < 100, `${calls} exponentials for the unchanged finite result`);
    }
  }
});

test('repeated rounded reference values cannot skip a later reference threshold', () => {
  // A finite reference phase can carry information below the visible FP64
  // values. These controlled reference coefficients isolate index ownership.
  const V = new Float64Array(130), T = new Float64Array(65).fill(core.LOG_R);
  for (let k = 1; k <= 64; k++) V[2 * k] = 1 + (k - 1) % 3;
  T[32] = -1;
  const ref = {c0: [1, 0], L0: [0, 0], length: 64, values: 65, V, T,
    ReA: new Float64Array(65), ImA: new Float64Array(65)};
  assert.deepEqual(core.perturb64(ref, 0, 0, 16384),
    {kind: 3, steps: 32 + 1 / core.LOG_R, re: 2, im: 0});
});
