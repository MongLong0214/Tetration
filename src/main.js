(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const F = createFixed(256);
  const VERSION = '1.0.0';
  const workerSource = __WORKER_SOURCE__;
  const workerURL = URL.createObjectURL(new Blob([workerSource], {type: 'text/javascript'}));
  const presets = [
    {name: 'Overview', sub: 'COMPLEX PLANE', x: '-0.2', y: '0', span: '7'},
    {name: 'Bloom', sub: 'RECURSIVE PETALS', x: '-2.5', y: '0', span: '1.8'},
    {name: 'Filaments', sub: 'BETWEEN THE BASINS', x: '-1.84', y: '0.09', span: '0.46'},
    {name: 'Feather', sub: 'FOLDS AND BRANCHES', x: '-0.72', y: '0.36', span: '0.7'},
    {name: 'Plume', sub: '10¹¹ · CORAL FEATHERS', x: '-2.2930579295624999999999991', y: '0.33208044555625', span: '5e-11'},
    {name: 'Abyss', sub: '10²⁵ · PERTURBATION', x: '-0.605137938972379900971816986088586258864125', y: '0.437740442074800562969426507709712806289976004723289995229', span: '7e-25'},
    {name: 'Horizon', sub: '10¹⁰⁰ · DEEP FEATHER', x: '-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206', y: '0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475', span: '7e-100'},
  ];
  const FIXED_ITERATIONS = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
  const AUTO_STEPS = [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384];
  const DIRECT_LIMIT = 2 ** -16, FP64_LIMIT = 1e-13, SETTLE_MS = 110, BATCH_MS = 14, FRAME_MS = 12;
  const minSpan = F.parse('1e-200'), maxSpan = F.parse('1e12'), maxCoordinate = F.parse('1e12');
  const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
  const coarsePointer = matchMedia('(pointer:coarse)').matches;

  let view = parseView(presets[1]), visual = clone(view);
  let palette = 0, iterationSetting = 'auto', engine = 'auto', quality = coarsePointer ? 4 : 16, grid = false, locationIndex = 1;
  let colorPhase = 0, flow = false, flowStarted = 0, flowFrame = 0, flowPaint = 0;
  let history = [], future = [], savedViews = [], coordinateDraft = false, toastTimer = 0;
  let dims = {w: 1, h: 1, dpr: 1};
  let gpu = null, gpuFailure = '', serial = 0, jobSerial = -1, settleTimer = 0, currentMode = 'gpu';
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
  const ctx = cpuCanvas.getContext('2d', {alpha: false}), gridCtx = gridCanvas.getContext('2d');
  const display = {canvas: cpuCanvas, view: null, frame: null, renderer: null, key: ''};

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
  function chooseMode(v = view) {
    if (engine === 'exact') return 'exact';
    const pixel = num(v.span) / Math.max(dims.w, 1), scale = magnitude(v);
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
  function saveHistory() {
    future = [];
    const prev = history.at(-1);
    if (!prev || !same(prev, view)) { if (history.length >= 80) history.shift(); history.push(clone(view)); }
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
    $('viewSubtitle').textContent = locationIndex < 0 ? (depth > 13 ? 'DEEP · ' + iterationsFor().toLocaleString('en-US') + ' STEPS' : 'EXPLORING') : presets[locationIndex].sub;
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
  function applyHue() { const angle = hue(); display.canvas.style.filter = angle ? 'hue-rotate(' + angle + 'deg)' : 'none'; }
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
    if (!display.view) return;
    if (same(display.view, visual)) { display.canvas.style.transform = 'none'; return; }
    const {zoom, dx, dy} = transformFor(display.view, visual);
    display.canvas.style.transform = Number.isFinite(zoom + dx + dy) && zoom < 1e6 && zoom > 1e-6 ? `translate(${dx}px,${dy}px) scale(${zoom})` : 'scale(0)';
  }
  function setDisplay(canvas, renderView) {
    for (const c of [gpuCanvas, cpuCanvas]) c.style.display = c === canvas ? 'block' : 'none';
    if (canvas !== gpuCanvas && display.frame) { const old = display.frame; display.frame = null; if (!pinned.has(old)) display.renderer?.releaseFrame(old); display.renderer = null; display.key = ''; }
    display.canvas = canvas; display.view = clone(renderView);
    reproject(); applyHue(); document.body.dataset.ready = 'true';
  }
  function show(renderer, frame, renderView, key) {
    renderer.presentFrame(frame);
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

  // ---------- References (exact orbits for perturbation) ----------
  const references = {worker: null, cache: [], inflight: new Map(), nextId: 1, waiters: new Map(), discover: new Map(), computed: 0, active: null};
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
        for (const waiter of references.waiters.values()) waiter.reject(Error('Reference worker interrupted'));
        references.waiters.clear(); references.inflight.clear(); references.worker = null; worker.terminate();
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
    const base = {iterations: iterationsFor(v), palette, rules: TetraCore.RULES.gpu};
    if (mode === 'gpu') return {...base, mode: 'direct', center: [num(v.x), num(v.y)], span: num(v.span)};
    return {...base, ...TetraRender.perturbScene(F, v, ref.point.x, ref.point.y), ref};
  }
  function sceneKey(scene, v) { return [scene.mode, F.text(v.x), F.text(v.y), F.text(v.span), scene.iterations, scene.palette, dims.w, dims.h].join('|'); }
  function rateKey(scene, samples) { return scene.mode + '|' + scene.iterations + '|' + samples; }
  function tileEdge(iterations, samples) { return Math.max(16, Math.min(256, Math.round(Math.sqrt(4096 * 256 * 16 / (iterations * samples)) / 16) * 16)); }
  // Resolution that should finish within the interactive frame budget.
  function interactiveSize(scene, target = TetraRender.size(dims.w, dims.h, dims.dpr)) {
    const rate = rates.get(rateKey(scene, 1)) ?? 60;
    // Slow GPUs (deep views on weak hardware) drop to coarser frames rather than stall the compositor.
    const floor = rate * FRAME_MS * 4 >= 8192 ? 8192 : 2048;
    // Cap one draw's orbit work so a sudden jump in cost cannot stall the GPU (driver watchdogs).
    const pixels = Math.max(floor, Math.min(target.width * target.height, rate * FRAME_MS, 8e7 / scene.iterations));
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
    if (gpuBusy) { interactivePending = true; return; }
    const v = clone(visual), mode = chooseMode(v);
    if (!isGPUMode(mode)) return;
    let ref = null;
    if (mode === 'perturb') {
      ref = findReference(v, mode);
      if (!ref) { ensureReference(v, mode).then(() => requestInteractive(), () => {}); return; }
    }
    const renderer = gpu, scene = buildScene(v, mode, ref), key = sceneKey(scene, v);
    if (display.frame && display.key === key) return;
    const size = interactiveSize(scene);
    setGPUBusy(true);
    const t0 = performance.now();
    let frame = null;
    try {
      frame = renderer.beginFrame(size.width, size.height);
      renderer.prepare(frame, scene, 1);
      renderer.drawTile(frame, {x: 0, y: 0, width: size.width, height: size.height});
      await renderer.fence();
      const ms = Math.max(0.5, performance.now() - t0);
      const k = rateKey(scene, 1), measured = size.width * size.height / ms;
      rates.set(k, rates.has(k) ? rates.get(k) * 0.5 + measured * 0.5 : measured);
      if (renderer === gpu) { show(renderer, frame, v, key); interactiveCount++; frame = null; }
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
  }
  async function runStage(id, renderer, frame, scene, samples, onBatch) {
    const edge = tileEdge(scene.iterations, samples), tiles = TetraRender.tiles(frame.width, frame.height, edge), key = rateKey(scene, samples);
    const area = frame.width * frame.height;
    let budget = Math.max(edge * edge, (rates.get(key) ?? (rates.get(rateKey(scene, 1)) ?? 60) / samples) * BATCH_MS);
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
      try {
        renderer.prepare(frame, scene, samples);
        for (const t of batch) renderer.drawTile(frame, t);
        await renderer.fence();
      } finally { setGPUBusy(false); }
      const ms = Math.max(0.5, performance.now() - t0), measured = pixels / ms;
      rates.set(key, measured);
      budget = Math.min(area, Math.max(edge * edge, measured * BATCH_MS));
      if (interactivePending) { interactivePending = false; requestInteractive(); }
      if (id !== serial) return false;
      onBatch?.(index / tiles.length, index === tiles.length);
    }
    return true;
  }
  async function gpuJob(id, v, mode, ref) {
    const renderer = gpu, scene = buildScene(v, mode, ref), aa = quality, key = sceneKey(scene, v);
    const target = TetraRender.size(dims.w, dims.h, dims.dpr);
    const stages = [{samples: 1, name: 'detail', label: 'Resolving detail'}];
    if (aa >= 4) stages.push({samples: 4, name: 'antialias', label: 'Smoothing edges'});
    if (aa >= 16) stages.push({samples: 16, name: 'ultra', label: 'Ultra edges'});
    const total = stages.length + 1, held = new Set();
    const hold = frame => { pin(frame); held.add(frame); return frame; };
    const drop = frame => { if (held.delete(frame)) unpin(renderer, frame); };
    try {
      let previous;
      if (display.frame && display.renderer === renderer && display.key === key) {
        // The interactive frame already shows this camera; refine it in place.
        previous = hold(display.frame);
      } else {
        renderStage = 'preview';
        const size = interactiveSize(scene, target);
        previous = hold(renderer.beginFrame(size.width, size.height));
        $('loadingText').textContent = 'Finding the view';
        if (!(await runStage(id, renderer, previous, scene, 1, fraction => setProgress(fraction / total * 100)))) return;
        show(renderer, previous, v, key);
      }
      for (let s = 0; s < stages.length; s++) {
        const stage = stages[s];
        renderStage = stage.name;
        const frame = hold(renderer.beginFrame(target.width, target.height, previous, stage.samples > 1));
        let lastPresented = 0;
        const ok = await runStage(id, renderer, frame, scene, stage.samples, (fraction, last) => {
          setProgress((s + 1 + fraction) / total * 100);
          $('loadingText').textContent = `${stage.label} · ${target.width} × ${target.height} · ${Math.round(fraction * 100)}%`;
          $('resolutionReadout').textContent = `${target.width} × ${target.height} / ${Math.round(fraction * 100)}%`;
          const now = performance.now();
          if (last || now - lastPresented > 50) { show(renderer, frame, v, key); lastPresented = now; }
        });
        drop(previous);
        previous = frame;
        if (!ok) return;
      }
      if (id === serial) finished(target.width, target.height, null, iterationsFor(v), mode, stages.at(-1).samples);
    } catch (error) {
      if (id !== serial && renderer === gpu && !renderer.lost()) return;
      gpuFailed(renderer, error);
    } finally {
      for (const frame of [...held]) drop(frame);
    }
  }
  function gpuFailed(renderer, error) {
    if (renderer !== gpu) return;
    console.warn('GPU renderer unavailable:', error?.message || error);
    gpuFailure = String(error?.message || error);
    if (!renderer.lost()) { try { renderer.destroy(); } catch { /* lost */ } }
    gpu = null; display.frame = null; display.renderer = null; display.key = '';
    toast('Renderer changed. Recomputing view.');
    changed();
  }

  // ---------- CPU rendering (persistent Worker pool) ----------
  const memory = navigator.deviceMemory || 8;
  const poolLimit = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1, memory <= 2 ? 2 : memory <= 4 ? 4 : 8));
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
      const copy = document.createElement('canvas'); copy.width = cpuCanvas.width; copy.height = cpuCanvas.height; copy.getContext('2d').drawImage(cpuCanvas, 0, 0);
      cpuCanvas.width = width; cpuCanvas.height = height; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(copy, 0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  }
  // Start the CPU canvas from the image currently on screen, at the new camera.
  function seedCPUPreview(v) {
    configureCPUCanvas();
    const source = display.canvas, from = display.view;
    ctx.fillStyle = '#060606';
    if (!from || (source === cpuCanvas && same(from, v))) { if (!from) ctx.fillRect(0, 0, cpuCanvas.width, cpuCanvas.height); return; }
    const copy = document.createElement('canvas'); copy.width = cpuCanvas.width; copy.height = cpuCanvas.height;
    copy.getContext('2d').drawImage(source, 0, 0, copy.width, copy.height);
    const {zoom, dx, dy} = transformFor(from, v), scale = cpuCanvas.width / dims.w;
    ctx.fillRect(0, 0, cpuCanvas.width, cpuCanvas.height);
    if (Number.isFinite(zoom + dx + dy) && zoom < 1e6 && zoom > 1e-6) ctx.drawImage(copy, dx * scale + (1 - zoom) * copy.width / 2, dy * scale + (1 - zoom) * copy.height / 2, copy.width * zoom, copy.height * zoom);
  }
  function cpuJob(id, v, mode, ref) {
    seedCPUPreview(v); setDisplay(cpuCanvas, v); renderStage = 'detail';
    const workers = ensurePool();
    if (!workers.length) { renderError('Workers unavailable. Use HTTPS or a local server.'); return; }
    const job = ++pool.job; pool.active = job;
    const pixelBudget = mode === 'exact' ? (dims.w < 761 ? 2048 : 4096) : 1600000;
    const maximum = Math.max(12, Math.floor(Math.min(mode === 'exact' ? 72 : 2048, dims.w * dims.dpr, Math.sqrt(pixelBudget * dims.w / dims.h))));
    const passes = [...new Set((mode === 'exact' ? [12, 30, maximum] : [160, 420, maximum]).map(w => Math.min(w, maximum)))].sort((a, b) => a - b);
    const iterations = iterationsFor(v), label = mode === 'exact' ? exactDigits(v) + ' DP' : mode === 'cpu-perturb' ? 'FP64 perturbation' : 'FP64';
    const base = {...serialize(v), mode, digits: exactDigits(v), iterations, palette, bitmap: true};
    if (ref) Object.assign(base, {ref: {V: ref.V, T: ref.T, ReA: ref.ReA, ImA: ref.ImA, length: ref.length, values: ref.values, L0: ref.L0, c0: ref.c0}, deltaRe: num(v.x - ref.point.x), deltaIm: num(v.y - ref.point.y), deltaMirror: num(-v.y - ref.point.y), imCenter: num(v.y)});
    let activePass = 0;
    function startPass() {
      if (id !== serial || job !== pool.job) return;
      const w = passes[activePass], h = Math.max(1, Math.round(w * dims.h / dims.w));
      const passCanvas = document.createElement('canvas'); passCanvas.width = w; passCanvas.height = h;
      const pctx = passCanvas.getContext('2d', {alpha: false}); pctx.imageSmoothingEnabled = true; pctx.drawImage(cpuCanvas, 0, 0, w, h);
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
            else { pool.active = 0; finished(w, h, counts.reduce((a, c) => a.map((n, i) => n + c[i]), [0, 0, 0, 0, 0]), iterations, mode, 1); }
          }
        };
        worker.postMessage({...base, id: job, width: w, height: h, index, workers: workers.length});
      });
    }
    startPass();
  }

  // ---------- Render orchestration ----------
  function renderError(message) {
    serial++; stopCPU(); viewport.setAttribute('aria-busy', 'false');
    $('statusText').textContent = 'Render interrupted'; showLoading(message); $('retryBtn').hidden = false;
  }
  $('retryBtn').onclick = () => changed();
  function finished(w, h, counts, iterations, mode, samples) {
    lastRenderComplete = true; renderStage = 'complete'; viewport.setAttribute('aria-busy', 'false'); $('loading').hidden = true; setProgress(100);
    const elapsed = performance.now() - started;
    $('statusText').textContent = `${iterations.toLocaleString('en-US')} steps · ${elapsed < 1000 ? Math.round(elapsed) + ' ms' : (elapsed / 1000).toFixed(1) + ' s'}`;
    $('resolutionReadout').textContent = `${w} × ${h} / ${mode === 'exact' ? exactDigits() + ' DP' : isGPUMode(mode) ? (samples === 16 ? 'ULTRA AA' : samples === 4 ? 'ADAPTIVE AA' : '1×') : 'FP64'}`;
    lastCompletedInfo = {view: serialize(), mode, iterations, palette, width: w, height: h, counts, elapsed, samples};
    document.body.dataset.ready = 'true'; document.body.dataset.mode = mode; document.body.dataset.complete = 'true';
    updateURL();
  }
  function invalidate() {
    serial++; stopCPU(); lastRenderComplete = false;
    document.body.dataset.complete = 'false'; viewport.setAttribute('aria-busy', 'true');
  }
  // Every camera or setting change ends here. Interactive changes keep showing and
  // refining low-cost frames; the full render starts when the camera rests.
  function changed(options = {}) {
    invalidate();
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
    if (document.hidden || jobSerial === serial) return;
    jobSerial = serial;
    const id = serial, v = clone(view), mode = chooseMode(v);
    visual = clone(view); started = performance.now(); currentMode = mode; updateReadout(); reproject();
    document.body.dataset.mode = mode; document.body.dataset.complete = 'false';
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
  const motion = {raf: 0, last: 0, vx: 0, vy: 0, samples: []};
  function easeVisual(dt) {
    if (same(visual, view)) return false;
    const k = 1 - Math.exp(-dt / 55);
    const from = visual, to = view, s0 = num(from.span), s1 = num(to.span), ratioSpan = s1 / s0;
    if (!Number.isFinite(ratioSpan) || ratioSpan > 1e6 || ratioSpan < 1e-6) { visual = clone(view); return true; }
    const nextSpan = s0 * ratioSpan ** k;
    let next;
    if (Math.abs(ratioSpan - 1) < 1e-9) {
      next = {span: to.span, x: from.x + ratio(to.x - from.x, k), y: from.y + ratio(to.y - from.y, k)};
    } else {
      // Keep the fixed point of the similarity between both cameras in place.
      const d = to.span - from.span, px = F.div(F.mul(from.x, to.span) - F.mul(to.x, from.span), d), py = F.div(F.mul(from.y, to.span) - F.mul(to.y, from.span), d);
      const spanBig = ratio(from.span, nextSpan / s0);
      next = {span: spanBig, x: px + ratio(from.x - px, nextSpan / s0), y: py + ratio(from.y - py, nextSpan / s0)};
    }
    const remaining = Math.abs(Math.log(s1 / num(next.span))) + Math.hypot(num(F.div(to.x - next.x, to.span)), num(F.div(to.y - next.y, to.span)));
    visual = remaining < 2e-3 ? clone(view) : next;
    return true;
  }
  function startMotion() { if (!motion.raf) { motion.last = performance.now(); motion.raf = requestAnimationFrame(stepMotion); } }
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
  function goTo(next, index = -1) { stopMotion(); view = next; locationIndex = index; changed({animate: near(next, visual)}); }
  function jump(next, index = -1) { saveHistory(); goTo(next, index); }
  function loadPreset(index) { closeSettings(); viewport.focus({preventScroll: true}); jump(parseView(presets[index]), index); }
  function zoomButton(factor, point) { stopMotion(); saveHistory(); if (zoomAt(factor, point)) { locationIndex = -1; changed({animate: true}); } }
  presets.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset'; b.type = 'button'; b.dataset.index = String(i); b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="preset-number">${String(i + 1).padStart(2, '0')}</span><span><span class="preset-name">${p.name}</span><span class="preset-sub">${p.sub}</span></span><span class="preset-arrow">↗</span>`;
    b.onclick = () => loadPreset(i);
    $('presets').append(b);
  });

  // ---------- Pointer, wheel and keyboard ----------
  const pointerMap = new Map();
  let pinch = null, drag = null, gestureSaved = false;
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
    stopMotion(); visual = clone(view);
    if (!gestureSaved) { saveHistory(); gestureSaved = true; }
    pointerMap.set(e.pointerId, relative(e.clientX, e.clientY)); touchSetup();
  });
  viewport.addEventListener('pointermove', e => {
    if (!pointerMap.has(e.pointerId)) return;
    pointerMap.set(e.pointerId, relative(e.clientX, e.clientY));
    const values = [...pointerMap.values()];
    if (pinch && values.length >= 2) {
      const [a, b] = values, mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), span = limitedSpan(ratio(pinch.view.span, pinch.distance, dist));
      view = bounded({span, x: pinch.anchor.x - ratio(span, mid.x - dims.w / 2, dims.w), y: pinch.anchor.y + ratio(span, mid.y - dims.h / 2, dims.w)});
    } else if (drag) {
      const p = values[0];
      view = bounded({...drag.view, x: drag.view.x - ratio(drag.view.span, p.x - drag.point.x, dims.w), y: drag.view.y + ratio(drag.view.span, p.y - drag.point.y, dims.w)});
      motion.samples.push({t: performance.now(), x: p.x, y: p.y}); if (motion.samples.length > 8) motion.samples.shift();
    } else return;
    locationIndex = -1; changed({interactive: true});
  });
  function pointerEnd(e) {
    if (!pointerMap.has(e.pointerId)) return;
    const samples = drag && pointerMap.size === 1 ? motionSamples() : null;
    pointerMap.delete(e.pointerId); touchSetup();
    if (pointerMap.size) return;
    gestureSaved = false;
    if (samples && !reducedMotion.matches && e.type === 'pointerup') { motion.vx = samples.vx; motion.vy = samples.vy; startMotion(); }
    clearTimeout(settleTimer); settleTimer = setTimeout(finalRender, 40); scheduleURL();
  }
  function motionSamples() {
    const list = motion.samples.filter(s => performance.now() - s.t < 90);
    if (list.length < 2) return null;
    const a = list[0], b = list.at(-1), dt = b.t - a.t;
    if (dt < 8) return null;
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    return Math.hypot(vx, vy) > 0.35 ? {vx: Math.max(-6, Math.min(6, vx)), vy: Math.max(-6, Math.min(6, vy))} : null;
  }
  viewport.addEventListener('pointerup', pointerEnd); viewport.addEventListener('pointercancel', pointerEnd); viewport.addEventListener('lostpointercapture', pointerEnd);
  let lastWheel = -Infinity;
  viewport.addEventListener('wheel', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    if (performance.now() - lastWheel > 500) saveHistory();
    lastWheel = performance.now();
    stopMotion();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? dims.h : 1);
    if (zoomAt(Math.exp(Math.max(-1.1, Math.min(1.1, dy * .0018))), relative(e.clientX, e.clientY))) { locationIndex = -1; changed({animate: !e.ctrlKey}); }
  }, {passive: false});
  viewport.addEventListener('dblclick', e => { if (e.target.closest('button')) return; e.preventDefault(); zoomButton(.4, relative(e.clientX, e.clientY)); });
  $('zoomIn').onclick = () => zoomButton(.5); $('zoomOut').onclick = () => zoomButton(2);
  $('homeBtn').onclick = () => loadPreset(0); $('brand').onclick = e => { e.preventDefault(); loadPreset(0); };
  $('backBtn').onclick = () => { if (!history.length) return; future.push(clone(view)); goTo(history.pop()); };
  $('forwardBtn').onclick = () => { if (!future.length) return; history.push(clone(view)); goTo(future.pop()); };
  viewport.addEventListener('keydown', e => {
    if (e.target.closest('button,input,select,textarea')) return;
    if (['+', '=', '-', '_', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault(); else return;
    if (e.altKey && e.key === 'ArrowLeft') { $('backBtn').click(); return; }
    if (e.altKey && e.key === 'ArrowRight') { $('forwardBtn').click(); return; }
    if (e.key === 'Home') { loadPreset(0); return; }
    if (e.key === '+' || e.key === '=') { zoomButton(.5); return; }
    if (e.key === '-' || e.key === '_') { zoomButton(2); return; }
    stopMotion(); saveHistory();
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
    const worker = referenceWorker(), seed = (Math.random() * 4294967296) >>> 0;
    const apply = place => {
      discovering = false; $('discoverBtn').removeAttribute('aria-busy');
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
    const captured = {view: serialize(), mode: currentMode, iterations: iterationsFor(), palette, complete: lastRenderComplete, hue: hue(), url: location.href};
    const gridCopy = grid ? document.createElement('canvas') : null;
    if (gridCopy) { gridCopy.width = gridCanvas.width; gridCopy.height = gridCanvas.height; gridCopy.getContext('2d').drawImage(gridCanvas, 0, 0); }
    const transform = display.view ? transformFor(display.view, view) : null;
    let source = display.canvas;
    if (display.frame && display.canvas === gpuCanvas) source = await display.renderer.capture(display.frame);
    const out = document.createElement('canvas'); out.width = Math.max(1, source.width); out.height = Math.max(1, source.height);
    const c = out.getContext('2d');
    c.fillStyle = '#060606'; c.fillRect(0, 0, out.width, out.height); c.save();
    if (transform) { c.translate(out.width / 2 + transform.dx / dims.w * out.width, out.height / 2 + transform.dy / dims.w * out.width); c.scale(transform.zoom, transform.zoom); c.translate(-out.width / 2, -out.height / 2); }
    if ('filter' in c) c.filter = `hue-rotate(${captured.hue}deg)`;
    c.drawImage(source, 0, 0, out.width, out.height); c.restore(); source.close?.();
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
        try { stopMotion(); saveHistory(); readHash(item.hash); closeSettings(); viewport.focus({preventScroll: true}); changed(); }
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
  window.addEventListener('storage', e => { if (e.key === TetraSaved.KEY) loadSaved(); });
  loadSaved();
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target.closest('input,select,textarea,[contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) { focusMode(false); return; }
    const key = e.key.toLowerCase();
    const actions = {f: () => $('focusBtn').click(), c: openSettings, b: () => $('saveViewBtn').click(), s: () => $('shareBtn').click(), e: () => $('exportBtn').click(), d: discover, g: () => { $('grid').checked = !grid; $('grid').dispatchEvent(new Event('change')); }, '?': () => $('helpBtn').click()};
    if (actions[key]) { e.preventDefault(); actions[key](); }
    else if (/^[1-9]$/.test(key) && Number(key) <= presets.length) { e.preventDefault(); loadPreset(Number(key) - 1); }
  });

  // ---------- Lifecycle ----------
  let resumeFlow = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resumeFlow = flow; setFlow(false);
      if (!lastRenderComplete) { serial++; stopCPU(); jobSerial = -1; }
    } else {
      if (resumeFlow) setFlow(true);
      if (!lastRenderComplete) changed();
    }
  });
  reducedMotion.addEventListener('change', e => { if (e.matches) { setFlow(false); stopMotion(); visual = clone(view); reproject(); } });
  window.addEventListener('pagehide', () => { serial++; stopCPU(); });
  window.addEventListener('pageshow', e => { if (e.persisted) changed(); });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#' + hashString()) return;
    try { stopMotion(); saveHistory(); if (readHash()) changed(); } catch (error) { toast(error.message); }
  });
  // A size change invalidates the image at once; live frames follow the new shape
  // and the full render starts once resizing pauses.
  function measure() {
    const r = viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const next = {w: r.width, h: r.height, dpr: Math.min(devicePixelRatio || 1, 2)};
    if (next.w === dims.w && next.h === dims.h && next.dpr === dims.dpr) return;
    const first = dims.w === 1;
    dims = next;
    changed(first ? {} : {interactive: true});
  }
  const observer = new ResizeObserver(measure);
  // Browser zoom and moving between displays change density without resizing the element.
  window.addEventListener('resize', measure);
  function startGPU() {
    try { gpu = new TetraGPU(gpuCanvas); gpuFailure = ''; return true; }
    catch (error) { gpu = null; gpuFailure = String(error.message); console.warn('WebGL2 unavailable; using Worker FP64.', error.message); return false; }
  }
  gpuCanvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    if (!gpu) return;
    gpu = null; display.frame = null; display.renderer = null; display.key = ''; gpuFailure = 'context lost';
    toast('GPU context lost. Switched to CPU.'); changed();
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
  })});
})();
