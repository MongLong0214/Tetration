/* In-page pixel comparison helpers for browser suites (injected with page.evaluate).
 * They use the production globals (TetraGPU, TetraCore, TetraReference, TetraRender,
 * createFixed) on a separate canvas, never the app's own renderer state. */
(() => {
  const F = createFixed(256);
  let renderer = null;
  // The harness waits for the BLA program, so comparisons never fall back to the plain one while it links.
  const gpu = () => {
    if (renderer) return renderer;
    renderer = new TetraGPU(document.createElement('canvas'));
    renderer.blaMode = 'on'; renderer.blaProgram(); renderer.blaMode = 'auto';
    return renderer;
  };

  // Exact per-pixel orbit with the GPU rule set (Euclidean tolerance), decimal BigInt.
  function exactOrbit(x, y, iterations, digits) {
    const rules = TetraCore.RULES.gpu, f = createFixed(digits), {Q, mul, abs} = f;
    const logR = f.ln(f.parse('10000000000')), cr = f.parse(x), ci = f.parse(y);
    if (!cr && !ci) return {kind: 4, steps: 0};
    const scale = abs(cr) > abs(ci) ? abs(cr) : abs(ci), xr = f.div(cr, scale), xi = f.div(ci, scale);
    const lr = f.ln(scale) + f.ln(mul(xr, xr) + mul(xi, xi)) / 2n, li = f.atan2(ci, cr);
    const low = f.parse(String(rules.lowA)), maxB = f.parse(String(rules.maxB)), tol = f.parse(String(rules.tol));
    let wr = Q, wi = 0n, oldr = 0n, oldi = 0n, fixed = 0, periodic = 0;
    for (let n = 1; n <= iterations; n++) {
      const a = mul(wr, lr) - mul(wi, li), b = mul(wr, li) + mul(wi, lr);
      if (a > logR) return {kind: 3, steps: n + Math.min(1, f.number(f.div(a - logR, logR)))};
      if (a < low || abs(b) > maxB) return {kind: 4, steps: n};
      const r = f.exp(a), [s, c] = f.sincos(b), nr = mul(r, c), ni = mul(r, s), t = mul(tol, Q + r), t2 = mul(t, t);
      fixed = mul(nr - wr, nr - wr) + mul(ni - wi, ni - wi) < t2 ? fixed + 1 : 0;
      periodic = n > 2 && mul(nr - oldr, nr - oldr) + mul(ni - oldi, ni - oldi) < t2 ? periodic + 1 : 0;
      oldr = wr; oldi = wi; wr = nr; wi = ni;
      if (fixed >= 8) return {kind: 1, steps: n, re: f.number(wr), im: f.number(wi)};
      if (periodic >= 12) return {kind: 2, steps: n, re: f.number(wr), im: f.number(wi)};
    }
    return {kind: 0, steps: iterations, re: f.number(wr), im: f.number(wi)};
  }

  function scene(cx, cy, span, iterations, palette, mode) {
    const view = {x: F.parse(cx), y: F.parse(cy), span: F.parse(span)};
    const base = {iterations, palette, rules: TetraCore.RULES.gpu};
    if (mode === 'direct') return {view, scene: {...base, mode: 'direct', center: [Number(cx), Number(cy)], span: Number(span)}};
    const point = TetraRender.referencePoint(F, view);
    const digits = Math.min(256, Math.max(30, Math.ceil(Math.log10(Math.max(1, Math.abs(Number(cx)), Math.abs(Number(cy))) / Number(span))) + 40));
    const ref = TetraReference.compute({x: F.text(point.x), y: F.text(point.y), digits, iterations, maxRe: 80});
    ref.point = point;
    return {view, point, ref, scene: {...base, ...TetraRender.perturbScene(F, view, point.x, point.y), ref}};
  }

  // Render W x H at 1 sample per pixel (bottom row first, as gl.readPixels returns it).
  function draw(s, W, H, samples = 1, tiles = 0) {
    const r = gpu(), frame = r.beginFrame(W, H);
    if (tiles) for (const t of TetraRender.tiles(W, H, tiles)) r.draw(frame, t, s, samples);
    else r.draw(frame, {x: 0, y: 0, width: W, height: H}, s, samples);
    const out = r.readFrame(frame);
    r.releaseFrame(frame);
    return out;
  }

  // Pixel sample position for GL row j (0 = bottom) and column i.
  function samplePoint(view, W, H, i, j) {
    const qx = ((i + 0.5) - W / 2) / W, qy = ((j + 0.5) - H / 2) / W;
    return {x: view.x + F.parse(qx.toPrecision(17)) * view.span / F.Q, y: view.y + F.parse(qy.toPrecision(17)) * view.span / F.Q, qx, qy};
  }

  window.__tetraPixels = {
    // BLA mode of the harness renderer ('auto', 'on' or 'off'); returns the previous mode.
    setBla(mode) { const r = gpu(), previous = r.blaMode; r.blaMode = mode; return previous; },
    // GPU (direct or perturbation) against FP64 perturbation / FP64 direct with GPU rules.
    compare(cx, cy, span, W, H, iterations, palette, mode, shortSteps) {
      const started = performance.now(), built = scene(cx, cy, span, iterations, palette, mode);
      const out = draw(built.scene, W, H);
      const gpuMs = performance.now() - started;
      const expected = new Uint8Array(W * H * 3), steps = new Float64Array(W * H), kinds = [0, 0, 0, 0, 0];
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const p = samplePoint(built.view, W, H, i, j);
        let r;
        if (mode === 'direct') r = TetraCore.orbitRules(Number(cx) + p.qx * Number(span), Number(cy) + p.qy * Number(span), iterations, TetraCore.RULES.gpu);
        else {
          const mirrored = p.y < 0n, my = mirrored ? -p.y : p.y;
          r = TetraCore.perturb64(built.ref, F.number(p.x - built.point.x), F.number(my - built.point.y), iterations, TetraCore.RULES.gpu);
          if (mirrored) r.im = -r.im;
        }
        kinds[r.kind]++; steps[j * W + i] = r.steps;
        expected.set(TetraCore.color(r.kind, r.steps, palette, r.re, r.im), (j * W + i) * 3);
      }
      let shortTotal = 0, shortMismatch = 0, longMismatch = 0, worst = [];
      for (let k = 0; k < W * H; k++) {
        const diff = Math.max(...[0, 1, 2].map(c => Math.abs(out[k * 4 + c] - expected[k * 3 + c])));
        const isShort = steps[k] <= shortSteps;
        if (isShort) shortTotal++;
        if (diff > 3) {
          if (isShort) { shortMismatch++; if (worst.length < 4) worst.push({k, steps: steps[k], actual: [...out.slice(k * 4, k * 4 + 3)], expected: [...expected.slice(k * 3, k * 3 + 3)]}); }
          else longMismatch++;
        }
      }
      // Visual similarity robust to chaotic noise: mean difference of 4x4 block averages.
      let blockDiff = 0, blocks = 0;
      for (let by = 0; by + 4 <= H; by += 4) for (let bx = 0; bx + 4 <= W; bx += 4) {
        for (let c = 0; c < 3; c++) {
          let a = 0, b = 0;
          for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) { a += out[(y * W + x) * 4 + c]; b += expected[(y * W + x) * 3 + c]; }
          blockDiff += Math.abs(a - b) / 16;
        }
        blocks++;
      }
      return {span, mode, kinds, total: W * H, shortTotal, shortMismatch, longMismatch, blockDiff: blockDiff / (blocks * 3), refLength: built.ref?.length ?? null, gpuMs: Math.round(gpuMs), worst};
    },
    // GPU perturbation pixels against exact decimal orbits at a few sampled pixels.
    exact(cx, cy, span, W, H, iterations, picks) {
      const built = scene(cx, cy, span, iterations, 0, 'perturb'), out = draw(built.scene, W, H), results = [];
      const digits = Math.min(256, Math.ceil(-Math.log10(Number(span))) + 40);
      for (const [i, j] of picks) {
        const p = samplePoint(built.view, W, H, i, j), e = exactOrbit(F.text(p.x), F.text(p.y), iterations, digits);
        const color = TetraCore.color(e.kind, e.steps, 0, e.re, e.im), k = j * W + i;
        results.push({i, j, kind: e.kind, steps: e.steps, diff: Math.max(...[0, 1, 2].map(c => Math.abs(out[k * 4 + c] - color[c])))});
      }
      return results;
    },
    // The same perturbation frame with BLA off, automatic and forced on: timing and agreement.
    bla(cx, cy, span, W, H, iterations, repeats = 2) {
      const built = scene(cx, cy, span, iterations, 0, 'perturb'), r = gpu(), timed = mode => {
        r.blaMode = mode;
        let out = draw(built.scene, W, H), best = Infinity;
        for (let n = 0; n < repeats; n++) { const t = performance.now(); out = draw(built.scene, W, H); best = Math.min(best, performance.now() - t); }
        return {out, ms: best};
      };
      const plain = timed('off'), auto = timed('auto'), forced = timed('on'), levels = r.bla?.levels ?? 0, reach = r.bla?.reach ?? 0;
      r.blaMode = 'auto';
      let differing = 0, blockDiff = 0, blocks = 0;
      for (let k = 0; k < W * H; k++) if (Math.max(...[0, 1, 2].map(c => Math.abs(plain.out[k * 4 + c] - forced.out[k * 4 + c]))) > 3) differing++;
      for (let by = 0; by + 4 <= H; by += 4) for (let bx = 0; bx + 4 <= W; bx += 4) {
        for (let c = 0; c < 3; c++) {
          let a = 0, b = 0;
          for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) { a += plain.out[(y * W + x) * 4 + c]; b += forced.out[(y * W + x) * 4 + c]; }
          blockDiff += Math.abs(a - b) / 16;
        }
        blocks++;
      }
      return {span, levels, reach, plainMs: Math.round(plain.ms), autoMs: Math.round(auto.ms), onMs: Math.round(forced.ms), speedup: +(plain.ms / auto.ms).toFixed(2),
        differing, total: W * H, blockDiff: +(blockDiff / (blocks * 3)).toFixed(2)};
    },
    // Rows j and H-1-j sample conjugate points when the view is centred on the real axis.
    symmetry(cx, span, W, H, iterations, mode) {
      const built = scene(cx, '0', span, iterations, 3, mode), out = draw(built.scene, W, H);
      let differing = 0;
      for (let j = 0; j < H / 2; j++) for (let i = 0; i < W; i++) {
        const a = (j * W + i) * 4, b = ((H - 1 - j) * W + i) * 4;
        if (Math.max(...[0, 1, 2].map(c => Math.abs(out[a + c] - out[b + c]))) > 0) differing++;
      }
      return {differing, pairs: W * H / 2};
    },
    // Tiled rendering must equal one full-frame draw.
    seams(cx, cy, span, W, H, iterations, mode, samples) {
      const built = scene(cx, cy, span, iterations, 0, mode), whole = draw(built.scene, W, H, samples), tiled = draw(built.scene, W, H, samples, 32);
      let worst = 0;
      for (let k = 0; k < whole.length; k++) worst = Math.max(worst, Math.abs(whole[k] - tiled[k]));
      return worst;
    },
    // Adaptive antialiasing error against a box-filtered supersampled reference.
    antialias(cx, cy, span, n, iterations, mode, factor) {
      const built = scene(cx, cy, span, iterations, 0, mode), r = gpu();
      const fine = draw(built.scene, n * factor, n * factor);
      const base = r.beginFrame(n, n);
      r.draw(base, {x: 0, y: 0, width: n, height: n}, built.scene, 1);
      const aa4 = r.beginFrame(n, n, base, true);
      r.draw(aa4, {x: 0, y: 0, width: n, height: n}, built.scene, 4);
      const aa16 = r.beginFrame(n, n, aa4, true);
      r.draw(aa16, {x: 0, y: 0, width: n, height: n}, built.scene, 16);
      const one = r.readFrame(base), four = r.readFrame(aa4), sixteen = r.readFrame(aa16);
      for (const f of [aa16, aa4, base]) r.releaseFrame(f);
      let e1 = 0, e4 = 0, e16 = 0, changed4 = 0, changed16 = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let d4 = false, d16 = false;
        for (let c = 0; c < 3; c++) {
          let target = 0;
          for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) target += fine[((y * factor + dy) * n * factor + x * factor + dx) * 4 + c];
          target /= factor * factor;
          const i = (y * n + x) * 4 + c;
          e1 += (one[i] - target) ** 2; e4 += (four[i] - target) ** 2; e16 += (sixteen[i] - target) ** 2;
          if (one[i] !== four[i]) d4 = true; if (four[i] !== sixteen[i]) d16 = true;
        }
        if (d4) changed4++; if (d16) changed16++;
      }
      const m = n * n * 3;
      return {rmse1: Math.sqrt(e1 / m), rmse4: Math.sqrt(e4 / m), rmse16: Math.sqrt(e16 / m), changed4, changed16, pixels: n * n, reference: `${factor * factor} samples per pixel`};
    },
    /* Live temporal accumulation on one sampling grid: frames adding perFrame stratified samples
     * converge to the 16-sample image; a still frame copies it bit for bit; a pan copies every
     * overlapping pixel and starts revealed ones afresh; a resampled history is trusted for at
     * most its cap. */
    accumulate(cx, cy, span, W, H, iterations, mode, perFrame) {
      const built = scene(cx, cy, span, iterations, 0, mode), r = gpu();
      const unit = (mode === 'direct' ? built.scene.span : built.scene.spanMant) / W;
      const at = (shift, accum) => ({...built.scene, aspect: H / W, grid: {shift, step: [unit, unit]}, ...(accum ? {accum} : {})});
      const render = (sc, samples) => { const f = r.beginFrame(W, H); r.draw(f, {x: 0, y: 0, width: W, height: H}, sc, samples); return f; };
      const take = f => { const out = r.readFrame(f); r.releaseFrame(f); return out; };
      const reference = take(render(at([0, 0]), 16));
      let prev = render(at([0, 0], {mode: 0}), perFrame), frames = 1;
      while (frames * perFrame < 16) {
        const next = render(at([0, 0], {mode: 1, frame: prev, shift: [0, 0]}), perFrame);
        r.releaseFrame(prev); prev = next; frames++;
      }
      const converged = r.readFrame(prev);
      let worst = 0, sum = 0, notSixteen = 0;
      for (let k = 0; k < converged.length; k += 4) {
        for (let c = 0; c < 3; c++) { const d = Math.abs(converged[k + c] - reference[k + c]); worst = Math.max(worst, d); sum += d; }
        if (converged[k + 3] !== 16) notSixteen++;
      }
      const still = take(render(at([0, 0], {mode: 1, frame: prev, shift: [0, 0]}), perFrame));
      let stillDiff = 0;
      for (let k = 0; k < still.length; k++) if (still[k] !== converged[k]) stillDiff++;
      const dx = 7, dy = -3, moved = take(render(at([dx, dy], {mode: 1, frame: prev, shift: [dx, dy]}), perFrame));
      let overlap = 0, overlapDiff = 0, revealed = 0, revealedWrong = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, sx = x + dx, sy = y + dy;
        if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
          overlap++;
          const j = (sy * W + sx) * 4;
          for (let c = 0; c < 4; c++) if (moved[i + c] !== converged[j + c]) { overlapDiff++; break; }
        } else { revealed++; if (moved[i + 3] !== perFrame) revealedWrong++; }
      }
      const resampled = take(render(at([0, 0], {mode: 2, frame: prev, scale: [1, 1], offset: [0, 0], count: 0, cap: 4}), perFrame));
      let resampledMax = 0, resampledTrusted = 0;
      for (let k = 3; k < resampled.length; k += 4) { resampledMax = Math.max(resampledMax, resampled[k]); if (resampled[k] === 4 + perFrame) resampledTrusted++; }
      r.releaseFrame(prev);
      return {frames, worst, mean: sum / (W * H * 3), notSixteen, stillDiff, overlap, overlapDiff, revealed, revealedWrong, resampledMax, resampledTrusted, pixels: W * H};
    },
  };
})();
