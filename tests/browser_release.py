"""Served-origin release checks. Production CSP remains enabled.

Requires an actual WebGL2 browser context, including a software-backed context.
This is not a hardware-GPU or physical Safari qualification.
"""
from pathlib import Path
from importlib.metadata import version
import hashlib
import json
import os
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'review-output'
OUT.mkdir(exist_ok=True)
BASE = os.environ.get('TETRA_BASE_URL', 'http://127.0.0.1:4173').rstrip('/')
checks = []
errors = []
report = {
    'origin': BASE,
    'transport': urlparse(BASE).scheme,
    'playwright': version('playwright'),
    'bundle_sha256': hashlib.sha256((ROOT / 'dist/index.html').read_bytes()).hexdigest(),
    'limitations': ['No physical iPhone/Safari test.', 'Software graphics is not hardware GPU qualification.'],
}


def record(name, detail=None):
    checks.append({'name': name, 'passed': True, 'detail': detail})
    print('PASS', name, detail or '', flush=True)


def ready(page, mode=None):
    selector = 'body[data-complete="true"]'
    if mode:
        selector += '[data-mode="' + mode + '"]'
    page.wait_for_selector(selector, state='attached', timeout=90000)


def controls(page):
    if not page.locator('#sidebar').is_visible():
        page.locator('#settingsBtn').click()

def coordinates(page, x, y, span):
    controls(page)
    page.locator('details.coordinates').evaluate('(el) => el.open = true')
    for name, value in [('xInput', x), ('yInput', y), ('spanInput', span)]:
        page.locator('#' + name).fill(value)
    page.locator('#coordinateForm button').click()


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH'), headless=True,
            args=['--no-sandbox', '--enable-unsafe-swiftshader'])
        report['browser_version'] = browser.version
        context = browser.new_context(viewport={'width': 1100, 'height': 800},
                                      permissions=['clipboard-read', 'clipboard-write'])
        context.add_init_script("Object.defineProperty(navigator,'gpu',{get:()=>undefined})")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        response = page.goto(BASE)
        assert response.status == 200
        expected = json.loads((ROOT / 'vercel.json').read_text())['headers'][0]['headers']
        headers = response.all_headers()
        for header in expected:
            assert headers.get(header['key'].lower()) == header['value'], header['key']
        assert hashlib.sha256(response.body()).hexdigest() == report['bundle_sha256']
        record('HTTP security headers and served bytes match the production build')
        ready(page, 'gpu')
        report['graphics'] = page.evaluate('''() => {
            const gl = document.querySelector('#gpuCanvas').getContext('webgl2');
            const info = gl.getExtension('WEBGL_debug_renderer_info');
            return {renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
                    version: gl.getParameter(gl.VERSION),
                    precision: gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision};
        }''')
        record('Application enters actual browser WebGL2', report['graphics'])

        pixels = page.evaluate('''() => {
            const renderer = new TetraGPU(document.createElement('canvas'));
            const gl = renderer.gl;
            const cases = [['fixed', .5, 0], ['period2', .01, 0], ['threshold', 2, 0],
                           ['origin', 0, 0], ['complex', .5, .25]];
            const results = cases.map(([name, x, y]) => {
                renderer.render({x: String(x), y: String(y), span: '1'}, 1, 1, 512, 0);
                const actual = new Uint8Array(4);
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
                const orbit = TetraCore.orbit64(x, y, 512);
                return {name, actual: [...actual], expected: TetraCore.color(orbit.kind, orbit.steps, 0)};
            });
            gl.deleteProgram(renderer.program);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            return results;
        }''')
        for pixel in pixels:
            assert pixel['actual'][3] == 255
            assert max(abs(a-b) for a, b in zip(pixel['actual'], pixel['expected'])) <= 1, pixel
            record('Browser WebGL2 pixel vs FP64: ' + pixel['name'], pixel)

        page.locator('#shareBtn').click()
        page.wait_for_function('() => navigator.clipboard.readText().then(text => text === location.href)')
        shared = page.evaluate('navigator.clipboard.readText()')
        assert '#v=1&x=' in shared
        record('Clipboard contains the exact shared URL on a secure loopback origin')
        restored = context.new_page()
        restored.goto(shared)
        ready(restored)
        assert restored.evaluate('tetraDiagnostics.view') == page.evaluate('tetraDiagnostics.view')
        restored.close()
        record('Copied URL reopens the same coordinates')

        controls(page)
        page.locator('#iterations').select_option('64')
        coordinates(page, '0.5', '0', '0.001')
        ready(page, 'cpu')
        record('Auto engine switches WebGL2 to FP64 at finer pixel spacing')
        coordinates(page, '0.5', '0', '1e-30')
        ready(page, 'big')
        record('Auto engine switches FP64 to BigInt at deep spacing')
        page.locator('#homeBtn').click()
        ready(page, 'gpu')
        record('Returning home restores the WebGL2 path')

        page.evaluate('''() => {
            const gl = document.querySelector('#gpuCanvas').getContext('webgl2');
            window.__tetraLossTest = gl.getExtension('WEBGL_lose_context');
            if (!window.__tetraLossTest) throw new Error('WEBGL_lose_context unavailable');
            window.__tetraLossTest.loseContext();
        }''')
        ready(page, 'cpu')
        record('Real WebGL context loss completes an FP64 fallback render')
        page.evaluate('window.__tetraLossTest.restoreContext()')
        page.locator('#viewport').focus()
        before = page.evaluate('tetraDiagnostics.view.x')
        page.keyboard.press('ArrowRight')
        ready(page, 'cpu')
        assert page.evaluate('tetraDiagnostics.view.x') != before
        record('Navigation works after loss and context restoration using CPU')
        context.close()

        fallback = browser.new_context(viewport={'width': 960, 'height': 720})
        fallback.add_init_script('''(() => {
            Object.defineProperty(navigator,'gpu',{get:()=>undefined});
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                return type === 'webgl2' ? null : original.call(this, type, ...args);
            };
        })()''')
        page = fallback.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '#v=1&x=0.5&y=0&s=0.1&n=64')
        ready(page, 'cpu')
        record('WebGL2 unavailable at startup uses the real Worker FP64 path')
        fallback.close()
        assert not errors, errors
        record('No uncaught browser exceptions')
        browser.close()
    report['passed'] = True
except Exception as error:
    report['passed'] = False
    report['failure'] = str(error)
    raise
finally:
    report['checks'] = checks
    report['count'] = len(checks)
    report['uncaught_errors'] = errors
    (OUT / 'browser-release.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
