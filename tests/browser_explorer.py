"""Explorer product checks: saved views, history, focus, shortcuts, discovery, sharing,
blocked-feature fallbacks, viewport sizes and automated accessibility. Production CSP stays enabled."""
import re
from browser_common import *
from playwright.sync_api import sync_playwright

AXE = Path(os.environ.get('AXE_CORE_PATH', str(ROOT / 'node_modules/axe-core/axe.min.js'))).read_text()
suite = Suite('explorer', ['Mobile input is emulated. No physical iPhone or hardware GPU qualification.'])
accessibility = []


def axe(page, name):
    page.evaluate(AXE)
    result = page.evaluate('''async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
      return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),passes:r.passes.length,incomplete:r.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))};}''')
    accessibility.append({'view': name, **result})
    assert not result['violations'], result['violations']
    suite.record('Automated WCAG checks: ' + name, {'passed_rules': result['passes'], 'incomplete': [i['id'] for i in result['incomplete']]})


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        context = browser.new_context(viewport={'width': 1440, 'height': 960}, permissions=['clipboard-read', 'clipboard-write'])
        page = suite.watch(context.new_page())
        open_app(page, 'v=1&x=-2.5&y=0&s=1.8&q=1')
        assert page.locator('html').get_attribute('lang') == 'en' and not re.search('[가-힣]', page.locator('body').inner_text())
        view = page.locator('#viewport').bounding_box()
        assert view['width'] == 1440 and view['height'] >= 860
        suite.record('English, edge-to-edge map uses the available workspace', view)
        axe(page, 'desktop map')
        controls(page)
        assert page.locator('.preset').count() == 7
        axe(page, 'desktop controls')
        page.screenshot(path=str(OUT / 'explorer-controls.png'))
        close_controls(page)

        before = state(page)['view']
        page.locator('#viewport').focus()
        page.keyboard.press('+')
        zoomed = state(page)['view']
        page.keyboard.press('Alt+ArrowLeft')
        assert state(page)['view'] == before
        page.keyboard.press('Alt+ArrowRight')
        assert state(page)['view'] == zoomed
        page.keyboard.press('Alt+ArrowLeft')
        page.keyboard.press('ArrowRight')
        assert page.locator('#forwardBtn').is_disabled()
        settle(page)
        suite.record('Back, forward and a new navigation branch preserve history')

        before = state(page)['view']
        page.keyboard.press('f')
        settle(page)
        assert state(page)['focus'] and page.locator('#viewport').bounding_box()['height'] == 960 and state(page)['view'] == before
        assert state(page)['lastCompleted']['height'] == 960
        page.keyboard.press('Escape')
        settle(page)
        assert not state(page)['focus'] and state(page)['view'] == before
        suite.record('Focus mode fills the screen at full resolution and preserves exact coordinates')

        for key, span in [('2', '1.8'), ('5', '0.00000000005'), ('7', '0.' + '0' * 99 + '7')]:
            page.keyboard.press(key)
            page.wait_for_function(f"() => tetraDiagnostics.view.span === '{span}'")
        assert page.locator('#locationTag').inner_text() == '07 / Horizon'
        page.keyboard.press('1')
        settle(page)
        assert state(page)['view']['span'] == '7'
        suite.record('Starting-point shortcuts 1-7 include the deep perturbation places')

        before = state(page)['view']
        page.keyboard.press('d')
        page.wait_for_function(f"() => tetraDiagnostics.view.span !== '{before['span']}' || tetraDiagnostics.view.x !== '{before['x']}'", timeout=30000)
        found = state(page)['view']
        assert page.locator('#locationTag').inner_text() == 'Custom view' and float(found['span']) < 2.5
        settle(page)
        page.locator('#discoverBtn').click()
        page.wait_for_function(f"() => tetraDiagnostics.view.x !== '{found['x']}'", timeout=30000)
        settle(page)
        page.keyboard.press('Alt+ArrowLeft')
        assert state(page)['view'] == found
        settle(page)
        suite.record('Discover (D and button) jumps to new detailed places and joins history', found)

        coordinates(page, '0.500000000000000000000000000001', '0', '1e-30')
        ready(page, 'perturb')
        saved = state(page)['view']
        page.keyboard.press('b')
        name = '<img src=x onerror=alert(1)>'
        page.locator('#bookmarkName').fill(name)
        page.locator('#bookmarkForm button').click()
        assert state(page)['savedCount'] == 1 and page.locator('.saved-open span').inner_text() == name and page.locator('#savedViews img').count() == 0
        page.reload()
        ready(page)
        assert state(page)['savedCount'] == 1
        page.locator('#homeBtn').click()
        settle(page)
        controls(page)
        page.locator('.saved-open').click()
        ready(page, 'perturb')
        assert state(page)['view'] == saved
        suite.record('Named views survive reload and restore sub-FP64 coordinates safely')

        page.locator('#shareBtn').click()
        page.wait_for_function('() => navigator.clipboard.readText().then(v=>v===location.href)')
        shared = page.evaluate('navigator.clipboard.readText()')
        other = suite.watch(context.new_page())
        other.goto(shared)
        ready(other)
        assert state(other)['view'] == saved
        other.close()
        suite.record('One-action clipboard sharing reopens the exact coordinates')

        controls(page)
        page.locator('.saved-delete').click()
        assert state(page)['savedCount'] == 0
        close_controls(page)
        page.reload()
        ready(page)
        assert state(page)['savedCount'] == 0
        suite.record('Removing a saved view persists')
        page.locator('#helpBtn').click()
        axe(page, 'guide')
        page.keyboard.press('Escape')
        context.close()

        for width, height in [(390, 844), (320, 568), (844, 390), (1280, 720)]:
            context = browser.new_context(viewport={'width': width, 'height': height}, has_touch=width < 761, is_mobile=width < 761)
            pg = suite.watch(context.new_page())
            open_app(pg, 'v=1&x=-2.5&y=0&s=1.8&q=1')
            assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
            for selector in ['#settingsBtn', '#discoverBtn', '#shareBtn', '#focusBtn', '#zoomIn', '#zoomOut', '#homeBtn', '#exportBtn']:
                box = pg.locator(selector).bounding_box()
                assert box and box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= width + .5 and box['y'] + box['height'] <= height + .5, (width, selector, box)
                assert box['width'] >= 44 and box['height'] >= 44, (selector, box)
            pg.screenshot(path=str(OUT / f'explorer-{width}x{height}.png'))
            if width == 390:
                axe(pg, 'mobile map')
                controls(pg)
                axe(pg, 'mobile controls')
                pg.locator('details.coordinates').evaluate('(el)=>el.open=true')
                pg.locator('#xInput').fill('0.12345678901234567890123456789')
                pg.set_viewport_size({'width': 390, 'height': 520})
                pg.wait_for_timeout(150)
                assert pg.locator('#xInput').input_value() == '0.12345678901234567890123456789'
                pg.locator('#yInput').fill('0')
                pg.locator('#spanInput').fill('1')
                pg.locator('#coordinateForm button').click()
                settle(pg)
                assert state(pg)['view']['x'] == '0.12345678901234567890123456789'
                suite.record('Coordinate draft survives keyboard-like resizing and submits')
            suite.record(f'Controls reachable at {width}x{height} with 44px targets')
            context.close()

        context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        context.add_init_script('''Object.defineProperty(navigator,'share',{value:async data=>{window.__shared=data}});Object.defineProperty(navigator,'canShare',{value:data=>!!(data&&data.files)});''')
        pg = suite.watch(context.new_page())
        open_app(pg, 'v=1&x=-2.5&y=0&s=1.8&q=1')
        pg.locator('#shareBtn').click()
        assert pg.evaluate('__shared.url===location.href')
        pg.locator('#exportBtn').click()
        pg.wait_for_function('() => window.__shared && window.__shared.files')
        shared = pg.evaluate('({name: __shared.files[0].name, type: __shared.files[0].type, size: __shared.files[0].size, text: __shared.text})')
        assert shared['type'] == 'image/png' and shared['size'] > 10000 and shared['text'].startswith('http')
        suite.record('Touch devices share the link and the rendered PNG through native share (API stub)', shared)
        context.close()

        context = browser.new_context(viewport={'width': 1000, 'height': 700})
        context.add_init_script('''Object.defineProperty(navigator,'clipboard',{get:()=>undefined});Storage.prototype.setItem=function(){throw new DOMException('blocked','SecurityError')};''')
        pg = suite.watch(context.new_page())
        open_app(pg, 'v=1&x=-2.5&y=0&s=1.8&q=1')
        pg.locator('#shareBtn').click()
        assert pg.locator('#shareDialog').is_visible() and pg.locator('#shareText').input_value() == pg.url
        axe(pg, 'manual sharing')
        pg.keyboard.press('Escape')
        controls(pg)
        pg.locator('#bookmarkName').fill('Test')
        pg.locator('#bookmarkForm button').click()
        assert state(pg)['savedCount'] == 0 and 'Storage unavailable' in pg.locator('#toast').inner_text()
        close_controls(pg)
        pg.locator('#zoomIn').click()
        settle(pg)
        suite.record('Blocked clipboard and storage expose usable fallbacks')
        context.close()
        suite.report['accessibility'] = accessibility
        suite.no_errors()
        browser.close()


run(suite, body)
