"""Core product flows on the production build. The production CSP stays enabled;
the harness never adds unsafe-eval or unsafe-inline."""
from decimal import Decimal, getcontext
from browser_common import *
from playwright.sync_api import sync_playwright

getcontext().prec = 300
suite = Suite('review', ['Touch input is emulated through CDP; no physical iPhone/Safari.', 'Software WebGL2.'])


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        page = suite.watch(browser.new_page(viewport={'width': 1200, 'height': 800}, accept_downloads=True))
        initial = open_app(page, 'v=1&x=-2.5&y=0&s=1.8&q=4')
        last = initial['lastCompleted']
        assert initial['mode'] == 'gpu' and last['width'] == 1200 and last['samples'] == 4, last
        suite.record('Initial production-CSP render at full display resolution', last)
        page.screenshot(path=str(OUT / 'review-desktop.png'))

        page.evaluate('window.__violations=[];document.addEventListener("securitypolicyviolation",e=>window.__violations.push(e.effectiveDirective));let s=document.createElement("script");s.textContent="window.__injected=true";document.body.appendChild(s)')
        page.wait_for_timeout(80)
        assert not page.evaluate('!!window.__injected') and 'script-src-elem' in page.evaluate('window.__violations')
        suite.record('CSP blocks unapproved inline JavaScript')
        page.evaluate('window.__violations=[];fetch("https://example.invalid/tetra-test").catch(()=>{})')
        page.wait_for_timeout(80)
        assert 'connect-src' in page.evaluate('window.__violations')
        suite.record('CSP blocks outbound fetch')

        box = page.locator('#viewport').bounding_box()
        px, py = round(box['width'] * .65), round(box['height'] * .45)

        def world(v):
            return (Decimal(v['x']) + (Decimal(px) - Decimal(str(box['width'])) / 2) * Decimal(v['span']) / Decimal(str(box['width'])),
                    Decimal(v['y']) - (Decimal(py) - Decimal(str(box['height'])) / 2) * Decimal(v['span']) / Decimal(str(box['width'])))

        before = state(page)['view']
        page.mouse.move(box['x'] + px, box['y'] + py)
        page.mouse.wheel(0, -180)
        after = state(page)['view']
        assert Decimal(after['span']) < Decimal(before['span'])
        assert all(abs(a - b) < Decimal('1e-8') for a, b in zip(world(before), world(after)))
        settle(page)
        assert state(page)['visual'] == state(page)['view']
        suite.record('Wheel zoom keeps the point under the cursor fixed and glides to rest')

        before = state(page)['view']
        page.mouse.move(box['x'] + px, box['y'] + py)
        page.mouse.down()
        for step in range(1, 10):
            page.mouse.move(box['x'] + px + step * 5, box['y'] + py + step * 2)
        page.mouse.up()
        after = state(page)['view']
        assert Decimal(after['x']) < Decimal(before['x']) and Decimal(after['y']) > Decimal(before['y']) and after['span'] == before['span']
        settle(page)
        suite.record('Drag pans without changing scale')

        page.locator('#homeBtn').click()
        page.locator('#viewport').focus()
        page.keyboard.press('+')
        assert state(page)['view']['span'] == '3.5'
        page.keyboard.press('-')
        assert state(page)['view']['span'] == '7'
        page.keyboard.press('Home')
        assert state(page)['view'] == {'x': '-0.2', 'y': '0', 'span': '7'}
        settle(page)
        suite.record('Keyboard zoom is exact and Home resets')

        controls(page)
        page.locator('.preset').nth(3).click()
        controls(page)
        page.locator('#iterations').select_option('256')
        page.locator('[data-palette="1"]').click()
        close_controls(page)
        settle(page)
        info = state(page)
        assert info['view']['span'] == '0.7' and info['iterations'] == 256 and info['palette'] == 1 and info['lastCompleted']['palette'] == 1
        suite.record('Preset, iteration limit and palette complete a render')

        page.keyboard.press('g')
        assert page.locator('#grid').is_checked()
        page.keyboard.press('g')
        suite.record('Coordinate grid toggles')

        page.locator('#helpBtn').click()
        assert page.locator('#helpDialog').is_visible() and page.locator('#helpDialog').get_attribute('aria-labelledby')
        page.keyboard.press('Escape')
        assert not page.locator('#helpDialog').is_visible()
        suite.record('Named guide dialog closes with Escape')

        page.locator('#shareBtn').click()
        page.wait_for_timeout(100)
        if page.locator('#shareDialog').is_visible():
            assert 's=0.7' in page.locator('#shareText').input_value()
            page.locator('#shareDialog .close-dialog').first.click()
            suite.record('Share fallback contains the complete view URL')
        else:
            suite.record('Clipboard share returned without an uncaught error')

        with page.expect_download() as event:
            page.locator('#exportBtn').click()
        event.value.save_as(str(OUT / 'review-export.png'))
        data = (OUT / 'review-export.png').read_bytes()
        assert data.startswith(b'\x89PNG\r\n\x1a\n')
        width = int.from_bytes(data[16:20], 'big')
        assert width == state(page)['displayWidth'], (width, state(page)['displayWidth'])
        # Decode it: the fractal must be there (many colours above the caption bar), not a blank canvas.
        from PIL import Image
        image = Image.open(OUT / 'review-export.png').convert('RGB')
        assert image.size == (state(page)['displayWidth'], state(page)['displayHeight']), image.size
        colours = len(set(image.crop((0, 0, image.width, int(image.height * 0.8))).resize((200, 120)).getdata()))
        assert colours > 200, colours
        suite.record('PNG export has the rendered resolution and the fractal pixels', {'width': width, 'colours': colours})

        before = state(page)['view']
        coordinates(page, '<script>', '0', '1')
        assert state(page)['view'] == before and 'Invalid' in page.locator('#toast').inner_text() or state(page)['view'] == before
        close_controls(page)
        suite.record('Invalid coordinates do not replace the view')

        coordinates(page, '0.500000000000000000000000000001', '0.0000000000000000000000000000001', '1e-30')
        ready(page, 'perturb')
        info = state(page)
        assert info['lastCompleted']['width'] == 1200 and info['reference']['digits'] >= 54, info
        suite.record('Deep coordinates render with perturbation at full resolution', {'mode': info['mode'], 'reference': info['reference']})

        before = state(page)['view']
        page.locator('#viewport').focus()
        page.keyboard.press('ArrowRight')
        after = state(page)['view']
        assert Decimal(before['x']) < Decimal(after['x']) and float(before['x']) == float(after['x'])
        settle(page)
        suite.record('Deep pan keeps a sub-FP64 coordinate change')

        page.locator('#homeBtn').click()
        controls(page)
        page.locator('#engine').select_option('exact')
        page.wait_for_timeout(30)
        page.locator('#engine').select_option('cpu')
        close_controls(page)
        settle(page)
        info = state(page)
        assert info['mode'] == 'cpu' and info['view']['span'] == '7' and info['engine'] == 'cpu'
        suite.record('Cancelled exact work cannot replace the CPU result')
        controls(page)
        page.locator('#engine').select_option('auto')
        close_controls(page)
        settle(page)

        coordinates(page, '0.5', '0', '1e-200')
        ready(page, 'perturb')
        info = state(page)
        assert info['referenceDigits'] >= 224 and info['lastCompleted']['width'] == 1200 and info['iterations'] == 256 and info['iterationSetting'] == 256
        suite.record('Minimum span renders at full resolution with a 240-digit reference', info['reference'])

        before = state(page)['view']
        page.mouse.move(box['x'] + px, box['y'] + py)
        page.mouse.wheel(0, -180)
        page.wait_for_timeout(60)
        assert state(page)['view'] == before
        suite.record('Minimum zoom boundary does not drift off-anchor')
        coordinates(page, '0.5', '0', '1e12')
        settle(page)
        before = state(page)['view']
        page.mouse.wheel(0, 180)
        page.wait_for_timeout(60)
        assert state(page)['view'] == before
        suite.record('Maximum zoom boundary does not drift off-anchor')

        page.close()
        page = suite.watch(browser.new_page(viewport={'width': 800, 'height': 700}))
        x = '2.000000000000000000000000000001'
        info = open_app(page, 'v=1&x=' + x + '&y=0&s=1e-30&n=256&p=1&g=1', 'perturb')
        assert info['view']['x'] == x and info['iterations'] == 256 and page.locator('#grid').is_checked()
        suite.record('Exact shared URL rehydrates and renders')
        previous = state(page)['view']
        page.evaluate('location.hash="v=99&x=0&y=0&s=1"')
        page.wait_for_timeout(100)
        assert state(page)['view'] == previous
        suite.record('Unsupported link schema does not replace the view')
        info = open_app(page, 'v=1&x=0.5&y=0&s=0.1&n=64&e=big&q=1', 'exact')
        assert info['engine'] == 'exact' and info['iterations'] == 64
        suite.record('Links from earlier releases (e=big) keep working')
        page.close()

        context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        phone = suite.watch(context.new_page())
        info = open_app(phone, 'v=1&x=-2.5&y=0&s=1.8&q=1')
        assert phone.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert info['lastCompleted']['width'] == 780, info['lastCompleted']
        phone.screenshot(path=str(OUT / 'review-mobile.png'))
        suite.record('Mobile layout: no horizontal overflow, 2x density rendering', info['lastCompleted'])
        assert not phone.locator('#sidebar').is_visible()
        phone.locator('#iterations').evaluate('(el)=>el.focus()')
        assert phone.evaluate('document.activeElement.id') != 'iterations'
        suite.record('Closed mobile drawer cannot receive focus')
        phone.locator('#settingsBtn').click()
        phone.locator('#sidebar').evaluate('(el)=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})))')
        assert phone.locator('#sidebar').bounding_box()['x'] >= -0.5 and phone.evaluate('document.activeElement.id') == 'closeSettings'
        phone.locator('#viewport').evaluate('(el)=>el.focus()')
        assert phone.evaluate('document.activeElement.id') == 'closeSettings'
        suite.record('Open mobile drawer moves focus and inerts the background')
        phone.keyboard.press('Shift+Tab')
        assert phone.evaluate('!!document.activeElement.closest("#sidebar")')
        phone.keyboard.press('Escape')
        assert phone.evaluate('document.activeElement.id') == 'settingsBtn' and not phone.locator('#sidebar').is_visible()
        suite.record('Escape closes the drawer and restores focus')
        phone.locator('#settingsBtn').click()
        phone.locator('#mobileHelpBtn').click()
        assert phone.locator('#helpDialog').is_visible()
        phone.keyboard.press('Escape')
        suite.record('Mobile guide is reachable')

        session = context.new_cdp_session(phone)

        def touch(kind, points):
            session.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'id': i, 'x': x, 'y': y, 'radiusX': 3, 'radiusY': 3} for i, x, y in points]})

        before = state(phone)['view']
        touch('touchStart', [(1, 130, 400), (2, 250, 400)])
        for step in range(1, 6):
            touch('touchMove', [(1, 130 - step * 8, 400), (2, 250 + step * 8, 400)])
        touch('touchEnd', [])
        phone.wait_for_timeout(80)
        assert Decimal(state(phone)['view']['span']) < Decimal(before['span'])
        suite.record('Real touch dispatch: pinch zoom')
        settle(phone)
        before = state(phone)['view']
        touch('touchStart', [(1, 180, 410)])
        touch('touchMove', [(1, 200, 420)])
        touch('touchMove', [(1, 215, 435)])
        touch('touchEnd', [])
        phone.wait_for_timeout(80)
        assert Decimal(state(phone)['view']['x']) < Decimal(before['x'])
        suite.record('Real touch dispatch: single-finger pan')
        settle(phone)
        context.close()
        suite.no_errors()
        browser.close()


run(suite, body)
