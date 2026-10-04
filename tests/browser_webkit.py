"""Linux Playwright WebKit checks (run in CI). This is not a physical Safari/iPhone test.
WebKit here renders through its own WebGL2 (or the Worker path when unavailable)."""
from browser_common import *
from playwright.sync_api import sync_playwright

suite = Suite('webkit', ['Linux WebKit with mobile viewport emulation; not physical Safari/iPhone.', 'Software rendering only.'])
DEEP = 'v=1&x=0.500000000000000000000000000001&y=0&s=1e-30&n=256&q=1'
HORIZON = ('v=1&x=-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206'
           '&y=0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475&s=7e-100&n=1024&q=1')


def body():
    with sync_playwright() as p:
        browser = p.webkit.launch()
        suite.report['browser_version'] = browser.version
        context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        context.add_init_script("Object.defineProperty(navigator,'clipboard',{get:()=>undefined});Object.defineProperty(navigator,'share',{value:undefined});")
        page = suite.watch(context.new_page())
        info = open_app(page, 'v=1&x=0.5&y=0&s=0.1&n=64&e=cpu', 'cpu')
        assert sum(info['lastCompleted']['counts']) == info['lastCompleted']['width'] * info['lastCompleted']['height']
        suite.record('WebKit completes the production-CSP Worker render', info['workerTransfer'])
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        suite.record('Mobile viewport has no horizontal overflow')

        info = open_app(page, 'v=1&x=-2.5&y=0&s=1.8&q=1')
        suite.report['webkit_gpu'] = info['gpu']
        assert info['mode'] in ('gpu', 'cpu')
        suite.record('Automatic engine renders the default view', {'mode': info['mode'], 'gpu': info['gpu'], 'size': [info['lastCompleted']['width'], info['lastCompleted']['height']]})

        info = open_app(page, DEEP)
        assert info['mode'] in ('perturb', 'cpu-perturb') and info['lastCompleted']['width'] >= 390
        suite.record('Deep view renders at full resolution with perturbation', {'mode': info['mode'], 'width': info['lastCompleted']['width']})

        # 10^100 uses bilinear approximation on the GPU path (and in Workers on the CPU path).
        info = open_app(page, HORIZON)
        assert info['mode'] in ('perturb', 'cpu-perturb') and info['lastCompleted']['width'] >= 390
        if info['mode'] == 'perturb':
            assert info['bla'] and info['bla']['levels'] > 0 and info['bla']['compiled'], info['bla']
        suite.record('10^100 renders at full resolution with BLA', {'mode': info['mode'], 'bla': info['bla'], 'seconds': round(info['lastCompleted']['elapsed'] / 1000, 1)})

        page.locator('#viewport').focus()
        before = state(page)['view']
        page.keyboard.press('+')
        settle(page)
        page.keyboard.press('Alt+ArrowLeft')
        settle(page)
        assert state(page)['view'] == before
        suite.record('Keyboard zoom and history restore the exact view')

        page.locator('#settingsBtn').click()
        assert page.evaluate('document.activeElement.id') == 'closeSettings'
        page.locator('#viewport').evaluate('(el)=>el.focus()')
        assert page.evaluate('!!document.activeElement.closest("#sidebar")')
        suite.record('Native modal prevents background focus')
        page.locator('details.coordinates').evaluate('(el)=>el.open=true')
        page.locator('#xInput').fill('0.500000000000000000000000000002')
        page.set_viewport_size({'width': 390, 'height': 520})
        page.wait_for_timeout(150)
        assert page.locator('#xInput').input_value() == '0.500000000000000000000000000002'
        page.locator('#coordinateForm button').click()
        settle(page)
        exact = state(page)['view']
        assert exact['x'] == '0.500000000000000000000000000002'
        suite.record('A coordinate draft survives resize and stays exact at depth')

        page.set_viewport_size({'width': 390, 'height': 844})
        settle(page)
        page.locator('#settingsBtn').click()
        page.locator('#bookmarkName').fill('WebKit view')
        page.locator('#bookmarkForm button').click()
        assert state(page)['savedCount'] == 1
        page.reload()
        ready(page)
        assert state(page)['savedCount'] == 1 and state(page)['view'] == exact
        suite.record('Saved coordinates and URL state survive reload')
        page.locator('#shareBtn').click()
        assert page.locator('#shareDialog').is_visible() and page.locator('#shareText').input_value() == page.url
        page.keyboard.press('Escape')
        suite.record('Manual link sharing exposes the exact current URL')
        page.locator('#focusBtn').click()
        settle(page)
        assert state(page)['focus']
        page.locator('#exitFocusBtn').click()
        settle(page)
        assert not state(page)['focus'] and state(page)['view'] == exact
        suite.record('Focus mode preserves deep coordinates')
        with page.expect_download() as event:
            page.locator('#exportBtn').click()
        event.value.save_as(str(OUT / 'webkit-export.png'))
        assert (OUT / 'webkit-export.png').read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
        suite.record('WebKit exports a PNG')
        page.screenshot(path=str(OUT / 'webkit-mobile.png'))
        suite.no_errors()
        browser.close()


run(suite, body)
