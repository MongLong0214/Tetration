"""Where an app render spends its time: reference requests, every GPU submission (frame size,
program, samples, tiles, GPU ms) and the total, from a fresh page load. The first perturbation
draw includes the driver's lazy shader compilation. Usage:
  python3 tools/perf/app_timeline.py [--port 4173] [--viewport 480x320] [--q 1] [view ...]"""
import argparse, json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tests'))
import browser_common as bc
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--port', default='4173')
parser.add_argument('--viewport', default='480x320')
parser.add_argument('--q', default='1')
parser.add_argument('--full', action='store_true', help='print every event')
parser.add_argument('views', nargs='*', default=['plume', 'abyss', 'horizon', 'deep200'])
args = parser.parse_args()
bc.BASE = f'http://127.0.0.1:{args.port}'
W, H = map(int, args.viewport.split('x'))
VIEWS = json.loads((pathlib.Path(__file__).parent / 'views.json').read_text())
HOOK = '''(() => { window.__tl = []; const log = (...a) => __tl.push([Math.round(performance.now()), ...a]);
  const wait = setInterval(() => { if (!window.TetraGPU) return; clearInterval(wait);
    const P = TetraGPU.prototype, prepare = P.prepare, fence = P.fence, tile = P.drawTile;
    P.prepare = function (f, s, n, ...r) { this.__tiles = 0; this.__info = [f.width + 'x' + f.height, s.mode, n, s.accum ? 'live' : 'final']; return prepare.call(this, f, s, n, ...r); };
    P.drawTile = function (f, t) { this.__tiles++; return tile.call(this, f, t); };
    P.fence = function () { const a = performance.now(), info = this.__info, tiles = this.__tiles; return fence.call(this).then(() => log('draw', ...info, tiles, Math.round(performance.now() - a))); }; }, 1);
  const W = window.Worker; window.Worker = function (...a) { const w = new W(...a), post = w.postMessage.bind(w);
    w.postMessage = (m, ...r) => { if (m && m.type) log('worker>', m.type); return post(m, ...r); };
    w.addEventListener('message', e => log('worker<', e.data && e.data.type)); return w; };
})()'''

with sync_playwright() as p:
    browser = bc.launch(p)
    for name in args.views:
        v = VIEWS[name]
        page = browser.new_page(viewport={'width': W, 'height': H})
        page.add_init_script(bc.NO_WEBGPU); page.add_init_script(HOOK)
        info = bc.open_app(page, f"v=1&x={v['x']}&y={v['y']}&s={v['span']}&q={args.q}")
        events = page.evaluate('__tl')
        draws = [e for e in events if e[1] == 'draw']
        first = next((e for e in draws if e[3] == 'perturb'), None)
        print(json.dumps({'view': name, 'total_ms': round(info['lastCompleted']['elapsed']), 'mode': info['lastCompleted']['mode'],
                          'reference': info.get('reference'), 'draws': len(draws), 'gpu_ms': sum(e[-1] for e in draws),
                          'first_perturb_draw': first and {'size': first[2], 'ms': first[-1]}, 'bla': info.get('bla')}), flush=True)
        if args.full:
            for e in events: print('  ', e)
        page.close()
    browser.close()
