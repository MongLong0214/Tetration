(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const F = createFixed(256);
  const VERSION = '1.0.0';
  const workerSource = __WORKER_SOURCE__;
  const workerURL = URL.createObjectURL(new Blob([workerSource], {type: 'text/javascript'}));
  const presets = [
    {name: 'Overview', sub: 'COMPLEX PLANE', x: '-0.5', y: '0', span: '8'},
    {name: 'Bloom', sub: 'PETALS WITHIN PETALS', x: '-2.2930579', y: '0.3320804', span: '0.00025'},
    {name: 'Filaments', sub: 'BETWEEN THE BASINS', x: '-1.84', y: '0.09', span: '0.46'},
    {name: 'Feather', sub: 'FOLDS AND BRANCHES', x: '-0.72', y: '0.36', span: '0.7'},
    {name: 'Plume', sub: '10¹¹ · CORAL FEATHERS', x: '-2.2930579295624999999999991', y: '0.33208044555625', span: '5e-11'},
    {name: 'Abyss', sub: '10²⁵ · PERTURBATION', x: '-0.605137938972379900971816986088586258864125', y: '0.437740442074800562969426507709712806289976004723289995229', span: '7e-25'},
    {name: 'Horizon', sub: '10¹⁰⁰ · DEEP FEATHER', x: '-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206', y: '0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475', span: '7e-100'},
  ];
  const FIXED_ITERATIONS = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
  const AUTO_STEPS = [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384];
  const DIRECT_LIMIT = 2 ** -16, FP64_LIMIT = 1e-13, SETTLE_MS = 110, BATCH_MS = 28, FRAME_MS = 12;
  const minSpan = F.parse('1e-200'), maxSpan = F.parse('1e12'), maxCoordinate = F.parse('1e12');
  const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
  const coarsePointer = matchMedia('(pointer:coarse)').matches;

  let view = parseView(presets[0]), visual = clone(view);
  let palette = 0, iterationSetting = 'auto', engine = 'auto', quality = coarsePointer ? 4 : 16, grid = false, locationIndex = 0;
  let colorPhase = 0, flow = false, flowStarted = 0, flowFrame = 0, flowPaint = 0;
  let history = [], future = [], savedViews = [], coordinateDraft = false, toastTimer = 0;
  let dims = {w: 1, h: 1, dpr: 1};
  // compute: the WebGPU accelerator for final stages (null until ready, or without WebGPU).
  let gpu = null, compute = null, gpuFailure = '', serial = 0, jobSerial = -1, settleTimer = 0, currentMode = 'gpu';
  let lastRenderComplete = false, lastCompletedInfo = null, renderStage = 'initial', started = 0, workerTransfer = 'pixels';
  let gpuBusy = false, interactiveFrame = 0, interactivePending = false, interactiveCount = 0;
  const rates = new Map(), idleWaiters = [];
  // One GPU submission at a time; waiters resume when the current one completes.
  function setGPUBusy(value) { gpuBusy = value; if (!value) idleWaiters.splice(0).forEach(resolve => resolve()); }
  function gpuIdle() { return gpuBusy ? new Promise(resolve => idleWaiters.push(resolve)) : Promise.resolve(); }
  // Frames still read by a running stage; counted because overlapping jobs can share one.
  const pinned = new Map();
  const pin = frame => { pinned.set(frame, (pinned.get(frame) || 0) + 1); };

  const viewport = $('viewport'), gpuCanvas = $('gpuCanvas'), cpuCanvas = $('cpuCanvas'), gridCanvas = $('gridCanvas');
  // Recovery must remain usable when the browser's GPU process is stalled.
  const ctx = cpuCanvas.getContext('2d', {alpha: false, willReadFrequently: true}), gridCtx = gridCanvas.getContext('2d');
  const display = {canvas: cpuCanvas, view: null, frame: null, renderer: null, key: '', info: null};
  const detailCanvas = $('detailCanvas');
  let retainedDetail = null;
  function clearDetail() { retainedDetail = null; detailCanvas.hidden = true; detailCanvas.width = detailCanvas.height = 1; }
  function retainDetail() {
    // A fully sampled native 4x stage is already useful detail, even while Ultra
    // is still refining it. Grabbing the map must preserve that sharp image too.
    if (retainedDetail || !gpu || display.canvas !== gpuCanvas || !display.info?.smooth || display.info.samples < 4 || display.soft || !display.view || display.canvas.width < targetSize(gpu).width) return;
    try {
      detailCanvas.width = gpuCanvas.width; detailCanvas.height = gpuCanvas.height;
      detailCanvas.getContext('2d', {alpha: true}).drawImage(gpuCanvas, 0, 0);
      retainedDetail = {view: clone(display.view), palette, aspect: display.aspect || detailCanvas.height / detailCanvas.width};
      detailCanvas.hidden = false;
    } catch { clearDetail(); }
  }

  // ---------- Camera ----------
  function parseView(p) { return {x: F.parse(p.x), y: F.parse(p.y), span: F.parse(p.span)}; }
  function clone(v) { return {x: v.x, y: v.y, span: v.span}; }
  function same(a, b) { return !!a && !!b && a.x === b.x && a.y === b.y && a.span === b.span; }
  const num = value => Number(F.text(value));
  const serialize = (v = view) => ({x: F.text(v.x), y: F.text(v.y), span: F.text(v.span)});
  const ratio = (a, n, d = 1) => a * BigInt(Math.round(n * 1e6)) / BigInt(Math.max(1, Math.round(d * 1e6)));
  const numFormat = (n, d = 6) => Math.abs(n) > 1e7 || (Math.abs(n) > 0 && Math.abs(n) < 1e-5) ? n.toExponential(4) : n.toFixed(d);
  function validate(v) {
    if (v.span < minSpan || v.span > maxSpan) throw Error('Span must be between 1e-200 and 1e12.');
    if (F.abs(v.x) > maxCoordinate || F.abs(v.y) > maxCoordinate) throw Error('Each coordinate must be between -1e12 and 1e12.');
    return v;
  }
  function bounded(v) {
    let limit = false;
    if (v.span < minSpan) { v.span = minSpan; limit = true; }
    if (v.span > maxSpan) { v.span = maxSpan; limit = true; }
    for (const key of ['x', 'y']) if (F.abs(v[key]) > maxCoordinate) { v[key] = v[key] < 0n ? -maxCoordinate : maxCoordinate; limit = true; }
    if (limit) toast('Navigation limit reached.');
    return v;
  }
  function limitedSpan(span) { return span < minSpan ? minSpan : span > maxSpan ? maxSpan : span; }
  function relative(clientX, clientY) { const r = viewport.getBoundingClientRect(); return {x: clientX - r.left, y: clientY - r.top}; }
  function at(point, v = view) { return {x: v.x + ratio(v.span, point.x - dims.w / 2, dims.w), y: v.y - ratio(v.span, point.y - dims.h / 2, dims.w)}; }
  // Zoom the camera so the point under `point` (as currently displayed) stays put.
  function zoomAt(factor, point = {x: dims.w / 2, y: dims.h / 2}) {
    const anchor = at(point, visual), span = limitedSpan(ratio(view.span, factor));
    if (span === view.span) { toast('Zoom limit reached.'); return false; }
    view = bounded({span, x: anchor.x - ratio(span, point.x - dims.w / 2, dims.w), y: anchor.y + ratio(span, point.y - dims.h / 2, dims.w)});
    return true;
  }
  function iterationsFor(v = view) {
    if (iterationSetting !== 'auto') return iterationSetting;
    const wanted = 320 + 34 * Math.max(0, Math.log10(7 / num(v.span)));
    return AUTO_STEPS.find(n => n >= wanted) || AUTO_STEPS.at(-1);
  }
  function magnitude(v) { return Math.max(1, Math.abs(num(v.x)), Math.abs(num(v.y))); }
  const splitAA = (iterations, samples) => (iterations >= 8192 && samples >= 4) || (iterations >= 4096 && samples >= 16);
  function chooseMode(v = view) {
    if (engine === 'exact') return 'exact';
    const pixel = num(v.span) / Math.max(dims.w, 1), scale = magnitude(v);
    // Dense high-cap views around FP64 scales finish faster on Workers using
    // exact machine cycles. Very deep views keep GPU perturbation, with long
    // AA passes split into single-sample submissions below.
    const n = iterationsFor(v);
    if (engine === 'auto' && ((n >= 8192 && num(v.span) >= scale * FP64_LIMIT) ||
        (splitAA(n, quality) && gpu && !gpu.floatColor))) return pixel >= scale * FP64_LIMIT ? 'cpu' : 'cpu-perturb';
    if (engine === 'auto' && gpu) return pixel >= scale * DIRECT_LIMIT ? 'gpu' : 'perturb';
    return pixel >= scale * FP64_LIMIT ? 'cpu' : 'cpu-perturb';
  }
  const isGPUMode = mode => mode === 'gpu' || mode === 'perturb';
  const needsReference = mode => mode === 'perturb' || mode === 'cpu-perturb';
  function referenceDigits(v) { return Math.ceil(Math.log10(magnitude(v) / num(v.span))) + 24; }
  function exactDigits(v = view) { return Math.min(240, Math.max(40, Math.ceil(-Math.log10(num(v.span))) + 40)); }

  // ---------- Small UI helpers ----------
  function toast(message) {
    clearTimeout(toastTimer);
    const el = $('toast'); el.textContent = message; el.hidden = false;
    if (el.showPopover) { try { el.showPopover(); } catch { /* already open */ } }
    toastTimer = setTimeout(() => { if (el.hidePopover) { try { el.hidePopover(); } catch { /* closed */ } } el.hidden = true; }, 3300);
  }
  function setProgress(value) { $('progressBar').style.width = value + '%'; $('progressTrack').setAttribute('aria-valuenow', Math.round(value)); }
  function showLoading(text) { $('retryBtn').hidden = true; $('loading').hidden = false; $('loadingText').textContent = text; }
  function saveHistory(base = view) {
    future = [];
    const prev = history.at(-1);
    if (!prev || !same(prev, base)) { if (history.length >= 80) history.shift(); history.push(clone(base)); }
    $('backBtn').disabled = !history.length; $('forwardBtn').disabled = !future.length;
  }

  // ---------- URL state ----------
  function hue() { return (colorPhase + (flow ? (performance.now() - flowStarted) / 500 : 0)) % 360; }
  function hashString() {
    return new URLSearchParams({v: '1', x: F.text(view.x), y: F.text(view.y), s: F.text(view.span), n: iterationSetting === 'auto' ? 'auto' : String(iterationSetting), p: String(palette), e: engine, g: grid ? '1' : '0', q: String(quality), c: String(Math.round(hue() * 100) / 100)}).toString();
  }
  let urlTimer = 0;
  function updateURL() { clearTimeout(urlTimer); urlTimer = 0; try { window.history.replaceState(null, '', '#' + hashString()); } catch { /* sandboxed */ } }
  function scheduleURL() { if (!urlTimer) urlTimer = setTimeout(updateURL, 250); }
  function readHash(hash = location.hash) {
    if (hash.length > 2400) throw Error('This view link is too long.');
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    if (!p.has('x')) return false;
    if (p.get('v') !== '1') throw Error('Unsupported view link version.');
    view = validate({x: F.parse(p.get('x')), y: F.parse(p.get('y')), span: F.parse(p.get('s'))});
    const n = p.get('n');
    iterationSetting = n === 'auto' || n === null ? 'auto' : FIXED_ITERATIONS.includes(Number(n)) ? Number(n) : 'auto';
    palette = [0, 1, 2, 3].includes(Number(p.get('p'))) ? Number(p.get('p')) : 0;
    const e = p.get('e');
    engine = e === 'big' ? 'exact' : ['auto', 'cpu', 'exact'].includes(e) ? e : 'auto';
    grid = p.get('g') === '1';
    const q = Number(p.get('q'));
    quality = [1, 4, 16].includes(q) ? q : quality;
    setFlow(false);
    const phase = Number(p.get('c'));
    colorPhase = Number.isFinite(phase) ? ((phase % 360) + 360) % 360 : 0;
    applyHue(); locationIndex = -1; visual = clone(view);
    return true;
  }

  // ---------- Controls and readouts ----------
  function syncControls() {
    $('iterations').value = String(iterationSetting); $('engine').value = engine; $('grid').checked = grid; $('quality').value = String(quality); $('flow').checked = flow;
    document.querySelectorAll('[data-palette]').forEach(b => { const selected = Number(b.dataset.palette) === palette; b.classList.toggle('active', selected); b.setAttribute('aria-pressed', String(selected)); });
    document.querySelectorAll('.preset').forEach(b => { const selected = Number(b.dataset.index) === locationIndex; b.classList.toggle('active', selected); b.setAttribute('aria-pressed', String(selected)); });
    const colors = [1, 2, 0, 3, 4].map(k => TetraCore.color(k, 8, palette));
    document.querySelectorAll('.legend i').forEach((el, i) => { el.style.background = `rgb(${colors[i].join(',')})`; });
    $('legend').title = 'Artistic color from finite orbit observations; shades are not mathematical proofs.';
  }
  function engineLabel(mode) {
    if (mode === 'gpu') return 'WEBGL2 · FP32';
    if (mode === 'perturb') return `PERTURBATION · REF ${Math.min(256, referenceDigits(view) + 16)} DP`;
    if (mode === 'cpu') return 'WORKER · FP64';
    if (mode === 'cpu-perturb') return 'WORKER · FP64 PERTURBATION';
    return `EXACT · ${exactDigits()} DP`;
  }
  function updateReadout() {
    const s = serialize(), span = Number(s.span), depth = Math.log10(7) - Math.log10(span);
    $('coordinatesReadout').textContent = `Re ${numFormat(Number(s.x))}  ·  Im ${numFormat(Number(s.y))}`;
    $('coordinatesReadout').title = `Re ${s.x}\nIm ${s.y}\nSpan ${s.span}`;
    $('zoomLabel').textContent = depth > 6 ? '10^' + depth.toFixed(1) + '×' : (7 / span).toLocaleString('en-US', {maximumFractionDigits: 2}) + '×';
    const ruler = window.innerWidth <= 760 ? 60 : 80;
    $('scaleLabel').textContent = (span * ruler / dims.w).toExponential(2) + ' units';
    if (!coordinateDraft) { $('xInput').value = s.x; $('yInput').value = s.y; $('spanInput').value = s.span; }
    $('locationTag').textContent = locationIndex < 0 ? 'Custom view' : String(locationIndex + 1).padStart(2, '0') + ' / ' + presets[locationIndex].name;
    $('viewSubtitle').textContent = locationIndex < 0 ? `${depth > 13 ? 'DEEP' : 'EXPLORING'} · ${iterationSetting === 'auto' ? 'AUTO ' : ''}${iterationsFor().toLocaleString('en-US')} STEPS` : presets[locationIndex].sub;
    currentMode = chooseMode();
    $('engineTag').textContent = engineLabel(currentMode);
    $('precisionNote').hidden = currentMode !== 'exact';
    $('precisionNote').textContent = `${exactDigits()} decimal places per pixel · up to 72 horizontal samples. Use Automatic for full-resolution deep zoom.`;
    $('backBtn').disabled = !history.length; $('forwardBtn').disabled = !future.length;
    drawGrid();
  }
  function drawGrid() {
    const {w, h, dpr} = dims;
    if (gridCanvas.width !== Math.round(w * dpr) || gridCanvas.height !== Math.round(h * dpr)) { gridCanvas.width = Math.round(w * dpr); gridCanvas.height = Math.round(h * dpr); }
    gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0); gridCtx.clearRect(0, 0, w, h);
    if (!grid) return;
    const v = visual, span = num(v.span), cx = num(v.x), cy = num(v.y);
    const raw = span / 6, base = 10 ** Math.floor(Math.log10(raw)), step = base * (raw / base > 5 ? 10 : raw / base > 2 ? 5 : raw / base > 1 ? 2 : 1);
    const pixel = span / w;
    // Ordinary Number tick labels cannot represent deep differences. Use screen offsets instead.
    const deep = pixel < Math.max(1, Math.abs(cx), Math.abs(cy)) * 1e-12;
    gridCtx.font = '9px monospace'; gridCtx.lineWidth = 1; gridCtx.fillStyle = '#bbbbbb'; gridCtx.strokeStyle = '#aaaaaa33';
    if (deep) {
      for (let x = w / 2 % 100; x < w; x += 100) { gridCtx.beginPath(); gridCtx.moveTo(x, 0); gridCtx.lineTo(x, h); gridCtx.stroke(); }
      for (let y = h / 2 % 100; y < h; y += 100) { gridCtx.beginPath(); gridCtx.moveTo(0, y); gridCtx.lineTo(w, y); gridCtx.stroke(); }
      gridCtx.fillText('RELATIVE GRID · 100 px', 18, h - 130); return;
    }
    for (let i = 0, value = Math.ceil((cx - span / 2) / step) * step; i < 20 && value <= cx + span / 2; value += step, i++) {
      const x = (value - cx) / pixel + w / 2;
      gridCtx.strokeStyle = Math.abs(value) < step * .0001 ? '#cccccc77' : '#aaaaaa33';
      gridCtx.beginPath(); gridCtx.moveTo(x, 0); gridCtx.lineTo(x, h); gridCtx.stroke();
      if (x > 45 && x < w - 45) gridCtx.fillText(numFormat(value, 2), x + 5, h - 123);
    }
    const vertical = span * h / w;
    for (let i = 0, value = Math.ceil((cy - vertical / 2) / step) * step; i < 30 && value <= cy + vertical / 2; value += step, i++) {
      const y = h / 2 - (value - cy) / pixel;
      gridCtx.strokeStyle = Math.abs(value) < step * .0001 ? '#cccccc77' : '#aaaaaa33';
      gridCtx.beginPath(); gridCtx.moveTo(0, y); gridCtx.lineTo(w, y); gridCtx.stroke();
      if (y > 120 && y < h - 140) gridCtx.fillText(numFormat(value, 2), 8, y - 5);
    }
  }

  // ---------- Color flow ----------
  function applyHue() { const angle = hue(), filter = angle ? 'hue-rotate(' + angle + 'deg)' : 'none'; display.canvas.style.filter = filter; detailCanvas.style.filter = filter; }
  function setFlow(enabled) {
    colorPhase = hue(); flow = enabled && !document.hidden; flowStarted = performance.now();
    cancelAnimationFrame(flowFrame); flowFrame = 0;
    if ($('flow')) $('flow').checked = flow;
    applyHue();
    const tick = t => { if (!flow) return; if (t - flowPaint >= 33) { applyHue(); flowPaint = t; } flowFrame = requestAnimationFrame(tick); };
    if (flow) flowFrame = requestAnimationFrame(tick);
  }

  // ---------- Display and reprojection ----------
  function transformFor(from, to) {
    const zoom = num(from.span) / num(to.span);
    const dx = num(F.div(from.x - to.x, to.span)) * dims.w, dy = -num(F.div(from.y - to.y, to.span)) * dims.w;
    return {zoom, dx, dy};
  }
  function reproject() {
    if (retainedDetail) {
      const {zoom, dx, dy} = transformFor(retainedDetail.view, visual);
      const sy = retainedDetail.aspect / (dims.h / dims.w);
      detailCanvas.style.transform = Number.isFinite(zoom + dx + dy) && zoom < 1e6 && zoom > 1e-6 ? `translate(${dx}px,${dy}px) scale(${zoom},${zoom * sy})` : 'scale(0)';
    }
    if (!display.view) return;
    const sy = display.canvas === gpuCanvas ? (display.aspect || dims.h / dims.w) / (dims.h / dims.w) : 1;
    if (same(display.view, visual) && sy === 1) { display.canvas.style.transform = 'none'; return; }
    const {zoom, dx, dy} = transformFor(display.view, visual);
    display.canvas.style.transform = Number.isFinite(zoom + dx + dy) && zoom < 1e6 && zoom > 1e-6 ? `translate(${dx}px,${dy}px) scale(${zoom},${zoom * sy})` : 'scale(0)';
  }
  function setDisplay(canvas, renderView) {
    for (const c of [gpuCanvas, cpuCanvas]) c.style.display = c === canvas ? 'block' : 'none';
    if (canvas !== gpuCanvas && display.frame) { const old = display.frame; display.frame = null; if (!pinned.has(old)) display.renderer?.releaseFrame(old); display.renderer = null; display.key = ''; }
    if (canvas !== gpuCanvas) display.info = null;
    display.canvas = canvas; display.view = clone(renderView);
    reproject(); applyHue(); document.body.dataset.ready = 'true';
  }
  /* sy: extra vertical scale of a grid-locked live frame (its vertical overscan differs slightly).
   * info: how the image was sampled — {palette, samples (per pixel, 0 for live frames), live
   * ({grid, shift, min, typical, cycle}: accumulation state), smooth (antialiased everywhere)}.
   * soft: present a single-sample image as its 2x2 average (see TetraGPU.presentFrame). */
  function show(renderer, frame, renderView, key, sy = 1, info = null, soft = false) {
    // Keep genuine previously computed detail above a coarse live image. Retire it
    // when the new image has equal or finer world sampling, or shading changes.
    if (retainedDetail && (retainedDetail.palette !== info?.palette || frame.width / num(renderView.span) >= detailCanvas.width / num(retainedDetail.view.span) * 0.999)) clearDetail();
    display.sy = sy; display.info = info; display.soft = soft;
    display.aspect = dims.h / dims.w * sy;
    renderer.presentFrame(frame, soft);
    if (display.frame !== frame) {
      const old = display.frame, oldRenderer = display.renderer;
      display.frame = frame; display.renderer = renderer;
      if (old && !pinned.has(old)) oldRenderer?.releaseFrame(old);
    }
    display.key = key;
    setDisplay(gpuCanvas, renderView);
  }
  function unpin(renderer, frame) {
    if (!frame) return;
    const count = (pinned.get(frame) || 1) - 1;
    if (count > 0) { pinned.set(frame, count); return; }
    pinned.delete(frame);
    if (frame !== display.frame) renderer.releaseFrame(frame);
  }

  // Completed images own their textures: the scratch pool must never overwrite them.
  // Three recent views cover Back/Forward without multiplying large Retina allocations.
  const completedViews = new Map();
  const completedBudget = (navigator.deviceMemory && navigator.deviceMemory <= 4 ? 24 : 64) * 1024 * 1024;
  let completedBytes = 0, completedHits = 0;
  function completedKey(v, mode, size, samples = quality) {
    return [F.text(v.x), F.text(v.y), F.text(v.span), mode, iterationsFor(v), palette, samples, dims.w, dims.h, size.width, size.height].join('|');
  }
  function forgetCompleted(key) {
    const item = completedViews.get(key);
    if (!item) return;
    completedViews.delete(key); completedBytes -= item.bytes;
    unpin(item.renderer, item.frame);
  }
  function clearCompleted() { for (const key of [...completedViews.keys()]) forgetCompleted(key); }
  function completedFamily(v, mode, size, samples = quality) {
    return [F.text(v.span), mode, iterationsFor(v), palette, samples, dims.w, dims.h, size.width, size.height].join('|');
  }
  function rememberCompleted(v, mode, renderer, frame, ref, samples, key, native) {
    const bytes = frame.width * frame.height * 4;
    if (bytes > completedBudget) return;
    const cacheKey = completedKey(v, mode, frame, samples);
    forgetCompleted(cacheKey);
    pin(frame);
    completedViews.set(cacheKey, {renderer, frame, ref, key, bytes, samples, native, family: completedFamily(v, mode, frame, samples), info: {palette, samples, live: null, smooth: samples >= 4}});
    completedBytes += bytes;
    while (completedViews.size > 3 || completedBytes > completedBudget) forgetCompleted(completedViews.keys().next().value);
  }
  function restoreCompleted(v, mode) {
    if (!gpu || !isGPUMode(mode)) return false;
    const cacheKey = completedKey(v, mode, targetSize(gpu)), item = completedViews.get(cacheKey);
    if (!item || item.renderer !== gpu) return false;
    completedViews.delete(cacheKey); completedViews.set(cacheKey, item);
    references.active = item.ref; completedHits++;
    show(gpu, item.frame, item.native?.at || v, item.key, 1, item.info);
    finished(item.frame.width, item.frame.height, null, iterationsFor(v), mode, item.samples, item.frame.width * item.frame.height);
    return true;
  }
  function nativePan(v, mode, ref, size) {
    const family = completedFamily(v, mode, size), round = (n, d) => n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
    let best = null;
    for (const item of completedViews.values()) {
      if (item.renderer !== gpu || item.ref !== ref || item.family !== family || !item.native) continue;
      const grid = item.native.grid, sx = round(v.x - grid.view.x, grid.px), sy = round(v.y - grid.view.y, grid.py);
      if (F.abs(sx) > 1000000n || F.abs(sy) > 1000000n) continue;
      const shift = [Number(sx), Number(sy)], dx = shift[0] - item.native.shift[0], dy = shift[1] - item.native.shift[1];
      const pixels = Math.max(0, size.width - Math.abs(dx)) * Math.max(0, size.height - Math.abs(dy));
      if (!pixels || (best && pixels <= best.pixels)) continue;
      best = {item, grid, shift, dx, dy, pixels, at: {x: grid.view.x + sx * grid.px, y: grid.view.y + sy * grid.py, span: v.span}};
    }
    return best;
  }

  // ---------- References (exact orbits for perturbation) ----------
  const references = {live: null, worker: null, cache: [], inflight: new Map(), nextId: 1, waiters: new Map(), discover: new Map(), computed: 0, active: null};
  function referenceWorker() {
    if (references.worker) return references.worker;
    try {
      const worker = new Worker(workerURL);
      worker.onmessage = ({data}) => {
        if (data.type === 'discover') { const done = references.discover.get(data.id); references.discover.delete(data.id); done?.(data); return; }
        const waiter = references.waiters.get(data.id); references.waiters.delete(data.id);
        if (waiter) data.error ? waiter.reject(Error(data.error)) : waiter.resolve(data.ref);
      };
      worker.onerror = event => {
        event.preventDefault?.();
        const pending = [...references.discover.values()]; references.discover.clear();
        for (const waiter of references.waiters.values()) waiter.reject(Error('Reference worker interrupted'));
        references.waiters.clear(); references.inflight.clear(); references.worker = null; worker.terminate();
        for (const done of pending) done({type: 'discover', error: 'Reference worker interrupted'});
      };
      references.worker = worker;
    } catch { references.worker = null; }
    return references.worker;
  }
  function referenceSpec(v, mode) {
    const point = TetraRender.referencePoint(F, v), n = iterationsFor(v);
    // With Auto, also cover the next iteration step so continued zooming can reuse it.
    const iterations = iterationSetting === 'auto' ? AUTO_STEPS[Math.min(AUTO_STEPS.length - 1, AUTO_STEPS.indexOf(n) + 1)] : n;
    return {point, options: {x: F.text(point.x), y: F.text(point.y), digits: Math.min(256, referenceDigits(v) + 16), iterations, maxRe: mode === 'perturb' ? 80 : 700}};
  }
  function findReference(v, mode) {
    const iterations = iterationsFor(v), maxRe = mode === 'perturb' ? 80 : 700, need = referenceDigits(v), limit = v.span * 64n, ay = v.y < 0n ? -v.y : v.y;
    return references.cache.find(r => r.iterations >= iterations && r.maxRe === maxRe && r.digits >= Math.min(256, need) && F.abs(r.point.x - v.x) <= limit && F.abs(r.point.y - ay) <= limit) || null;
  }
  // Live-frame stand-in while the exact reference is computed: same rules, 12 fewer guard digits, nearby.
  function nearReference(v, mode) {
    const maxRe = mode === 'perturb' ? 80 : 700, need = Math.min(256, referenceDigits(v)) - 12, limit = v.span * 4096n, ay = v.y < 0n ? -v.y : v.y;
    return references.cache.find(r => r.maxRe === maxRe && r.digits >= need && F.abs(r.point.x - v.x) <= limit && F.abs(r.point.y - ay) <= limit) || null;
  }
  function ensureReference(v, mode) {
    const found = findReference(v, mode);
    if (found) return Promise.resolve(found);
    const {point, options} = referenceSpec(v, mode);
    const key = JSON.stringify(options);
    if (references.inflight.has(key)) return references.inflight.get(key);
    const store = ref => {
      ref.point = point; ref.maxRe = options.maxRe; ref.digits = options.digits; references.computed++;
      references.cache = [ref, ...references.cache.filter(r => r !== ref)].slice(0, 6);
      return ref;
    };
    const worker = referenceWorker();
    let promise;
    if (worker) {
      const id = references.nextId++;
      promise = new Promise((resolve, reject) => { references.waiters.set(id, {resolve, reject}); worker.postMessage({type: 'reference', id, options}); }).then(store);
    } else {
      // No Workers: compute on the main thread so deep zoom still works.
      promise = new Promise((resolve, reject) => setTimeout(() => {
        try { resolve(store(TetraReference.compute(options))); } catch (error) { reject(error); }
      }, 0));
    }
    promise = promise.finally(() => references.inflight.delete(key));
    references.inflight.set(key, promise);
    return promise;
  }

  // ---------- GPU rendering ----------
  function buildScene(v, mode, ref) {
    const base = {iterations: iterationsFor(v), palette, rules: TetraCore.RULES.gpu, aspect: dims.h / dims.w};
    if (mode === 'gpu') return {...base, mode: 'direct', center: [num(v.x), num(v.y)], span: num(v.span)};
    return {...base, ...TetraRender.perturbScene(F, v, ref.point.x, ref.point.y), ref};
  }
  function sceneKey(scene, v) { return [scene.mode, F.text(v.x), F.text(v.y), F.text(v.span), scene.iterations, scene.palette, dims.w, dims.h].join('|'); }
  function rateKey(scene, samples) { return scene.mode + '|' + scene.iterations + '|' + samples; }
  function tileEdge(iterations, samples) { return Math.max(16, Math.min(256, Math.round(Math.sqrt(4096 * 256 * 16 / (iterations * samples)) / 16) * 16)); }
  // Resolution that should finish within the interactive frame budget.
  // Display-resolution target within the pixel budget and the device's texture limit.
  let budgetScale = 1;
  function targetSize(renderer) { return TetraRender.size(dims.w, dims.h, dims.dpr, 8294400 * budgetScale, Math.min(8192, renderer?.maxTexture || 8192)); }
  /* Live-frame plan during a gesture: size and samples stay fixed (one sampling grid) and
   * change only when frames run far over or under budget. Live pixels accumulate samples
   * across frames, so resolution comes first: 4 new samples per frame only when that still
   * leaves full display resolution. */
  let livePlan = null, refineTimer = 0;
  function livePlanFor(renderer, scene) {
    const target = targetSize(renderer), key = [scene.mode, scene.iterations, scene.palette, target.width, target.height].join('|');
    if (livePlan && livePlan.key === key && !livePlan.stale) return livePlan;
    // Full resolution with every pixel each frame if affordable (4 samples if even that is), else
    // interleaved refinement: a quarter of the pixels per frame, so four times as many pixels.
    const one = interactiveSize(renderer, scene, target, 1), four = interactiveSize(renderer, scene, target, 4);
    let pick = one, samples = 1, interleave = 1;
    if (four.width >= target.width) { pick = four; samples = 4; }
    else if (one.width < target.width) { pick = interactiveSize(renderer, scene, target, 1, 4); interleave = 4; }
    // An unchanged size keeps the existing plan, and with it the sampling grid.
    if (livePlan && livePlan.key === key && livePlan.width === pick.width && livePlan.height === pick.height && livePlan.samples === samples && livePlan.interleave === interleave) { livePlan.stale = false; return livePlan; }
    livePlan = {key, ...pick, samples, interleave, phase: 0, full: pick.width >= target.width};
    return livePlan;
  }
  // Snap the frame centre to the world grid of its pixels, so consecutive live frames of a pan
  // sample the same fractal points (no shimmer); the sub-pixel rest is a compositor translate.
  function snapView(v, size) {
    const px = v.span / BigInt(size.width), py = v.span * BigInt(Math.round(dims.h / dims.w * 1e12)) / 1000000000000n / BigInt(size.height);
    const snap = (value, step) => { if (step <= 0n) return value; const q = value >= 0n ? (value + step / 2n) / step : -((-value + step / 2n) / step); return q * step; };
    return {x: snap(v.x, px), y: snap(v.y, py), span: v.span};
  }
  function interactiveSize(renderer, scene, target = targetSize(renderer), samples = 1, interleave = 1) {
    // Before a live frame of this cap is measured: a quarter of the WebGPU stage's rate (it finishes the
    // same pixels about four times faster than these WebGL frames; its WebGL tiles were only the tiny
    // preview's), else the final tiles' rate.
    const compute = rates.get('compute|' + rateKey(scene, 1));
    const rate = (rates.get(rateKey(scene, samples)) ?? (rates.get(rateKey(scene, 1)) ?? (compute ? compute / 4 : rates.get('tile|' + rateKey(scene, 1)) ?? 60)) / samples);
    // Slow GPUs (deep views on weak hardware) drop to coarser frames rather than stall the compositor.
    const floor = rate * FRAME_MS * 4 >= 8192 ? 8192 : 2048;
    // Cap one draw's orbit work so a sudden jump in cost cannot stall the GPU (driver watchdogs).
    const pixels = Math.max(floor / samples, Math.min(target.width * target.height, rate * FRAME_MS * interleave, 8e7 * interleave / samples / renderer.effectiveIterations(scene, target.width, target.height)));
    // Quantised so consecutive frames reuse pooled textures instead of reallocating.
    const scale = Math.min(1, Math.round(Math.sqrt(pixels / (target.width * target.height)) * 24) / 24 || 1 / 24);
    return {width: Math.max(32, Math.round(target.width * scale)), height: Math.max(20, Math.round(target.height * scale))};
  }
  function requestInteractive() {
    if (!gpu || interactiveFrame) return;
    interactiveFrame = requestAnimationFrame(runInteractive);
  }
  async function runInteractive() {
    interactiveFrame = 0;
    if (!gpu || document.hidden) return;
    // The final render for this camera has started; refining live frames would only compete.
    if (jobSerial === serial && same(visual, view)) return;
    if (gpuBusy) { interactivePending = true; return; }
    const v = clone(visual), mode = chooseMode(v), shape = dims;
    const settings = {engine, iterationSetting, quality};
    if (!isGPUMode(mode)) return;
    let ref = null;
    if (mode === 'perturb') {
      ref = findReference(v, mode);
      // One outstanding request from live frames; later frames reuse it instead of queueing stale orbits.
      // A failed request is not retried every frame (Retry or a settings change clears it).
      if (!ref) {
        const spec = JSON.stringify(referenceSpec(v, mode).options);
        if (!references.live && references.liveFailed !== spec) {
          references.live = ensureReference(v, mode).then(
            () => { references.live = null; requestInteractive(); },
            () => { references.live = null; references.liveFailed = spec; });
        }
        // Meanwhile keep live frames going with the nearest cached orbit that still has enough precision.
        ref = nearReference(v, mode);
        if (!ref) return;
      }
    }
    const renderer = gpu;
    let scene = buildScene(v, mode, ref);
    if (ref && scene.iterations > ref.iterations) scene.iterations = ref.iterations;
    const plan = livePlanFor(renderer, scene);
    // Grid-locked live frame (always, also at full resolution): one live pixel of overscan on every
    // side hides the sub-pixel shift.
    let at, size, sy, min = 0, typical = 0, cycle = 0;
    {
      // Zoom levels of 1/8 octave: within a level the grid stays put and the compositor scales
      // the frame by at most 9%, so zooming does not resample the fractal every frame either.
      const level = Math.ceil(Math.log2(num(v.span)) * 8), levelSpan = F.parse((2 ** (level / 8)).toPrecision(17));
      const lv = {x: v.x, y: v.y, span: levelSpan > v.span ? levelSpan : v.span};
      const W = plan.width, H = plan.height, snapped = snapView(lv, plan), span = lv.span * BigInt(W + 2) / BigInt(W);
      size = {width: W + 2, height: H + 2};
      at = {x: snapped.x, y: snapped.y, span};
      sy = ((H + 2) / H) / ((W + 2) / W);
      // The grid (origin, step, reference) stays fixed while the span does; frames differ only by an integer shift.
      const px = lv.span / BigInt(W), py = lv.span * BigInt(Math.round(dims.h / dims.w * 1e12)) / 1000000000000n / BigInt(H);
      let grid = plan.grid;
      if (!grid || grid.span !== lv.span || grid.ref !== ref || grid.mode !== mode) {
        const iterations = scene.iterations, origin = buildScene(at, mode, ref);
        origin.iterations = iterations; origin.aspect = dims.h / dims.w * sy;
        const step = mode === 'gpu' ? [origin.span / size.width, origin.span * origin.aspect / size.height] : [origin.spanMant / size.width, origin.spanMant * origin.aspect / size.height];
        grid = plan.grid = {span: lv.span, ref, mode, ox: snapped.x, oy: snapped.y, scene: origin, step};
      }
      const shift = [Number((snapped.x - grid.ox) / px), Number((snapped.y - grid.oy) / py)];
      if (Math.abs(shift[0]) > 1e6 || Math.abs(shift[1]) > 1e6) { plan.grid = null; requestInteractive(); return; }
      scene = {...grid.scene, grid: {shift, step: grid.step}};
      ({accum: scene.accum, min, typical, cycle} = liveHistory(renderer, grid, shift, size, at, sy, plan.samples, plan.interleave));
      if (plan.interleave > 1) { plan.phase = (plan.phase + 1) & 3; scene.accum.phase = plan.phase; }
    }
    const key = sceneKey(scene, at) + '|live' + plan.samples;
    if (mode === 'perturb') scheduleWarm();
    // Same camera and every pixel already holds its 16 samples: nothing left to refine.
    if (display.frame && display.key === key && display.info?.live && display.info.live.min >= 16) return;
    setGPUBusy(true);
    const t0 = performance.now(), links = renderer.links;
    let frame = null, spent = 0;
    try {
      frame = renderer.beginFrame(size.width, size.height);
      renderer.prepare(frame, scene, plan.samples, undefined, false);
      renderer.drawTile(frame, {x: 0, y: 0, width: size.width, height: size.height});
      await renderer.fence();
      const ms = Math.max(0.5, performance.now() - t0);
      spent = ms;
      // A shifted history skips converged pixels, so its frames overstate the rate: they may only
      // lower the estimate. Frames that sample every pixel measure it.
      // Interleaved frames compute about a quarter of the pixels that have history.
      // A frame that linked a program measures nothing (the first deep frame after WebGPU final stages).
      const fresh = scene.accum.mode !== 1, k = rateKey(scene, plan.samples), measured = size.width * size.height / (scene.accum.mode ? plan.interleave : 1) / ms;
      if (renderer.links === links) {
        if (fresh || measured < (rates.get(k) ?? Infinity)) rates.set(k, rates.has(k) ? rates.get(k) * 0.5 + measured * 0.5 : measured);
        // Re-plan only when well off budget: three slow frames in a row (a single hitch, such as a
        // garbage collection, keeps the plan) or one very slow frame; faster only from a fresh frame.
        plan.over = ms > FRAME_MS * 1.5 ? (plan.over || 0) + 1 : 0;
        if (plan.over >= 3 || ms > FRAME_MS * 8 || (fresh && ms < FRAME_MS * 0.5 && !plan.full)) plan.stale = true;
      }
      // A final render (including an immediate cache restore) owns the screen now.
      // A slow live draw from before navigation must not replace its completed image
      // or switch a CPU render back to the GPU canvas. Camera-only changes may still
      // reproject useful live frames; changed render settings and shape cannot.
      if (renderer === gpu && !document.hidden && jobSerial !== serial && shape === dims && scene.palette === palette && settings.engine === engine && settings.iterationSetting === iterationSetting && settings.quality === quality) {
        show(renderer, frame, at, key, sy, {palette: scene.palette, samples: 0, live: {grid: plan.grid, shift: scene.grid.shift, min, typical, cycle}, smooth: typical >= 4});
        interactiveCount++; frame = null;
      }
    } catch (error) {
      setGPUBusy(false);
      if (frame && !renderer.lost()) renderer.releaseFrame(frame);
      frame = null;
      gpuFailed(renderer, error);
      return;
    } finally {
      setGPUBusy(false);
      if (frame) renderer.releaseFrame(frame);
    }
    if (interactivePending || !same(visual, v)) { interactivePending = false; requestInteractive(); }
    // Keep refining a still camera (pointer held, or waiting to settle) until every pixel has 16
    // samples, leaving the GPU idle as long as each frame took: input and compositing stay prompt.
    else if (min < 16 && jobSerial !== serial) { clearTimeout(refineTimer); refineTimer = setTimeout(requestInteractive, Math.min(100, spent)); }
  }
  /* Temporal accumulation of live frames. Each live pixel keeps a running mean of up to 16
   * stratified samples (the Ultra 4x4 pattern). Within one sampling grid the previous image
   * carries over by an integer pixel shift, so a pan re-uses every overlapping sample and new
   * samples refine it; on a new grid (zoom level, plan or reference change) or from a final
   * image the previous picture is resampled once, trusted for at most 4 samples. A pixel
   * with no history starts from scratch. Returns the shader input and the fewest samples any
   * pixel will hold after this frame (min) and what the bulk of the image holds (typical:
   * newly revealed strips at an edge aside). */
  function liveHistory(renderer, grid, shift, size, at, sy, perFrame, interleave) {
    const info = display.frame && display.renderer === renderer && display.canvas === gpuCanvas ? display.info : null;
    const none = {accum: {mode: 0}, min: perFrame, typical: perFrame, cycle: 0};
    if (!info || info.palette !== palette) return none;
    const frame = display.frame, live = info.live;
    if (live && live.grid === grid && frame.width === size.width && frame.height === size.height) {
      const dx = shift[0] - live.shift[0], dy = shift[1] - live.shift[1];
      const typical = Math.min(16, live.typical + perFrame / interleave);
      // Interleaved, every pixel has taken new samples once a full cycle of phases has passed.
      if (dx || dy) return {accum: {mode: 1, frame, shift: [dx, dy]}, min: perFrame, typical, cycle: 0};
      const cycle = live.cycle + 1, full = cycle >= interleave;
      return {accum: {mode: 1, frame, shift: [dx, dy]}, min: full ? Math.min(16, live.min + perFrame) : live.min, typical, cycle: full ? 0 : cycle};
    }
    const map = displayMap(at, size, sy);
    if (!map) return none;
    const trusted = Math.min(4, live ? live.typical : Math.max(1, info.samples));
    return {accum: {mode: 2, frame, ...map, count: live ? 0 : Math.max(1, info.samples), cap: 4}, min: perFrame, typical: Math.min(16, trusted + perFrame / interleave), cycle: 0};
  }
  // Pixel centre of a frame (at, size, sy) -> texel coordinate of the shown frame, per axis (both images
  // map world coordinates linearly with y up; spans as ratios keep this exact at any depth).
  function displayMap(at, size, sy) {
    const frame = display.frame, hv = display.view, hsy = display.sy || 1, aspect = dims.h / dims.w, hSpan = num(hv.span);
    const rx = num(at.span) / hSpan, ry = rx * sy / hsy;
    const ox = num(at.x - hv.x) / hSpan, oy = num(at.y - hv.y) / (hSpan * aspect * hsy);
    const scale = [rx * frame.width / size.width, ry * frame.height / size.height];
    const offset = [(ox - rx / 2 + 0.5) * frame.width, (oy - ry / 2 + 0.5) * frame.height];
    return [...scale, ...offset].every(Number.isFinite) ? {scale, offset} : null;
  }
  async function runStage(id, renderer, frame, scene, samples, onBatch, work = null) {
    if (compute && !compute.failed) {
      const levels = scene.mode === 'perturb' ? renderer.blaPolicy(frame, scene) : 0, kernel = compute.kernel(scene, levels);
      if (kernel && compute.seedSlot(frame) === null && frame.seed.width === frame.width && frame.seed.height === frame.height) compute.adopt(renderer, frame.seed);
      if (kernel && compute.seedSlot(frame) !== null) {
        try { return await computeStage(id, renderer, frame, scene, samples, onBatch, work, kernel, levels); }
        catch (error) {
          if (renderer.lost()) throw error;
          // The WebGL programs redraw the whole stage.
          compute.failed = true; console.warn('WebGPU compute unavailable:', error?.message || error);
        }
      }
    }
    const effective = renderer.effectiveIterations(scene, frame.width, frame.height);
    const workCap = 8e7;
    const highCap = scene.iterations >= 8192;
    // A seeded 4096-step BLA pass has already skipped the long approach.
    // Splitting its AA adds a measured fivefold Auto Horizon regression.
    // Keep plain/unseeded 4096 and every higher-cap request bounded.
    const ordinaryBlaAA = scene.iterations === 4096 && samples === 16 && frame.seed && scene.mode === 'perturb' && renderer.blaLevels(frame, scene, false) > 0;
    const partial = splitAA(scene.iterations, samples) && renderer.floatColor && !ordinaryBlaAA;
    const atlas = scene.mode === 'perturb' && scene.iterations === 512 && samples === 16 && renderer.floatColor;
    // A partial pass evaluates one orbit per pixel. Use that per-pass work
    // when sizing its tile; charging all AA samples here quadruples fences.
    const edge = partial ? Math.min(highCap ? 32 : 64, tileEdge(effective, 1)) : highCap ? Math.min(16, tileEdge(effective, samples)) : tileEdge(effective, samples);
    const tiles = work ? TetraRender.exposedTiles(frame.width, frame.height, work.dx, work.dy, edge) : TetraRender.tiles(frame.width, frame.height, edge), key = rateKey(scene, samples);
    const area = frame.width * frame.height;
    // Cheap tiles can precede a dense, unresolved basin. Measured throughput
    // alone cannot bound that next batch: keep its worst-case orbit work below
    // the live-frame cap without changing the image, AA or iteration limit.
    const maxPixels = highCap || partial ? edge * edge : Math.max(edge * edge, Math.floor(workCap / (effective * samples)));
    // Final tiles keep their own rate (live frames smooth theirs over whole frames). The first
    // batch is at most 4 tiles and a batch at most doubles, so a dense centre after cheap
    // corners cannot become seconds of GPU work.
    const tileKey = 'tile|' + key;
    let budget = Math.max(edge * edge, Math.min(maxPixels, 4 * edge * edge, (rates.get(tileKey) ?? (rates.get(rateKey(scene, 1)) ?? 60) / samples) * BATCH_MS));
    let index = 0;
    while (index < tiles.length) {
      if (id !== serial || renderer !== gpu) return false;
      const batch = [];
      let pixels = 0;
      do { const t = tiles[index++]; batch.push(t); pixels += t.width * t.height; } while (index < tiles.length && pixels + tiles[index].width * tiles[index].height <= budget);
      for (;;) { if (!gpuBusy) break; await gpuIdle(); }
      if (id !== serial) return false;
      setGPUBusy(true);
      const t0 = performance.now(), links = renderer.links;
      try {
        if (partial) {
          for (const t of batch) if (!(await renderer.drawAATile(frame, t, scene, () => id !== serial || renderer !== gpu, work ? 0 : undefined, samples))) return false;
        } else if (atlas) {
          for (const t of batch) renderer.drawAtlasTile(frame, t, scene, work ? 0 : undefined);
          await renderer.fence();
        } else {
          renderer.prepare(frame, scene, samples, work ? 0 : undefined);
          for (const t of batch) renderer.drawTile(frame, t);
          await renderer.fence();
        }
      } finally { setGPUBusy(false); }
      const ms = Math.max(0.5, performance.now() - t0), measured = pixels / ms;
      if (renderer.links === links) {
        rates.set(tileKey, measured);
        budget = ms > 3 * BATCH_MS ? edge * edge : Math.min(area, maxPixels, 2 * pixels, Math.max(edge * edge, measured * BATCH_MS));
      }
      if (interactivePending) { interactivePending = false; requestInteractive(); }
      if (id !== serial) return false;
      onBatch?.(index / tiles.length, index === tiles.length);
    }
    return true;
  }
  // runStage on the WebGPU accelerator: one dispatch per batch, so whole batches run as one queue of samples.
  async function computeStage(id, renderer, frame, scene, samples, onBatch, work, kernel, levels) {
    const effective = levels ? Math.max(64, Math.round(scene.iterations - 0.75 * Math.min(renderer.bla.reach, scene.iterations))) : scene.iterations;
    const edge = Math.min(256, 2 * tileEdge(effective, samples)), key = 'compute|' + rateKey(scene, samples);
    const tiles = work ? TetraRender.exposedTiles(frame.width, frame.height, work.dx, work.dy, edge) : TetraRender.tiles(frame.width, frame.height, edge);
    const area = frame.width * frame.height;
    // As in runStage: a dense basin after cheap tiles stays bounded (here ~0.1 s of orbit work at the worst).
    const maxPixels = Math.min(Math.floor(compute.capacity(kernel) / samples), Math.max(edge * edge, Math.floor(4e9 / (effective * samples))));
    let budget = Math.max(edge * edge, Math.min(maxPixels, 4 * edge * edge, (rates.get(key) ?? (rates.get('tile|' + rateKey(scene, samples)) ?? 60) * 4) * BATCH_MS));
    let index = 0;
    while (index < tiles.length) {
      if (id !== serial || renderer !== gpu) return false;
      const batch = [];
      let pixels = 0;
      do { const t = tiles[index++]; batch.push(t); pixels += t.width * t.height; } while (index < tiles.length && pixels + tiles[index].width * tiles[index].height <= budget);
      for (;;) { if (!gpuBusy) break; await gpuIdle(); }
      if (id !== serial) return false;
      setGPUBusy(true);
      const t0 = performance.now();
      try { await compute.draw(renderer, frame, scene, samples, work ? 0 : 0.035, batch, kernel, levels); }
      finally { setGPUBusy(false); }
      const ms = Math.max(0.5, performance.now() - t0), measured = pixels / ms;
      rates.set(key, measured);
      budget = ms > 3 * BATCH_MS ? edge * edge : Math.min(area, maxPixels, 2 * pixels, Math.max(edge * edge, measured * BATCH_MS));
      if (interactivePending) { interactivePending = false; requestInteractive(); }
      if (id !== serial) return false;
      onBatch?.(index / tiles.length, index === tiles.length);
    }
    // Only a whole frame can seed the next stage from its WebGPU copy (a reuse pass computes just the strips).
    if (!work) compute.complete(frame);
    return true;
  }
  async function gpuJob(id, v, mode, ref) {
    const renderer = gpu, aa = quality;
    const target = targetSize(renderer);
    const reuse = nativePan(v, mode, ref, target);
    const origin = reuse?.grid || {view: clone(v), scene: buildScene(v, mode, ref), px: v.span / BigInt(target.width), py: v.span * BigInt(Math.round(dims.h / dims.w * 1e12)) / 1000000000000n / BigInt(target.height)};
    const span = mode === 'gpu' ? origin.scene.span : origin.scene.spanMant;
    const shift = reuse?.shift || [0, 0], renderView = reuse?.at || v;
    const scene = {...origin.scene, grid: {shift, step: [span / target.width, span * origin.scene.aspect / target.height]}}, key = sceneKey(scene, v);
    const native = {grid: origin, at: clone(renderView), shift};
    // The overlap already contains final samples. Exposed strips do not need the
    // centre sample: start at 4x, then reuse those four samples in the 16x pass.
    // A single 16x pass was slower on dense deep views despite fewer submissions.
    const stages = reuse ? [{samples: aa >= 4 ? 4 : 1, name: aa >= 4 ? 'antialias' : 'detail', label: 'Resolving new detail'}] : [{samples: 1, name: 'detail', label: 'Resolving detail'}];
    if (!reuse && aa >= 4) stages.push({samples: 4, name: 'antialias', label: 'Smoothing edges'});
    if (aa >= 16) stages.push({samples: 16, name: 'ultra', label: 'Ultra edges'});
    const total = stages.length + 1, held = new Set();
    const hold = frame => { pin(frame); held.add(frame); return frame; };
    const drop = frame => { if (held.delete(frame)) unpin(renderer, frame); };
    /* Over an antialiased picture (a converged live frame) single-sample stages would flash
     * noise. They are shown soft (the 2x2 average) where that is sharper than the picture on
     * screen — while they fill in, the 1x stage only once it starts from that picture
     * (finished tiles then sharpen it centre first; others would be blank) — and held back
     * otherwise until antialiased. The last stage always appears. */
    const keepSmooth = display.renderer === renderer && display.canvas === gpuCanvas && !!display.info?.smooth && display.info.palette === scene.palette;
    const softer = keepSmooth && !!display.frame && display.frame.width < target.width * 0.5;
    try {
      let previous = null;
      if (reuse) {
        await gpuIdle();
        if (id !== serial || renderer !== gpu) return;
        previous = hold(reuse.item.frame);
        if (!reuse.dx && !reuse.dy) {
          show(renderer, previous, renderView, key, 1, reuse.item.info);
          finished(target.width, target.height, null, iterationsFor(v), mode, aa, reuse.pixels); return;
        }
      } else if (display.frame && display.renderer === renderer && display.key === key) {
        // The interactive frame already shows this camera; refine it in place.
        previous = hold(display.frame);
      } else if (!keepSmooth) {
        renderStage = 'preview';
        const size = interactiveSize(renderer, scene, target);
        previous = hold(renderer.beginFrame(size.width, size.height));
        $('loadingText').textContent = 'Finding the view';
        // This preview has a different size and needs that size's world sampling step.
        const preview = {...scene, grid: null};
        if (!(await runStage(id, renderer, previous, preview, 1, fraction => setProgress(fraction / total * 100)))) return;
        show(renderer, previous, renderView, key, 1, {palette: scene.palette, samples: 1, live: null, smooth: false});
      }
      // smoothBase: the frame under the current stage is a completed antialiased stage.
      let smoothBase = false;
      for (let s = 0; s < stages.length; s++) {
        const stage = stages[s];
        renderStage = stage.name;
        const frame = hold(renderer.beginFrame(target.width, target.height, reuse && s === 0 ? null : previous, stage.samples > 1));
        if (reuse && s === 0) {
          // The exposed strips stay pending, while every overlapping 16x sample is preserved.
          // Until computed they keep the picture on screen (usually the live frame), not blank tiles.
          const map = display.frame && display.renderer === renderer && display.canvas === gpuCanvas && display.info?.palette === scene.palette ? displayMap(renderView, frame, 1) : null;
          if (map) renderer.copyScaled(frame, display.frame, map.scale, map.offset);
          renderer.copyShifted(frame, previous, reuse.dx, reuse.dy);
          show(renderer, frame, renderView, key, 1, {...reuse.item.info, samples: 0});
        }
        // A 1x stage over the live picture starts from it (resampled), so finished tiles can sharpen it.
        let seeded = !!previous;
        if (!reuse && s === 0 && !previous && keepSmooth) {
          const map = displayMap(renderView, frame, 1);
          if (map) { renderer.copyScaled(frame, display.frame, map.scale, map.offset); seeded = true; }
        }
        let lastPresented = 0;
        const ok = await runStage(id, renderer, frame, scene, stage.samples, (fraction, last) => {
          setProgress((s + 1 + fraction) / total * 100);
          $('loadingText').textContent = `${stage.label} · ${target.width} × ${target.height} · ${Math.round(fraction * 100)}%`;
          $('resolutionReadout').textContent = `${target.width} × ${target.height} / ${Math.round(fraction * 100)}%`;
          const smooth = stage.samples >= 4 && (last || smoothBase || !!reuse), final = last && s === stages.length - 1;
          let soft = false;
          if (keepSmooth && !smooth && !final) {
            if (!softer || (stage.samples === 1 && !last && !seeded)) return;
            soft = true;
          }
          const now = performance.now();
          if (last || now - lastPresented > 50) {
            show(renderer, frame, renderView, key, 1, {palette: scene.palette, samples: last ? stage.samples : smoothBase ? 4 : 1, live: null, smooth: smooth || soft}, soft);
            lastPresented = now;
          }
        }, reuse);
        smoothBase = ok && stage.samples >= 4;
        drop(previous);
        previous = frame;
        if (!ok) return;
      }
      if (id === serial) {
        rememberCompleted(v, mode, renderer, previous, ref, stages.at(-1).samples, key, native);
        finished(target.width, target.height, null, iterationsFor(v), mode, stages.at(-1).samples, reuse?.pixels || 0);
      }
    } catch (error) {
      if (id !== serial && renderer === gpu && !renderer.lost()) return;
      gpuFailed(renderer, error);
    } finally {
      for (const frame of [...held]) drop(frame);
    }
  }
  function gpuFailed(renderer, error) {
    if (renderer !== gpu) return;
    clearDetail();
    // Out of texture memory or above the size limit with a live context: free frames, halve the budget, retry.
    if (!renderer.lost() && /allocation|limit/.test(String(error?.message)) && budgetScale > 1 / 8) {
      budgetScale /= 2;
      clearCompleted();
      if (display.renderer === renderer && display.canvas === gpuCanvas) keepSnapshot();
      display.frame = null; display.renderer = null; display.key = '';
      renderer.releaseAll();
      changed(); return;
    }
    keepSnapshot();
    console.warn('GPU renderer unavailable:', error?.message || error);
    gpuFailure = String(error?.message || error);
    clearCompleted();
    if (!renderer.lost()) { try { renderer.destroy(); } catch { /* lost */ } }
    gpu = null; display.frame = null; display.renderer = null; display.key = '';
    toast('Renderer changed. Recomputing view.');
    changed();
  }

  // ---------- CPU rendering (persistent Worker pool) ----------
  const memory = navigator.deviceMemory || 8;
  // CPU passes start after navigation rests; Workers yield for cancellation.
  // Reserving a whole logical processor underuses small machines during recovery.
  const poolLimit = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2, memory <= 2 ? 2 : memory <= 4 ? 4 : 8));
  const pool = {workers: [], size: poolLimit, job: 0, pendingPaint: 0, active: 0};
  function ensurePool() {
    while (pool.workers.length < pool.size) {
      try {
        const worker = new Worker(workerURL);
        worker.onerror = event => { event.preventDefault?.(); retireWorker(worker); };
        pool.workers.push(worker);
      } catch { pool.size = pool.workers.length; break; }
    }
    return pool.workers;
  }
  function retireWorker(worker) {
    worker.terminate();
    pool.workers = pool.workers.filter(w => w !== worker);
    if (pool.active === pool.job) renderError('Worker interrupted. Lower the iteration limit or retry.');
  }
  function stopCPU() {
    pool.job++;
    for (const worker of pool.workers) { worker.onmessage = null; worker.postMessage({type: 'cancel'}); }
    cancelAnimationFrame(pool.pendingPaint); pool.pendingPaint = 0; pool.active = 0;
  }
  function configureCPUCanvas(width = Math.round(dims.w * dims.dpr), height = Math.round(dims.h * dims.dpr)) {
    if (cpuCanvas.width !== width || cpuCanvas.height !== height) {
      const copy = document.createElement('canvas'); copy.width = cpuCanvas.width; copy.height = cpuCanvas.height; copy.getContext('2d', {willReadFrequently: true}).drawImage(cpuCanvas, 0, 0);
      cpuCanvas.width = width; cpuCanvas.height = height; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(copy, 0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  }
  // Keep the last GPU image as a 2D copy before the GPU goes away (a lost context has no pixels).
  function keepSnapshot() {
    if (display.canvas !== gpuCanvas || !display.view || !gpu || gpu.lost() || gpuBusy) return;
    try { configureCPUCanvas(gpuCanvas.width, gpuCanvas.height); ctx.drawImage(gpuCanvas, 0, 0); setDisplay(cpuCanvas, display.view); } catch { /* nothing to keep */ }
  }
  // Start the CPU canvas from the image currently on screen, at the new camera.
  function seedCPUPreview(v) {
    configureCPUCanvas();
    const source = display.canvas, from = display.view;
    ctx.fillStyle = '#060606';
    if (source === gpuCanvas && (!gpu || gpu.lost() || gpuBusy)) { ctx.fillRect(0, 0, cpuCanvas.width, cpuCanvas.height); return; }
    if (!from || (source === cpuCanvas && same(from, v))) { if (!from) ctx.fillRect(0, 0, cpuCanvas.width, cpuCanvas.height); return; }
    const copy = document.createElement('canvas'); copy.width = cpuCanvas.width; copy.height = cpuCanvas.height;
    copy.getContext('2d', {willReadFrequently: true}).drawImage(source, 0, 0, copy.width, copy.height);
    const {zoom, dx, dy} = transformFor(from, v), scale = cpuCanvas.width / dims.w;
    ctx.fillRect(0, 0, cpuCanvas.width, cpuCanvas.height);
    if (Number.isFinite(zoom + dx + dy) && zoom < 1e6 && zoom > 1e-6) ctx.drawImage(copy, dx * scale + (1 - zoom) * copy.width / 2, dy * scale + (1 - zoom) * copy.height / 2, copy.width * zoom, copy.height * zoom);
  }
  function cpuJob(id, v, mode, ref) {
    seedCPUPreview(v); setDisplay(cpuCanvas, v); renderStage = 'detail';
    const aa = mode === 'exact' ? 1 : quality;
    const workers = ensurePool();
    if (!workers.length) { renderError('Workers unavailable. Use HTTPS or a local server.'); return; }
    const job = ++pool.job; pool.active = job;
    const pixelBudget = mode === 'exact' ? (dims.w < 761 ? 2048 : 4096) : 1600000;
    const maximum = Math.max(12, Math.floor(Math.min(mode === 'exact' ? 72 : 2048, dims.w * dims.dpr, Math.sqrt(pixelBudget * dims.w / dims.h))));
    const passes = [...new Set((mode === 'exact' ? [12, 30, maximum] : [160, 420, maximum]).map(w => Math.min(w, maximum)))].sort((a, b) => a - b);
    const iterations = iterationsFor(v), label = mode === 'exact' ? exactDigits(v) + ' DP' : mode === 'cpu-perturb' ? 'FP64 perturbation' : 'FP64';
    // Transfer actual pixel buffers; creating Worker GPU-backed images can wait
    // on the same failed process this CPU renderer is meant to recover from.
    const base = {...serialize(v), mode, digits: exactDigits(v), iterations, palette, bitmap: false};
    if (ref) Object.assign(base, {ref: {V: ref.V, T: ref.T, ReA: ref.ReA, ImA: ref.ImA, length: ref.length, values: ref.values, L0: ref.L0, c0: ref.c0}, deltaRe: num(v.x - ref.point.x), deltaIm: num(v.y - ref.point.y), deltaMirror: num(-v.y - ref.point.y), imCenter: num(v.y)});
    let activePass = 0;
    function startPass() {
      if (id !== serial || job !== pool.job) return;
      const w = passes[activePass], h = Math.max(1, Math.round(w * dims.h / dims.w));
      const passCanvas = document.createElement('canvas'); passCanvas.width = w; passCanvas.height = h;
      const pctx = passCanvas.getContext('2d', {alpha: false, willReadFrequently: true}); pctx.imageSmoothingEnabled = true; pctx.drawImage(cpuCanvas, 0, 0, w, h);
      const progress = workers.map(() => 0), counts = workers.map(() => [0, 0, 0, 0, 0]), completed = new Set();
      showLoading(`${label} · pass ${activePass + 1}/${passes.length} · 0%`);
      const paint = () => { pool.pendingPaint = 0; if (id !== serial) return; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(passCanvas, 0, 0, cpuCanvas.width, cpuCanvas.height); };
      workers.forEach((worker, index) => {
        worker.onmessage = ({data: d}) => {
          if (id !== serial || job !== pool.job || d.id !== job) { d.bitmap?.close(); return; }
          if (d.error) { renderError('Could not complete this view: ' + d.error); return; }
          if (d.tile) {
            if (d.bitmap) { pctx.drawImage(d.bitmap, d.tile.x, d.tile.y); d.bitmap.close(); workerTransfer = 'bitmap'; }
            else { pctx.putImageData(new ImageData(d.pixels, d.tile.width, d.tile.height), d.tile.x, d.tile.y); workerTransfer = 'pixels'; }
          }
          progress[index] = d.done; counts[index] = d.counts;
          const fraction = progress.reduce((a, b) => a + b, 0) / (w * h);
          if (!pool.pendingPaint) pool.pendingPaint = requestAnimationFrame(paint);
          setProgress((activePass + fraction) / passes.length * 100);
          $('loadingText').textContent = `${label} · pass ${activePass + 1}/${passes.length} · ${Math.round(fraction * 100)}%`;
          $('resolutionReadout').textContent = `${w} × ${h} / ${Math.round(fraction * 100)}%`;
          if (d.complete) completed.add(index);
          if (completed.size === workers.length) {
            cancelAnimationFrame(pool.pendingPaint); paint(); activePass++;
            if (activePass < passes.length) setTimeout(startPass, 16);
            else { pool.active = 0; finished(w, h, counts.reduce((a, c) => a.map((n, i) => n + c[i]), [0, 0, 0, 0, 0]), iterations, mode, aa); }
          }
        };
        worker.postMessage({...base, id: job, width: w, height: h, index, workers: workers.length, samples: activePass === passes.length - 1 ? aa : 1});
      });
    }
    startPass();
  }

  // ---------- Render orchestration ----------
  function renderError(message) {
    serial++; stopCPU(); viewport.setAttribute('aria-busy', 'false');
    $('statusText').textContent = 'Render interrupted'; showLoading(message); $('retryBtn').hidden = false;
  }
  $('retryBtn').onclick = () => { references.liveFailed = null; changed(); };
  function finished(w, h, counts, iterations, mode, samples, reusedPixels = 0) {
    // Retained detail is a motion preview. Once this camera is complete, its own
    // computed image must be the only fractal layer, also after zooming out.
    clearDetail();
    lastRenderComplete = true; renderStage = 'complete'; viewport.setAttribute('aria-busy', 'false'); $('loading').hidden = true; setProgress(100);
    const elapsed = performance.now() - started;
    $('statusText').textContent = `${iterations.toLocaleString('en-US')} steps · ${elapsed < 1000 ? Math.round(elapsed) + ' ms' : (elapsed / 1000).toFixed(1) + ' s'}`;
    $('resolutionReadout').textContent = `${w} × ${h} / ${mode === 'exact' ? exactDigits() + ' DP' : isGPUMode(mode) ? (samples === 16 ? 'ULTRA AA' : samples === 4 ? 'ADAPTIVE AA' : '1×') : 'FP64'}`;
    lastCompletedInfo = {view: serialize(), mode, iterations, palette, width: w, height: h, counts, elapsed, samples, reusedPixels, computedPixels: w * h - reusedPixels};
    document.body.dataset.ready = 'true'; document.body.dataset.mode = mode; document.body.dataset.complete = 'true';
    updateURL();
    scheduleWarm();
  }
  /* Prepare the deep-zoom (BLA) program once the explorer is in perturbation depths, in
   * a quiet moment: compiling can occupy a slow GPU process for a second, which should
   * not land in the middle of a gesture or delay the first image. */
  let warmTimer = 0, quietSince = 0;
  // In shallow views the perturbation program is used once in a quiet moment too, so zooming
  // past the direct limit for the first time does not wait for the driver to compile it.
  function canWarmBla() { return currentMode === 'perturb' && !!gpu?.bla?.levels && gpu.bla.ref === references.active; }
  function scheduleWarm() {
    // Perturbation also serves the default close-up, where the BLA table is empty.
    // Do not compile the large deep-zoom program for a view that cannot use it.
    const deep = canWarmBla();
    if (!gpu || warmTimer || (deep ? gpu.warmed : gpu.perturbWarm)) return;
    warmTimer = setTimeout(() => {
      warmTimer = 0;
      if (!gpu || document.hidden) return;
      if (gpuBusy || !lastRenderComplete || pointerMap.size || motion.raf || performance.now() - quietSince < 2500) { scheduleWarm(); return; }
      let done = true;
      try { if (canWarmBla()) done = gpu.warm(); else gpu.warmPerturb(); } catch { /* the programs keep working */ }
      if (!done) scheduleWarm();
    }, 2500);
  }
  function invalidate() {
    serial++; stopCPU(); lastRenderComplete = false;
    document.body.dataset.complete = 'false'; viewport.setAttribute('aria-busy', 'true');
  }
  // Every camera or setting change ends here. Interactive changes keep showing and
  // refining low-cost frames; the full render starts when the camera rests.
  function changed(options = {}) {
    if (!options.interactive) cancelGesture();
    if (options.interactive || options.animate) retainDetail(); else clearDetail();
    invalidate(); quietSince = performance.now();
    if (!options.keepVisual && (reducedMotion.matches || !options.animate)) visual = clone(view);
    syncControls(); updateReadout(); reproject(); setProgress(0);
    showLoading(options.interactive || options.animate ? 'Preview · refining when you pause' : 'Computing view');
    if (options.animate && !reducedMotion.matches) startMotion();
    if (options.interactive || (options.animate && !reducedMotion.matches)) requestInteractive();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(finalRender, options.interactive || options.animate ? SETTLE_MS : 0);
    scheduleURL();
  }
  async function finalRender() {
    clearTimeout(settleTimer);
    if (pointerMap.size || motion.raf) { settleTimer = setTimeout(finalRender, SETTLE_MS); return; }
    livePlan = null;
    if (document.hidden || jobSerial === serial) return;
    jobSerial = serial;
    const id = serial, v = clone(view), mode = chooseMode(v);
    visual = clone(view); started = performance.now(); currentMode = mode; updateReadout(); reproject();
    document.body.dataset.mode = mode; document.body.dataset.complete = 'false';
    if (restoreCompleted(v, mode)) return;
    let ref = null;
    if (needsReference(mode)) {
      ref = findReference(v, mode);
      if (!ref) {
        renderStage = 'reference';
        showLoading(`Exact reference orbit · ${Math.min(256, referenceDigits(v) + 16)} digits`);
        try { ref = await ensureReference(v, mode); }
        catch (error) { if (id === serial) renderError('Could not compute the reference orbit: ' + error.message); return; }
        if (id !== serial) return;
      }
    }
    references.active = ref;
    if (isGPUMode(mode) && gpu) gpuJob(id, v, mode, ref);
    else cpuJob(id, v, mode, ref);
  }

  // ---------- Motion: smooth zoom, inertia ----------
  const motion = {raf: 0, last: 0, vx: 0, vy: 0, samples: [], frames: 0};
  // BigInt times a double with a 53-bit mantissa (ratio() rounds factors to 1e-6).
  function scaleBig(a, f) {
    if (!f || !a) return 0n;
    const e = Math.floor(Math.log2(Math.abs(f))), m = BigInt(Math.round(f * 2 ** (52 - e)));
    return e >= 52 ? a * m << BigInt(e - 52) : a * m / (1n << BigInt(52 - e));
  }
  function easeVisual(dt) {
    if (same(visual, view)) return false;
    const k = 1 - Math.exp(-dt / 55);
    const from = visual, to = view, s0 = num(from.span), s1 = num(to.span), ratioSpan = s1 / s0;
    if (!Number.isFinite(ratioSpan) || ratioSpan > 1e6 || ratioSpan < 1e-6) { visual = clone(view); return true; }
    const nextSpan = s0 * ratioSpan ** k;
    let next;
    if (Math.abs(ratioSpan - 1) < 1e-9) {
      next = {span: to.span, x: from.x + scaleBig(to.x - from.x, k), y: from.y + scaleBig(to.y - from.y, k)};
    } else {
      // Keep the fixed point of the similarity between both cameras in place.
      // Exact rational (one rounding), so the fixed point stays exact down to 1e-200 spans.
      const d = to.span - from.span, px = (from.x * to.span - to.x * from.span) / d, py = (from.y * to.span - to.y * from.span) / d, f = nextSpan / s0;
      next = {span: scaleBig(from.span, f), x: px + scaleBig(from.x - px, f), y: py + scaleBig(from.y - py, f)};
    }
    const remaining = Math.abs(Math.log(s1 / num(next.span))) + Math.hypot(num(F.div(to.x - next.x, to.span)), num(F.div(to.y - next.y, to.span)));
    // Snap when close, or if a glide ever stops converging, so the final render always starts.
    motion.frames++;
    visual = remaining < 2e-3 || !Number.isFinite(remaining) || motion.frames > 240 ? clone(view) : next;
    return true;
  }
  function startMotion() { motion.frames = 0; if (!motion.raf) { motion.last = performance.now(); motion.raf = requestAnimationFrame(stepMotion); } }
  function stepMotion(now) {
    const dt = Math.min(48, Math.max(1, now - motion.last)); motion.last = now;
    let moved = easeVisual(dt);
    if (motion.vx || motion.vy) {
      view = bounded({...view, x: view.x - ratio(view.span, motion.vx * dt, dims.w), y: view.y + ratio(view.span, motion.vy * dt, dims.w)});
      visual = clone(view);
      const decay = Math.exp(-dt / 300); motion.vx *= decay; motion.vy *= decay;
      if (Math.hypot(motion.vx, motion.vy) < 0.03) { motion.vx = 0; motion.vy = 0; }
      locationIndex = -1; invalidate(); updateReadout(); moved = true;
    }
    if (moved) { reproject(); drawGrid(); requestInteractive(); }
    if (!same(visual, view) || motion.vx || motion.vy) motion.raf = requestAnimationFrame(stepMotion);
    else { motion.raf = 0; clearTimeout(settleTimer); settleTimer = setTimeout(finalRender, SETTLE_MS); scheduleURL(); }
  }
  function stopMotion() { motion.vx = 0; motion.vy = 0; }

  // ---------- Navigation ----------
  // Nearby targets glide; distant ones (large zoom ratio or far away) cut directly.
  function near(a, b) {
    const zoom = num(a.span) / num(b.span), larger = a.span > b.span ? a.span : b.span;
    return zoom < 64 && zoom > 1 / 64 && num(F.div(F.abs(a.x - b.x) + F.abs(a.y - b.y), larger)) < 4;
  }
  function goTo(next, index = -1) {
    cancelGesture();
    stopMotion();
    if (same(next, view) && same(visual, view) && (lastRenderComplete || jobSerial === serial)) { locationIndex = index; syncControls(); updateReadout(); return; }
    view = next; locationIndex = index; changed({animate: near(next, visual)});
  }
  function jump(next, index = -1) { if (!same(next, view)) saveHistory(); goTo(next, index); }
  function loadPreset(index) { closeSettings(); viewport.focus({preventScroll: true}); jump(parseView(presets[index]), index); }
  function zoomButton(factor, point) { stopMotion(); const before = clone(view); if (zoomAt(factor, point)) { saveHistory(before); locationIndex = -1; changed({animate: true}); } }
  presets.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset'; b.type = 'button'; b.dataset.index = String(i); b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="preset-number">${String(i + 1).padStart(2, '0')}</span><span><span class="preset-name">${p.name}</span><span class="preset-sub">${p.sub}</span></span><span class="preset-arrow">↗</span>`;
    b.onclick = () => loadPreset(i);
    $('presets').append(b);
  });

  // ---------- Pointer, wheel and keyboard ----------
  const pointerMap = new Map();
  let pinch = null, drag = null, gestureSaved = false, gestureBase = null;
  let selecting = false, selection = null;
  function cancelGesture() {
    const ids = [...pointerMap.keys()];
    selectDetail(false);
    pointerMap.clear(); drag = null; pinch = null; gestureSaved = false; gestureBase = null; motion.samples = [];
    for (const id of ids) { try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch { /* already released */ } }
  }
  function selectDetail(enabled) {
    selecting = enabled;
    $('detailBtn').setAttribute('aria-pressed', String(enabled));
    viewport.classList.toggle('select-detail', enabled);
    if (!enabled && selection) { pointerMap.delete(selection.id); selection = null; $('detailBox').hidden = true; touchSetup(); }
  }
  function drawSelection() {
    const {from, to} = selection, box = $('detailBox');
    box.hidden = false;
    box.style.left = Math.min(from.x, to.x) + 'px'; box.style.top = Math.min(from.y, to.y) + 'px';
    box.style.width = Math.abs(to.x - from.x) + 'px'; box.style.height = Math.abs(to.y - from.y) + 'px';
  }
  $('detailBtn').onclick = () => {
    selectDetail(!selecting); viewport.focus({preventScroll: true});
    if (selecting) toast('Drag a box around the structure. Escape cancels.');
  };
  function touchSetup() {
    const values = [...pointerMap.values()];
    if (values.length >= 2) {
      const a = values[0], b = values[1], mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
      pinch = {distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor: at(mid), view: clone(view)}; drag = null;
    } else if (values.length === 1) { drag = {point: values[0], view: clone(view)}; pinch = null; }
    else { drag = null; pinch = null; }
    motion.samples = [];
  }
  viewport.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.button > 0) return;
    viewport.focus({preventScroll: true}); viewport.setPointerCapture(e.pointerId);
    // Grabbing during a glide freezes the camera where it is on screen.
    stopMotion();
    if (!same(visual, view)) { view = clone(visual); locationIndex = -1; invalidate(); syncControls(); updateReadout(); }
    visual = clone(view);
    // Selection can become a pinch when a second finger arrives. Both paths need
    // the camera at the first touch, rather than the previous gesture's history.
    if (!pointerMap.size) { gestureBase = clone(view); gestureSaved = false; }
    if (selection && selection.id !== e.pointerId) {
      const first = selection; selectDetail(false); pointerMap.set(first.id, first.to);
    }
    if ((e.shiftKey || selecting) && !pointerMap.size) {
      selectDetail(true);
      const point = relative(e.clientX, e.clientY);
      selection = {id: e.pointerId, from: point, to: point, view: clone(visual), width: dims.w, height: dims.h};
      pointerMap.set(e.pointerId, point); drawSelection(); return;
    }
    pointerMap.set(e.pointerId, relative(e.clientX, e.clientY)); touchSetup();
  });
  viewport.addEventListener('pointermove', e => {
    if (!pointerMap.has(e.pointerId)) return;
    if (selection && selection.id === e.pointerId) {
      const point = relative(e.clientX, e.clientY);
      selection.to = {x: Math.max(0, Math.min(dims.w, point.x)), y: Math.max(0, Math.min(dims.h, point.y))};
      drawSelection(); return;
    }
    pointerMap.set(e.pointerId, relative(e.clientX, e.clientY));
    const values = [...pointerMap.values()];
    if (pinch && values.length >= 2) {
      const [a, b] = values, mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), span = limitedSpan(ratio(pinch.view.span, pinch.distance, dist));
      view = bounded({span, x: pinch.anchor.x - ratio(span, mid.x - dims.w / 2, dims.w), y: pinch.anchor.y + ratio(span, mid.y - dims.h / 2, dims.w)});
    } else if (drag) {
      const p = values[0];
      view = bounded({...drag.view, x: drag.view.x - ratio(drag.view.span, p.x - drag.point.x, dims.w), y: drag.view.y + ratio(drag.view.span, p.y - drag.point.y, dims.w)});
      // Input timestamps, not handler time: a busy main thread must not distort the release velocity.
      motion.samples.push({t: e.timeStamp, x: p.x, y: p.y}); if (motion.samples.length > 8) motion.samples.shift();
    } else return;
    // History is saved only once a gesture actually moves the camera (a tap keeps Forward).
    if (!gestureSaved && gestureBase && !same(gestureBase, view)) { saveHistory(gestureBase); gestureSaved = true; }
    locationIndex = -1; changed({interactive: true});
  });
  function pointerEnd(e) {
    if (!pointerMap.has(e.pointerId)) return;
    if (selection && selection.id === e.pointerId) {
      const box = selection;
      // ResizeObserver can run after pointerup. Check the actual layout too, so
      // releasing a pre-resize box cannot apply it to the changed viewport.
      const bounds = viewport.getBoundingClientRect();
      const next = e.type === 'pointerup' && bounds.width === box.width && bounds.height === box.height ? TetraRender.boxView(F, box.view, box.width, box.height, box.from, box.to) : null;
      selectDetail(false);
      if (next && next.span < box.view.span) { saveHistory(box.view); view = bounded(next); locationIndex = -1; changed(); }
      else { clearTimeout(settleTimer); settleTimer = setTimeout(finalRender, 40); }
      return;
    }
    const samples = drag && pointerMap.size === 1 ? motionSamples(e.timeStamp) : null;
    pointerMap.delete(e.pointerId); touchSetup();
    if (pointerMap.size) return;
    gestureSaved = false;
    if (samples && !reducedMotion.matches && e.type === 'pointerup') { motion.vx = samples.vx; motion.vy = samples.vy; startMotion(); }
    // Pointer release is an explicit stop; wheel gestures still use the debounce.
    clearTimeout(settleTimer); settleTimer = setTimeout(finalRender, motion.raf ? SETTLE_MS : 0); scheduleURL();
  }
  function motionSamples(now) {
    const list = motion.samples.filter(s => now - s.t < 90);
    if (list.length < 2) return null;
    const a = list[0], b = list.at(-1), dt = b.t - a.t;
    if (dt < 8) return null;
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    return Math.hypot(vx, vy) > 0.35 ? {vx: Math.max(-6, Math.min(6, vx)), vy: Math.max(-6, Math.min(6, vy))} : null;
  }
  viewport.addEventListener('pointerup', pointerEnd); viewport.addEventListener('pointercancel', pointerEnd); viewport.addEventListener('lostpointercapture', pointerEnd);
  let lastWheel = -Infinity, lastWheelSerial = -1;
  viewport.addEventListener('wheel', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? dims.h : 1);
    if (!dy) return;
    if (selection || selecting) cancelGesture();
    const held = pointerMap.size > 0;
    const before = clone(view), fresh = performance.now() - lastWheel > 500 || serial !== lastWheelSerial;
    stopMotion();
    // Chromium/Firefox send trackpad pinch as ctrl+wheel with deltaY = -100 ln(scale): follow the fingers 1:1, live.
    // Ctrl + mouse-wheel notches (|deltaY| >= 50) keep the animated wheel path.
    const pinchZoom = e.ctrlKey && e.deltaMode === 0 && Math.abs(dy) < 50;
    const step = pinchZoom ? Math.max(-0.5, Math.min(0.5, dy * 0.01)) : Math.max(-1.1, Math.min(1.1, dy * .0018));
    if (zoomAt(Math.exp(step), relative(e.clientX, e.clientY))) {
      if (held) {
        if (!gestureSaved) { saveHistory(gestureBase || before); gestureSaved = true; }
        // Continue a held drag/pinch from the zoomed camera. Its old starting
        // camera would undo the zoom on the very next pointer move.
        touchSetup();
      } else if (fresh) saveHistory(before);
      lastWheel = performance.now(); locationIndex = -1; changed(pinchZoom || held ? {interactive: true} : {animate: true});
      // A preset, Back, settings change or another gesture starts a new wheel
      // history entry even when it happens inside the wheel burst's time window.
      lastWheelSerial = serial;
    }
  }, {passive: false});
  // Safari sends trackpad pinch as gesture events; without this the whole page magnifies.
  let gestureScale = 1;
  viewport.addEventListener('gesturestart', e => { e.preventDefault(); gestureScale = 1; if (!pointerMap.size) { cancelGesture(); stopMotion(); saveHistory(); } }, {passive: false});
  viewport.addEventListener('gesturechange', e => {
    e.preventDefault();
    if (pointerMap.size || !e.scale) return;
    if (zoomAt(gestureScale / e.scale, relative(e.clientX, e.clientY))) { locationIndex = -1; changed({interactive: true}); }
    gestureScale = e.scale;
  }, {passive: false});
  viewport.addEventListener('gestureend', e => { e.preventDefault(); }, {passive: false});
  viewport.addEventListener('dblclick', e => { if (e.target.closest('button')) return; e.preventDefault(); zoomButton(.4, relative(e.clientX, e.clientY)); });
  $('zoomIn').onclick = () => zoomButton(.5); $('zoomOut').onclick = () => zoomButton(2);
  $('homeBtn').onclick = () => loadPreset(0); $('brand').onclick = e => { e.preventDefault(); loadPreset(0); };
  $('backBtn').onclick = () => { if (!history.length) return; future.push(clone(view)); goTo(history.pop()); };
  $('forwardBtn').onclick = () => { if (!future.length) return; history.push(clone(view)); goTo(future.pop()); };
  viewport.addEventListener('keydown', e => {
    if (e.target.closest('button,input,select,textarea')) return;
    if (e.key === 'Escape' && selecting) { e.preventDefault(); e.stopPropagation(); selectDetail(false); settleTimer = setTimeout(finalRender, 40); return; }
    if (['+', '=', '-', '_', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault(); else return;
    if (e.altKey && e.key === 'ArrowLeft') { $('backBtn').click(); return; }
    if (e.altKey && e.key === 'ArrowRight') { $('forwardBtn').click(); return; }
    if (e.key === 'Home') { loadPreset(0); return; }
    if (e.key === '+' || e.key === '=') { zoomButton(.5); return; }
    if (e.key === '-' || e.key === '_') { zoomButton(2); return; }
    stopMotion(); if (!e.repeat) saveHistory();
    const step = view.span / (e.shiftKey ? 3n : 10n);
    view = bounded({...view, x: view.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0n), y: view.y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0n)});
    locationIndex = -1; changed({animate: true});
  });

  // ---------- Settings ----------
  $('iterations').onchange = e => { iterationSetting = e.target.value === 'auto' ? 'auto' : Number(e.target.value); changed(); };
  $('engine').onchange = e => { engine = e.target.value; changed(); };
  document.querySelectorAll('[data-palette]').forEach(b => { b.onclick = () => { palette = Number(b.dataset.palette); changed(); }; });
  $('quality').onchange = e => { quality = Number(e.target.value); changed(); };
  $('flow').onchange = e => { setFlow(e.target.checked); updateURL(); };
  $('grid').onchange = e => { grid = e.target.checked; drawGrid(); updateURL(); };
  ['xInput', 'yInput', 'spanInput'].forEach(id => $(id).addEventListener('input', () => { coordinateDraft = true; }));
  $('coordinateForm').onsubmit = e => {
    e.preventDefault();
    try {
      const v = validate({x: F.parse($('xInput').value.trim()), y: F.parse($('yInput').value.trim()), span: F.parse($('spanInput').value.trim())});
      coordinateDraft = false; closeSettings(); viewport.focus({preventScroll: true}); jump(v);
    } catch (error) { toast(error.message); }
  };

  // ---------- Discover ----------
  let discovering = false;
  function discover() {
    if (discovering) return;
    const requestedAt = serial;
    const worker = referenceWorker(), seed = (Math.random() * 4294967296) >>> 0;
    const apply = place => {
      discovering = false; $('discoverBtn').removeAttribute('aria-busy');
      // A queued search cannot override navigation/settings chosen afterwards.
      if (requestedAt !== serial) return;
      if (!place) { toast('Could not find a new place. Try again.'); return; }
      closeSettings(); viewport.focus({preventScroll: true});
      const v = {x: F.parse(place.x.toPrecision(17)), y: F.parse(place.y.toPrecision(17)), span: F.parse(place.span.toPrecision(6))};
      jump(validate(v)); toast('Discovered · ' + (7 / place.span).toExponential(1).replace('e+', '×10^'));
    };
    discovering = true; $('discoverBtn').setAttribute('aria-busy', 'true');
    if (!worker) {
      let s = seed || 1;
      apply(TetraCore.discover(() => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }));
      return;
    }
    const id = references.nextId++;
    references.discover.set(id, data => apply(data.error ? null : data.place));
    worker.postMessage({type: 'discover', id, seed});
  }
  $('discoverBtn').onclick = discover;

  // ---------- Share and export ----------
  $('shareBtn').onclick = async () => {
    updateURL(); const url = location.href;
    if (location.protocol === 'file:') { $('shareMessage').textContent = 'This is a local file. Append these coordinates to the same hosted app to reopen the view.'; $('shareText').value = '#' + hashString(); $('shareDialog').showModal(); $('shareText').select(); return; }
    try {
      if (navigator.share && coarsePointer) { await navigator.share({title: 'TETRA', text: 'Explore this view.', url}); return; }
      if (!navigator.clipboard) throw Error('No clipboard');
      await navigator.clipboard.writeText(url); toast('View link copied.');
    } catch (error) {
      if (error.name === 'AbortError') return;
      $('shareMessage').textContent = 'Copy this link to reopen the same view.'; $('shareText').value = url; $('shareDialog').showModal(); $('shareText').select();
    }
  };
  $('copyLinkBtn').onclick = async () => {
    try { await navigator.clipboard.writeText($('shareText').value); toast('View link copied.'); }
    catch { $('shareText').focus(); $('shareText').select(); toast('Select and copy the link.'); }
  };
  async function snapshot() {
    // ImageBitmap creation is asynchronous. Freeze every camera/viewport transform
    // with the image and its metadata, before navigation or resize can change them.
    const capturedView = clone(view), capturedDims = {...dims};
    const captured = {view: serialize(), mode: currentMode, iterations: iterationsFor(), palette, complete: lastRenderComplete, hue: hue(), url: location.href};
    const gridCopy = grid ? document.createElement('canvas') : null;
    const detailCopy = retainedDetail ? document.createElement('canvas') : null, detailView = retainedDetail && clone(retainedDetail.view), detailAspect = retainedDetail?.aspect;
    if (detailCopy) { detailCopy.width = detailCanvas.width; detailCopy.height = detailCanvas.height; detailCopy.getContext('2d').drawImage(detailCanvas, 0, 0); }
    if (gridCopy) { gridCopy.width = gridCanvas.width; gridCopy.height = gridCanvas.height; gridCopy.getContext('2d').drawImage(gridCanvas, 0, 0); }
    const transform = display.view ? transformFor(display.view, capturedView) : null;
    const sourceAspect = display.canvas === gpuCanvas ? display.aspect || capturedDims.h / capturedDims.w : capturedDims.h / capturedDims.w;
    const detailTransform = detailView ? transformFor(detailView, capturedView) : null;
    let source = display.canvas;
    if (display.frame && display.canvas === gpuCanvas) source = await display.renderer.capture(display.frame, display.soft);
    const out = document.createElement('canvas'); out.width = Math.max(1, source.width, detailCopy?.width || 0); out.height = Math.max(1, source.height, detailCopy?.height || 0);
    const c = out.getContext('2d');
    c.fillStyle = '#060606'; c.fillRect(0, 0, out.width, out.height); c.save();
    if (transform) { c.translate(out.width / 2 + transform.dx / capturedDims.w * out.width, out.height / 2 + transform.dy / capturedDims.h * out.height); c.scale(transform.zoom, transform.zoom * sourceAspect / (capturedDims.h / capturedDims.w)); c.translate(-out.width / 2, -out.height / 2); }
    if ('filter' in c) c.filter = `hue-rotate(${captured.hue}deg)`;
    c.drawImage(source, 0, 0, out.width, out.height); c.restore(); source.close?.();
    if (detailCopy) {
      const t = detailTransform;
      c.save(); c.translate(out.width / 2 + t.dx / capturedDims.w * out.width, out.height / 2 + t.dy / capturedDims.h * out.height);
      c.scale(t.zoom, t.zoom * detailAspect / (out.height / out.width));
      c.translate(-out.width / 2, -out.height / 2); if ('filter' in c) c.filter = `hue-rotate(${captured.hue}deg)`;
      c.drawImage(detailCopy, 0, 0, out.width, out.height); c.restore();
    }
    if (!('filter' in c) && captured.hue) { const pixels = c.getImageData(0, 0, out.width, out.height); TetraRender.huePixels(pixels.data, captured.hue); c.putImageData(pixels, 0, 0); }
    if (gridCopy) c.drawImage(gridCopy, 0, 0, out.width, out.height);
    const scale = Math.max(1, out.width / 1400);
    c.fillStyle = '#0a0a0aeb'; c.fillRect(0, out.height - 43 * scale, out.width, 43 * scale);
    c.fillStyle = '#eeeeee'; c.font = `${10 * scale}px monospace`;
    c.fillText(`TETRA / ${captured.mode.toUpperCase()} / ${captured.iterations} LIMIT / ${captured.complete ? 'COMPLETED' : 'PARTIAL PREVIEW'}`, 12 * scale, out.height - 26 * scale);
    c.font = `${8 * scale}px monospace`; c.fillStyle = '#bbbbbb';
    c.fillText(`Re ${captured.view.x}  Im ${captured.view.y}  Span ${captured.view.span}`, 12 * scale, out.height - 10 * scale, out.width - 24 * scale);
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
    return {blob, captured};
  }
  $('exportBtn').onclick = async () => {
    updateURL();
    let result;
    try { result = await snapshot(); } catch { toast('Wait for a completed view, then save again.'); return; }
    const {blob, captured} = result;
    if (!blob) { toast('Could not export this image.'); return; }
    const name = 'tetra-' + Date.now() + '.png';
    if (coarsePointer && typeof File === 'function' && navigator.canShare) {
      const file = new File([blob], name, {type: 'image/png'});
      if (navigator.canShare({files: [file]})) {
        try { await navigator.share({files: [file], title: 'TETRA', text: captured.url}); return; }
        catch (error) { if (error.name === 'AbortError') return; }
      }
    }
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000);
    toast(captured.complete ? 'PNG exported.' : 'Partial preview exported.');
  };
  $('fullscreenBtn').onclick = async () => {
    closeSettings();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('Fullscreen is unavailable in this browser.');
    } catch { toast('Could not enter fullscreen.'); }
  };

  // ---------- Dialogs, focus mode, saved views ----------
  $('helpBtn').onclick = () => $('helpDialog').showModal();
  $('mobileHelpBtn').onclick = () => { closeSettings(); $('helpDialog').showModal(); };
  document.querySelectorAll('.close-dialog').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  }));
  function openSettings() { if (!$('sidebar').open) $('sidebar').showModal(); $('settingsBtn').setAttribute('aria-expanded', 'true'); }
  function closeSettings() { if ($('sidebar').open) $('sidebar').close(); }
  $('sidebar').addEventListener('close', () => { $('settingsBtn').setAttribute('aria-expanded', 'false'); coordinateDraft = false; updateReadout(); });
  $('settingsBtn').onclick = openSettings; $('closeSettings').onclick = closeSettings;
  function focusMode(enabled) {
    document.body.classList.toggle('focus-mode', enabled);
    $('focusBtn').setAttribute('aria-pressed', String(enabled)); $('focusBtn').setAttribute('aria-label', enabled ? 'Exit focus mode' : 'Enter focus mode');
    $('exitFocusBtn').hidden = !enabled; viewport.focus({preventScroll: true});
    // CSS changes can precede ResizeObserver delivery. Invalidate the old size
    // before callers can treat its pixels as a completed focused view.
    measure();
  }
  $('focusBtn').onclick = () => focusMode(!document.body.classList.contains('focus-mode'));
  $('exitFocusBtn').onclick = () => focusMode(false);
  function loadSaved() { try { savedViews = TetraSaved.decode(localStorage.getItem(TetraSaved.KEY)); } catch { savedViews = []; } drawSaved(); }
  function writeSaved(next) {
    try { localStorage.setItem(TetraSaved.KEY, TetraSaved.encode(next)); savedViews = next; drawSaved(); return true; }
    catch { toast('Storage unavailable. Share a link to keep this view.'); return false; }
  }
  function drawSaved() {
    $('savedViews').replaceChildren(); $('savedCount').textContent = savedViews.length + ' / ' + TetraSaved.LIMIT; $('savedEmpty').hidden = !!savedViews.length;
    savedViews.forEach(item => {
      const row = document.createElement('div'); row.className = 'saved-view';
      const open = document.createElement('button'); open.className = 'saved-open'; open.type = 'button';
      const name = document.createElement('span'); name.textContent = item.name;
      const detail = document.createElement('small'), params = new URLSearchParams(item.hash); detail.textContent = 'span ' + params.get('s');
      open.append(name, detail);
      open.onclick = () => {
        try { const before = clone(view); if (!readHash(item.hash)) throw Error('Invalid saved view'); stopMotion(); saveHistory(before); closeSettings(); viewport.focus({preventScroll: true}); changed(); }
        catch { toast('This saved view is not valid.'); }
      };
      const remove = document.createElement('button'); remove.className = 'saved-delete'; remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove ' + item.name);
      remove.onclick = () => { if (writeSaved(savedViews.filter(v => v.id !== item.id))) { $('bookmarkName').focus(); toast('Saved view removed.'); } };
      row.append(open, remove); $('savedViews').append(row);
    });
  }
  $('bookmarkForm').onsubmit = e => {
    e.preventDefault();
    if (savedViews.length >= TetraSaved.LIMIT) { toast('24 views saved. Remove one before saving another.'); return; }
    const name = $('bookmarkName').value.trim() || (locationIndex >= 0 ? presets[locationIndex].name : 'View ' + String(savedViews.length + 1).padStart(2, '0'));
    const item = {id: globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2), name: name.slice(0, 48), hash: hashString()};
    if (writeSaved([...savedViews, item])) { $('bookmarkName').value = ''; toast('View saved on this device.'); }
  };
  $('saveViewBtn').onclick = () => { openSettings(); $('bookmarkName').focus(); };
  window.addEventListener('storage', e => { if (e.key === TetraSaved.KEY || e.key === null) loadSaved(); });
  loadSaved();
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target.closest('input,select,textarea,[contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) { focusMode(false); return; }
    const key = e.key.toLowerCase();
    const actions = {z: () => $('detailBtn').click(), f: () => $('focusBtn').click(), c: openSettings, b: () => $('saveViewBtn').click(), s: () => $('shareBtn').click(), e: () => $('exportBtn').click(), d: discover, g: () => { $('grid').checked = !grid; $('grid').dispatchEvent(new Event('change')); }, '?': () => $('helpBtn').click()};
    if (actions[key]) { e.preventDefault(); actions[key](); }
    else if (/^[1-9]$/.test(key) && Number(key) <= presets.length) { e.preventDefault(); loadPreset(Number(key) - 1); }
  });

  // ---------- Lifecycle ----------
  let resumeFlow = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelGesture();
      resumeFlow = flow; setFlow(false);
      if (!lastRenderComplete) { serial++; stopCPU(); jobSerial = -1; }
    } else {
      if (resumeFlow) setFlow(true);
      if (!lastRenderComplete) changed();
    }
  });
  reducedMotion.addEventListener('change', e => { if (e.matches) { resumeFlow = false; setFlow(false); stopMotion(); visual = clone(view); reproject(); } });
  window.addEventListener('pagehide', () => { serial++; stopCPU(); });
  window.addEventListener('pageshow', e => { if (e.persisted) changed(); });
  window.addEventListener('hashchange', e => {
    try {
      // A render completion or URL debounce may replace location.hash before this
      // queued event is delivered. The event still owns the requested navigation.
      const hash = e.newURL ? new URL(e.newURL).hash : location.hash;
      if (hash === '#' + hashString()) return;
      const before = clone(view);
      if (readHash(hash)) { stopMotion(); saveHistory(before); changed(); }
    } catch (error) { toast(error.message); }
  });
  // A size change invalidates the image at once; live frames follow the new shape
  // and the full render starts once resizing pauses.
  const displayDensity = () => Math.min(Math.max(devicePixelRatio || 1, 0.25), 3);
  function measure() {
    const r = viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const next = {w: r.width, h: r.height, dpr: displayDensity()};
    if (next.w === dims.w && next.h === dims.h && next.dpr === dims.dpr) return;
    const first = dims.w === 1;
    cancelGesture();
    dims = next;
    changed(first ? {} : {interactive: true});
  }
  const observer = new ResizeObserver(measure);
  // Browser zoom changes density with a resize; moving to another display may not, so watch the resolution too.
  window.addEventListener('resize', measure);
  let dprQuery = null;
  function watchDensity() {
    dprQuery?.removeEventListener('change', onDensity);
    dprQuery = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDensity);
  }
  function onDensity() { watchDensity(); measure(); }
  watchDensity();
  // Some browsers omit resolution media events after fullscreen. Check one
  // number per second while visible; only an actual density change reads layout.
  window.setInterval(() => { if (!document.hidden && displayDensity() !== dims.dpr) onDensity(); }, 1000);
  function startGPU() {
    if (!compute && typeof TetraCompute === 'function' && window.TETRA_COMPUTE !== false) {
      TetraCompute.create().then(accelerator => { compute = accelerator; }, error => { console.warn('WebGPU unavailable:', error?.message || error); });
    }
    try { gpu = new TetraGPU(gpuCanvas); gpuFailure = ''; return true; }
    catch (error) { gpu = null; gpuFailure = String(error.message); console.warn('WebGL2 unavailable; using Worker FP64.', error.message); return false; }
  }
  gpuCanvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    if (!gpu) return;
    const timedOut = gpu.failed;
    clearDetail();
    keepSnapshot();
    clearCompleted();
    gpu = null; display.frame = null; display.renderer = null; display.key = ''; gpuFailure = timedOut ? 'GPU completion timed out' : 'context lost';
    toast(timedOut ? 'GPU stopped responding. Switched to CPU.' : 'GPU context lost. Switched to CPU.'); changed();
  });
  gpuCanvas.addEventListener('webglcontextrestored', () => {
    if (gpu) return;
    if (startGPU()) { toast('GPU restored.'); changed(); }
  });
  try { readHash(); } catch (error) { toast('Could not open this view. ' + error.message); }
  startGPU();
  // Installable, offline-capable shell (network first; see sw.js). Secure contexts only.
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).catch(() => {}); });
  }
  $('gestureHint').textContent = coarsePointer ? 'DRAG TO PAN / PINCH TO ZOOM' : 'DRAG TO PAN / SCROLL TO ZOOM';
  syncControls(); observer.observe(viewport);

  // Read-only diagnostic snapshots for reproducible tests; no network or telemetry.
  Object.defineProperty(window, 'tetraDiagnostics', {get: () => ({
    view: serialize(), visual: serialize(visual), mode: currentMode, digits: exactDigits(), referenceDigits: Math.min(256, referenceDigits(view) + 16),
    iterations: iterationsFor(), iterationSetting, palette, engine, complete: lastRenderComplete, lastCompleted: lastCompletedInfo,
    backend: isGPUMode(currentMode) ? gpu?.kind : currentMode, gpu: !!gpu, gpuFailure, workers: pool.workers.length, poolLimit, workerTransfer,
    references: references.cache.map(r => ({x: r.x.slice(0, 24), y: r.y.slice(0, 24), digits: r.digits, iterations: r.iterations, length: r.length, elapsed: r.elapsed})),
    reference: references.active && {x: references.active.x.slice(0, 40), y: references.active.y.slice(0, 40), digits: references.active.digits, iterations: references.active.iterations, length: references.active.length, elapsed: references.active.elapsed},
    referencesComputed: references.computed,
    savedCount: savedViews.length, focus: document.body.classList.contains('focus-mode'), version: VERSION, renderStage, quality, colorPhase: hue(), flow,
    interactiveFrames: interactiveCount, animating: !!motion.raf, gpuFrames: gpu ? gpu.live : 0, gpuPooled: gpu ? gpu.pool.length : 0, displayWidth: display.canvas.width, displayHeight: display.canvas.height,
    completedCache: {entries: completedViews.size, bytes: completedBytes, budget: completedBudget, hits: completedHits},
    retainedDetail: retainedDetail ? {width: detailCanvas.width, height: detailCanvas.height, view: serialize(retainedDetail.view)} : null,
    blaCompile: gpu ? {pending: !!gpu.pendingBla, warmed: gpu.warmed, error: gpu.blaError} : null,
    bla: gpu?.bla ? {levels: gpu.bla.levels, reach: gpu.bla.reach, compiled: !!gpu.programs.perturbBla, mode: gpu.blaMode} : null, blaReady: !!gpu?.programs.perturbBla, displayView: display.view && serialize(display.view), displayCanvas: display.canvas.id, liveSamples: livePlan ? livePlan.samples : 0, liveInterleave: livePlan ? livePlan.interleave : 0, liveSize: livePlan ? [livePlan.width, livePlan.height] : null, liveMin: display.info?.live ? display.info.live.min : null, displaySmooth: !!display.info?.smooth, displaySoft: !!display.soft, perturbWarm: !!gpu?.perturbWarm, preciseTrig: !!gpu?.preciseTrig,
    compute: compute ? {failed: compute.failed, batches: compute.batches, ready: Object.keys(compute.pipelines), preciseTrig: compute.precise} : null,
  })});
})();
