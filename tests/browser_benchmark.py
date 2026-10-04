"""Controlled software-WebGL navigation measurement; not a hardware benchmark.
Usage: python3 tests/browser_benchmark.py --result out.json --image out.png"""
import argparse
import json
import time
from browser_common import *
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--result', default=str(OUT / 'performance.json'))
parser.add_argument('--image', default=str(OUT / 'performance.png'))
parser.add_argument('--fragment', default='v=1&x=-0.2&y=0&s=7&q=4')
args = parser.parse_args()
TIMES = '''window.__visualTimes={};document.addEventListener('DOMContentLoaded',()=>{function tick(){const d=window.tetraDiagnostics;if(d){
  if(document.body.dataset.ready==='true'&&!__visualTimes.preview_ms)__visualTimes.preview_ms=performance.now();
  if(d.renderStage==='antialias'&&!__visualTimes.native_ms)__visualTimes.native_ms=performance.now();
  if(d.complete){__visualTimes.complete_ms=performance.now();return;}}requestAnimationFrame(tick)}requestAnimationFrame(tick)});'''

with sync_playwright() as p:
    browser = launch(p)
    page = browser.new_page(viewport={'width': 1440, 'height': 960})
    page.add_init_script(NO_WEBGPU)
    page.add_init_script(TIMES)
    started = time.time()
    response = page.goto(BASE + '/#' + args.fragment)
    ready(page)
    result = {'bundle_sha256': hashlib.sha256(response.body()).hexdigest(), 'visual_times': page.evaluate('__visualTimes'), 'browser': browser.version,
              'initial_seconds': time.time() - started, 'initial': state(page), 'scope': 'Chromium, ANGLE/SwiftShader, 1440x960, DPR 1. Playwright mouse input; not a hardware benchmark.'}
    page.screenshot(path=args.image)
    page.evaluate('''() => {window.__gaps=[];window.__draws=0;let prev=performance.now();window.__measure=true;
      function frame(t){if(!__measure)return;__gaps.push(t-prev);prev=t;requestAnimationFrame(frame)}requestAnimationFrame(frame);
      const prepare=TetraGPU.prototype.prepare;TetraGPU.prototype.prepare=function(f,s,samples,...r){if(samples>1)__draws++;return prepare.call(this,f,s,samples,...r)};}''')
    frames0 = state(page)['interactiveFrames']
    page.mouse.move(700, 400)
    page.mouse.down()
    t = time.time()
    for i in range(30):
        page.mouse.move(700 + i * 5, 400 + i * 1.5)
        page.wait_for_timeout(16)
    result['drag_seconds'] = time.time() - t
    result['drag_final_quality_draws'] = page.evaluate('__draws')
    result['drag_live_frames'] = state(page)['interactiveFrames'] - frames0
    page.mouse.up()
    gaps = page.evaluate('()=>{__measure=false;return __gaps}')
    result['frames'] = len(gaps)
    result['frame_gap_p95_ms'] = sorted(gaps)[int(len(gaps) * .95)] if gaps else None
    result['frame_gap_max_ms'] = max(gaps) if gaps else None
    settle(page)
    result['after'] = state(page)
    Path(args.result).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ['initial', 'after']}))
    browser.close()
