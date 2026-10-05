"""Production flow transitions and real renderer/Worker recovery.

Fence hooks defer only delivery after actual GPU work, to expose export stages.
Worker/OOM hooks inject named failures; they do not substitute successful pixels.
"""
from PIL import Image
from browser_common import *
from playwright.sync_api import sync_playwright

WEBKIT = os.environ.get('TETRA_BROWSER') == 'webkit'
suite = Suite('production-webkit' if WEBKIT else 'production',
              ['Playwright desktop browser; not physical Safari/iPhone/Android qualification.',
               'Named Worker/allocation failures, GPU completion delivery and one visibility transition are injected.'])
SHALLOW = 'v=1&x=-1.84&y=0.09&s=0.46&n=128&q=16'
CLOSE = 'v=1&x=-2.2930579&y=0.3320804&s=0.00025&n=512&q=16'
GRAB = '''() => {const c=document.querySelector('#gpuCanvas'),t=document.createElement('canvas');t.width=c.width;t.height=c.height;
 const g=t.getContext('2d');g.drawImage(c,0,0);return {w:c.width,h:c.height,data:Array.from(g.getImageData(0,0,c.width,c.height).data)};}'''


def consistent(page):
    d = state(page)
    assert d['complete'] and d['view'] == d['lastCompleted']['view'], d
    assert d['lastCompleted']['iterations'] == d['iterations'] and d['lastCompleted']['palette'] == d['palette']
    assert d['retainedDetail'] is None and page.locator('#viewport').get_attribute('aria-busy') == 'false'
    assert d['displayCanvas'] == ('gpuCanvas' if d['mode'] in ('gpu', 'perturb') else 'cpuCanvas')
    cache = d['completedCache']
    assert cache['entries'] <= 3 and 0 <= cache['bytes'] <= cache['budget']
    assert d['gpuPooled'] <= 3 and d['workers'] <= d['poolLimit']
    return d


def body():
    with sync_playwright() as p:
        browser = p.webkit.launch() if WEBKIT else launch(p)
        suite.report['browser_version'] = browser.version
        context = browser.new_context(viewport={'width': 480, 'height': 320}, accept_downloads=True)
        page = suite.watch(context.new_page())
        open_app(page, SHALLOW)
        suite.report['graphics'] = graphics(page)
        page.locator('#viewport').focus(); page.keyboard.press('ArrowRight'); settle(page)
        later = state(page)['view']
        page.keyboard.press('Alt+ArrowLeft'); settle(page)
        earlier = state(page)['view']
        assert page.locator('#forwardBtn').is_enabled()
        for fragment in ['v=99&x=0&y=0&s=1', 'v=1&x=invalid&y=0&s=1', 'v=1&x=0&y=0&s=0', 'unrelated', 'x=' + '0'*2500]:
            page.evaluate('(h)=>location.hash=h', fragment)
            page.wait_for_function('(h)=>location.hash==="#"+h', arg=fragment)
            page.wait_for_timeout(80)
            assert state(page)['view'] == earlier and page.locator('#forwardBtn').is_enabled(), fragment
        page.locator('#forwardBtn').click(); settle(page)
        assert state(page)['view'] == later
        suite.record('Rejected and unrelated links preserve camera and Forward; Forward still restores the accepted view')

        open_app(page, SHALLOW)
        page.evaluate('''()=>{location.hash='v=1&x=0.5&y=0&s=0.05&n=64&q=4';
         location.hash='v=1&x=0.25&y=0.1&s=0.025&n=256&q=16&p=2';}''')
        page.wait_for_function('()=>tetraDiagnostics.view.x==="0.25"'); settle(page)
        assert state(page)['iterations'] == 256 and state(page)['palette'] == 2
        page.go_back(); page.wait_for_function('()=>tetraDiagnostics.view.x==="0.5"'); settle(page)
        assert state(page)['iterations'] == 64 and state(page)['quality'] == 4
        page.go_forward(); page.wait_for_function('()=>tetraDiagnostics.view.x==="0.25"'); settle(page)
        assert state(page)['palette'] == 2 and state(page)['quality'] == 16
        suite.record('Rapid external links and native browser Back/Forward restore their own coordinates and settings')

        open_app(page, CLOSE)
        page.evaluate('''()=>{const show=TetraGPU.prototype.presentFrame,fence=TetraGPU.prototype.fence;
         TetraGPU.prototype.presentFrame=function(f,soft){const r=show.call(this,f,soft);if(soft&&!window.__softLatched)window.__holdSoft=true;return r;};
         TetraGPU.prototype.fence=function(){const p=fence.call(this);
          if(window.__holdInitial){__holdInitial=false;return p.then(()=>new Promise(r=>{window.__resumeInitial=r;}));}
          if(window.__holdSoft){__holdSoft=false;window.__softLatched=true;return p.then(()=>new Promise(r=>{window.__resumeSoft=r;}));}return p;};
         window.__holdInitial=true;}''')
        page.set_viewport_size({'width': 1280, 'height': 800})
        page.wait_for_function('()=>typeof window.__resumeInitial==="function" && tetraDiagnostics.renderStage==="detail"')
        page.evaluate('__resumeInitial()')
        page.wait_for_function('()=>tetraDiagnostics.displaySoft && typeof window.__resumeSoft==="function"')
        before = page.evaluate(GRAB)
        with page.expect_download() as event: page.locator('#exportBtn').click()
        path = OUT / ('production-soft-webkit.png' if WEBKIT else 'production-soft.png')
        event.value.save_as(str(path))
        assert page.evaluate(GRAB) == before, 'PNG export changed the visible sampling'
        png = Image.open(path).convert('RGBA')
        assert png.size == (before['w'], before['h'])
        expected = Image.frombytes('RGBA', png.size, bytes(before['data']))
        assert png.crop((0, 0, png.width, png.height-43)).tobytes() == expected.crop((0, 0, png.width, png.height-43)).tobytes()
        page.evaluate('__resumeSoft()'); settle(page); consistent(page)
        suite.record('Export during a real soft refinement preserves every visible map byte and exports the same smoothing')

        page.set_viewport_size({'width': 640, 'height': 430})
        open_app(page, SHALLOW.replace('&q=16', '&q=1'))
        # Fast live draw dimensions include overscan. Freeze the first delivered
        # frame after it has accumulated, keeping the real gesture held.
        page.evaluate('''()=>{const show=TetraGPU.prototype.presentFrame,fence=TetraGPU.prototype.fence;
         TetraGPU.prototype.presentFrame=function(...a){const r=show.apply(this,a);if(window.__freezeShown)window.__holdFrame=true;return r;};
         TetraGPU.prototype.fence=function(){const p=fence.call(this);if(window.__holdFrame){__holdFrame=false;__freezeShown=false;
          return p.then(()=>new Promise(r=>{window.__resumeFrame=r;}));}return p;};window.__freezeShown=true;}''')
        box = page.locator('#viewport').bounding_box(); x, y = box['x']+box['width']/2, box['y']+box['height']/2
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x+23, y+9)
        page.wait_for_function('()=>tetraDiagnostics.interactiveFrames>0 && typeof window.__resumeFrame==="function"')
        assert state(page)['retainedDetail'] is None
        # Capture the expected compositor and start export in the same task.
        # A slow renderer can still be easing the camera between protocol calls.
        with page.expect_download() as event:
            expected = page.evaluate('''()=>{const c=document.querySelector('#gpuCanvas'),out=document.createElement('canvas'),r=document.querySelector('#viewport').getBoundingClientRect();
             out.width=c.width;out.height=c.height;const g=out.getContext('2d'),m=new DOMMatrix(c.style.transform);
             g.fillStyle='#060606';g.fillRect(0,0,out.width,out.height);g.translate(out.width/2+m.e/r.width*out.width,out.height/2+m.f/r.height*out.height);
             g.scale(m.a,m.d);g.translate(-out.width/2,-out.height/2);g.drawImage(c,0,0);
             const expected={w:out.width,h:out.height,data:Array.from(g.getImageData(0,0,out.width,out.height).data),sy:m.d};
             document.querySelector('#exportBtn').click();return expected;}''')
        assert abs(expected['sy']-1) > 1e-5, 'Witness must exercise vertical overscan'
        path = OUT / ('production-live-webkit.png' if WEBKIT else 'production-live.png'); event.value.save_as(str(path))
        png = Image.open(path).convert('RGBA')
        upper = (0, 0, png.width, png.height-43)
        expected_image = Image.frombytes('RGBA',(expected['w'],expected['h']),bytes(expected['data']))
        # CSS matrices use float components; Canvas composition can round a
        # channel once differently. Geometry errors must exceed neither one byte
        # nor this same bound on any pixel above the caption.
        actual_bytes,expected_bytes=png.crop(upper).tobytes(),expected_image.crop(upper).tobytes()
        assert len(actual_bytes)==len(expected_bytes)
        worst=max(abs(a-b) for a,b in zip(actual_bytes,expected_bytes))
        assert worst <= 1, ('Export ignored displayed vertical sampling',worst)
        page.mouse.up(); page.evaluate('__resumeFrame()'); settle(page); consistent(page)
        suite.record('A held live frame exports the same world aspect as its compositor transform', {'maximum_channel_error':worst})

        open_app(page, SHALLOW)
        # Actual native context loss while a retained-detail drag is active.
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x+13, y+7)
        page.wait_for_function('()=>!!tetraDiagnostics.retainedDetail')
        page.evaluate("window.__loss=document.querySelector('#gpuCanvas').getContext('webgl2').getExtension('WEBGL_lose_context');__loss.loseContext()")
        page.mouse.up(); ready(page, 'cpu'); d = consistent(page)
        assert not d['gpu'] and d['completedCache']['entries'] == 0
        page.evaluate('__loss.restoreContext()'); ready(page, 'gpu'); consistent(page)
        suite.record('Active gesture context loss clears retained/cache textures, completes CPU fallback and restores the GPU')

        open_app(page, SHALLOW)
        page.evaluate('''()=>{const begin=TetraGPU.prototype.beginFrame;let failed=false;TetraGPU.prototype.beginFrame=function(...a){
         if(!failed){failed=true;throw Error('GPU image allocation failed');}return begin.apply(this,a);};}''')
        controls(page); page.locator('[data-palette="1"]').click(); close_controls(page); settle(page)
        d = consistent(page); assert d['gpu'] and d['lastCompleted']['samples'] == 16 and d['palette'] == 1
        suite.record('One allocation failure clears cache and retries without lowering AA or iterations')

        hung=browser.new_context(viewport={'width':480,'height':320})
        hung.add_init_script('''(()=>{window.__forceFencePending=true;
         const wait=WebGL2RenderingContext.prototype.clientWaitSync;
         WebGL2RenderingContext.prototype.clientWaitSync=function(...a){const result=wait.apply(this,a);
          return __forceFencePending && !this.isContextLost()?this.TIMEOUT_EXPIRED:result;};})()''')
        pg=suite.watch(hung.new_page());pg.goto(BASE+'/#'+SHALLOW)
        pg.evaluate("window.__restore=document.querySelector('#gpuCanvas').getContext('webgl2').getExtension('WEBGL_lose_context')")
        ready(pg,'cpu',timeout=45000);d=consistent(pg)
        assert 'timed out' in d['gpuFailure'] and d['iterations']==128 and d['lastCompleted']['samples']==16, d
        grab_cpu='''()=>{const c=document.querySelector('#cpuCanvas');return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);}'''
        aa=pg.evaluate(grab_cpu)
        controls(pg);pg.locator('#quality').select_option('1');close_controls(pg);settle(pg)
        one=pg.evaluate(grab_cpu)
        assert sum(a!=b for a,b in zip(aa,one))>500, 'CPU fallback advertised AA without changing actual pixels'
        controls(pg);pg.locator('#quality').select_option('16');close_controls(pg);settle(pg)
        pg.evaluate('__forceFencePending=false;__restore.restoreContext()');ready(pg,'gpu');d=consistent(pg)
        assert d['gpu'] and not d['gpuFailure'] and d['lastCompleted']['samples']==16, d
        suite.record('A fence that never reports completion switches to FP64 with real Ultra AA; native restore recomputes the GPU image')
        hung.close()

        # Native browser document leave/return, not a synthetic pageshow event.
        camera = state(page)['view']; page.goto('about:blank'); page.go_back(); ready(page); assert consistent(page)['view'] == camera
        suite.record('Leaving the document and native Back restores the serialized camera')
        page.emulate_media(reduced_motion='reduce'); controls(page); page.locator('#flow').check(); close_controls(page)
        page.locator('#zoomIn').click(); settle(page)
        assert state(page)['view'] == state(page)['visual'] and not state(page)['animating']
        page.evaluate("window.__preference=[];matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',e=>__preference.push(e.matches))")
        page.emulate_media(reduced_motion='no-preference'); page.wait_for_function('()=>__preference.includes(false)')
        page.emulate_media(reduced_motion='reduce'); page.wait_for_function('()=>__preference.includes(true) && !tetraDiagnostics.flow'); page.emulate_media(reduced_motion='no-preference')
        suite.record('Runtime reduced-motion changes stop color flow and settle camera navigation')
        # Playwright keeps native tab visibility overridden in this environment.
        # This named event injection covers the application transition only.
        controls(page);page.locator('#flow').check();close_controls(page)
        page.evaluate("window.__hidden=true;window.__reduceEvents=0;Object.defineProperty(document,'hidden',{configurable:true,get:()=>__hidden});matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',()=>__reduceEvents++);document.dispatchEvent(new Event('visibilitychange'))")
        assert not state(page)['flow']
        page.emulate_media(reduced_motion='reduce');page.wait_for_function('()=>__reduceEvents>0&&matchMedia("(prefers-reduced-motion:reduce)").matches')
        page.evaluate("__hidden=false;document.dispatchEvent(new Event('visibilitychange'))")
        assert not state(page)['flow'], 'Returning from the background undid the new reduced-motion preference'
        page.evaluate('delete document.hidden');page.emulate_media(reduced_motion='no-preference')
        suite.record('Injected background return respects a reduced-motion change made while flow was paused')
        open_app(page, 'v=1&x=0.5&y=0&s=0.05&n=64&q=16')
        fullscreen=page.evaluate('!!(document.fullscreenEnabled && document.documentElement.requestFullscreen)')
        controls(page); page.locator('#fullscreenBtn').click()
        if fullscreen:
            page.wait_for_function('()=>!!document.fullscreenElement'); settle(page)
            assert consistent(page)['view']=={'x':'0.5','y':'0','span':'0.05'}
            controls(page); page.locator('#fullscreenBtn').click()
            page.wait_for_function('()=>!document.fullscreenElement'); settle(page); consistent(page)
            suite.record('Native fullscreen entry/exit preserves the camera and final renderer')
        else:
            page.wait_for_function('()=>document.querySelector("#toast").textContent.toLowerCase().includes("fullscreen")')
            consistent(page)
            suite.record('Unavailable native fullscreen reports the fallback without interrupting rendering')
            suite.report['limitations'].append('Native fullscreen is unavailable in this browser environment; entry/exit is unqualified here.')
        if not WEBKIT:
            cdp=context.new_cdp_session(page)
            cdp.send('Emulation.setDeviceMetricsOverride',{'width':640,'height':430,'deviceScaleFactor':2,'mobile':False})
            page.wait_for_function('()=>devicePixelRatio===2 && tetraDiagnostics.lastCompleted?.width===1280 && tetraDiagnostics.complete')
            consistent(page)
            cdp.send('Emulation.setDeviceMetricsOverride',{'width':640,'height':430,'deviceScaleFactor':1,'mobile':False})
            page.wait_for_function('()=>devicePixelRatio===1 && tetraDiagnostics.lastCompleted?.width===640 && tetraDiagnostics.complete')
            consistent(page); cdp.detach()
            suite.record('Native DPR changes re-render at the new density and restore the original density')
        else:
            suite.report['limitations'].append('Hot DPR transition requires CDP and is covered by Chromium, not this WebKit run.')
        context.close()

        # A real crashing Worker reports Retry. Only the first constructor uses
        # the faulty script; Retry creates a Worker running the production blob.
        for fragment, mode, name in [('v=1&x=0.5&y=0&s=0.05&n=64&e=cpu','cpu','CPU'),
                                      ('v=1&x=0.5&y=0&s=1e-30&n=64','perturb','reference')]:
            ctx = browser.new_context(viewport={'width':480,'height':320})
            ctx.add_init_script('''(()=>{const Original=Worker;let first=true;const bad=URL.createObjectURL(new Blob(["self.onmessage=()=>{throw Error('test worker crash')}"]));
             window.Worker=class extends Original{constructor(url,...rest){super(first?bad:url,...rest);first=false;}};})()''')
            pg = suite.watch(ctx.new_page()); pg.goto(BASE+'/#'+fragment)
            pg.locator('#retryBtn').wait_for(state='visible')
            assert not state(pg)['complete'] and pg.locator('#viewport').get_attribute('aria-busy') == 'false'
            pg.locator('#retryBtn').click(); ready(pg, mode); consistent(pg)
            suite.record(name+' Worker crash reports interruption and Retry computes a real completed view')
            ctx.close()

        ctx = browser.new_context(viewport={'width':480,'height':320})
        a = suite.watch(ctx.new_page()); open_app(a, SHALLOW); controls(a)
        a.locator('#bookmarkName').fill('Across tabs'); a.locator('#bookmarkForm button').click(); assert state(a)['savedCount']==1
        b = suite.watch(ctx.new_page()); open_app(b, SHALLOW); assert state(b)['savedCount']==1
        a.evaluate('window.__storage=[];addEventListener("storage",e=>__storage.push(e.key))')
        b.evaluate('localStorage.clear()'); a.wait_for_function('()=>window.__storage.includes(null)')
        assert state(a)['savedCount']==0, 'Another tab cleared storage, but stale bookmarks remain'
        a.locator('#bookmarkName').fill('New view'); a.locator('#bookmarkForm button').click()
        b.wait_for_function('()=>tetraDiagnostics.savedCount===1'); assert b.evaluate('JSON.parse(localStorage.getItem("tetra.saved.v1")).views[0].name')=='New view'
        suite.record('Cross-tab storage clear removes stale saved views before a later save can resurrect them')
        ctx.close()
        # The dense maximum can kill the native WebKit GPU process for all
        # contexts. Run it last, after GPU-specific restoration witnesses, then
        # explicitly verify navigation continues with the available renderer.
        ctx=browser.new_context(viewport={'width':640,'height':430})
        page=suite.watch(ctx.new_page());open_app(page,SHALLOW)
        for engine, quality, palette, iterations in [('auto',1,1,64),('cpu',4,2,128),('exact',16,3,64),('auto',16,0,16384),('auto',4,2,'auto')]:
            controls(page); page.locator('#engine').select_option(engine); page.locator('#quality').select_option(str(quality))
            page.locator('#iterations').select_option(str(iterations)); page.locator(f'[data-palette="{palette}"]').click(); close_controls(page)
            settle(page); d = consistent(page)
            assert d['engine'] == engine and d['palette'] == palette and d['quality'] == quality
            if engine == 'auto': assert d['lastCompleted']['samples'] == quality
            if iterations != 'auto': assert d['lastCompleted']['iterations'] == iterations
            if iterations==16384:
                suite.report['maximum_iterations_backend']={k:d[k] for k in ['backend','gpuFailure','lastCompleted']}
            if engine == 'exact':
                for width,height in [(320,568),(390,844),(844,390)]:
                    page.set_viewport_size({'width':width,'height':height}); settle(page)
                    note,tool=page.locator('#precisionNote').bounding_box(),page.locator('#detailBtn').bounding_box()
                    overlap=max(0,min(note['x']+note['width'],tool['x']+tool['width'])-max(note['x'],tool['x']))*max(0,min(note['y']+note['height'],tool['y']+tool['height'])-max(note['y'],tool['y']))
                    assert overlap == 0 and note['x'] >= 0 and note['x']+note['width']<=width
                page.set_viewport_size({'width':640,'height':430}); settle(page)
                suite.record('Detail control leaves the Exact precision/resolution note readable at phone and landscape sizes')
        page.locator('#homeBtn').click();settle(page);consistent(page)
        page.locator('#backBtn').click();settle(page);consistent(page)
        suite.record('Precision/AA/shading/min/max/Auto transitions complete with the requested samples, including navigation after a reported GPU fallback')
        ctx.close(); suite.no_errors(); browser.close()


run(suite, body)
