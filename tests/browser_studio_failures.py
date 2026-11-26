"""Actual Studio capability, hidden/export, resize and GPU recovery flows."""
import base64
import json
import subprocess
from playwright.sync_api import sync_playwright
from browser_common import BASE, OUT, Suite, launch, ready


def setup(page):
    page.goto(BASE)
    page.click('#openStudioBtn')
    page.wait_for_function('() => tetraStudioDiagnostics.entered')
    page.click('#studioSettingsBtn')
    page.locator('#studio-duration-number').fill('2')
    page.locator('#studio-duration-number').press('Tab')
    page.click('#studioPreviewView')
    page.get_by_label('Aspect', exact=True).select_option('16:9')
    page.click('#studioVideo')
    page.get_by_label('Resolution', exact=True).select_option('720')
    page.click('#studioExportClose')


def export(page):
    page.click('#studioVideo')
    page.click('#studioExportStart')


def terminal(page, expected):
    page.wait_for_function('() => ["ready","failed","canceled"].includes(tetraStudioDiagnostics.export.state) && !tetraStudioDiagnostics.export.active', timeout=120000)
    state = page.evaluate('() => tetraStudioDiagnostics.export')
    assert state['state'] == expected, state
    return state


def withheld_completion(browser, suite):
    for method in ['mapAsync', 'popErrorScope']:
        page=suite.watch(browser.new_page(viewport={'width':1200,'height':800},accept_downloads=True))
        setup(page)
        if not page.evaluate('()=>tetraDiagnostics.compute&&!tetraDiagnostics.compute.failed'):
            suite.report['webgpu_completion_stall']='Unavailable: this browser has no working WebGPU accelerator'
            page.close();return
        page.click('#studioVideo')
        page.evaluate('''method=>{
          const proto=method==='mapAsync'?GPUBuffer.prototype:GPUDevice.prototype,original=proto[method];let armed=true;
          window.__heldCompletion=false;window.__restoreCompletion=()=>{proto[method]=original;};
          proto[method]=function(...args){const pending=original.apply(this,args);if(!armed)return pending;armed=false;
            return pending.then(value=>{__heldCompletion=true;return new Promise(resolve=>window.__releaseCompletion=()=>resolve(value));});};
        }''',method)
        page.click('#studioExportStart');page.wait_for_function('()=>window.__heldCompletion',timeout=30000)
        page.click('#studioExportCancel')
        page.wait_for_function('()=>!tetraStudioDiagnostics.export.active',timeout=15000)
        state=page.evaluate('()=>({export:tetraStudioDiagnostics.export,owner:tetraStudioDiagnostics.owner,compute:tetraDiagnostics.compute})')
        assert state['export']['state']=='failed' and 'timed out' in state['export']['error'] and state['owner']=='studio' and state['compute']['failed'],state
        assert state['export']['url'] is None
        page.evaluate('()=>{__restoreCompletion();__releaseCompletion();}')
        page.click('#studioExportClose');page.click('#leaveStudio')
        page.wait_for_function('()=>tetraStudioDiagnostics.owner==="explore"&&!tetraStudioDiagnostics.entered')
        ready(page)
        page.click('#openStudioBtn');export(page)
        recovered=terminal(page,'ready')
        assert recovered['profile']['backend']=='webgl' and recovered['submitted']==60,recovered
        with page.expect_download() as download:page.click('#studioDownload')
        path=OUT/('studio-recovered-'+method+'.mp4');download.value.save_as(path)
        stream=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',str(path)],text=True))['streams'][0]
        assert int(stream['nb_read_frames'])==60 and (stream['width'],stream['height'])==(1280,720),stream
        suite.record('Withheld WebGPU '+method+' completion times out, releases cancellation, returns to Explore and exports a decoded fresh video',{'fault':'native completion withheld after resolution','decodedFrames':60})
        page.close()


SAVE_INIT = """window.__saveFault=null;window.__pickFault=null;window.__pickTarget='content.mp4';window.__picks=0;
 // Real OPFS handles stand in for the files a user would pick; a fault is a write or close the browser rejects.
 window.showSaveFilePicker=async options=>{__picks++;window.__pickOptions=options;if(__pickFault==='abort')throw new DOMException('The user aborted a request.','AbortError');
  const handle=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('picked')).getFileHandle(__pickTarget);if(!__pickFault)return handle;
  return {name:handle.name,async createWritable(){const real=await handle.createWritable();return new WritableStream({
   async write(chunk){if(__pickFault==='copy'){await real.abort();throw Error('injected write fault');}await real.write(chunk);},
   async close(){if(__pickFault==='close'){await real.abort();throw Error('injected close fault');}await real.close();},abort:reason=>real.abort(reason)});}};};
 const estimate=StorageManager.prototype.estimate;StorageManager.prototype.estimate=function(){return __saveFault==='quota'?Promise.resolve({quota:1024,usage:0}):estimate.call(this);};
 let exported;Object.defineProperty(globalThis,'TetraStudioExport',{configurable:true,get:()=>exported,set:value=>{
  const create=value.create;value.create=options=>create({...options,maxBytes:1,
   async prepare(...args){if(__saveFault==='prepare')throw Error('injected prepare fault');return TetraStudioRender.prepare(...args);},
   async probe(...args){if(__saveFault==='probe')throw Error('injected probe fault');return TetraStudioEncoder.probe(...args);},
   async createSink(...args){const sink=await TetraStudioEncoder.createSink(...args),add=sink.addFrame,finish=sink.finish;
    sink.addFrame=time=>__saveFault==='render'&&sink.submittedFrames>=30?Promise.reject(Error('injected render fault')):add(time);
    sink.finish=()=>__saveFault==='finalize'?Promise.reject(Error('injected finalize fault')):finish();return sink;}});exported=value;}});
"""
SAVE_FILES = """async()=>{const root=await navigator.storage.getDirectory(),names=[];for await(const [name] of root.entries())names.push(name);
 const picked=await root.getDirectoryHandle('picked'),read=async name=>{const file=await (await picked.getFileHandle(name)).getFile();return file.size>64?{size:file.size}:{size:file.size,text:await file.text()};};
 return {temps:names.filter(name=>name.startsWith(TetraStudioExport.TEMP_PREFIX)),empty:await read('empty.mp4'),content:await read('content.mp4'),picks:__picks};}"""
UNTOUCHED = {'empty': {'size': 0, 'text': ''}, 'content': {'size': 8, 'text': 'SENTINEL'}}


def saved_files(page, temps):
    page.wait_for_function('async n=>(await ('+SAVE_FILES+')()).temps.length===n', arg=temps, timeout=30000)
    return page.evaluate(SAVE_FILES)


def decode_picked(page, name):
    data = page.evaluate('''async name=>{const file=await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('picked')).getFileHandle(name)).getFile(),bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}''', name)
    path = OUT / ('studio-safe-save-' + name)
    path.write_bytes(base64.b64decode(data))
    stream = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', str(path)], text=True))['streams'][0]
    assert int(stream['nb_read_frames']) == 60 and (stream['width'], stream['height']) == (1280, 720), stream
    return {'bytes': path.stat().st_size, 'decodedFrames': int(stream['nb_read_frames'])}


def safe_save(browser, suite):
    # Large output is forced with a 1-byte in-memory limit, so the real OPFS, Web Locks and encoder paths run on a short clip.
    context = browser.new_context(viewport={'width': 1200, 'height': 800})
    context.add_init_script(SAVE_INIT)
    page = suite.watch(context.new_page())
    page.goto(BASE)
    page.evaluate('''async()=>{const root=await navigator.storage.getDirectory(),picked=await root.getDirectoryHandle('picked',{create:true});
      for(const [name,text] of [['empty.mp4',''],['content.mp4','SENTINEL']]){const writable=await (await picked.getFileHandle(name,{create:true})).createWritable();await writable.write(text);await writable.close();}
      await root.getFileHandle('tetra-export-stale.mp4',{create:true});}''')
    setup(page)
    swept = saved_files(page, 0)
    assert {key: swept[key] for key in UNTOUCHED} == UNTOUCHED and swept['picks'] == 0, swept
    suite.record('Studio start sweeps a stale temporary export file and leaves other files alone', swept)
    stages = {}
    for fault, needle in [('quota', 'browser storage'), ('probe', 'injected probe'), ('prepare', 'injected prepare'), ('render', 'injected render'), ('finalize', 'injected finalize'), ('cancel', None)]:
        page.evaluate('f=>{window.__saveFault=f;}', fault)
        export(page)
        if fault == 'cancel':
            page.wait_for_function('() => tetraStudioDiagnostics.export.state==="rendering" && tetraStudioDiagnostics.export.submitted>=10', timeout=120000)
            page.click('#studioExportCancel')
        state = terminal(page, 'canceled' if fault == 'cancel' else 'failed')
        assert state['url'] is None and state['result'] is None and (needle is None or needle in state['error']), state
        files = saved_files(page, 0)
        assert {key: files[key] for key in UNTOUCHED} == UNTOUCHED and files['picks'] == 0, (fault, files)
        stages[fault] = {'submitted': state['submitted'], 'error': state['error']}
        page.click('#studioReturnEdit')
    suite.record('A quota, probe, prepare, render or finalize failure and a render cancel leave picked files untouched and no temporary file', stages)
    page.evaluate('() => {window.__saveFault=null;}')
    export(page)
    ready = terminal(page, 'ready')
    assert ready['result']['temp'] and ready['submitted'] == 60 and ready['url'], ready
    page.wait_for_function('() => document.querySelector("#studioResultVideo").readyState>=1', timeout=30000)
    files = saved_files(page, 1)
    assert {key: files[key] for key in UNTOUCHED} == UNTOUCHED and files['picks'] == 0, files
    assert page.locator('#studioDownload').inner_text().startswith('Save MP4'), page.locator('#studioDownload').inner_text()
    saves = {}
    for fault, needle in [('abort', 'no location was chosen'), ('copy', 'injected write fault'), ('close', 'injected close fault')]:
        page.evaluate('f=>{window.__pickFault=f;}', fault)
        page.click('#studioDownload')
        page.wait_for_function('() => !tetraStudioDiagnostics.export.saving && tetraStudioDiagnostics.export.saveError', timeout=30000)
        state = page.evaluate('() => tetraStudioDiagnostics.export')
        assert needle in state['saveError'] and 'The video is kept' in state['saveError'] and state['url'] and state['result']['temp'], state
        files = saved_files(page, 1)
        assert {key: files[key] for key in UNTOUCHED} == UNTOUCHED, (fault, files)
        saves[fault] = state['saveError']
    page.evaluate('() => {window.__pickFault=null;}')
    page.click('#studioDownload')
    page.wait_for_function('() => tetraStudioDiagnostics.export.result?.savedAs==="content.mp4" && !tetraStudioDiagnostics.export.saving', timeout=30000)
    files = saved_files(page, 0)
    assert files['empty'] == UNTOUCHED['empty'] and files['content']['size'] > 1000 and files['picks'] == 4, files
    assert page.evaluate('() => __pickOptions.suggestedName') == ready['result']['filename']
    assert page.locator('#studioDownload').is_hidden() and 'Saved to content.mp4' in page.locator('#studioExportState').inner_text()
    saves['overwrite'] = decode_picked(page, 'content.mp4')
    page.click('#studioReturnEdit')
    suite.record('A canceled picker, a failed write and a failed close keep the video; a successful Save replaces the chosen file and deletes the temporary file', saves)
    page.evaluate("() => {window.__pickTarget='empty.mp4';}")
    export(page)
    terminal(page, 'ready')
    saved_files(page, 1)
    page.click('#studioReturnEdit')
    discarded = saved_files(page, 0)
    export(page)
    terminal(page, 'ready')
    saved_files(page, 1)
    page.click('#studioDownload')
    page.wait_for_function('() => tetraStudioDiagnostics.export.result?.savedAs==="empty.mp4"', timeout=30000)
    files = saved_files(page, 0)
    assert discarded['empty'] == UNTOUCHED['empty'] and files['empty']['size'] > 1000, (discarded, files)
    decoded = decode_picked(page, 'empty.mp4')
    page.click('#studioExportClose')
    export(page)
    terminal(page, 'ready')
    saved_files(page, 1)
    page.click('#studioExportClose')
    page.click('#leaveStudio')
    page.wait_for_function('() => !tetraStudioDiagnostics.entered', timeout=30000)
    left = saved_files(page, 0)
    suite.record('Closing a result deletes its temporary file; a Save into a pre-existing empty file decodes; leaving Studio leaves no temporary file', {'empty': decoded, 'afterLeave': left['temps']})
    context.close()


def run():
    suite = Suite('studio-failures', ['Visibility is driven through the real app handler with a controlled document.hidden getter.'])
    try:
        with sync_playwright() as p:
            browser = launch(p)
            withheld_completion(browser, suite)
            safe_save(browser, suite)
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
            # Becoming visible resumes the suspended export without a click.
            state = terminal(page, 'ready')
            assert page.evaluate('() => tetraStudioDiagnostics.project') == before
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
            suite.record('Hidden completes current frame then stops; becoming visible resumes automatically and resize preserves output', {'suspendedAfter': count, 'decodedFrames': stream['nb_read_frames']})
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
            page.close()
            page = suite.watch(browser.new_page(viewport={'width': 1200, 'height': 800}, accept_downloads=True))
            # Observe every allocation from construction, including pooled frames.
            # Driver/encoder allocations are outside this accounting.
            page.add_init_script('''(() => {
             window.__studioHidden=false;Object.defineProperty(document,"hidden",{configurable:true,get:()=>window.__studioHidden});
             const owned=window.__studioOwned={textures:new Set(),buffers:new Set(),bitmaps:new Set(),urls:new Set()};window.__studioURLTypes=new Map();
             for(const [kind,create,remove]of [['textures','createTexture','deleteTexture'],['buffers','createFramebuffer','deleteFramebuffer']]){
              const add=WebGL2RenderingContext.prototype[create],drop=WebGL2RenderingContext.prototype[remove];
              WebGL2RenderingContext.prototype[create]=function(...args){const value=add.apply(this,args);owned[kind].add(value);return value;};
              WebGL2RenderingContext.prototype[remove]=function(value){owned[kind].delete(value);return drop.call(this,value);};
             }
             const bitmap=window.createImageBitmap,close=ImageBitmap.prototype.close;
             window.createImageBitmap=async(...args)=>{const value=await bitmap(...args);owned.bitmaps.add(value);return value;};
             ImageBitmap.prototype.close=function(){owned.bitmaps.delete(this);return close.call(this);};
             const url=URL.createObjectURL,revoke=URL.revokeObjectURL;
             URL.createObjectURL=function(value){const result=url.call(this,value);owned.urls.add(result);window.__studioURLTypes.set(result,value.type);return result;};
             URL.revokeObjectURL=function(value){owned.urls.delete(value);window.__studioURLTypes.delete(value);return revoke.call(this,value);};
            })();''')
            setup(page)
            # Explore keeps one reference-worker script URL for this page's lifetime.
            assert page.evaluate('() => [...__studioURLTypes.values()]') == ['text/javascript']
            page.evaluate('''() => {
             window.__studioInitialURLs=new Set(__studioOwned.urls);
             const prepare=TetraStudioRender.prepare;
             TetraStudioRender.prepare=(project,options)=>{window.__studioResourceRenderer=options.renderer;return prepare(project,options);};
             window.__studioResourceReady=()=>{
              const d=tetraStudioDiagnostics,r=d.requested;
              return r?.quality==='detailed'&&!d.preview.suspended&&!d.preview.pending&&d.preview.displayedK>=0
               &&d.render?.cachedFrames===1&&!d.render.active&&d.render.cachedSamples===r.samples
               &&d.render.output.width===r.width&&d.render.output.height===r.height
               &&d.displayedSize?.width===r.width&&d.displayedSize.height===r.height&&!d.fx.active
               &&!d.thumbnails.active&&d.thumbnails.completed===d.thumbnails.revision;
             };
            }''')
            counts = []
            reclamations = []
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
                    page.wait_for_function('() => __studioResourceReady()', timeout=120000)
                # A free frame pool may contain 0–3 images depending on the
                # canceled work. Reclaim only those returned images; a leaked
                # in-use frame cannot be hidden by this operation.
                # Native dialog close is asynchronous. Check completion and
                # capture in one task, so a suspended pre-resume state cannot
                # become the certified resource snapshot.
                sample = page.wait_for_function('''() => {
                 if(!__studioResourceReady())return false;
                 const renderer=__studioResourceRenderer;
                 const count=()=>Object.fromEntries(Object.entries(__studioOwned).map(([key,value])=>[key,key==="urls"?[...value].filter(url=>!__studioInitialURLs.has(url)).length:value.size]));
                 const before=count(),pool=renderer.pool.slice();
                 if(pool.length>3||new Set(pool).size!==pool.length||pool.some(frame=>!__studioOwned.textures.has(frame.texture)||!__studioOwned.buffers.has(frame.buffer)))throw Error('Unaccounted free frame pool');
                 renderer.releaseAll();
                 return {before,pooled:pool.length,after:count(),remainingPool:renderer.pool.length};
                }''', timeout=120000)
                reclaimed = sample.json_value()
                sample.dispose()
                assert reclaimed['remainingPool'] == 0, reclaimed
                for kind in ['textures', 'buffers']:
                    assert reclaimed['after'][kind] == reclaimed['before'][kind] - reclaimed['pooled'], reclaimed
                assert reclaimed['after']['bitmaps'] == reclaimed['before']['bitmaps'] == 0, reclaimed
                assert reclaimed['after']['urls'] == reclaimed['before']['urls'] == 0, reclaimed
                reclamations.append(reclaimed)
                counts.append(reclaimed['after'])
            assert counts[0] == counts[1] == counts[2], counts
            assert all(c['bitmaps'] == 0 and c['urls'] == 0 for c in counts), counts
            suite.record('Three actual success/cancel/success cycles reclaim every pooled frame, retain equal active textures/FBOs and no bitmap/result URLs', reclamations)
            page.evaluate('() => {window.__studioHidden=true;document.dispatchEvent(new Event("visibilitychange"));}')
            page.wait_for_function('() => tetraStudioDiagnostics.preview.suspended')
            page.evaluate('() => {window.__studioHidden=false;document.dispatchEvent(new Event("visibilitychange"));}')
            page.wait_for_function('() => !tetraStudioDiagnostics.preview.suspended')
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
                    page.wait_for_function('() => tetraStudioDiagnostics.owner==="explore" && tetraStudioDiagnostics.entered')
                    assert page.locator('#viewport').is_visible()
                    export(page)
                    failure = terminal(page, 'failed')
                    assert 'WebGL2' in failure['error'] and failure['url'] is None
                    page.click('#studioReturnEdit');page.click('#leaveStudio')
                    page.wait_for_function('() => !tetraStudioDiagnostics.entered && tetraStudioDiagnostics.owner==="explore"')
                    suite.record('CPU framing remains available without WebGL; video fails explicitly and Explore is restored')
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
            page.wait_for_function('() => tetraStudioDiagnostics.entered && tetraStudioDiagnostics.owner==="explore" && tetraStudioDiagnostics.endpoint==="start"', timeout=120000)
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
