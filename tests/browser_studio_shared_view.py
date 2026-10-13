"""Studio framing stays on Explore's real viewport and preserves output framing."""
import time
from playwright.sync_api import sync_playwright
from browser_common import BASE, Suite, launch, ready


def framing(page):
    page.get_by_role('button', name='Edit Start', exact=True).click()
    page.wait_for_function('() => tetraStudioDiagnostics.endpoint === "start"')
    before = page.evaluate('''() => ({box:document.querySelector('#viewport').getBoundingClientRect().toJSON(),
      backing:[document.querySelector('#viewport').clientWidth,document.querySelector('#viewport').clientHeight],
      camera:tetraStudioDiagnostics.draft,view:tetraDiagnostics.view, frame:document.querySelector('#studioFrameOverlay').getBoundingClientRect().toJSON()})''')
    assert page.locator('#viewport').is_visible()
    assert page.locator('#studioCanvas').is_hidden()
    assert abs(before['frame']['width'] / before['frame']['height'] - 9/16) < 1e-6
    bounds = before['box']
    x, y = bounds['x'] + bounds['width'] * .52, bounds['y'] + bounds['height'] * .51
    page.mouse.move(x, y);page.mouse.down();page.mouse.move(x + 32, y + 18, steps=4);page.mouse.up()
    page.wait_for_function('''(old) => tetraStudioDiagnostics.owner === "explore" &&
      JSON.stringify(tetraStudioDiagnostics.draft) !== JSON.stringify(old)''', arg=before['camera'], timeout=30000)
    page.wait_for_function('()=>!tetraDiagnostics.animating')
    moved = page.evaluate('''() => ({box:document.querySelector('#viewport').getBoundingClientRect().toJSON(),
      camera:tetraStudioDiagnostics.draft, view:tetraDiagnostics.view, overlay:document.querySelector('#studioFrameOverlay').getBoundingClientRect().toJSON()})''')
    assert moved['box']['width'] == before['box']['width'] and moved['box']['height'] == before['box']['height']
    assert moved['view'] != before['view']
    assert moved['camera']['x'] != before['camera']['x'] or moved['camera']['y'] != before['camera']['y']
    page.click('#studioApply')
    page.click('#studioVideo')
    try:
        page.wait_for_function('() => document.querySelector("#studioExportDialog").open', timeout=5000)
    except Exception:
        raise AssertionError(page.evaluate('''() => ({studio:tetraStudioDiagnostics,dialog:document.querySelector('#studioExportDialog').outerHTML,
          open:document.querySelector('#studioExportDialog').open,buttons:[...document.querySelectorAll('#studio button')].map(b=>[b.id,b.innerText,b.getBoundingClientRect().toJSON()])})'''))
    page.click('#studioExportClose')
    page.get_by_label('Aspect', exact=True).select_option('16:9')
    page.click('#studioVideo')
    page.click('#studioExportClose')
    page.click('#studioStart')
    page.wait_for_function('''() => tetraStudioDiagnostics.endpoint === "start" && Math.abs((()=>{const r=document.querySelector('#studioFrameOverlay').getBoundingClientRect();return r.width/r.height})()-16/9)<1e-6''')
    changed = page.evaluate('''() => ({box:document.querySelector('#viewport').getBoundingClientRect().toJSON(),camera:tetraStudioDiagnostics.draft})''')
    assert changed['box']['width'] == before['box']['width'] and changed['box']['height'] == before['box']['height']
    assert changed['camera']['x'] == moved['camera']['x'] and changed['camera']['y'] == moved['camera']['y']
    if page.locator('#studioSettings').is_hidden():
        page.click('#studioSettingsBtn')
    page.click('#studioMotionTab')
    page.click('#studioApply')
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.start.x === tetraStudioDiagnostics.draft.x')
    page.get_by_role('button', name='Edit End', exact=True).click()
    page.wait_for_function('() => tetraStudioDiagnostics.endpoint === "end"')
    page.mouse.move(x, y);page.mouse.down();page.mouse.move(x - 27, y + 11, steps=4);page.mouse.up()
    page.wait_for_function('() => tetraStudioDiagnostics.draftDirty')
    page.click('#studioApply')
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.start.x !== tetraStudioDiagnostics.project.shot.end.x || tetraStudioDiagnostics.project.shot.start.y !== tetraStudioDiagnostics.project.shot.end.y')
    page.click('#studioPreviewView')
    try:
        page.wait_for_function('() => tetraStudioDiagnostics.owner === "studio" && getComputedStyle(document.querySelector("#viewport")).visibility === "hidden"',timeout=10000)
    except Exception:
        raise AssertionError(page.evaluate('''() => ({studio:tetraStudioDiagnostics,app:document.body.dataset.app,
          viewport:getComputedStyle(document.querySelector('#viewport')).visibility,notice:document.querySelector('#studioNotice').textContent})'''))
    page.click('#studioPlay')
    page.wait_for_function('() => tetraStudioDiagnostics.preview.playing')
    assert page.locator('#studioPlay').inner_text() == 'Pause'
    page.click('#studioPlay')
    page.wait_for_function('() => tetraStudioDiagnostics.owner === "studio" && !tetraStudioDiagnostics.preview.playing')
    assert page.locator('#studioPlay').inner_text() == 'Play'
    page.click('#leaveStudio')
    page.wait_for_function('() => !tetraStudioDiagnostics.entered && tetraStudioDiagnostics.owner === "explore"')
    assert page.locator('#viewport').is_visible()


def stable(page):
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)


def settled_capture(browser, suite):
    page=suite.watch(browser.new_page(viewport={'width':1100,'height':760}, reduced_motion='no-preference'))
    page.goto(BASE);ready(page);page.click('#openStudioBtn');stable(page)
    if page.evaluate('()=>tetraStudioDiagnostics.endpoint') != 'start':
        page.click('#studioStart');stable(page)
    box=page.locator('#viewport').bounding_box()
    x,y=box['x']+box['width']*.45,box['y']+box['height']*.5

    def inertial_drag():
        # Keep native, trusted input timestamps inside the app's 90 ms velocity
        # window even when CI protocol round trips are slow or events coalesce.
        cdp=page.context.new_cdp_session(page);started=time.time()
        try:
            for kind,dx,dt,buttons in [('mouseMoved',0,0,0),('mousePressed',0,.001,1),
                                     ('mouseMoved',40,.017,1),('mouseMoved',90,.033,1),('mouseReleased',90,.034,0)]:
                cdp.send('Input.dispatchMouseEvent',{'type':kind,'x':x+dx,'y':y,
                         'button':'left' if buttons or kind=='mouseReleased' else 'none','buttons':buttons,
                         'clickCount':1 if kind!='mouseMoved' else 0,'timestamp':started+dt})
        finally:
            cdp.detach()

    def current_camera():
        return page.evaluate('''()=>{const d=tetraStudioDiagnostics,r=document.querySelector('#viewport').getBoundingClientRect(),
          aspect=d.project.output.aspect==='9:16'?9/16:d.project.output.aspect==='1:1'?1:16/9;
          return {...TetraStudioFrame.fromView(tetraDiagnostics.view,TetraStudioFrame.geometry(r.width,r.height,aspect,d.draft.rollDeg),createFixed(256)),rollDeg:d.draft.rollDeg};}''')

    def capture_current_view():
        expected=current_camera()
        page.click('#studioApply');stable(page)
        actual=page.evaluate('()=>tetraStudioDiagnostics.project.shot.start')
        assert actual == expected, {'expectedLiveCamera':expected,'saved':actual}

    inertial_drag()
    released=page.evaluate('()=>tetraDiagnostics.view')
    page.wait_for_function('()=>!tetraDiagnostics.animating',timeout=10000)
    assert page.evaluate('()=>tetraDiagnostics.view') != released, 'The gesture must exercise inertia'
    capture_current_view()
    suite.record('Capture saves the settled shared View after real pointer inertia')

    page.locator('#viewport').focus();page.keyboard.press('+')
    assert page.evaluate('()=>JSON.stringify(tetraDiagnostics.visual)!==JSON.stringify(tetraDiagnostics.view)'), 'The zoom must exercise a glide'
    page.mouse.move(x,y);page.mouse.down()
    grabbed=page.evaluate('()=>tetraDiagnostics.view')
    page.mouse.up();page.wait_for_function('()=>!tetraDiagnostics.animating',timeout=10000)
    assert page.evaluate('()=>tetraDiagnostics.view') == grabbed
    capture_current_view()
    suite.record('Capture saves the displayed camera after grabbing an unfinished glide without dragging')

    inertial_drag()
    assert page.evaluate('()=>tetraDiagnostics.animating'), 'The capture must interrupt motion'
    page.click('#studioApply');stable(page)
    assert not page.evaluate('()=>tetraDiagnostics.animating')
    saved=page.evaluate('()=>tetraStudioDiagnostics.project.shot.start')
    assert saved==current_camera()
    page.wait_for_timeout(150)
    assert saved==current_camera() and not page.evaluate('()=>tetraStudioDiagnostics.draftDirty')
    suite.record('Capture during inertia freezes the shared View and leaves no later unsaved camera drift')
    page.close()


def camera_history(browser, suite):
    page=suite.watch(browser.new_page(viewport={'width':1100,'height':760}))
    page.goto(BASE);page.click('#openStudioBtn');stable(page)

    def camera_matches_view():
        actual=page.evaluate('''()=>{const d=tetraStudioDiagnostics,r=document.querySelector('#viewport').getBoundingClientRect(),F=createFixed(256),
          aspect=d.project.output.aspect==='9:16'?9/16:d.project.output.aspect==='1:1'?1:16/9,
          expected=TetraStudioFrame.toView(d.draft,TetraStudioFrame.geometry(r.width,r.height,aspect,d.draft.rollDeg),F);
          return {view:tetraDiagnostics.view,expected:{x:expected.x,y:expected.y,span:expected.span}};}''')
        assert actual['view']==actual['expected'], actual

    page.click('#studioZoomIn');page.click('#studioApply');stable(page)
    page.click('#studioUndo');stable(page);camera_matches_view()
    page.click('#studioRedo');stable(page);camera_matches_view()
    page.click('#studioEnd');stable(page)
    page.click('#studioZoomOut');page.click('#studioApply');stable(page)
    page.click('#studioSettingsBtn')
    page.get_by_role('button',name='Reverse Path',exact=True).click();stable(page);camera_matches_view()
    page.click('#studioUndo');stable(page);camera_matches_view()
    suite.record('Capture undo/redo and Reverse Path keep the shared View exactly aligned with the stored endpoint camera')
    page.close()


def visibility(page, hidden):
    page.evaluate("""hidden=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});document.dispatchEvent(new Event('visibilitychange'));}""", hidden)


def ownership_and_timing(page, suite):
    page.click('#openStudioBtn')
    page.wait_for_function('() => tetraStudioDiagnostics.entered && tetraStudioDiagnostics.owner === "studio"')
    page.click('#studioStart');stable(page)
    before = page.evaluate('() => __studioCalls.length')
    page.click('#studioHelp');page.click('#studioHelpClose');stable(page)
    page.evaluate("() => document.querySelector('#studioOriginal').dispatchEvent(new MouseEvent('click'))")
    visibility(page, True);visibility(page, False);stable(page)
    page.wait_for_timeout(700)
    assert page.evaluate('() => __studioCalls.length') == before
    assert page.evaluate('() => tetraStudioDiagnostics.owner === "explore" && tetraStudioDiagnostics.preview.suspended')
    assert 'preparing' not in page.locator('#studioFrameNote').inner_text()
    if page.locator('#studioSettings').is_hidden():
        page.click('#studioSettingsBtn')
    duration = page.locator('#studio-duration-number')
    duration.fill('2');duration.press('Tab')
    # Exercise the actual FPS handler while framing; the output dialog is closed.
    page.get_by_label('FPS', exact=True).evaluate("el=>{el.value='24';el.dispatchEvent(new Event('change'));}")
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.frameCount') == 48
    page.click('#studioPreviewView');stable(page)
    assert page.evaluate('() => tetraStudioDiagnostics.previewTiming') == {'frameCount': 48, 'fps': 24}
    scrub = page.locator('#studioScrub')
    scrub.evaluate("el=>{el.value=47;el.dispatchEvent(new Event('input'));}");stable(page)
    page.wait_for_function('() => tetraStudioDiagnostics.preview.displayedK===47',timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.preview.desiredK') == 47
    page.click('#studioPlay');page.wait_for_function('() => tetraStudioDiagnostics.preview.playing')
    page.click('#studioPlay');stable(page)
    page.wait_for_function('() => !tetraStudioDiagnostics.preview.pending', timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.owner') == 'studio'
    page.click('#studioOriginal');page.click('#studioOriginal')
    page.click('#studioHelp');page.click('#studioHelpClose');stable(page)
    visibility(page, True);visibility(page, False);stable(page)
    # Rapid requests overlap delayed prepare, modal resume and paused refinement.
    page.evaluate("""()=>{document.querySelector('#studioStart').click();document.querySelector('#studioPreviewView').click();document.querySelector('#studioEnd').click();}""")
    stable(page);page.wait_for_function('() => tetraStudioDiagnostics.endpoint === "end" && tetraStudioDiagnostics.owner === "explore"')
    page.click('#studioPreviewView');stable(page)
    page.wait_for_function('() => !tetraStudioDiagnostics.preview.pending && tetraStudioDiagnostics.thumbnails.completed===tetraStudioDiagnostics.thumbnails.revision',timeout=120000)
    assert page.evaluate('() => __exploreGpuCalls')>0
    calls=page.evaluate('() => __studioCalls')
    assert any(c['kind']=='renderBase' and not c['playing'] for c in calls)
    assert all(c['owner'] in ['studio','export'] and c['endpoint'] is None for c in calls), calls
    suite.record('Render/compose invocation ownership survives framing modal-close, Original, visibility, rapid transitions and paused refinement; 48-frame/24fps timing uses the last frame', {'calls': len(calls)})
    page.click('#studioVideo')
    page.get_by_label('Resolution', exact=True).select_option('720')
    page.get_by_text('Advanced', exact=True).click()
    page.get_by_label('Iterations', exact=True).select_option('fixed')
    page.locator('#studio-numerics-fixedIterations-number').fill('64')
    page.locator('#studio-numerics-fixedIterations-number').press('Tab')
    page.click('#studioExportStart')
    page.wait_for_function('() => tetraStudioDiagnostics.owner === "export" && tetraStudioDiagnostics.export.active',timeout=120000)
    page.evaluate("() => document.querySelector('#studioOriginal').dispatchEvent(new MouseEvent('click'))")
    page.click('#studioExportCancel')
    page.wait_for_function('() => !tetraStudioDiagnostics.export.active',timeout=120000)
    state=page.evaluate('() => tetraStudioDiagnostics')
    assert state['owner']=='studio' and state['export']['state']=='canceled', state
    assert state['preview']['suspended']
    page.click('#studioExportClose');stable(page)
    page.wait_for_function('() => tetraStudioDiagnostics.preview.displayedK>=0 && !tetraStudioDiagnostics.preview.pending',timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.owner')=='studio'
    suite.record('Export drains preview and View before GPU preparation; cancellation restores Studio ownership and closing resumes preview')
    page.click('#studioStart');stable(page)
    old=page.evaluate('() => tetraDiagnostics.view')
    page.click('#studioZoomIn')
    assert page.evaluate('() => tetraDiagnostics.view') != old
    page.locator('#viewport').focus();page.keyboard.press('Alt+ArrowLeft')
    assert page.evaluate('() => tetraDiagnostics.view') == old
    suite.record('Shared camera zoom snapshots history before mutation')
    page.click('#studioApply');stable(page);page.click('#studioPreviewView');stable(page)
    page.set_viewport_size({'width':1100,'height':760})
    page.click('#studioStart');stable(page)
    mapped=page.evaluate('''()=>{const d=tetraStudioDiagnostics,r=document.querySelector('#viewport').getBoundingClientRect(),F=createFixed(256),frame=TetraStudioFrame.geometry(r.width,r.height,d.project.output.aspect==='16:9'?16/9:d.project.output.aspect==='9:16'?9/16:1,d.draft.rollDeg);
      return {actual:tetraDiagnostics.view,expected:TetraStudioFrame.toView(d.draft,frame,F),stored:d.project.shot.start,draft:d.draft};}''')
    assert mapped['actual']=={key:mapped['expected'][key] for key in ['x','y','span']}
    assert mapped['draft']==mapped['stored']
    page.set_viewport_size({'width':1440,'height':900})
    page.wait_for_timeout(200)
    suite.record('Preview resize refreshes View dimensions before framing and retains the exact stored camera')
    page.get_by_label('Aspect',exact=True).select_option('9:16')
    project_before=page.evaluate('() => tetraStudioDiagnostics.project')
    fragment=page.evaluate('() => location.hash')
    page.evaluate("() => {const hash=new URLSearchParams(location.hash.slice(1));hash.set('s','1e-200');location.hash=hash.toString();}")
    page.wait_for_function('() => tetraStudioDiagnostics.cameraError!==null')
    assert page.locator('#studioApply').is_disabled()
    page.locator('#studioApply').evaluate("el=>el.dispatchEvent(new MouseEvent('click'))")
    stable(page)
    assert page.evaluate('() => tetraStudioDiagnostics.project')==project_before
    page.evaluate('(hash)=>location.hash=hash',fragment)
    page.wait_for_function('() => tetraStudioDiagnostics.cameraError===null')
    suite.record('At minimum View span the smaller output frame is rejected visibly and cannot capture stale or out-of-range camera')
    page.click('#studioApply');page.click('#leaveStudio');stable(page)


def compact_inspector(browser, suite):
    for width,height in [(1440,900),(390,844),(320,568),(844,390)]:
        page=suite.watch(browser.new_page(viewport={'width':width,'height':height}))
        page.goto(BASE);page.click('#openStudioBtn')
        page.wait_for_function('() => tetraStudioDiagnostics.entered')
        viewport=page.locator('#viewport').bounding_box()
        assert page.locator('#studioSettings').is_hidden()
        button=page.locator('#studioSettingsBtn')
        button.click()
        assert button.get_attribute('aria-expanded')=='true'
        assert page.locator('#studioMotionTab').evaluate('el=>el===document.activeElement')
        page.click('#studioSettingsClose')
        assert button.get_attribute('aria-expanded')=='false'
        assert button.evaluate('el=>el===document.activeElement')
        assert page.locator('#viewport').bounding_box()==viewport
        assert page.locator('#studioApply').is_visible() and page.get_by_label('Aspect',exact=True).is_visible()
        assert page.evaluate('() => document.documentElement.scrollWidth<=innerWidth')
        page.close()
    suite.record('Desktop, mobile and landscape inspector collapses with focus restoration; one camera toolbar retains capture/aspect and the full viewport')


def queued_path_handoff(browser, suite):
    page=suite.watch(browser.new_page(viewport={'width':1200,'height':800}))
    page.add_init_script("""addEventListener('load',()=>{
      window.__slowDispose=false;window.__disposalStarted=false;window.__disposalFinished=false;
      const prepare=TetraStudioRender.prepare;
      TetraStudioRender.prepare=async(...args)=>{const render=await prepare(...args),dispose=render.dispose;
        render.dispose=async()=>{if(__slowDispose&&render.diagnostics().cachedFrames>0){__disposalStarted=true;await new Promise(r=>setTimeout(r,500));await dispose();__disposalFinished=true;}else await dispose();};
        return render;
      };
    });""")
    page.goto(BASE);page.click('#openStudioBtn');page.click('#studioSettingsBtn')
    page.locator('#studio-duration-number').fill('2');page.locator('#studio-duration-number').press('Tab')
    page.click('#studioPreviewView')
    page.wait_for_function('() => tetraStudioDiagnostics.requested?.quality==="detailed" && !tetraStudioDiagnostics.preview.pending && tetraStudioDiagnostics.thumbnails.completed===tetraStudioDiagnostics.thumbnails.revision',timeout=120000)
    page.evaluate('() => {__slowDispose=true;}')
    page.get_by_label('Path',exact=True).select_option('in')
    page.wait_for_function('() => __disposalStarted')
    page.click('#studioPreviewView')
    page.wait_for_function('() => __disposalFinished && !tetraStudioDiagnostics.transitioning')
    state=page.evaluate('() => tetraStudioDiagnostics')
    assert state['endpoint'] is None and state['owner']=='studio', state
    page.wait_for_function('() => !tetraStudioDiagnostics.preview.pending && tetraStudioDiagnostics.preview.displayedK>=0',timeout=120000)
    suite.record('Path-driven framing drains delayed preview disposal before a newer Preview request reacquires ownership')
    page.close()


def main():
    suite = Suite('studio_shared_view', ['Headless Chromium; browser integration covers shared camera, framing and ownership, not physical touch hardware.'])
    try:
        with sync_playwright() as playwright:
            browser = launch(playwright)
            context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2)
            page = suite.watch(context.new_page())
            page.add_init_script("""addEventListener('load',()=>{
             window.__studioCalls=[];window.__exploreGpuCalls=0;
             for(const name of ['prepare','drawTile','warm','warmPerturb']){const method=TetraGPU.prototype[name];TetraGPU.prototype[name]=function(...args){
               const stack=new Error().stack;
               if(this.canvas.id==='gpuCanvas'&&/runStage|runInteractive|scheduleWarm/.test(stack)){__exploreGpuCalls++;if(tetraStudioDiagnostics.owner!=='explore')throw Error('Explore GPU work without ownership');}
               return method.apply(this,args);
             };}
             const record=kind=>{const d=tetraStudioDiagnostics;__studioCalls.push({kind,owner:d.owner,endpoint:d.endpoint,playing:d.preview?.playing,suspended:d.preview?.suspended,exporting:d.export.active});
               if(!['studio','export'].includes(d.owner)||d.endpoint)throw Error('Studio GPU invocation without ownership: '+kind);};
             const prepare=TetraStudioRender.prepare;
             TetraStudioRender.prepare=async(...args)=>{record('prepare');await new Promise(r=>setTimeout(r,80));const render=await prepare(...args),base=render.renderBase;
               render.renderBase=(...args)=>{record('renderBase');return base(...args);};return render;};
             const create=TetraStudioFX.createCompositor;
             TetraStudioFX.createCompositor=(...args)=>{const fx=create(...args),compose=fx.compose;fx.compose=(...args)=>{record('compose');return compose(...args);};return fx;};
            });""")
            page.goto(BASE)
            ready(page)
            initial = page.locator('#viewport').bounding_box()
            page.click('#openStudioBtn')
            try:
                page.wait_for_function('() => tetraStudioDiagnostics.entered', timeout=10000)
            except Exception:
                raise AssertionError(page.evaluate('''() => ({studio:window.tetraStudioDiagnostics,toast:document.querySelector('#toast').textContent,
                  app:document.body.dataset.app,button:document.querySelector('#openStudioBtn')?.outerHTML})'''))
            framing(page)
            ownership_and_timing(page, suite)
            assert page.locator('#viewport').bounding_box() == initial
            camera_history(browser, suite)
            settled_capture(browser, suite)
            queued_path_handoff(browser, suite)
            compact_inspector(browser, suite)
            suite.record('Explore input updates the Start/End camera through the shared View renderer; frame aspect changes leave viewport dimensions intact')
            suite.no_errors()
            context.close();browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    main()
