"""Served-origin release checks: security headers and exact served bytes, GPU reference pixels,
engine transitions, GPU loss and restoration, and degraded-feature fallbacks. CSP stays enabled.
Software graphics only; not hardware GPU or physical Safari qualification."""
import json
from browser_common import *
from playwright.sync_api import sync_playwright

suite = Suite('release', ['No physical iPhone/Safari test.', 'Software graphics is not hardware GPU qualification.'])
SHALLOW_BIG = 'v=1&x=0.5&y=0&s=1e-30&n=256&q=1'


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        context = browser.new_context(viewport={'width': 960, 'height': 700}, permissions=['clipboard-read', 'clipboard-write'])
        context.add_init_script(NO_WEBGPU)
        page = suite.watch(context.new_page())
        response = page.goto(BASE + '/#v=1&x=-2.5&y=0&s=1.8&q=1')
        assert response.status == 200
        expected = json.loads((ROOT / 'vercel.json').read_text())['headers'][0]['headers']
        headers = response.all_headers()
        for header in expected:
            assert headers.get(header['key'].lower()) == header['value'], header['key']
        assert hashlib.sha256(response.body()).hexdigest() == suite.report['bundle_sha256']
        suite.record('HTTP security headers and served bytes match the production build')
        ready(page, 'gpu')
        suite.report['graphics'] = page.evaluate('''() => {
            const gl = document.createElement('canvas').getContext('webgl2'), info = gl.getExtension('WEBGL_debug_renderer_info');
            return {renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER), version: gl.getParameter(gl.VERSION),
                    precision: gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE)};
        }''')
        suite.record('Application renders through browser WebGL2', suite.report['graphics'])

        pixels = page.evaluate('''() => {
            const r = new TetraGPU(document.createElement('canvas')), out = [];
            for (let palette = 0; palette < 4; palette++) for (const [name, x, y] of [['fixed', .5, 0], ['period2', .01, 0], ['threshold', 2, 0], ['origin', 0, 0], ['complex', .5, .25], ['negative axis', -1.2, 0]]) {
              const frame = r.beginFrame(1, 1);
              r.draw(frame, {x: 0, y: 0, width: 1, height: 1}, {mode: 'direct', center: [x, y], span: 1, iterations: 512, palette, rules: TetraCore.RULES.gpu}, 1);
              const actual = [...r.readFrame(frame)]; r.releaseFrame(frame);
              const o = TetraCore.orbitRules(x, y, 512, TetraCore.RULES.gpu);
              out.push({name, palette, actual, expected: TetraCore.color(o.kind, o.steps, palette, o.re, o.im)});
            }
            r.destroy(); return out;
        }''')
        for pixel in pixels:
            assert pixel['actual'][3] == 255 and max(abs(a - b) for a, b in zip(pixel['actual'], pixel['expected'])) <= 1, pixel
        suite.record('24 direct-shader reference pixels match FP64 across all palettes', len(pixels))
        pert = page.evaluate('''() => {
            const F = createFixed(256), r = new TetraGPU(document.createElement('canvas')), out = [];
            for (const [x, y] of [['0.5', '0'], ['0.5', '0.25'], ['-0.2', '0.7'], ['2', '0.3'], ['-1.2', '0.0000001']]) {
              const ref = TetraReference.compute({x, y, digits: 40, iterations: 512, maxRe: 80}); ref.point = {x: F.parse(x), y: F.parse(y)};
              const view = {x: F.parse(x), y: F.parse(y), span: F.parse('1e-20')}, frame = r.beginFrame(1, 1);
              r.draw(frame, {x: 0, y: 0, width: 1, height: 1}, {...TetraRender.perturbScene(F, view, ref.point.x, ref.point.y), ref, iterations: 512, palette: 0, rules: TetraCore.RULES.gpu}, 1);
              const actual = [...r.readFrame(frame)]; r.releaseFrame(frame);
              const o = TetraCore.perturb64(ref, 0, 0, 512, TetraCore.RULES.gpu);
              out.push({x, y, actual, expected: TetraCore.color(o.kind, o.steps, 0, o.re, o.im)});
            }
            r.destroy(); return out;
        }''')
        for pixel in pert:
            assert max(abs(a - b) for a, b in zip(pixel['actual'], pixel['expected'])) <= 1, pixel
        suite.record('Perturbation-shader reference pixels match the exact reference orbit', pert)

        page.locator('#shareBtn').click()
        page.wait_for_function('() => navigator.clipboard.readText().then(text => text === location.href)')
        shared = page.evaluate('navigator.clipboard.readText()')
        assert '#v=1&x=' in shared
        restored = suite.watch(context.new_page())
        restored.goto(shared)
        ready(restored)
        assert restored.evaluate('tetraDiagnostics.view') == page.evaluate('tetraDiagnostics.view')
        restored.close()
        suite.record('Copied URL reopens the same coordinates on a loopback origin')

        # Automatic engine: direct GPU -> GPU perturbation -> back.
        # Direct FP32 until the pixel spacing falls below 2^-16 of the coordinate scale (span 0.0147 at 960 px).
        coordinates(page, '0.5', '0.3', '0.02')
        ready(page, 'gpu')
        coordinates(page, '0.5', '0.3', '0.01')
        ready(page, 'perturb')
        coordinates(page, '0.5', '0.3', '1e-60')
        ready(page, 'perturb')
        page.locator('#homeBtn').click()
        ready(page, 'gpu')
        suite.record('Automatic engine switches direct GPU, perturbation and back by depth')

        # Real context loss falls back to CPU (direct or perturbation), restoration brings the GPU back.
        page.evaluate('''() => { window.__loss = document.querySelector('#gpuCanvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__loss.loseContext(); }''')
        ready(page, 'cpu')
        assert not state(page)['gpu']
        suite.record('Real WebGL context loss completes an FP64 Worker render')
        page.evaluate(f"location.hash='{SHALLOW_BIG}'")
        ready(page, 'cpu-perturb')
        assert state(page)['lastCompleted']['width'] == 960
        suite.record('Deep view during GPU loss uses full-resolution FP64 perturbation')
        page.evaluate('window.__loss.restoreContext()')
        ready(page, 'perturb')
        assert state(page)['gpu']
        page.locator('#homeBtn').click()
        ready(page, 'gpu')
        suite.record('Context restoration recompiles shaders and returns to the GPU')
        context.close()

        # WebGL2 unavailable at startup.
        fallback = browser.new_context(viewport={'width': 800, 'height': 600})
        fallback.add_init_script(NO_WEBGPU + ''';(() => { const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); }; })()''')
        pg = suite.watch(fallback.new_page())
        info = open_app(pg, 'v=1&x=0.5&y=0&s=0.1&n=64', 'cpu')
        assert not info['gpu'] and info['workers'] >= 1
        suite.record('WebGL2 unavailable at startup uses the Worker FP64 path')
        info = open_app(pg, SHALLOW_BIG, 'cpu-perturb')
        assert info['lastCompleted']['width'] == 800 and info['reference']['digits'] >= 54
        suite.record('Without WebGL2, deep views still render at full resolution (FP64 perturbation)')
        fallback.close()

        # Worker feature fallbacks: no OffscreenCanvas / scheduler, and a single-Worker quota.
        for name, init in [
            ('No OffscreenCanvas or scheduler', ''),
            ('Single active Worker quota', "const Old=Worker;let active=0;window.Worker=class extends Old{constructor(...a){if(active>=2)throw Error('quota');super(...a);active++;}terminate(){active--;super.terminate();}};"),
        ]:
            ctx = browser.new_context(viewport={'width': 800, 'height': 600})
            ctx.add_init_script(NO_WEBGPU + ';' + init + '''const OriginalBlob=Blob;window.Blob=class extends OriginalBlob{constructor(parts,options){super(options?.type==='text/javascript'?['self.OffscreenCanvas=undefined;self.scheduler=undefined;\\n',...parts]:parts,options)}};''')
            pg = suite.watch(ctx.new_page())
            info = open_app(pg, 'v=1&x=0.5&y=0&s=0.1&n=64&e=cpu', 'cpu')
            assert info['workerTransfer'] == 'pixels', info
            assert sum(info['lastCompleted']['counts']) == info['lastCompleted']['width'] * info['lastCompleted']['height']
            suite.record(name + ' uses transferable pixel buffers and timer yields', info['workers'])
            ctx.close()

        # Installable offline shell: the service worker caches the app and serves it without a network.
        ctx = browser.new_context(viewport={'width': 800, 'height': 600})
        ctx.add_init_script(NO_WEBGPU)
        pg = suite.watch(ctx.new_page())
        open_app(pg, 'v=1&x=-2.5&y=0&s=1.8&q=1')
        scope = pg.evaluate('navigator.serviceWorker.ready.then(r => r.scope)')
        manifest = pg.evaluate("fetch === undefined ? null : document.querySelector('link[rel=manifest]').href")
        assert scope.startswith(BASE) and manifest.endswith('manifest.webmanifest')
        pg.reload()
        ready(pg)
        assert pg.evaluate('!!navigator.serviceWorker.controller')
        ctx.set_offline(True)
        pg.reload()
        ready(pg, 'gpu')
        assert pg.evaluate("document.querySelector('#coordinatesReadout').textContent").startswith('Re')
        icon = pg.evaluate("caches.keys().then(k => caches.open(k.find(n => n.startsWith('tetra-')))).then(c => c.match('icon-512.png')).then(r => r ? r.headers.get('content-type') : null)")
        assert icon == 'image/png', icon
        ctx.set_offline(False)
        suite.record('Service worker installs the app shell and reloads it offline', {'scope': scope})
        ctx.close()

        # No Workers at all: GPU rendering and deep zoom still work (reference on the main thread).
        ctx = browser.new_context(viewport={'width': 800, 'height': 600})
        ctx.add_init_script(NO_WEBGPU + ";window.Worker=class{constructor(){throw Error('blocked')}};")
        pg = suite.watch(ctx.new_page())
        info = open_app(pg, SHALLOW_BIG, 'perturb')
        assert info['workers'] == 0 and info['lastCompleted']['width'] == 800
        suite.record('Without Workers, the GPU still renders deep views (main-thread reference)')
        ctx.close()
        suite.no_errors()
        browser.close()


run(suite, body)
