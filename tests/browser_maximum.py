"""High-cap deep views must finish and remain actionable, with real AA pixels."""
from browser_common import *
from playwright.sync_api import sync_playwright

suite = Suite('maximum', ['Desktop Chromium/WebKit, not physical Safari or mobile qualification.',
                         'Float outputs compare finite FP32 states. No infinite-orbit proof is claimed.'])
CASES = [
    ('Plume', '-2.2930579295624999999999991', '0.33208044555625', '5e-11', 16384),
    ('Abyss', '-0.605137938972379900971816986088586258864125',
     '0.437740442074800562969426507709712806289976004723289995229', '7e-25', 16384),
    ('Horizon', '-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206',
     '0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475', '7e-100', 16384),
    ('Minimum span Auto', '-2.2930579295428124999999991', '0.3320804455471875', '1e-200', 'auto'),
]


def check_requested(page, n):
    d = state(page); last = d['lastCompleted']
    assert d['complete'] and d['quality'] == last['samples'] == 16, d
    assert d['iterationSetting'] == n and last['iterations'] == (8192 if n == 'auto' else n), d
    assert (last['width'], last['height']) == (640, 354), d
    assert d['displayCanvas'] == ('gpuCanvas' if d['mode'] == 'perturb' else 'cpuCanvas'), d
    assert page.locator('#viewport').get_attribute('aria-busy') == 'false'
    return d


def navigate_after(page):
    controls(page)
    page.locator('#iterations').select_option('auto'); close_controls(page); settle(page)
    page.locator('#homeBtn').click(); settle(page)
    page.locator('#backBtn').click(); settle(page)
    assert state(page)['complete']


def body():
    with sync_playwright() as p:
        for name, x, y, span, n in CASES:
            # Each cold process owns the full original resolution/cap/AA case.
            browser = launch(p); suite.report['browser_version'] = browser.version
            context = browser.new_context(viewport={'width': 640, 'height': 430})
            page = suite.watch(context.new_page())
            open_app(page, f'v=1&x={x}&y={y}&s={span}&n={n}&q=16')
            d = check_requested(page, n)
            if name in ['Abyss', 'Horizon']:
                page.locator('#viewport').focus(); page.keyboard.press('ArrowRight'); settle(page)
                pan = check_requested(page, n)
                assert pan['lastCompleted']['reusedPixels'] > 0, pan
                suite.record(f'{name} high-cap pan preserves overlap and finishes new strips at native AA16', pan['lastCompleted'])
            navigate_after(page)
            suite.record(f'{name} cold native AA16 completes and Settings/Home/Back remain actionable',
                         {k: d[k] for k in ['backend', 'gpuFailure', 'lastCompleted']})
            context.close(); browser.close()

        browser = launch(p); context = browser.new_context(viewport={'width': 640, 'height': 430})
        context.add_init_script('''const get=WebGL2RenderingContext.prototype.getExtension;
          WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_color_buffer_float'?null:get.call(this,name);};''')
        suite.report['limitations'].append('One context injects absence of the optional float-color extension; CPU pixels and navigation are real.')
        page = suite.watch(context.new_page())
        x, y = '-2.2930579295428124999999991', '0.3320804455471875'
        open_app(page, f'v=1&x={x}&y={y}&s=1e-50&n=16384&q=16')
        d = check_requested(page, 16384); assert d['mode'] == 'cpu-perturb', d
        navigate_after(page)
        suite.record('Missing float-color extension computes the full deep request on FP64 Workers and remains navigable')
        context.close(); browser.close()

        browser = launch(p); context = browser.new_context(viewport={'width': 320, 'height': 240})
        # Isolate kernel probes from the application's idle-time warm-up; the
        # probe's own WebGL context still uses the real browser and GPU.
        context.add_init_script('''const get=HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl2'&&this.id==='gpuCanvas')return null;return get.call(this,type,...args);};''')
        page = suite.watch(context.new_page()); open_app(page, 'v=1&x=.5&y=0&s=.1&n=64&q=1&e=cpu')
        page.evaluate((ROOT / 'tests/browser_gpu_limits.js').read_text())
        with browser_deadline(240000):
            partial = page.evaluate('__gpuPartialComparison()')
        assert partial['error'] == 0 and len(partial['cases']) == 48, partial
        assert all(c['changed'] == c['priorChanged'] == c['cancelChanges'] == 0 and c['cancelled'] for c in partial['cases']), partial
        suite.record('Bounded four-sample FP32 sums match every original AA16 RGBA byte and preserve prior frames',
                     {'cases': 48, 'pixels': 48 * 48 * 30, 'forced_pan_strips': True, 'cancelled_frames_unchanged': True})
        with browser_deadline(240000):
            phase = page.evaluate('__gpuPhaseComparison()')
        assert phase['error'] == 0 and len(phase['rows']) == 24, phase
        assert all(r['changed'] == 0 for r in phase['rows']), phase
        suite.record('GPU cycle skipping preserves every FP32 bit of phase, class and finite step across BLA modes and cap remainders',
                     {'cases': 24, 'points': 24 * 16 * 16})
        suite.no_errors(); context.close(); browser.close()


run(suite, body)
