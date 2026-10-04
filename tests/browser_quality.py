"""Image quality and interaction: adaptive antialiasing against supersampled references,
live frames while moving, smooth zoom, inertia, reduced motion and colour flow.
Software WebGL2; one sampled camera per measurement, not a universal bound."""
from decimal import Decimal
from browser_common import *
from playwright.sync_api import sync_playwright

PIXELS = (ROOT / 'tests/browser_pixels.js').read_text()
suite = Suite('quality', ['Software WebGL2; antialiasing error measured on sampled cameras.', 'Motion is driven by Playwright input events.'])


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        page = suite.watch(browser.new_page(viewport={'width': 1000, 'height': 680}, permissions=['clipboard-read', 'clipboard-write']))
        page.add_init_script(NO_WEBGPU)
        info = open_app(page)
        last = info['lastCompleted']
        assert info['quality'] == 16 and last['samples'] == 16 and last['width'] == 1000, last
        assert last['height'] == round(page.locator('#viewport').bounding_box()['height'])
        suite.record('Default Ultra quality reaches display resolution with 16-sample edges', last)
        page.screenshot(path=str(OUT / 'quality-ultra.png'))

        page.evaluate(PIXELS)
        for name, args in [('direct overview', ['-0.2', '0', '7', 160, 384, 'direct', 8]),
                           ('direct filaments', ['-1.84', '0.09', '0.46', 160, 384, 'direct', 8]),
                           ('perturbation plume', ['-2.2930579295624999999999991', '0.33208044555625', '5e-11', 120, 768, 'perturb', 8])]:
            r = page.evaluate('(a) => __tetraPixels.antialias(...a)', args)
            assert r['rmse4'] < r['rmse1'] * 0.85 and r['rmse16'] < r['rmse4'] * 0.95, (name, r)
            suite.record('Adaptive 4x and 16x antialiasing reduce error against a 64-sample reference: ' + name, r)

        worst = page.evaluate('() => __tetraPixels.seams("-2.5","0","1.8",192,128,384,"direct",4)')
        assert worst == 0, worst
        suite.record('Direct tiles with adaptive samples equal one full-frame draw', worst)

        # Live frames while dragging: only reduced-resolution single-sample frames, no final stages.
        open_app(page, 'v=1&x=-0.72&y=0.36&s=0.7&q=4')
        page.evaluate('''() => {window.__draws={1:0,4:0,16:0};const prepare=TetraGPU.prototype.prepare;
          TetraGPU.prototype.prepare=function(frame,scene,samples,...rest){__draws[samples]=(__draws[samples]||0)+1;return prepare.call(this,frame,scene,samples,...rest);};}''')
        frames0 = state(page)['interactiveFrames']
        box = page.locator('#viewport').bounding_box()
        cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        for i in range(40):
            page.mouse.move(cx + i * 4, cy + i * 2)
            page.wait_for_timeout(28)
        during = state(page)
        draws = page.evaluate('__draws')
        assert during['interactiveFrames'] - frames0 >= 12, during['interactiveFrames'] - frames0
        assert draws['4'] == 0 and draws['16'] == 0 and not during['complete'], draws
        assert page.evaluate("getComputedStyle(document.querySelector('#gpuCanvas')).transform") in ('none', 'matrix(1, 0, 0, 1, 0, 0)') or during['interactiveFrames'] > frames0
        page.mouse.up()
        settle(page)
        assert state(page)['lastCompleted']['samples'] == 4
        suite.record('Dragging shows live single-sample frames, then refines on release', {'frames': during['interactiveFrames'] - frames0, 'draws': draws})

        # Smooth wheel zoom: the displayed camera glides to the exact target.
        before = Decimal(state(page)['view']['span'])
        page.mouse.move(cx, cy)
        for _ in range(4):
            page.mouse.wheel(0, -150)
            page.wait_for_timeout(16)
        mid = state(page)
        assert mid['animating'] and Decimal(mid['visual']['span']) > Decimal(mid['view']['span'])
        target = mid['view']
        settle(page)
        final = state(page)
        assert final['visual'] == final['view'] == target and Decimal(target['span']) < before
        suite.record('Wheel zoom eases the visible camera onto the exact target', {'target_span': target['span'][:20]})

        # Inertia after a flick.
        page.mouse.move(cx, cy)
        page.mouse.down()
        for i in range(6):
            page.mouse.move(cx - i * 30, cy)
            page.wait_for_timeout(12)
        released = state(page)['view']
        page.mouse.up()
        page.wait_for_timeout(60)
        assert state(page)['animating']
        settle(page)
        assert Decimal(state(page)['view']['x']) > Decimal(released['x'])
        suite.record('A flick keeps gliding with decaying inertia, then renders')

        # Colour flow changes presentation only.
        controls(page)
        page.locator('#flow').check()
        close_controls(page)
        page.evaluate('__draws={1:0,4:0,16:0}')
        before = page.evaluate('({view:tetraDiagnostics.view,phase:tetraDiagnostics.colorPhase})')
        page.wait_for_timeout(500)
        after = page.evaluate('({view:tetraDiagnostics.view,phase:tetraDiagnostics.colorPhase,draws:__draws})')
        assert after['view'] == before['view'] and after['phase'] > before['phase'] and sum(after['draws'].values()) == 0
        suite.record('Colour flow changes only presentation, without recomputing')
        page.locator('#shareBtn').click()
        link = page.evaluate('navigator.clipboard.readText()')
        assert '&c=' in link and '&q=4' in link
        other = suite.watch(browser.new_page(viewport={'width': 640, 'height': 480}))
        other.add_init_script(NO_WEBGPU)
        other.goto(link)
        ready(other)
        assert other.evaluate('tetraDiagnostics.view') == after['view'] and not other.evaluate('tetraDiagnostics.flow') and other.evaluate('tetraDiagnostics.quality') == 4
        other.close()
        suite.record('A shared view keeps quality and hue and opens without motion')
        page.emulate_media(reduced_motion='reduce')
        page.wait_for_function('() => !tetraDiagnostics.flow')
        suite.record('Reduced-motion preference stops colour flow')

        # Reduced motion: no glide, no inertia.
        page.mouse.move(cx, cy)
        page.mouse.wheel(0, -150)
        snap = state(page)
        assert not snap['animating'] and snap['visual'] == snap['view']
        settle(page)
        page.mouse.move(cx, cy)
        page.mouse.down()
        for i in range(6):
            page.mouse.move(cx + i * 30, cy)
            page.wait_for_timeout(12)
        page.mouse.up()
        page.wait_for_timeout(40)
        assert not state(page)['animating']
        settle(page)
        suite.record('Reduced motion jumps directly and disables inertia')
        page.emulate_media(reduced_motion='no-preference')

        # CPU path keeps the reprojected camera while new Worker tiles are pending.
        open_app(page, 'v=1&x=-0.72&y=0.36&s=0.7&e=cpu&q=1', 'cpu')
        page.evaluate('''()=>{const c=document.querySelector('#cpuCanvas');window.__cpuBefore=c.getContext('2d').getImageData(0,0,c.width,c.height);window.__workerPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m){if(m&&m.type)return __workerPost.call(this,m);};}''')
        page.mouse.move(cx - 100, cy - 50)
        page.mouse.down()
        page.mouse.move(cx, cy - 10)
        page.mouse.up()
        page.wait_for_function('() => !tetraDiagnostics.complete && tetraDiagnostics.renderStage === "detail"')
        page.wait_for_timeout(150)
        error = page.evaluate('''()=>{const c=document.querySelector('#cpuCanvas'),now=c.getContext('2d').getImageData(0,0,c.width,c.height);let e=0;
          for(let y=60;y<c.height-20;y+=7)for(let x=120;x<c.width-20;x+=7)for(let k=0;k<3;k++)e=Math.max(e,Math.abs(now.data[(y*c.width+x)*4+k]-__cpuBefore.data[((y-40)*c.width+x-100)*4+k]));return e;}''')
        assert error <= 1, error
        page.evaluate('() => {Worker.prototype.postMessage=__workerPost;}')
        suite.record('CPU keeps the reprojected image while replacement Workers are pending', error)

        # Palette change re-renders with distinct colours.
        open_app(page, 'v=1&x=-2.5&y=0&s=1.8&q=1')
        a = page.screenshot(clip={'x': cx - 40, 'y': cy - 40, 'width': 80, 'height': 80})
        controls(page)
        page.locator('[data-palette="2"]').click()
        close_controls(page)
        settle(page)
        b = page.screenshot(clip={'x': cx - 40, 'y': cy - 40, 'width': 80, 'height': 80})
        assert a != b and state(page)['lastCompleted']['palette'] == 2
        suite.record('Palette changes recolour the rendered view')
        suite.no_errors()
        browser.close()


run(suite, body)
