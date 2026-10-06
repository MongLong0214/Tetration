"""Native sample reuse, pixel equality, and precise region inspection on the production app."""
from decimal import Decimal
from browser_common import *
from playwright.sync_api import sync_playwright

suite = Suite('reuse', ['Chromium graphics on the local runner; no physical mobile qualification.'])
VIEWS = json.loads((ROOT / 'tools/perf/views.json').read_text())
HOOK = '''(() => {const timer=setInterval(()=>{if(!window.TetraGPU)return;clearInterval(timer);
 const prepare=TetraGPU.prototype.prepare;TetraGPU.prototype.prepare=function(f,s,n,...r){
 if(!s.accum){window.__nativeRenderer=this;window.__nativeScene=s;}return prepare.call(this,f,s,n,...r);};
 const copy=TetraGPU.prototype.copyShifted;TetraGPU.prototype.copyShifted=function(f,...a){copy.call(this,f,...a);
 const d=this.readFrame(f);let n=0;for(let i=0;i<d.length;i+=4)if(d[i]===6&&d[i+1]===6&&d[i+2]===6)n++;window.__blankPending=n;};},1);})()'''
GRAB = '''() => {const c=document.querySelector('#gpuCanvas'),t=document.createElement('canvas');t.width=c.width;t.height=c.height;
 const g=t.getContext('2d');g.drawImage(c,0,0);return {w:c.width,h:c.height,data:Array.from(g.getImageData(0,0,c.width,c.height).data)};}'''


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        page = suite.watch(browser.new_page(viewport={'width': 480, 'height': 320}, device_scale_factor=1))
        page.add_init_script(HOOK)
        for name, mx, my in [('plume', 12, 5), ('abyss', -12, 5), ('horizon', 12, -5), ('horizon', -12, -5)]:
            v = VIEWS[name]
            first = open_app(page, f"v=1&x={v['x']}&y={v['y']}&s={v['span']}&q=16", 'perturb')
            suite.report['graphics'] = graphics(page)
            before = page.evaluate(GRAB)
            box = page.locator('#viewport').bounding_box()
            x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + mx, y + my)
            page.wait_for_timeout(100)
            during = state(page)
            assert during['retainedDetail'] and during['retainedDetail']['width'] == before['w'], during
            assert not page.locator('#detailCanvas').is_hidden()
            page.mouse.up(); settle(page)
            final, after = state(page), page.evaluate(GRAB)
            last = final['lastCompleted']
            assert (after['w'], after['h']) == (before['w'], before['h'])
            reused = (before['w'] - 12) * (before['h'] - 5)
            assert last['reusedPixels'] == reused and last['samples'] == 16, last
            assert last['computedPixels'] == before['w'] * before['h'] - reused
            # Pending strips show the picture already on screen, never blank (clear-colour) tiles.
            assert page.evaluate('window.__blankPending') == 0, (name, page.evaluate('window.__blankPending'))
            # Compare the entire overlapping image, including all four shift signs.
            left, right = max(0, mx), min(after['w'], after['w'] + mx)
            top, bottom = max(0, my), min(after['h'], after['h'] + my)
            length = (right - left) * 4
            for yy in range(top, bottom):
                a, b = (yy * after['w'] + left) * 4, ((yy - my) * before['w'] + left - mx) * 4
                assert after['data'][a:a+length] == before['data'][b:b+length], (name, mx, my, yy)
            # The four-sample mean rounds once to RGBA8 before its 12 additional
            # samples. Every new pixel must match a fresh 16x draw within one byte.
            diff = page.evaluate('''async([mx,my])=>{const r=__nativeRenderer,s=__nativeScene,W=r.canvas.width,H=r.canvas.height;
             const f=r.beginFrame(W,H);for(const tile of TetraRender.tiles(W,H,16)){r.draw(f,tile,s,16,0);await r.fence();}
             const expected=r.readFrame(f),c=document.querySelector('#gpuCanvas'),t=document.createElement('canvas');t.width=W;t.height=H;
             const g=t.getContext('2d');g.drawImage(c,0,0);const actual=g.getImageData(0,0,W,H).data;let worst=0;
             const left=Math.max(0,mx),right=Math.min(W,W+mx),top=Math.max(0,my),bottom=Math.min(H,H+my);
             for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(x<left||x>=right||y<top||y>=bottom)for(let k=0;k<3;k++)worst=Math.max(worst,Math.abs(actual[(y*W+x)*4+k]-expected[((H-1-y)*W+x)*4+k]));
             r.releaseFrame(f);return worst;}''', [mx, my])
            assert diff <= 1, (name, diff)
            suite.record('Native pan preserves every overlapping Ultra sample and computes only new strips: ' + name,
                         {'shift': [mx, my], 'before_ms': first['lastCompleted']['elapsed'], 'pan_ms': last['elapsed'], 'reused_pixels': reused,
                          'computed_pixels': last['computedPixels'], 'exposed_pixel_error': diff})
            hits = final['completedCache']['hits']
            page.locator('#backBtn').click(); settle(page)
            restored = state(page)
            assert restored['view'] == first['view'] and restored['completedCache']['hits'] > hits
            assert page.evaluate(GRAB)['data'] == before['data']
            suite.record('Back returns the exact cached native image without orbit work: ' + name, restored['lastCompleted']['elapsed'])

        previous = state(page)
        page.keyboard.down('Shift'); page.mouse.move(x + 16, y + 12); page.mouse.down()
        page.mouse.move(x + 64, y + 36)
        assert page.locator('#detailBox').is_visible()
        page.mouse.up(); page.keyboard.up('Shift'); settle(page)
        detail = state(page)
        assert Decimal(detail['view']['span']) < Decimal(previous['view']['span']) / 8
        assert Decimal(detail['view']['x']) != Decimal(previous['view']['x'])
        assert detail['lastCompleted']['width'] == before['w'] and detail['lastCompleted']['samples'] == 16
        assert detail['iterations'] >= previous['iterations'] and detail['lastCompleted']['computedPixels'] > 0
        suite.record('Shift-drag at 10^100 computes a smaller region at full native resolution', detail['lastCompleted'])
        page.screenshot(path=str(OUT / 'detail-horizon.png'))
        unchanged = detail['view']
        page.locator('#detailBtn').click(); page.keyboard.press('Escape')
        assert state(page)['view'] == unchanged and page.locator('#detailBtn').get_attribute('aria-pressed') == 'false'
        assert page.locator('#detailBox').is_hidden()
        suite.record('Cancelling region selection preserves the exact camera')

        # Explore as soon as native 4x detail is ready, without waiting for Ultra.
        page.set_viewport_size({'width': 1280, 'height': 800})
        try:
            page.wait_for_function('''() => {const d=tetraDiagnostics;return !d.complete && d.renderStage==='ultra' && d.displayWidth===1280 && d.displaySmooth && !d.displaySoft;}''')
        except Exception:
            suite.report['failure_state'] = state(page)
            page.screenshot(path=str(OUT / f'{suite.name}-failure.png'))
            raise
        box = page.locator('#viewport').bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 12, y + 5)
        partial = state(page)
        assert partial['retainedDetail'] and partial['retainedDetail']['width'] == 1280, partial
        assert page.locator('#detailCanvas').is_visible()
        page.mouse.up(); settle(page)
        suite.record('Moving during Ultra refinement preserves the already computed native 4x image', partial['retainedDetail']['width'])
        suite.no_errors(); browser.close()


run(suite, body)
