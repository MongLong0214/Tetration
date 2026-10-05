"""Compare real cold renders and completed-view pan reuse on one GPU/browser.

Serve the candidate build, then optionally pass an original built HTML to compare
both apps on the same origin. The baseline response is intercepted byte-for-byte;
service workers are blocked to prevent cross-build caching. Network time is excluded.
Usage: python3 tools/perf/exploration.py --port 4173 --repeat 3
       --baseline-html /path/to/original/dist/index.html --output /tmp/exploration.json
"""
import argparse
import hashlib
import json
import pathlib
import statistics
import sys
import time
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests'))
import browser_common as bc

parser = argparse.ArgumentParser()
parser.add_argument('--port', default='4173')
parser.add_argument('--repeat', type=int, default=3)
parser.add_argument('--scenario', nargs='+', choices=['cold', 'pan', 'retina_drag'])
parser.add_argument('--baseline-html', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path)
args = parser.parse_args()
bc.BASE = f'http://127.0.0.1:{args.port}'
views = json.loads((ROOT / 'tools/perf/views.json').read_text())
baseline = args.baseline_html.read_bytes() if args.baseline_html else None
report = {'candidate_sha256': bc.bundle_sha(), 'baseline_sha256': hashlib.sha256(baseline).hexdigest() if baseline else None,
          'origin': bc.BASE, 'network_timing': False, 'repeat': args.repeat, 'runs': [], 'medians': []}

HOOK = '''(() => {window.__present=[];window.__long=[];window.__released=null;window.__releaseComplete=null;
 document.addEventListener('pointerup',e=>{if(e.target.closest?.('#viewport')){__released=performance.now();__releaseComplete=null;}},true);
 new MutationObserver(()=>{if(__released!==null&&__releaseComplete===null&&document.body?.dataset.complete==='true')__releaseComplete=performance.now()-__released;})
 .observe(document,{subtree:true,attributes:true,attributeFilter:['data-complete']});
 try{new PerformanceObserver(l=>l.getEntries().forEach(e=>__long.push(e.duration))).observe({type:'longtask',buffered:true});}catch{}
 const t=setInterval(()=>{if(!window.TetraGPU)return;clearInterval(t);const show=TetraGPU.prototype.presentFrame;
 TetraGPU.prototype.presentFrame=function(...a){__present.push(performance.now());return show.apply(this,a);};},1);})()'''


def run(browser, build, name, scenario):
    retina = scenario == 'retina_drag'
    viewport = {'width': 1440 if retina else 960 if scenario == 'cold' else 480,
                'height': 960 if retina else 640 if scenario == 'cold' else 320}
    context = browser.new_context(viewport=viewport, device_scale_factor=2 if scenario != 'cold' else 1, service_workers='block')
    if build == 'baseline':
        context.route(bc.BASE + '/', lambda route: route.fulfill(status=200, body=baseline, content_type='text/html'))
    page = context.new_page()
    page.add_init_script(HOOK)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    v = views[name]
    opened = time.perf_counter()
    page.goto(bc.BASE + '/#' + urlencode({'v': 1, 'x': v['x'], 'y': v['y'], 's': v['span'], 'q': 4 if retina else 16}))
    bc.ready(page)
    page_ms = (time.perf_counter() - opened) * 1000
    if not report.get('graphics'):
        report['graphics'] = page.evaluate('''()=>{const g=document.querySelector('#gpuCanvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER);}''')
    first = bc.state(page)['lastCompleted']
    result = {'build': build, 'view': name, 'scenario': scenario, 'size': [first['width'], first['height']], 'first_render_ms': first['elapsed'], 'page_to_complete_ms': page_ms}
    if scenario != 'cold':
        box = page.locator('#viewport').bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        page.evaluate('__present=[];__long=[]')
        page.mouse.move(x, y); page.mouse.down()
        if retina:
            for step in range(60):
                page.mouse.move(x + step * 2, y + step * .3); page.wait_for_timeout(16)
        else:
            page.mouse.move(x + 12, y + 5)
        # Release without inertia, measuring settle/recalculation rather than the glide.
        page.wait_for_timeout(120)
        during = bc.state(page)
        result['retained_native_detail'] = bool(during.get('retainedDetail'))
        page.mouse.up()
        released = time.perf_counter()
        bc.settle(page)
        result['wait_to_complete_ms'] = (time.perf_counter() - released) * 1000
        result['release_to_complete_ms'] = page.evaluate('__releaseComplete')
        assert result['release_to_complete_ms'] is not None, 'Missing app completion marker'
        final = bc.state(page)
        result.update({'pan_render_ms': final['lastCompleted']['elapsed'], 'reused_pixels': final['lastCompleted'].get('reusedPixels', 0),
                       'computed_pixels': final['lastCompleted'].get('computedPixels', first['width'] * first['height'])})
        presents = page.evaluate('__present')
        gaps = sorted(b - a for a, b in zip(presents, presents[1:]))
        result['presentation_gap_p95_ms'] = gaps[min(len(gaps)-1, int(len(gaps)*.95))] if gaps else None
        result['cache'] = final.get('completedCache')
    result['long_tasks_ms'] = page.evaluate('__long')
    result['errors'] = errors
    context.close()
    return result


with sync_playwright() as p:
    browser = bc.launch(p)
    report['browser'] = browser.version
    scenarios = [('cold', n) for n in ['plume', 'abyss', 'horizon']] + [('pan', n) for n in ['plume', 'abyss', 'horizon']] + [('retina_drag', 'horizon')]
    if args.scenario: scenarios = [(s, n) for s, n in scenarios if s in args.scenario]
    for scenario, name in scenarios:
        for repeat in range(args.repeat):
            # Alternate the order to reduce thermal/clocking bias.
            builds = ['baseline', 'candidate'] if baseline else ['candidate']
            if repeat % 2: builds.reverse()
            for build in builds:
                r = run(browser, build, name, scenario)
                r['repeat'] = repeat
                report['runs'].append(r)
                if args.output: args.output.write_text(json.dumps(report, indent=2))
                print(json.dumps(r), flush=True)
        for build in ['baseline', 'candidate'] if baseline else ['candidate']:
            rows = [r for r in report['runs'] if r['build'] == build and r['scenario'] == scenario and r['view'] == name]
            med = {'build': build, 'scenario': scenario, 'view': name}
            for key in ['first_render_ms', 'page_to_complete_ms', 'pan_render_ms', 'release_to_complete_ms', 'presentation_gap_p95_ms']:
                values = [r[key] for r in rows if r.get(key) is not None]
                if values: med[key] = round(statistics.median(values), 1)
            report['medians'].append(med)
        if args.output: args.output.write_text(json.dumps(report, indent=2))
    browser.close()
