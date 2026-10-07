"""Interrupted navigation and late GPU delivery on the production app.

The fence latch delays delivery after a real GPU draw. It reproduces slow-device
ordering without changing the shader, camera, image cache, or rendered pixels.
"""
from browser_common import *
from playwright.sync_api import sync_playwright

suite = Suite('interactions', ['GPU completion delivery is deliberately delayed in the two race checks. Touch hardware is not qualified here.'])
PLUME = 'v=1&x=-2.2930579295624999999999991&y=0.33208044555625&s=5e-11&q=16'
# Bloom is off the Overview, so Home moves the camera, and heavy enough that live frames stay below native size (the detail image is retained during a drag).
BLOOM = 'v=1&x=-2.2930579&y=0.3320804&s=0.00025&q=16'
GRAB = '''() => {const c=document.querySelector('#gpuCanvas'),t=document.createElement('canvas');t.width=c.width;t.height=c.height;
 const g=t.getContext('2d');g.drawImage(c,0,0);return Array.from(g.getImageData(0,0,c.width,c.height).data);}'''
LATCH = '''() => {const fence=TetraGPU.prototype.fence;
 const hold=p=>{if(window.__holdLive){__holdLive=false;return p.then(()=>new Promise(resolve=>{
 window.__releaseLive=()=>{resolve();window.__deliveredLive=true;};}));}return p;};
 TetraGPU.prototype.fence=function(){return hold(fence.call(this));};
 // WebGPU live frames end in the accelerator's draw instead of a WebGL fence.
 if(window.TetraCompute){const draw=TetraCompute.prototype.draw;TetraCompute.prototype.draw=function(...a){return hold(draw.apply(this,a));};}
 window.__holdLive=true;}'''


def center(page):
    box = page.locator('#viewport').bounding_box()
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2


def selection(page):
    x, y = center(page)
    page.keyboard.down('Shift'); page.mouse.move(x-40, y-40); page.mouse.down(); page.mouse.move(x+40, y+40)
    assert page.locator('#detailBox').is_visible()
    return x, y


def release_selection(page):
    page.mouse.up(); page.keyboard.up('Shift'); settle(page)
    assert page.locator('#detailBox').is_hidden()
    assert page.locator('#detailBtn').get_attribute('aria-pressed') == 'false'


def hold_live(page):
    page.evaluate(LATCH)
    x, y = center(page)
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x+12, y+5)
    page.wait_for_function('() => typeof window.__releaseLive === "function"')
    page.mouse.up()


def deliver_live(page):
    page.evaluate('__releaseLive()')
    page.wait_for_function('() => window.__deliveredLive')
    # Let the async renderer continuation and its next animation frame run.
    page.wait_for_timeout(120)


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        page = suite.watch(browser.new_page(viewport={'width': 480, 'height': 320}))

        open_app(page)
        page.locator('#zoomOut').click(); settle(page)
        assert state(page)['retainedDetail'] is None and page.locator('#detailCanvas').is_hidden()
        suite.record('Zooming out ends with only the newly computed final image')

        open_app(page); selection(page); page.keyboard.press('Home')
        release_selection(page)
        assert state(page)['view'] == {'x': '-0.5', 'y': '0', 'span': '8'}, state(page)['view']
        suite.record('Home supersedes a region drag; releasing it cannot restore the old camera')

        first = open_app(page)['view']; x, y = selection(page)
        page.mouse.wheel(0, -120)
        expected = state(page)['view']
        release_selection(page)
        assert state(page)['view'] == expected and expected != first
        suite.record('Wheel zoom supersedes a region drag without applying its obsolete box')

        first = open_app(page)['view']; x, y = center(page)
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x+12, y+5); page.mouse.wheel(0, -120)
        zoomed = state(page)['view']; page.mouse.move(x+42, y+20)
        continued = state(page)['view']
        assert continued['span'] == zoomed['span'] and continued['x'] != zoomed['x'] and continued['y'] != zoomed['y']
        page.mouse.up(); settle(page)
        page.locator('#backBtn').click(); settle(page)
        assert state(page)['view'] == first
        suite.record('Wheel zoom rebases a held drag and keeps its pan/zoom in one Back entry')

        first = open_app(page)['view']
        wheel_history = '''(interrupt) => {const v=document.querySelector('#viewport'),r=v.getBoundingClientRect();
         const wheel=()=>v.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,clientX:r.x+r.width/2,
          clientY:r.y+r.height/2,bubbles:true,cancelable:true}));
         wheel();if(interrupt)document.querySelector('#homeBtn').click();const expected=tetraDiagnostics.view;
         wheel();wheel();document.querySelector('#backBtn').click();return expected;}'''
        # Dispatch in one task to keep the sequence within the 500ms wheel window,
        # independently of GPU speed. These use the real input/navigation handlers.
        page.evaluate(wheel_history, False); settle(page)
        assert state(page)['view'] == first and page.locator('#backBtn').is_disabled()
        open_app(page)
        expected = page.evaluate(wheel_history, True); settle(page)
        assert expected == {'x': '-0.5', 'y': '0', 'span': '8'} and state(page)['view'] == expected
        suite.record('Wheel bursts share one Back entry; intervening navigation starts a new entry')

        first = open_app(page)['view']; selection(page)
        page.set_viewport_size({'width': 640, 'height': 380})
        release_selection(page)
        assert state(page)['view'] == first, (first, state(page)['view'])
        suite.record('Resize cancels a region drag without remapping its old screen coordinates')

        open_app(page); selection(page)
        page.evaluate("location.hash='v=1&x=0.5&y=0&s=0.1&n=64&q=4'")
        page.wait_for_function("() => tetraDiagnostics.view.x==='0.5'")
        release_selection(page)
        assert state(page)['view'] == {'x': '0.5', 'y': '0', 'span': '0.1'}
        suite.record('An external view link supersedes an active region drag')

        open_app(page)
        # The grid control synchronously writes the old camera to the URL before
        # the new link's queued hashchange arrives, as a completion/debounce can.
        page.evaluate('''()=>{location.hash='v=1&x=0.5&y=0&s=0.05&n=1024&q=4';
         const g=document.querySelector('#grid');g.checked=true;g.dispatchEvent(new Event('change'));}''')
        page.wait_for_function('() => tetraDiagnostics.iterationSetting===1024'); settle(page)
        assert state(page)['view'] == {'x':'0.5','y':'0','span':'0.05'} and state(page)['quality']==4
        suite.record('URL synchronization cannot swallow the camera or settings of a queued external link')

        page.set_viewport_size({'width': 480, 'height': 320})
        open_app(page, PLUME, 'perturb')
        page.locator('#viewport').focus(); page.keyboard.press('ArrowRight'); settle(page)
        target = state(page); image = page.evaluate(GRAB)
        hold_live(page)
        page.keyboard.press('Alt+ArrowLeft'); settle(page)
        restored = state(page)
        assert restored['view'] == target['view'] and restored['completedCache']['hits'] > target['completedCache']['hits']
        assert page.evaluate(GRAB) == image
        deliver_live(page)
        assert state(page)['complete'] and state(page)['displayView'] == restored['displayView']
        assert page.evaluate(GRAB) == image
        suite.record('A late live GPU frame cannot overwrite a byte-exact cached Back restoration')

        open_app(page, 'v=1&x=0.5&y=0&s=0.05&n=64&q=4', 'gpu')
        hold_live(page)
        controls(page); page.locator('#engine').select_option('cpu'); close_controls(page)
        ready(page, 'cpu')
        completed = state(page)['lastCompleted']
        deliver_live(page)
        assert state(page)['complete'] and state(page)['mode'] == 'cpu'
        assert state(page)['displayCanvas'] == 'cpuCanvas' and page.locator('#gpuCanvas').is_hidden()
        assert state(page)['lastCompleted'] == completed
        suite.record('A late GPU frame cannot hide the completed CPU render after switching precision')

        open_app(page, BLOOM)
        x, y = center(page)
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x+12, y+5)
        page.wait_for_function('() => tetraDiagnostics.retainedDetail && tetraDiagnostics.interactiveFrames>0')
        # Two exports start in the same task, from the same image/camera. Only the
        # second bitmap delivery waits, while Home and a resize change the app.
        with page.expect_download() as first_export:
            page.evaluate('''()=>{const make=window.createImageBitmap;let n=0;window.createImageBitmap=function(...args){
             const at=++n;return make(...args).then(bitmap=>at===2?new Promise(resolve=>{window.__resumeExport=()=>resolve(bitmap);}):bitmap);};
             const e=document.querySelector('#exportBtn');e.click();e.click();}''')
        page.wait_for_function('() => typeof window.__resumeExport === "function"')
        page.mouse.up(); page.locator('#viewport').focus(); page.keyboard.press('Home')
        page.set_viewport_size({'width': 640, 'height': 380}); settle(page)
        with page.expect_download() as second_export:
            page.evaluate('__resumeExport()')
        paths = [OUT / 'interrupted-export-0.png', OUT / 'interrupted-export-1.png']
        for download, path in zip([first_export.value, second_export.value], paths): download.save_as(str(path))
        assert paths[0].read_bytes() == paths[1].read_bytes(), 'Navigation changed an already captured image'
        suite.record('Navigation and resize cannot change the camera or detail layer of an in-flight PNG export')

        open_app(page, BLOOM)
        page.evaluate('''()=>{const post=Worker.prototype.postMessage;let held=false;Worker.prototype.postMessage=function(msg,...rest){
         if(msg.type==='discover'&&!held){held=true;msg.seed=123456789;const worker=this;
          const spy=e=>{if(e.data.type==='discover'){window.__discoveredPlace=e.data.place;worker.removeEventListener('message',spy);}};
          worker.addEventListener('message',spy);window.__deliverDiscovery=()=>post.call(worker,msg,...rest);return;}
         return post.call(this,msg,...rest);};}''')
        page.locator('#discoverBtn').click()
        page.wait_for_function('() => typeof window.__deliverDiscovery==="function"')
        page.locator('#viewport').focus(); page.keyboard.press('Home'); settle(page)
        home = state(page)['view']
        page.evaluate('__deliverDiscovery()')
        page.wait_for_function('() => !document.querySelector("#discoverBtn").hasAttribute("aria-busy")')
        assert page.evaluate('!!window.__discoveredPlace'), 'The actual Worker must return a place for this race check'
        settle(page)
        assert state(page)['view'] == home
        suite.record('A queued Discover result cannot override navigation performed after the request')

        open_app(page)
        page.locator('#viewport').focus()
        page.mouse.move(*center(page)); page.mouse.wheel(120, 0)
        assert page.locator('#toast').is_hidden()
        suite.record('Horizontal-only wheel input does not report a false zoom limit')
        suite.no_errors(); browser.close()


run(suite, body)
