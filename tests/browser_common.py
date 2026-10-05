"""Shared helpers for the TETRA browser suites.

Every suite drives the production build on a served origin with its CSP intact.
Software graphics (SwiftShader / Linux WebKit) are not hardware GPU or physical
device qualification; timings here are bounds for that environment only.
"""
from importlib.metadata import version
from contextlib import contextmanager
from pathlib import Path
import faulthandler
import hashlib
import json
import os
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'review-output'
OUT.mkdir(exist_ok=True)
BASE = os.environ.get('TETRA_BASE_URL', 'http://127.0.0.1:4173').rstrip('/')
CHROMIUM_ARGS = ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
NO_WEBGPU = "Object.defineProperty(navigator,'gpu',{get:()=>undefined})"


def bundle_sha():
    return hashlib.sha256((ROOT / 'dist/index.html').read_bytes()).hexdigest()


class Suite:
    """Collects checks, browser errors and timing into one JSON report."""

    def __init__(self, name, limitations):
        if os.environ.get('TETRA_BROWSER') == 'webkit' and not name.endswith('webkit'):
            name += '-webkit'
        self.name = name
        self.started = time.time()
        self.checks = []
        self.errors = []
        self.report = {'suite': name, 'origin': BASE, 'bundle_sha256': bundle_sha(),
                       'playwright': version('playwright'), 'limitations': limitations}

    def record(self, name, detail=None):
        self.checks.append({'name': name, 'passed': True, 'detail': detail, 'seconds': round(time.time() - self.started, 2)})
        print('PASS', name, json.dumps(detail, default=str)[:300] if detail is not None else '', flush=True)
        # A stalled browser can prevent exception handling or teardown from
        # completing. Preserve completed checks without claiming suite success.
        self.write(False, 'Suite has not completed')

    def watch(self, page):
        page.on('pageerror', lambda error: self.errors.append(f'{self.name}: {error}'))
        return page

    def no_errors(self):
        assert not self.errors, self.errors
        self.record('No uncaught browser exceptions')

    def write(self, passed, failure=None):
        self.report.update({'passed': passed, 'checks': self.checks, 'count': len(self.checks),
                            'uncaught_errors': self.errors, 'seconds': round(time.time() - self.started, 1)})
        if failure:
            self.report['failure'] = failure
        else:
            self.report.pop('failure', None)
        (OUT / f'browser-{self.name}.json').write_text(json.dumps(self.report, indent=2, ensure_ascii=False, default=str) + '\n')


def launch(playwright, extra=()):
    if os.environ.get('TETRA_BROWSER') == 'webkit':
        return playwright.webkit.launch(headless=True)
    hardware = ['--enable-gpu'] if os.environ.get('TETRA_HARDWARE_BROWSER') == '1' else []
    trace = ['--enable-logging=stderr'] if os.environ.get('TETRA_TRACE_GPU') == '1' else []
    return playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'), channel='chromium' if hardware else None,
                                      headless=True, args=CHROMIUM_ARGS + hardware + trace + list(extra))


@contextmanager
def browser_deadline(timeout):
    # Playwright's timeout cancellation can itself wait on a stuck renderer.
    # Keep the requested deadline and allow five seconds to report a failure.
    faulthandler.dump_traceback_later(timeout / 1000 + 5, exit=True)
    try:
        yield
    finally:
        faulthandler.cancel_dump_traceback_later()


def ready(page, mode=None, timeout=240000):
    selector = 'body[data-complete="true"]' + (f'[data-mode="{mode}"]' if mode else '')
    try:
        with browser_deadline(timeout):
            page.wait_for_selector(selector, state='attached', timeout=timeout)
    except Exception as error:
        print('RENDER_TIMEOUT', selector, str(error), flush=True)
        # evaluate() has no timeout. A blocked renderer must not strand the
        # failure diagnostic itself until the CI job is forcibly cancelled.
        faulthandler.dump_traceback_later(5, exit=True)
        try:
            diagnostic = state(page)
            print('RENDER_TIMEOUT_STATE', json.dumps(diagnostic), flush=True)
            # A failed/abandoned GL context can block even a driver-info query.
            # Preserve the responsive app state before touching that driver.
            if diagnostic.get('gpu'):
                print('RENDER_TIMEOUT_GRAPHICS', json.dumps(graphics(page)), flush=True)
        except Exception:
            pass  # Preserve the original timeout if the page itself is gone.
        finally:
            faulthandler.cancel_dump_traceback_later()
        raise


def settle(page, timeout=240000):
    """Wait for a render that started after the last interaction to complete."""
    with browser_deadline(timeout):
        page.wait_for_function('() => !window.tetraDiagnostics.animating', timeout=timeout)
    page.wait_for_timeout(30)
    ready(page, timeout=timeout)


def state(page):
    return page.evaluate('window.tetraDiagnostics')


def graphics(page):
    """Record the actual driver; an OS label does not establish hardware use."""
    return page.evaluate('''()=>{const gl=document.querySelector('#gpuCanvas').getContext('webgl2');
      if(!gl)return null;const e=gl.getExtension('WEBGL_debug_renderer_info');
      return {renderer:gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER),
        vendor:gl.getParameter(e?e.UNMASKED_VENDOR_WEBGL:gl.VENDOR),version:gl.getParameter(gl.VERSION),
        processors:navigator.hardwareConcurrency,memory:navigator.deviceMemory||null};}''')


def open_app(page, fragment='', mode=None, fresh=True):
    """Load the app; fresh=False keeps the document and exercises hash navigation."""
    if fresh and page.url.startswith(BASE):
        page.goto('about:blank')
    page.goto(BASE + ('/#' + fragment if fragment else '/'))
    ready(page, mode)
    return state(page)


def controls(page):
    if not page.locator('#sidebar').is_visible():
        page.locator('#settingsBtn').click()


def close_controls(page):
    if page.locator('#sidebar').is_visible():
        page.locator('#closeSettings').click()


def coordinates(page, x, y, span):
    controls(page)
    page.locator('details.coordinates').evaluate('(el) => el.open = true')
    for name, value in [('xInput', x), ('yInput', y), ('spanInput', span)]:
        page.locator('#' + name).fill(value)
    page.locator('#coordinateForm button').click()


def run(suite, body):
    """Run a suite body, always writing its report."""
    try:
        body()
        suite.write(True)
        print('ALL', len(suite.checks), 'PASSED', flush=True)
    except Exception as error:
        suite.write(False, str(error))
        raise
