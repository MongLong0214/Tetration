'use strict';
let current = 0;
self.onmessage = async function ({ data: job }) {
  const token = ++current;
  if (job.cancel) return;
  try {
    const camera = createFixed(256);
    const cx = camera.parse(job.x), cy = camera.parse(job.y), span = camera.parse(job.span);
    const calculate = job.mode === 'big' ? TetraCore.makePreciseOrbit(job.digits) : null;
    const [w, h] = [job.width, job.height];
    const nx = Number(job.x), ny = Number(job.y), ns = Number(job.span);
    const xr = Array.from({ length: w }, (_, x) => job.mode === 'big' ? camera.text(cx + span * BigInt(2 * x + 1 - w) / BigInt(2 * w)) : nx + (x + 0.5 - w / 2) * ns / w);
    const yr = Array.from({ length: h }, (_, y) => job.mode === 'big' ? camera.text(cy + span * BigInt(h - 2 * y - 1) / BigInt(2 * w)) : ny + (h / 2 - y - 0.5) * ns / w);
    const tile = job.mode === 'big' ? 4 : 24;
    // Center-out tile order delivers a useful preview before completing a pass.
    const tiles = [];
    for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) tiles.push({ x, y, width: Math.min(tile, w-x), height: Math.min(tile, h-y) });
    tiles.sort((a,b) => (a.x-w/2)**2+(a.y-h/2)**2 - ((b.x-w/2)**2+(b.y-h/2)**2));
    const assigned = tiles.filter((_, i) => i % (job.workers || 1) === (job.index || 0));
    const total = assigned.reduce((n, t) => n + t.width*t.height, 0);
    let surface = null, surfaceContext = null;
    if (job.bitmap && typeof OffscreenCanvas === 'function') {
      try { surface = new OffscreenCanvas(tile, tile); surfaceContext = surface.getContext('2d', {alpha:false}); } catch {}
    }
    if (!total) { self.postMessage({id:job.id, done:0, counts:[0,0,0,0,0], complete:true}); return; }
    let done = 0, lastYield = performance.now(); const counts = [0,0,0,0,0];
    for (const t of assigned) {
      if (token !== current) return;
      const pixels = new Uint8ClampedArray(t.width * t.height * 4);
      let p = 0;
      for (let y = t.y; y < t.y + t.height; y++) {
        for (let x = t.x; x < t.x + t.width; x++) {
          const result = calculate ? calculate(xr[x], yr[y], job.iterations) : TetraCore.orbit64(xr[x], yr[y], job.iterations);
          counts[result.kind]++;
          const rgb = TetraCore.color(result.kind, result.steps, job.palette, result.re, result.im);
          pixels[p++] = rgb[0]; pixels[p++] = rgb[1]; pixels[p++] = rgb[2]; pixels[p++] = 255;
        }
      }
      done += t.width * t.height;
      const message = { id:job.id, tile:t, done, progress:done/total, counts, complete:done===total };
      let bitmap = null;
      if (surfaceContext) {
        try {
          surface.width=t.width; surface.height=t.height;
          surfaceContext.putImageData(new ImageData(pixels,t.width,t.height),0,0);
          bitmap=surface.transferToImageBitmap();
        } catch { surfaceContext=null; }
      }
      if (bitmap) self.postMessage({...message, bitmap},[bitmap]);
      else self.postMessage({...message, pixels},[pixels.buffer]);
      // Yield so cancellation can be processed even without terminating the worker.
      if (performance.now() - lastYield > 12) {
        if (self.scheduler?.yield) await self.scheduler.yield();
        else await new Promise(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
  } catch (error) { self.postMessage({ id: job.id, error: String(error.message) }); }
};
