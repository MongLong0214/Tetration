"""Perturbation kernel time on the production shaders, without the app's scheduling:
one 1-sample draw per view (best of 3) with automatic BLA, as the app would choose it.
Needs a served build (npm run build && node serve.cjs dist). Usage:
  python3 tools/perf/gpu_kernel.py [--port 4173] [--size 240x118] [view ...]"""
import argparse, json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tests'))
import browser_common as bc
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--port', default='4173')
parser.add_argument('--size', default='240x118')
parser.add_argument('views', nargs='*', default=['plume', 'abyss', 'horizon'])
args = parser.parse_args()
bc.BASE = f'http://127.0.0.1:{args.port}'
W, H = map(int, args.size.split('x'))
VIEWS = json.loads((pathlib.Path(__file__).parent / 'views.json').read_text())
AUTO = [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384]
SCRIPT = '''async ([x, y, s, n, W, H]) => {
  const F = createFixed(256), r = window.__kernel || (window.__kernel = new TetraGPU(document.createElement('canvas')));
  r.blaMode = 'on'; r.blaProgram(); r.blaMode = 'auto';
  const v = {x: F.parse(x), y: F.parse(y), span: F.parse(s)}, pt = TetraRender.referencePoint(F, v);
  const ref = TetraReference.compute({x: F.text(pt.x), y: F.text(pt.y), digits: Math.min(256, Math.ceil(-Math.log10(Number(s))) + 30), iterations: n, maxRe: 80});
  ref.point = pt;
  const scene = {iterations: n, palette: 0, rules: TetraCore.RULES.gpu, aspect: H / W, ...TetraRender.perturbScene(F, v, pt.x, pt.y), ref};
  let best = 1e9;
  for (let k = 0; k < 3; k++) {
    const f = r.beginFrame(W, H), t = performance.now();
    r.draw(f, {x: 0, y: 0, width: W, height: H}, scene, 1); await r.fence();
    best = Math.min(best, performance.now() - t); r.releaseFrame(f);
  }
  return {ms: Math.round(best), bla: r.bla ? {levels: r.bla.levels, reach: r.bla.reach} : null};
}'''

with sync_playwright() as p:
    browser = bc.launch(p)
    page = browser.new_page(viewport={'width': 800, 'height': 600})
    page.add_init_script(bc.NO_WEBGPU)
    bc.open_app(page, 'v=1&x=-1.84&y=0.09&s=0.46&q=1')
    for name in args.views:
        v = VIEWS[name]
        n = next(k for k in AUTO if k >= 320 + 34 * max(0, __import__('math').log10(7 / float(v['span']))))
        print(json.dumps({'view': name, 'size': [W, H], 'iterations': n, **page.evaluate(SCRIPT, [v['x'], v['y'], v['span'], n, W, H])}), flush=True)
    browser.close()
