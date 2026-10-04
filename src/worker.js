'use strict';
/* Worker roles: exact reference orbits, and CPU image tiles (FP64 direct, FP64
 * perturbation or exact BigInt per pixel). One persistent pool is reused across
 * views; a newer job supersedes an older one at the next yield. */
let current = 0;
// Yield one macrotask so a queued 'cancel' or newer job runs first (scheduler.yield
// continuations can outrank incoming messages; nested timers are clamped to 4 ms).
const yieldQueue = [];
let yieldChannel = null;
function pause() {
  if (!yieldChannel && typeof MessageChannel === 'function') {
    yieldChannel = new MessageChannel();
    yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
  }
  if (!yieldChannel) return new Promise(resolve => setTimeout(resolve, 0));
  return new Promise(resolve => { yieldQueue.push(resolve); yieldChannel.port2.postMessage(0); });
}
function referenceJob(job) {
  try {
    const ref = TetraReference.compute(job.options);
    self.postMessage({type: 'reference', id: job.id, ref}, [ref.V.buffer, ref.T.buffer, ref.ReA.buffer, ref.ImA.buffer]);
  } catch (error) {
    self.postMessage({type: 'reference', id: job.id, error: String(error.message)});
  }
}
async function tileJob(job, token) {
  const camera = createFixed(256);
  const [w, h] = [job.width, job.height], mode = job.mode;
  const cx = camera.parse(job.x), cy = camera.parse(job.y), span = camera.parse(job.span);
  const nx = Number(job.x), ny = Number(job.y), ns = Number(job.span);
  const exact = mode === 'exact' ? TetraCore.makePreciseOrbit(job.digits) : null;
  const rules = TetraCore.RULES.cpu, ref = job.ref || null;
  // Pixel centres; the exact mode keeps every coordinate as a decimal string.
  const xr = Array.from({length: w}, (_, x) => exact ? camera.text(cx + span * BigInt(2 * x + 1 - w) / BigInt(2 * w)) : (x + 0.5 - w / 2) * ns / w);
  const yr = Array.from({length: h}, (_, y) => exact ? camera.text(cy + span * BigInt(h - 2 * y - 1) / BigInt(2 * w)) : (h / 2 - y - 0.5) * ns / w);
  // Deep views skip linear runs of steps (BLA); the bound covers every pixel centre.
  const bla = ref && TetraCore.blaTable(ref, TetraCore.logOffsetBound(TetraCore.offsetBound(job.deltaRe, job.deltaIm, job.deltaMirror, job.imCenter, ns / 2, ns * h / w / 2) /
    Math.hypot(ref.c0[0], ref.c0[1])), rules, TetraCore.BLA_EPS.cpu);
  const sample = ref ? (x, y) => {
    // Lower-half pixels use the conjugate orbit of their mirror image.
    const mirrored = job.imCenter + yr[y] < 0;
    const r = TetraCore.perturb64(ref, job.deltaRe + xr[x], mirrored ? job.deltaMirror - yr[y] : job.deltaIm + yr[y], job.iterations, rules, bla);
    if (mirrored && r.im !== undefined) r.im = -r.im;
    return r;
  } : exact ? (x, y) => exact(xr[x], yr[y], job.iterations) : (x, y) => TetraCore.orbit64(nx + xr[x], ny + yr[y], job.iterations);
  const edge = exact ? 4 : 24;
  const tiles = [];
  for (let y = 0; y < h; y += edge) for (let x = 0; x < w; x += edge) tiles.push({x, y, width: Math.min(edge, w - x), height: Math.min(edge, h - y)});
  tiles.sort((a, b) => (a.x + a.width / 2 - w / 2) ** 2 + (a.y + a.height / 2 - h / 2) ** 2 - ((b.x + b.width / 2 - w / 2) ** 2 + (b.y + b.height / 2 - h / 2) ** 2));
  const assigned = tiles.filter((_, i) => i % (job.workers || 1) === (job.index || 0));
  const total = assigned.reduce((n, t) => n + t.width * t.height, 0);
  if (!total) { self.postMessage({id: job.id, done: 0, counts: [0, 0, 0, 0, 0], complete: true}); return; }
  let surface = null, surfaceContext = null;
  if (job.bitmap && typeof OffscreenCanvas === 'function') {
    try { surface = new OffscreenCanvas(edge, edge); surfaceContext = surface.getContext('2d', {alpha: false}); } catch { surfaceContext = null; }
  }
  let done = 0, lastYield = performance.now();
  const counts = [0, 0, 0, 0, 0];
  for (const t of assigned) {
    if (token !== current) return;
    const pixels = new Uint8ClampedArray(t.width * t.height * 4);
    let p = 0;
    for (let y = t.y; y < t.y + t.height; y++) {
      for (let x = t.x; x < t.x + t.width; x++) {
        const result = sample(x, y);
        counts[result.kind]++;
        const rgb = TetraCore.color(result.kind, result.steps, job.palette, result.re, result.im);
        pixels[p++] = rgb[0]; pixels[p++] = rgb[1]; pixels[p++] = rgb[2]; pixels[p++] = 255;
      }
      // Let a newer job or a cancel in between rows (deep FP64 rows can take long too).
      if (performance.now() - lastYield > 12) {
        await pause(); lastYield = performance.now();
        if (token !== current) return;
      }
    }
    done += t.width * t.height;
    const message = {id: job.id, tile: t, done, progress: done / total, counts, complete: done === total};
    let bitmap = null;
    if (surfaceContext) {
      try {
        surface.width = t.width; surface.height = t.height;
        surfaceContext.putImageData(new ImageData(pixels, t.width, t.height), 0, 0);
        bitmap = surface.transferToImageBitmap();
      } catch { surfaceContext = null; }
    }
    if (bitmap) self.postMessage({...message, bitmap}, [bitmap]);
    else self.postMessage({...message, pixels}, [pixels.buffer]);
    // Yield so a newer job can be received without terminating the worker.
    if (performance.now() - lastYield > 12) { await pause(); lastYield = performance.now(); }
  }
}
function discoverJob(job) {
  // Deterministic, well-mixed generator (mulberry32) so a seed reproduces the same place.
  let seed = job.seed >>> 0;
  const random = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { self.postMessage({type: 'discover', id: job.id, place: TetraCore.discover(random)}); }
  catch (error) { self.postMessage({type: 'discover', id: job.id, error: String(error.message)}); }
}
self.onmessage = async function ({data: job}) {
  if (job.type === 'reference') { referenceJob(job); return; }
  if (job.type === 'discover') { discoverJob(job); return; }
  const token = ++current;
  if (job.type === 'cancel') return;
  try { await tileJob(job, token); } catch (error) { self.postMessage({id: job.id, error: String(error.message)}); }
};
