"""Actual Studio capability, hidden/export, resize and GPU recovery flows."""
import json
import subprocess
from playwright.sync_api import sync_playwright
from browser_common import BASE, OUT, Suite, launch


def setup(page):
    page.goto(BASE)
    page.click('#openStudioBtn')
    page.wait_for_function('() => tetraStudioDiagnostics.entered')
    page.locator('#studio-duration-number').fill('2')
    page.locator('#studio-duration-number').press('Tab')
    page.click('#studioPreviewView')
    page.click('#studioVideo')
    page.get_by_label('Resolution', exact=True).select_option('720')
    page.get_by_label('Aspect', exact=True).select_option('16:9')
    page.click('#studioExportClose')


def export(page):
    page.click('#studioVideo')
    page.click('#studioExportStart')


def terminal(page, expected):
    page.wait_for_function('() => ["ready","failed","canceled"].includes(tetraStudioDiagnostics.export.state) && !tetraStudioDiagnostics.export.active', timeout=120000)
    state = page.evaluate('() => tetraStudioDiagnostics.export')
    assert state['state'] == expected, state
    return state


def run():
    suite = Suite('studio-failures', ['Visibility is driven through the real app handler with a controlled document.hidden getter.'])
    try:
        with sync_playwright() as p:
            browser = launch(p)
            page = suite.watch(browser.new_page(viewport={'width': 1200, 'height': 800}, accept_downloads=True))
            setup(page)
            before = page.evaluate('() => tetraStudioDiagnostics.project')
            page.evaluate('() => {window.__studioHidden=false;Object.defineProperty(document,"hidden",{configurable:true,get:()=>window.__studioHidden});}')
            export(page)
            page.wait_for_function('() => tetraStudioDiagnostics.export.state==="rendering" && tetraStudioDiagnostics.export.submitted>=1', timeout=120000)
            page.evaluate('() => {window.__studioHidden=true;document.dispatchEvent(new Event("visibilitychange"));}')
            page.wait_for_function('() => tetraStudioDiagnostics.export.state==="suspended"', timeout=120000)
            count = page.evaluate('() => tetraStudioDiagnostics.export.submitted')
            page.set_viewport_size({'width': 780, 'height': 1024})
            page.evaluate('() => {window.__studioHidden=false;document.dispatchEvent(new Event("visibilitychange"));}')
            page.wait_for_timeout(100)
            assert page.evaluate('() => tetraStudioDiagnostics.export.submitted') == count
            assert page.evaluate('() => tetraStudioDiagnostics.project') == before
            page.click('#studioExportResume')
            state = terminal(page, 'ready')
            assert state['config']['width'] == 1280 and state['config']['height'] == 720
            assert state['submitted'] == 60 and not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
            page.evaluate('() => {window.__studioHidden=true;document.dispatchEvent(new Event("visibilitychange"));window.__studioHidden=false;document.dispatchEvent(new Event("visibilitychange"));}')
            retained = page.evaluate('() => ({preview:tetraStudioDiagnostics.preview,output:tetraStudioDiagnostics.export,open:document.querySelector("#studioExportDialog").open})')
            assert retained['open'] and retained['preview']['suspended'] and not retained['preview']['playing'], retained
            assert retained['output']['url'] == state['url'] and retained['output']['state'] == 'ready', retained
            with page.expect_download() as download:
                page.click('#studioDownload')
            path = OUT / 'studio-hidden-resume.mp4'
            download.value.save_as(path)
            stream = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', str(path)], text=True))['streams'][0]
            assert int(stream['nb_read_frames']) == 60 and (stream['width'], stream['height']) == (1280, 720), stream
            suite.record('Hidden completes current frame then stops; explicit visible Resume and resize preserve output', {'suspendedAfter': count, 'decodedFrames': stream['nb_read_frames']})
            page.click('#studioReturnEdit')
            export(page)
            page.wait_for_function('() => tetraStudioDiagnostics.export.state==="rendering"', timeout=120000)
            page.evaluate('''() => {const gl=document.querySelector('#gpuCanvas').getContext('webgl2'),loss=gl.getExtension('WEBGL_lose_context');if(!loss)throw Error('Context loss extension unavailable');window.__studioRestore=()=>loss.restoreContext();loss.loseContext();}''')
            failed = terminal(page, 'failed')
            assert failed['url'] is None and 'GPU' in failed['error'], failed
            assert page.evaluate('() => tetraStudioDiagnostics.project') == before
            page.click('#studioReturnEdit')
            page.evaluate('() => window.__studioRestore()')
            page.wait_for_function('() => tetraDiagnostics.gpu', timeout=120000)
            page.click('#studioPreviewView')
            page.wait_for_function('() => tetraStudioDiagnostics.preview.displayedK>=0 && !tetraStudioDiagnostics.preview.pending', timeout=120000)
            assert page.evaluate('''() => {const c=document.querySelector('#studioCanvas'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i]>100||a[i+1]>100||a[i+2]>100)return true;return false;}''')
            export(page)
            restored = terminal(page, 'ready')
            assert restored['submitted'] == 60 and restored['profile']['resourcesAfterCleanup']['render']['completedFrames'] == 1, restored
            page.click('#studioReturnEdit')
            suite.record('Actual WebGL loss fails without partial video; restored GPU produces preview and a fresh complete export')
            # Observe the resources the app can own, after context recovery.
            # Driver/encoder allocations are outside this accounting.
            page.evaluate('''() => {
             const owned=window.__studioOwned={textures:new Set(),buffers:new Set(),bitmaps:new Set(),urls:new Set()};
             for(const [kind,create,remove]of [['textures','createTexture','deleteTexture'],['buffers','createFramebuffer','deleteFramebuffer']]){
              const add=WebGL2RenderingContext.prototype[create],drop=WebGL2RenderingContext.prototype[remove];
              WebGL2RenderingContext.prototype[create]=function(...args){const value=add.apply(this,args);owned[kind].add(value);return value;};
              WebGL2RenderingContext.prototype[remove]=function(value){owned[kind].delete(value);return drop.call(this,value);};
             }
             const bitmap=window.createImageBitmap,close=ImageBitmap.prototype.close;
             window.createImageBitmap=async(...args)=>{const value=await bitmap(...args);owned.bitmaps.add(value);return value;};
             ImageBitmap.prototype.close=function(){owned.bitmaps.delete(this);return close.call(this);};
             const url=URL.createObjectURL,revoke=URL.revokeObjectURL;
             URL.createObjectURL=function(value){const result=url.call(this,value);owned.urls.add(result);return result;};
             URL.revokeObjectURL=function(value){owned.urls.delete(value);return revoke.call(this,value);};
            }''')
            counts = []
            for _ in range(3):
                for expected in ['ready', 'canceled', 'ready']:
                    export(page)
                    if expected == 'canceled':
                        page.wait_for_function('() => tetraStudioDiagnostics.export.state==="rendering"', timeout=120000)
                        page.click('#studioExportCancel')
                    value = terminal(page, expected)
                    if expected == 'ready':
                        assert value['submitted'] == 60 and value['result']['bytes'] > 0, value
                    else:
                        assert value['url'] is None, value
                    page.click('#studioReturnEdit')
                    page.wait_for_function('() => !tetraStudioDiagnostics.preview.pending && !tetraStudioDiagnostics.thumbnails.active', timeout=120000)
                counts.append(page.evaluate('() => Object.fromEntries(Object.entries(__studioOwned).map(([key,value])=>[key,value.size]))'))
            assert counts[0] == counts[1] == counts[2], counts
            assert all(c['bitmaps'] == 0 and c['urls'] == 0 for c in counts), counts
            suite.record('Three actual success/cancel/success cycles retain bounded textures/FBOs and no bitmap/result URLs', counts)
            page.evaluate('() => {window.__studioHidden=true;document.dispatchEvent(new Event("visibilitychange"));}')
            page.wait_for_function('() => tetraStudioDiagnostics.preview.suspended')
            page.evaluate('() => {window.__studioHidden=false;document.dispatchEvent(new Event("visibilitychange"));}')
            visible = page.evaluate('() => tetraStudioDiagnostics.preview')
            assert not visible['suspended'] and not visible['playing'], visible
            page.click('#studioLookTab')
            page.get_by_label('Preset', exact=True).select_option('Deep Ambient')
            page.wait_for_function('() => tetraStudioDiagnostics.preview.displayedK>=0 && !tetraStudioDiagnostics.preview.pending && !tetraStudioDiagnostics.thumbnails.active', timeout=120000)
            assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
            suite.record('Visible return resumes selected-frame Look updates without autoplay')
            page.close()
            context = browser.new_context(viewport={'width': 1200, 'height': 800}, accept_downloads=True)
            context.add_init_script("""window.__cleanupFx=true;window.__cleanupRender=true;window.__forceWebM=false;
             let exported;Object.defineProperty(globalThis,'TetraStudioExport',{configurable:true,get:()=>exported,set:value=>{
              const create=value.create;value.create=options=>create({...options,
               createCompositor(renderer,size){const fx=TetraStudioFX.createCompositor(renderer,size),dispose=fx.dispose;fx.dispose=async()=>{await dispose();if(window.__cleanupFx){window.__cleanupFx=false;throw Error('injected FX cleanup');}};return fx;},
               async prepare(p,o){const session=await TetraStudioRender.prepare(p,o),dispose=session.dispose;session.dispose=async()=>{await dispose();if(window.__cleanupRender){window.__cleanupRender=false;throw Error('injected render cleanup');}};return session;},
               probe:(config,...rest)=>TetraStudioEncoder.probe({...config,container:window.__forceWebM&&config.container==='auto'?'webm':config.container},...rest)
              });exported=value;
             }});
            """)
            page = suite.watch(context.new_page())
            setup(page)
            export(page)
            failure = terminal(page, 'failed')
            assert 'FX cleanup' in failure['error'] and 'render cleanup' in failure['error'], failure
            assert failure['url'] is None and page.evaluate('() => tetraStudioDiagnostics.owner==="studio"')
            assert not page.locator('#studioOutputFields').is_disabled()
            page.click('#studioReturnEdit')
            export(page)
            assert terminal(page, 'ready')['submitted'] == 60
            page.click('#studioReturnEdit')
            suite.record('Actual compositor/session cleanup exceptions both run, publish no file, unlock UI/owner and permit a fresh successful job')
            # A forced MP4 availability failure still uses the real WebM probe and encoder.
            page.evaluate('() => {window.__forceWebM=true;}')
            page.click('#studioVideo')
            page.get_by_label('Format', exact=True).select_option('auto')
            page.click('#studioExportStart')
            alternative = terminal(page, 'failed')
            assert alternative['errorCode'] == 'MP4_UNAVAILABLE' and alternative['profile'] is None
            assert page.get_by_role('button', name='Use WebM', exact=True).is_visible()
            page.click('#studioUseWebM')
            assert page.evaluate('() => tetraStudioDiagnostics.project.output.container==="webm" && !tetraStudioDiagnostics.export.active')
            page.click('#studioExportStart')
            output = terminal(page, 'ready')
            assert output['config']['container'] == 'webm' and output['submitted'] == 60
            with page.expect_download() as downloaded:
                page.click('#studioDownload')
            path = OUT / 'studio-confirmed-webm.webm'
            downloaded.value.save_as(path)
            stream = json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',str(path)],text=True))['streams'][0]
            assert stream['codec_name'] == 'vp9' and int(stream['nb_read_frames']) == 60
            page.click('#studioReturnEdit')
            suite.record('Confirmed WebM alternative requires explicit selection, then a real VP9/60-frame download')
            page.click('#studioMotionTab')
            page.click('#studioStart')
            page.get_by_text('Speed, easing and rotation', exact=True).click()
            page.locator('#studio-rollDeg-number').fill('45')
            page.locator('#studio-rollDeg-number').press('Tab')
            page.click('#studioApply')
            page.click('#studioPreviewView')
            frozen = page.evaluate('() => tetraStudioDiagnostics.project')
            page.evaluate('''() => {const prepare=TetraStudioRender.prepare;TetraStudioRender.prepare=async(p,o)=>{if(o.size)return prepare(p,o);const limit=o.renderer.maxTexture;o.renderer.maxTexture=1024;try{return await prepare(p,o);}finally{o.renderer.maxTexture=limit;}};}''')
            export(page)
            limited = terminal(page, 'failed')
            assert limited['errorCode'] == 'SOURCE_LIMIT' and limited['url'] is None
            assert page.evaluate('() => tetraStudioDiagnostics.project') == frozen
            page.click('#studioEditRotation')
            page.wait_for_function('() => tetraStudioDiagnostics.endpoint==="start"')
            assert page.locator('#studio-rollDeg-number').is_visible()
            assert page.locator('#studio-rollDeg-number').input_value() == '45'
            suite.record('Rolled source limit preserves output/angles and routes explicit rotation editing to the used Hold endpoint')
            context.close()
            for mode, init in [
                ('encoder', 'Object.defineProperty(window,"VideoEncoder",{value:undefined,configurable:true});'),
                ('float', '''const original=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_color_buffer_float'?null:original.call(this,name);};'''),
                ('webgl', '''const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};'''),
            ]:
                context = browser.new_context(viewport={'width': 1200, 'height': 800})
                context.add_init_script(init)
                page = suite.watch(context.new_page())
                if mode == 'webgl':
                    page.goto(BASE)
                    page.click('#openStudioBtn')
                    page.wait_for_function('() => tetraStudioDiagnostics.owner==="explore" && !tetraStudioDiagnostics.entered')
                    assert page.locator('#viewport').is_visible()
                    assert page.locator('#toast').is_visible()
                    suite.record('Unavailable WebGL restores Explore with an explanation')
                    context.close()
                    continue
                setup(page)
                if mode == 'float':
                    page.click('#studioLookTab')
                    page.get_by_label('Preset', exact=True).select_option('Neon Pulse')
                value = page.evaluate('() => tetraStudioDiagnostics.project')

                export(page)
                failure = terminal(page, 'failed')
                assert failure['url'] is None and page.evaluate('() => tetraStudioDiagnostics.project') == value, failure
                needle = {'encoder': 'WebCodecs', 'float': 'half-float', 'webgl': 'WebGL2'}[mode]
                assert needle in failure['error'], failure
                page.click('#studioEditOutput')
                assert page.evaluate('() => document.activeElement.matches("#studioOutputControls select")')
                if mode == 'encoder':
                    assert failure['profile'] is None
                page.click('#studioReturnEdit')
                page.click('#studioSave')
                assert not page.evaluate('() => tetraStudioDiagnostics.dirty')
                suite.record('Missing ' + mode + ' reports failure and preserves editable/savable project', failure['error'])
                context.close()
            context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
            page = suite.watch(context.new_page())
            page.goto(BASE)
            page.click('#settingsBtn')
            page.click('#openStudioFromSettings')
            page.wait_for_function('() => tetraStudioDiagnostics.entered && tetraStudioDiagnostics.preview.displayedK>=0', timeout=120000)
            assert not page.locator('#sidebar').is_visible()
            assert page.locator('#studioSettingsBtn').is_visible()
            suite.record('Mobile Explore controls open Studio and hand off the renderer')
            context.close()
            suite.no_errors()
            browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    run()
