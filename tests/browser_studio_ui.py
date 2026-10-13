"""User-facing Studio edits and moving fractal+FX output, independently decoded."""
import json
import subprocess
from playwright.sync_api import sync_playwright
from browser_common import BASE, OUT, ROOT, Suite, launch


def tab(page, name):
    if not page.locator('#studioSettings').is_visible():
        page.click('#studioSettingsBtn')
    page.get_by_role('tab', name=name, exact=True).click()


def configure_output(page, values):
    if 'Aspect' in values:
        page.get_by_label('Aspect', exact=True).select_option(str(values['Aspect']))
    page.click('#studioVideo')
    for label, value in values.items():
        if label == 'Aspect':
            continue
        page.get_by_label(label, exact=True).select_option(str(value))
    page.click('#studioExportClose')


def number(page, name, value):
    field = page.locator('#studio-' + name.replace('.', '-') + '-number')
    if not name.startswith('numerics.') and page.locator('#studioSettings').is_hidden():
        page.click('#studioSettingsBtn')
    if name == 'rollDeg':
        tab(page, 'Motion')
    for detail in reversed(field.locator('xpath=ancestor::details').all()):
        if detail.get_attribute('open') is None:
            detail.locator('summary').first.click()
    field.fill(str(value))
    field.press('Tab')


def inspect(path, size, fps, count):
    data = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames',
                    '-show_streams', '-show_format', '-show_frames', '-of', 'json', str(path)], text=True))
    assert len(data['streams']) == 1, data['streams']
    stream = data['streams'][0]
    assert stream['codec_name'] == 'h264' and (stream['width'], stream['height']) == size, stream
    assert int(stream['nb_read_frames']) == count, stream
    assert abs(float(data['format']['duration']) - count / fps) < .002, data['format']
    pts = [float(f['best_effort_timestamp_time']) for f in data['frames']]
    assert len(pts) == count and all(abs(t - k / fps) < .002 for k, t in enumerate(pts)), pts
    samples = []
    for k in [0, count // 2, count - 1]:
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-vf',
               f'select=eq(n\\,{k}),scale=96:96', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
        assert len(raw) == 96 * 96 * 3 and max(raw) > 100, (k, len(raw))
        samples.append(raw)
    assert all(a != b for a, b in zip(samples, samples[1:])), 'Moving/FX clip is frozen'
    return {'codec': stream['codec_name'], 'size': size, 'frames': count,
            'duration': data['format']['duration'], 'bytes': path.stat().st_size,
            'first_middle_last_distinct': True, 'all_pts_match': True}


def camera_reference(page, path, output_state):
    """Separate full-profile references distinguish camera travel from FX-only change."""
    rows = page.evaluate('''async () => {
      const p=TetraStudioModel.validate(tetraStudioDiagnostics.project),renderer=new TetraGPU(document.createElement('canvas')),
        compute=await TetraCompute.create(),size=TetraStudioModel.dimensions(p.output),indices=[0,Math.floor(p.shot.frameCount/2),p.shot.frameCount-1];
      const session=await TetraStudioRender.prepare(p,{renderer,compute}),fx=TetraStudioFX.createCompositor(renderer,size),rows=[];
      const sample=document.createElement('canvas');sample.width=sample.height=96;const ctx=sample.getContext('2d');
      async function pixels(source,k){const base=await source.renderBase(k,'final');try{const canvas=await fx.compose(base,{look:p.look,k,fps:p.shot.fps,rollDeg:source.plan.frames[k].camera.rollDeg});ctx.drawImage(canvas,0,0,96,96);const rgba=ctx.getImageData(0,0,96,96).data;return Array.from(rgba).filter((_,i)=>i%4!==3);}finally{base.release();}}
      try{
       for(const k of indices)rows.push({k,camera:session.plan.frames[k].camera,expected:await pixels(session,k),backend:session.backend,samples:p.output.samples});
       const still=TetraStudioModel.validate(p);still.shot.motion='hold';still.numerics.iterations='fixed';still.numerics.fixedIterations=session.plan.iterations;
       const held=await TetraStudioRender.prepare(still,{renderer,compute});try{for(const row of rows)row.still=await pixels(held,row.k);}finally{await held.dispose();}
      }finally{await fx.dispose();await session.dispose();compute?.destroy();renderer.releaseAll();renderer.destroy();}
      return rows;
    }''')
    results = []
    for row in rows:
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-vf',
              f'select=eq(n\\,{row["k"]}),scale=96:96', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
        error = sum(abs(a-b) for a, b in zip(raw, row['expected'])) / len(raw)
        frozen_error = sum(abs(a-b) for a, b in zip(raw, row['still'])) / len(raw)
        assert row['backend'] == output_state['profile']['backend'] and row['samples'] == 4
        assert error < 26, (row['k'], error)
        if row['k']:
            assert error < frozen_error, (row['k'], error, frozen_error)
        results.append({'k': row['k'], 'camera': row['camera'], 'mean_rgb_error': error, 'still_camera_error': frozen_error})
    assert rows[0]['camera'] == page.evaluate('() => tetraStudioDiagnostics.project.shot.start')
    assert rows[-1]['camera'] == page.evaluate('() => tetraStudioDiagnostics.project.shot.end')
    return results


def regressions(browser, suite):
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2, accept_downloads=True)
    page = suite.watch(context.new_page())
    page.goto(BASE)
    page.click('#openStudioBtn')
    page.wait_for_function('() => tetraStudioDiagnostics.entered')
    original_end = page.evaluate('() => tetraStudioDiagnostics.project.shot.end')
    box = page.locator('#studioCanvasArea').bounding_box()
    page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width']/2 + 30, box['y'] + box['height']/2, steps=5)
    page.mouse.up()
    page.click('#studioApply')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    assert page.evaluate('() => JSON.stringify(tetraStudioDiagnostics.draft)===JSON.stringify(tetraStudioDiagnostics.project.shot.start)')
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.end') == original_end
    assert page.locator('#studioApply').is_visible()
    page.click('#studioPreviewView')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.end') == original_end
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.motion==="hold" && tetraStudioDiagnostics.endpoint===null')
    page.click('#studioEnd')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    number(page, 'rollDeg', 45)
    page.click('#studioApply')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.end.rollDeg===45 && !tetraStudioDiagnostics.draftDirty')
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.motion==="travel"')
    page.click('#studioStart')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    page.get_by_role('button', name='Reverse Path', exact=True).click()
    assert page.evaluate('() => !tetraStudioDiagnostics.draftDirty && JSON.stringify(tetraStudioDiagnostics.draft)===JSON.stringify(tetraStudioDiagnostics.project.shot.start)')
    page.click('#studioUndo')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    page.click('#studioRedo')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    assert page.evaluate('() => !tetraStudioDiagnostics.draftDirty')
    page.click('#studioPreviewView')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    before = page.evaluate('() => ({project:tetraStudioDiagnostics.project,k:tetraStudioDiagnostics.preview.desiredK})')
    page.locator('#studioMotionTab').focus()
    page.keyboard.press('End')
    assert page.locator('#studioRhythmTab').get_attribute('aria-selected') == 'true'
    page.keyboard.press('ArrowLeft')
    assert page.locator('#studioLookTab').get_attribute('aria-selected') == 'true'
    page.keyboard.press('Home')
    assert page.evaluate('() => ({project:tetraStudioDiagnostics.project,k:tetraStudioDiagnostics.preview.desiredK})') == before
    assert page.locator('#studioLookControls').is_hidden()
    suite.record('Capture preserves stored End; Preview retains Hold; capturing rotated End enables travel; Reverse/Undo and keyboard tabs')
    tab(page, 'Look')
    bloom = page.evaluate('() => tetraStudioDiagnostics.project.look.bloom')
    assert page.locator('#studio-look-bloom-intensity-number').is_disabled()
    page.get_by_label('Glow enabled', exact=True).check()
    number(page, 'look.bloom.intensity', .8)
    page.get_by_label('Glow enabled', exact=True).uncheck()
    assert page.locator('#studio-look-bloom-intensity-number').is_disabled()
    assert page.evaluate('() => tetraStudioDiagnostics.project.look.bloom.intensity') == .8
    page.get_by_label('Glow enabled', exact=True).check()
    number(page, 'look.bloom.intensity', '')
    page.get_by_label('Glow enabled', exact=True).click()
    assert page.get_by_label('Glow enabled', exact=True).is_checked()
    assert page.locator('#studio-look-bloom-intensity-number').evaluate('(el)=>el===document.activeElement && !el.disabled')
    page.get_by_role('button', name='Reset Glow strength', exact=True).click()
    number(page, 'look.bloom.intensity', .8)
    number(page, 'look.amount', 0)
    page.click('#studioAdjustAmount')
    assert page.locator('#studio-look-amount-number').evaluate('(el)=>el===document.activeElement')
    assert 'amount is 0' in page.locator('#studioBypass').inner_text()
    number(page, 'look.amount', 1)
    before = page.evaluate('() => tetraStudioDiagnostics.project')
    page.click('#studioOriginal')
    assert 'preview only' in page.locator('#studioBypass').inner_text()
    page.click('#studioShowEffects')
    assert page.evaluate('() => tetraStudioDiagnostics.project') == before
    assert page.evaluate('() => tetraStudioDiagnostics.project.look.bloom.radiusRatio') == bloom['radiusRatio']
    page.get_by_label('Preset', exact=True).select_option('Prism Wave')
    page.click('#studioEnd')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    assert 'hidden while framing' in page.locator('#studioBypass').inner_text()
    page.click('#studioViewEffects')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.endpoint===null && tetraStudioDiagnostics.project.look.kaleido.enabled')
    suite.record('Effect switches preserve values; amount/Original/framing bypass explain the actual state')
    tab(page, 'Motion')
    page.get_by_label('Path', exact=True).select_option('hold')
    configure_output(page, {'Aspect': '16:9', 'Resolution': 1080, 'Sampling': 4})
    page.wait_for_function('() => tetraStudioDiagnostics.displayedSize?.width===1536 && tetraStudioDiagnostics.displayedSize?.height===864 && !tetraStudioDiagnostics.preview.pending', timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.render.output.width===1536 && document.querySelector("#studioCanvas").width===1536')
    assert '1536 × 864' in page.locator('#studioFrameNote').inner_text()
    baseline = page.evaluate('() => ({camera:tetraStudioDiagnostics.project.shot.start,completed:tetraStudioDiagnostics.render.completedFrames})')
    tab(page, 'Look')
    number(page, 'look.hueDeg', 20)
    page.wait_for_function('() => !tetraStudioDiagnostics.preview.pending', timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.render.completedFrames') == baseline['completed']
    assert page.evaluate('() => tetraStudioDiagnostics.project.shot.start') == baseline['camera']
    configure_output(page, {'Resolution': 720})
    page.wait_for_function('() => tetraStudioDiagnostics.displayedSize?.width===1280 && tetraStudioDiagnostics.displayedSize?.height===720 && !tetraStudioDiagnostics.preview.pending', timeout=120000)
    suite.record('DPR2 real Detailed source/composition/backing reaches 1536×864, respects 720 output; Hold Look has zero added orbit frames')
    # Fault/delay injection is separate from the public-UI first-video scenario.
    page.evaluate('''() => {window.__detailAttempts=0;const prepare=TetraStudioRender.prepare;TetraStudioRender.prepare=async(p,o)=>{if(o.size.width>512&&++window.__detailAttempts===1)throw Error('injected detail allocation failure');return prepare(p,o);};}''')
    configure_output(page, {'Resolution': 1080})
    page.wait_for_function('() => tetraStudioDiagnostics.detailError!==null', timeout=120000)
    completed = page.evaluate('() => tetraStudioDiagnostics.displayedSize')
    page.wait_for_timeout(700)
    assert page.evaluate('() => __detailAttempts') == 1
    assert page.evaluate('() => tetraStudioDiagnostics.displayedSize') == completed
    page.click('#studioDetailRetry')
    page.wait_for_function('() => tetraStudioDiagnostics.displayedSize?.width===1536 && !tetraStudioDiagnostics.detailError && !tetraStudioDiagnostics.preview.pending', timeout=120000)
    assert page.evaluate('() => __detailAttempts') == 2
    page.evaluate('''() => {const prepare=TetraStudioRender.prepare;TetraStudioRender.prepare=async(...args)=>{await new Promise(r=>setTimeout(r,100));return prepare(...args);};}''')
    page.click('#studioEnd')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    page.click('#studioPreviewView')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    page.click('#studioStart')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    page.wait_for_function('() => tetraStudioDiagnostics.endpoint==="start" && !tetraStudioDiagnostics.preview.pending', timeout=120000)
    assert page.evaluate('() => tetraStudioDiagnostics.owner==="explore" && tetraStudioDiagnostics.preview.suspended && !tetraStudioDiagnostics.render')
    suite.record('Detailed failure keeps complete pixels, retries only explicitly; delayed view changes present the final selected camera')
    page.click('#studioPreviewView')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    page.click('#studioSave')
    page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
    saved = page.evaluate('() => tetraStudioDiagnostics.project')
    page.click('#leaveStudio')
    page.wait_for_function('() => tetraStudioDiagnostics.owner==="explore"')
    page.click('#openStudioBtn')
    page.wait_for_function('() => tetraStudioDiagnostics.entered && tetraStudioDiagnostics.endpoint===null')
    assert page.evaluate('() => tetraStudioDiagnostics.project') == saved
    page.click('#studioPlay')
    page.wait_for_function('() => tetraStudioDiagnostics.preview.playing')
    page.click('#studioHelp')
    assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
    page.click('#studioHelpClose')
    assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
    assert page.locator('#studioHelp').evaluate('(el)=>el===document.activeElement')
    number(page, 'duration', '')
    page.click('#leaveStudio')
    page.get_by_role('button', name='Cancel', exact=True).click()
    assert page.evaluate('() => tetraStudioDiagnostics.entered')
    page.click('#leaveStudio')
    page.get_by_role('button', name='Discard invalid inputs', exact=True).click()
    page.wait_for_function('() => tetraStudioDiagnostics.owner==="explore"')
    suite.record('Reopen restores exact project; help pauses and returns focus; explicit invalid-input Discard permits leaving')
    context.close()
    for width, height in [(390, 844), (320, 568), (844, 390)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=3, has_touch=True, is_mobile=True)
        page = suite.watch(context.new_page())
        page.goto(BASE)
        assert page.locator('#openStudioBtn').is_visible()
        page.click('#openStudioBtn')
        page.wait_for_function('() => tetraStudioDiagnostics.entered')
        page.click('#studioSettingsBtn')
        assert not page.locator('#studioSettings').evaluate('(el)=>el.matches(":modal")')
        if width == 390:
            number(page, 'rollDeg', 45)
            box = page.locator('#studioCanvasArea').bounding_box()
            cdp = context.new_cdp_session(page)
            x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x-15, 'y': y, 'id': 1}, {'x': x+15, 'y': y, 'id': 2}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x-25, 'y': y, 'id': 1}, {'x': x+25, 'y': y, 'id': 2}]})
            framed = page.evaluate('() => tetraStudioDiagnostics.draft')
            page.set_viewport_size({'width': width, 'height': height-100})
            page.wait_for_timeout(200)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x-30, 'y': y, 'id': 1}, {'x': x+30, 'y': y, 'id': 2}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            assert page.evaluate('() => tetraStudioDiagnostics.draft') == framed
            page.set_viewport_size({'width': width, 'height': height})
            suite.record('45 degree real two-touch pinch ends safely across resize without mixing old anchors and new backing size')
        box = page.locator('#studioCanvasArea').bounding_box()
        assert box['height'] > 40
        page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width']/2 + 12, box['y'] + box['height']/2, steps=3)
        page.mouse.up()
        assert page.evaluate('() => tetraStudioDiagnostics.draftDirty')
        page.click('#studioApply')
        page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
        box = page.locator('#studioCanvasArea').bounding_box()
        assert box['height'] > 40, box
        page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
        page.mouse.wheel(0, -100)
        assert page.evaluate('() => tetraStudioDiagnostics.draftDirty')
        page.click('#studioApply')
        page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
        page.click('#studioPreviewView')
        page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
        page.click('#studioPlay')
        page.wait_for_function('() => tetraStudioDiagnostics.preview.displayedK>=1', timeout=120000)
        page.get_by_role('button', name='Pause preview', exact=True).click()
        assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
        assert page.evaluate('() => document.documentElement.scrollWidth') <= width
        snapshot = page.evaluate('() => tetraStudioDiagnostics.project')
        for viewport in [{'width': 1100, 'height': 800}, {'width': width, 'height': height}]:
            page.set_viewport_size(viewport)
        assert page.evaluate('() => tetraStudioDiagnostics.project') == snapshot
        page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        page.wait_for_function('() => !tetraStudioDiagnostics.preview.pending', timeout=120000)
        page.screenshot(path=str(OUT / f'studio-ux-{width}.png'))
        if width == 390:
            # Emulate the user's 200% text preference, without changing product state.
            page.evaluate('() => {for(const el of document.querySelectorAll("#studio button,#studio label,#studio p,#studio span,#studio input,#studio select,#studio summary,#studio h2,#studio h3"))el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*2)+"px";}')
            assert page.evaluate('() => document.documentElement.scrollWidth') <= width
            page.get_by_role('button', name='Play preview', exact=True).click()
            page.wait_for_function('() => tetraStudioDiagnostics.preview.playing')
            page.get_by_role('button', name='Pause preview', exact=True).click()
            assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
            page.click('#studioSettingsClose')
            page.click('#studioSettingsBtn')
            page.set_viewport_size({'width': width, 'height': 550})
            page.get_by_role('tab', name='Motion', exact=True).click()
            page.locator('#studio-duration-number').fill('3')
            page.locator('#studio-duration-number').press('Tab')
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.frameCount===90')
            page.get_by_role('button', name='Play preview', exact=True).click()
            page.wait_for_function('() => tetraStudioDiagnostics.preview.playing')
            page.get_by_role('button', name='Pause preview', exact=True).click()
            assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
            page.set_viewport_size({'width': width, 'height': height})
            suite.record('200% text and keyboard-sized mobile viewport keep inputs and Pause accessible')
        page.click('#studioSettingsClose')
        assert page.locator('#studioSettingsBtn').evaluate('(el)=>el===document.activeElement')
        page.click('#studioVideo')
        assert page.get_by_label('Resolution', exact=True).is_visible()
        page.click('#studioExportClose')
        suite.record(f'{width}×{height}: exposed Studio, nonmodal gesture and Pause, resize preserves model, output in dialog')
        context.close()


def run():
    suite = Suite('studio-ui', ['Physical iPhone and Safari video export are not certified by this Chromium run.'])
    try:
        with sync_playwright() as p:
            browser = launch(p)
            page = suite.watch(browser.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True))
            page.goto(BASE)
            page.click('#openStudioBtn')
            page.wait_for_function('() => tetraStudioDiagnostics.entered && tetraStudioDiagnostics.owner==="explore" && tetraStudioDiagnostics.endpoint==="start"', timeout=120000)
            initial = page.evaluate('() => ({studio:tetraStudioDiagnostics.project,explore:tetraDiagnostics.view,hash:location.hash})')
            assert initial['studio']['shot']['start']['x'] == initial['explore']['x']
            assert initial['studio']['shot']['start'] == initial['studio']['shot']['end']
            assert page.evaluate('() => tetraStudioDiagnostics.preview.generation') < 10
            suite.record('Explore snapshot, no autoplay, bounded thumbnail handoff')
            assert page.evaluate('() => tetraStudioDiagnostics.endpoint==="start" && tetraStudioDiagnostics.preview.suspended')
            assert page.get_by_role('button', name='Capture Start', exact=True).is_visible()
            page.click('#studioApply')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            page.click('#studioEnd')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            assert page.evaluate('() => tetraStudioDiagnostics.endpoint==="end" && tetraStudioDiagnostics.draft.span===tetraStudioDiagnostics.project.shot.end.span')
            box = page.locator('#studioCanvasArea').bounding_box()
            page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.mouse.wheel(0, -200)
            page.wait_for_function('() => tetraStudioDiagnostics.draftDirty')
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.start.span===tetraStudioDiagnostics.project.shot.end.span')
            assert page.get_by_role('button', name='Capture End', exact=True).is_visible()
            page.click('#studioApply')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.motion==="travel" && tetraStudioDiagnostics.endpoint==="end"')
            page.click('#studioPreviewView')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            page.click('#studioUndo')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.motion==="hold" && tetraStudioDiagnostics.project.shot.start.span===tetraStudioDiagnostics.project.shot.end.span')
            page.click('#studioRedo')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            tab(page, 'Look')
            page.get_by_label('Preset', exact=True).select_option('Neon Pulse')
            page.get_by_label('Glow enabled', exact=True).check()
            number(page, 'look.bloom.intensity', .6)
            tab(page, 'Rhythm')
            number(page, 'look.pulse.period', 2)
            tab(page, 'Motion')
            page.click('#studioPlay')
            page.wait_for_function('() => tetraStudioDiagnostics.preview.displayedK>=3 && tetraStudioDiagnostics.render.completedFrames>=2', timeout=120000)
            played = page.evaluate('() => tetraStudioDiagnostics')
            assert played['project']['shot']['start']['span'] != played['project']['shot']['end']['span']
            assert played['render']['completedFrames'] >= 2
            assert played['displayedCamera'] != played['project']['shot']['start']
            assert page.evaluate('() => JSON.stringify(tetraStudioDiagnostics.displayedCamera)===JSON.stringify(TetraStudioCamera.evaluateFrame(tetraStudioDiagnostics.project,tetraStudioDiagnostics.preview.displayedK).camera)')
            page.get_by_role('button', name='Pause preview', exact=True).click()
            suite.record('Public UI first shot: captured Start, explicit End zoom/capture, single Undo, Glow/Pulse and moving preview', {'displayedK': played['preview']['displayedK'], 'shot': played['project']['shot']})
            tab(page, 'Motion')
            number(page, 'duration', 10)
            page.screenshot(path=str(OUT / 'studio-desktop.png'))
            page.click('#studioVideo')
            for label, value in {'FPS': '30', 'Resolution': '1080', 'Sampling': '4', 'Format': 'mp4'}.items():
                page.get_by_label(label, exact=True).select_option(value)
            page.click('#studioExportStart')
            page.wait_for_function('() => ["ready","failed","canceled"].includes(tetraStudioDiagnostics.export.state) && !tetraStudioDiagnostics.export.active', timeout=600000)
            state = page.evaluate('() => tetraStudioDiagnostics.export')
            assert state['state'] == 'ready', state
            assert state['submitted'] == 300 and state['profile']['samples'] == 4, state
            assert state['profile']['resourcesAfterCleanup']['fx']['motionPasses'] == 0, 'Preview history must not affect the final video'
            assert not page.locator('#studioResultVideo').evaluate('(v) => !v.paused')
            with page.expect_download() as download:
                page.click('#studioDownload')
            path = OUT / 'studio-motion-neon-1080-30.mp4'
            download.value.save_as(path)
            decoded = inspect(path, (1080, 1920), 30, 300)
            references = camera_reference(page, path, state)
            suite.record('Actual UI Tunnel In + Neon Pulse 10 s 1080 portrait / 30 fps / AA4 MP4', {'output': state, 'decoded': decoded, 'camera_references': references})
            page.screenshot(path=str(OUT / 'studio-export-ready.png'))
            page.click('#studioReturnEdit')
            # Reverse must synchronize an untouched active draft, then Undo/Redo must do the same.
            page.click('#studioStart')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            page.get_by_role('button', name='Reverse Path', exact=True).click()
            assert page.evaluate('() => !tetraStudioDiagnostics.draftDirty && JSON.stringify(tetraStudioDiagnostics.draft)===JSON.stringify(tetraStudioDiagnostics.project.shot.start)')
            page.click('#studioUndo')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            page.click('#studioPreviewView')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            number(page, 'duration', 5)
            configure_output(page, {'FPS': 24})
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.frameCount===120')
            page.locator('#studio-duration-number').fill('')
            page.locator('#studio-duration-number').press('Tab')
            revision = page.evaluate('() => tetraStudioDiagnostics.revision')
            for action in ['#studioSave', '#studioPlay', '#studioVideo']:
                page.click(action)
                assert page.locator('#studio-duration-number').get_attribute('aria-invalid') == 'true'
                assert page.locator('#studio-duration-number').evaluate('(el)=>el===document.activeElement')
                assert page.evaluate('() => !tetraStudioDiagnostics.preview.playing && !document.querySelector("#studioExportDialog").open')
                assert page.evaluate('() => tetraStudioDiagnostics.revision') == revision
            tab(page, 'Look')
            page.get_by_label('Preset', exact=True).select_option('Neon Pulse')
            assert page.locator('#studio-duration-number').get_attribute('aria-invalid') == 'true'
            tab(page, 'Motion')
            page.get_by_role('button', name='Reset Duration', exact=True).click()
            page.click('#studioSave')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            baseline = page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)')
            page.locator('#studioOriginal').focus()
            page.keyboard.press('Space')
            assert page.locator('#studioOriginal').get_attribute('aria-pressed') == 'true'
            assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
            assert page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)') == baseline
            page.keyboard.press('Space')
            tab(page, 'Look')
            page.locator('#studio-look-hueDeg-number').fill('')
            page.locator('#studio-look-hueDeg-number').press('Tab')
            assert page.locator('#studio-look-hueDeg-number').get_attribute('aria-invalid') == 'true'
            assert page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)') == baseline
            page.evaluate('() => {const r=document.querySelector("#studio-look-hueDeg");r.dispatchEvent(new Event("pointerdown"));for(let i=1;i<=100;i++){r.value=i;r.dispatchEvent(new Event("input"));}r.dispatchEvent(new Event("change"));}')
            page.click('#studioUndo')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            assert page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)') == baseline
            assert not page.evaluate('() => tetraStudioDiagnostics.dirty')
            page.evaluate('() => {const r=document.querySelector("#studio-look-hueDeg");r.dispatchEvent(new Event("pointerdown"));r.value=100;r.dispatchEvent(new Event("input"));r.dispatchEvent(new Event("pointercancel"));}')
            assert page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)') == baseline
            page.locator('#studio-look-hueDeg').focus()
            for _ in range(5):
                page.keyboard.down('ArrowRight')
            page.keyboard.up('ArrowRight')
            page.click('#studioUndo')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            assert page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)') == baseline
            suite.record('Reverse clean draft, invalid Save/Play/Export, scoped preset errors, Original, drag/pointercancel and native keyrepeat Undo')
            assert page.evaluate('() => tetraStudioDiagnostics.export.url===null')
            tab(page, 'Look')
            page.get_by_label('Preset', exact=True).select_option('Prism Wave')
            tab(page, 'Motion')
            number(page, 'duration', 2)
            configure_output(page, {'FPS': 24, 'Resolution': 720})
            for aspect, samples in [('16:9', '4'), ('1:1', '16')]:
                page.get_by_label('Aspect', exact=True).select_option(aspect)
                page.click('#studioVideo')
                page.get_by_label('Sampling', exact=True).select_option(samples)
                if samples == '16':
                    page.click('#studioExportStart')
                    page.wait_for_function('() => tetraStudioDiagnostics.export.active')
                    assert page.locator('#studioFields').get_attribute('disabled') is not None
                    assert page.locator('#studio-duration-number').is_disabled()
                    page.click('#studioExportCancel')
                    page.wait_for_function('() => !tetraStudioDiagnostics.export.active && tetraStudioDiagnostics.export.state==="canceled"', timeout=120000)
                    assert page.evaluate('() => tetraStudioDiagnostics.export.url===null')
                    suite.record('Cancel preparation/render safely restores editing with no partial file')
                page.click('#studioExportStart')
                page.wait_for_function('() => ["ready","failed","canceled"].includes(tetraStudioDiagnostics.export.state) && !tetraStudioDiagnostics.export.active', timeout=300000)
                output = page.evaluate('() => tetraStudioDiagnostics.export')
                assert output['state'] == 'ready', output
                cleanup = output['profile']['resourcesAfterCleanup']
                assert cleanup['render']['cachedFrames'] == 0 and cleanup['fx']['bytes'] == 0, cleanup
                with page.expect_download() as download:
                    page.click('#studioDownload')
                path = OUT / f'studio-prism-{aspect.replace(":", "x")}-aa{samples}.mp4'
                download.value.save_as(path)
                size = (1280, 720) if aspect == '16:9' else (720, 720)
                suite.record('Actual Prism Wave moving short clip', {'samples': samples, 'decoded': inspect(path, size, 24, 48), 'cleanup': cleanup})
                page.click('#studioReturnEdit')
            configure_output(page, {'Sampling': 4})
            for preset in ['Neutral', 'Deep Ambient']:
                tab(page, 'Look')
                page.get_by_label('Preset', exact=True).select_option(preset)
                page.click('#studioVideo')
                page.click('#studioExportStart')
                page.wait_for_function('() => ["ready","failed","canceled"].includes(tetraStudioDiagnostics.export.state) && !tetraStudioDiagnostics.export.active', timeout=300000)
                output = page.evaluate('() => tetraStudioDiagnostics.export')
                assert output['state'] == 'ready' and output['submitted'] == 48, output
                with page.expect_download() as download:
                    page.click('#studioDownload')
                path = OUT / ('studio-' + preset.lower().replace(' ', '-') + '-720.mp4')
                download.value.save_as(path)
                suite.record('Actual ' + preset + ' moving short clip', inspect(path, (720, 720), 24, 48))
                page.click('#studioReturnEdit')
            tab(page, 'Look')
            page.get_by_label('Preset', exact=True).select_option('Prism Wave')
            tab(page, 'Motion')
            page.get_by_label('Path', exact=True).select_option('hold')
            configure_output(page, {'Sampling': 4})
            number(page, 'duration', 20)
            configure_output(page, {'FPS': 30})
            page.click('#studioVideo')
            page.click('#studioExportStart')
            page.wait_for_function('() => ["ready","failed","canceled"].includes(tetraStudioDiagnostics.export.state) && !tetraStudioDiagnostics.export.active', timeout=300000)
            hold = page.evaluate('() => tetraStudioDiagnostics.export')
            assert hold['state'] == 'ready' and hold['submitted'] == 600, hold
            assert hold['profile']['resourcesAfterCleanup']['render']['completedFrames'] == 1, hold
            with page.expect_download() as download:
                page.click('#studioDownload')
            path = OUT / 'studio-hold-prism-20s.mp4'
            download.value.save_as(path)
            suite.record('Actual 20 s / 600 frame Hold reuses one orbit image', {'decoded': inspect(path, (720, 720), 30, 600), 'cleanup': hold['profile']['resourcesAfterCleanup']})
            page.click('#studioReturnEdit')
            page.click('#studioEnd')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            number(page, 'rollDeg', 90)
            page.wait_for_function('() => tetraStudioDiagnostics.owner==="explore" && tetraStudioDiagnostics.preview.suspended', timeout=120000)
            framing = page.evaluate('() => tetraStudioDiagnostics.draft')
            box = page.locator('#studioCanvasArea').bounding_box()
            page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.mouse.down()
            page.mouse.move(box['x'] + box['width'] / 2 + 24, box['y'] + box['height'] / 2, steps=4)
            page.mouse.up()
            after = page.evaluate('() => tetraStudioDiagnostics.draft')
            assert float(after['x']) < float(framing['x']), (framing, after)
            assert abs(float(after['y']) - float(framing['y'])) < 1e-12, (framing, after)
            assert page.evaluate('() => tetraStudioDiagnostics.project.look.kaleido.enabled && tetraStudioDiagnostics.project.shot.end.rollDeg===0')
            page.click('#studioPreviewView')
            page.get_by_role('button', name='Apply', exact=True).click()
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            page.wait_for_function('() => tetraStudioDiagnostics.endpoint===null && tetraStudioDiagnostics.project.shot.end.rollDeg===90')
            suite.record('90 degree output overlay retains Explore world-axis pan; only draft changes and spatial FX restore in Preview')
            page.click('#studioSave')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            page.click('#studioFiles')
            with page.expect_download() as download:
                page.click('#studioJSON')
            json_path = OUT / 'studio-project.json'
            download.value.save_as(json_path)
            saved = json.loads(json_path.read_text())
            page.locator('#studioImportFile').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{"bad":true}'})
            page.wait_for_function('() => document.querySelector("#studioProjectMessage").textContent.length>0')
            assert page.evaluate('() => tetraStudioDiagnostics.project') == saved
            imported = dict(saved, name='Imported shot')
            page.locator('#studioImportFile').set_input_files({'name': 'project.json', 'mimeType': 'application/json', 'buffer': json.dumps(imported).encode()})
            page.wait_for_function('() => tetraStudioDiagnostics.project.name==="Imported shot" && !document.querySelector("#studioProjects").open', timeout=120000)
            assert not page.evaluate('() => tetraStudioDiagnostics.preview.playing')
            page.click('#studioUndo')
            page.wait_for_function('() => !tetraStudioDiagnostics.transitioning', timeout=120000)
            assert page.evaluate('() => tetraStudioDiagnostics.project') == saved
            assert not page.evaluate('() => tetraStudioDiagnostics.dirty')
            page.click('#studioFiles')
            page.locator('#studioProjectList button').first.click()
            page.wait_for_function('() => !document.querySelector("#studioProjects").open')
            page.click('#studioFiles')
            page.get_by_role('button', name='Delete ' + saved['name'], exact=True).click()
            page.get_by_role('button', name='Delete', exact=True).click()
            page.click('#studioProjectsClose')
            assert page.evaluate('() => tetraStudioDiagnostics.dirty')
            suite.record('Actual Save/JSON/invalid import/valid import/Undo/Load/Delete preserve exact project data')
            page.click('#studioPlay')
            page.wait_for_function('() => tetraStudioDiagnostics.preview.playing')
            page.emulate_media(reduced_motion='reduce')
            page.wait_for_function('() => !tetraStudioDiagnostics.preview.playing')
            page.set_viewport_size({'width': 768, 'height': 1024})
            page.screenshot(path=str(OUT / 'studio-tablet.png'))
            assert page.evaluate('() => document.documentElement.scrollWidth<=768')
            suite.record('Reduced-motion change pauses preview; tablet layout fits')
            # Mobile retains the canvas and exposes the same controls in a nonmodal region.
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(OUT / 'studio-mobile.png'))
            assert page.locator('#studioCanvas').bounding_box()['height'] > 100
            assert page.evaluate('() => document.documentElement.scrollWidth<=390')
            tab(page, 'Look')
            page.get_by_label('Preset', exact=True).select_option('Prism Wave')
            page.screenshot(path=str(OUT / 'studio-mobile-settings.png'))
            page.click('#studioSettingsClose')
            assert not page.locator('#studioSettings').is_visible()
            axe_path = ROOT / 'node_modules' / 'axe-core' / 'axe.min.js'
            if axe_path.exists():
                # CDP evaluation of a supplied function keeps the production script CSP intact.
                page.evaluate(axe_path.read_text())
                violations = page.evaluate('async () => (await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations')
                assert not violations, violations
                suite.record('Mobile WCAG checks')
            suite.record('390 px canvas and nonmodal settings, focus return and no horizontal overflow')
            page.click('#leaveStudio')
            page.wait_for_function('() => tetraStudioDiagnostics.owner==="explore"', timeout=120000)
            assert page.evaluate('() => new URLSearchParams(location.hash.slice(1)).get("x")===tetraDiagnostics.view.x')
            assert page.evaluate('() => tetraStudioDiagnostics.export.url===null')
            suite.record('Return to the shared Explore camera with matching hash and released video URL')
            regressions(browser, suite)
            suite.no_errors()
            browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    run()
