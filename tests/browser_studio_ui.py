"""User-facing Studio edits and moving fractal+FX output, independently decoded."""
import json
import subprocess
from playwright.sync_api import sync_playwright
from browser_common import BASE, OUT, ROOT, Suite, launch


def number(page, name, value):
    field = page.locator('#studio-' + name.replace('.', '-') + '-number')
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


def run():
    suite = Suite('studio-ui', ['Physical iPhone and Safari video export are not certified by this Chromium run.'])
    try:
        with sync_playwright() as p:
            browser = launch(p)
            page = suite.watch(browser.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True))
            page.goto(BASE)
            page.click('#openStudioBtn')
            page.wait_for_function('() => tetraStudioDiagnostics.thumbnails.completed===tetraStudioDiagnostics.thumbnails.revision && tetraStudioDiagnostics.preview.displayedK===0', timeout=120000)
            initial = page.evaluate('() => ({studio:tetraStudioDiagnostics.project,explore:tetraDiagnostics.view,hash:location.hash})')
            assert initial['studio']['shot']['start']['x'] == initial['explore']['x']
            assert initial['studio']['shot']['start'] == initial['studio']['shot']['end']
            assert page.evaluate('() => tetraStudioDiagnostics.preview.generation') < 10
            suite.record('Explore snapshot, no autoplay, bounded thumbnail handoff')
            page.click('#studioEnd')
            box = page.locator('#studioCanvas').bounding_box()
            page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.mouse.wheel(0, -200)
            page.wait_for_function('() => tetraStudioDiagnostics.draftDirty')
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.start.span===tetraStudioDiagnostics.project.shot.end.span')
            page.click('#studioStart')
            page.get_by_role('button', name='Cancel', exact=True).click()
            assert page.evaluate('() => tetraStudioDiagnostics.endpoint==="end" && tetraStudioDiagnostics.draftDirty')
            page.click('#studioApply')
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.motion==="hold" && !tetraStudioDiagnostics.draftDirty')
            page.get_by_label('Path', exact=True).select_option('in')
            page.get_by_label('Preset', exact=True).select_option('Neon Pulse')
            page.click('#studioPreviewView')
            number(page, 'duration', 5)
            page.get_by_label('FPS', exact=True).select_option('24')
            assert page.evaluate('() => tetraStudioDiagnostics.project.shot.frameCount===120')
            assert page.locator('#studio-speed-number').input_value() == '2'
            page.click('#studioSave')
            baseline = page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)')
            page.locator('#studio-look-hueDeg-number').fill('')
            page.locator('#studio-look-hueDeg-number').press('Tab')
            assert page.locator('#studio-look-hueDeg-number').get_attribute('aria-invalid') == 'true'
            assert page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)') == baseline
            page.evaluate('''() => {const r=document.querySelector('#studio-look-hueDeg');r.dispatchEvent(new Event('pointerdown'));for(let i=1;i<=100;i++){r.value=i;r.dispatchEvent(new Event('input'));}r.dispatchEvent(new Event('change'));}''')
            page.click('#studioUndo')
            assert page.evaluate('() => TetraStudioModel.serialize(tetraStudioDiagnostics.project)') == baseline
            assert not page.evaluate('() => tetraStudioDiagnostics.dirty')
            suite.record('Draft Cancel/Apply, Hold B preservation, speed/FPS, invalid number and one drag Undo')
            # Keep one moving endpoint pair; restore the mandatory 10 s portrait configuration.
            number(page, 'duration', 10)
            page.get_by_label('FPS', exact=True).select_option('30')
            page.get_by_label('Resolution', exact=True).select_option('1080')
            page.screenshot(path=str(OUT / 'studio-desktop.png'))
            page.click('#studioVideo')
            page.click('#studioExportStart')
            page.wait_for_function('() => ["ready","failed","canceled"].includes(tetraStudioDiagnostics.export.state) && !tetraStudioDiagnostics.export.active', timeout=600000)
            state = page.evaluate('() => tetraStudioDiagnostics.export')
            assert state['state'] == 'ready', state
            assert state['submitted'] == 300 and state['profile']['samples'] == 4, state
            assert not page.locator('#studioResultVideo').evaluate('(v) => !v.paused')
            with page.expect_download() as download:
                page.click('#studioDownload')
            path = OUT / 'studio-motion-neon-1080-30.mp4'
            download.value.save_as(path)
            decoded = inspect(path, (1080, 1920), 30, 300)
            suite.record('Actual UI Tunnel In + Neon Pulse 10 s 1080 portrait / 30 fps / AA4 MP4', {'output': state, 'decoded': decoded})
            page.screenshot(path=str(OUT / 'studio-export-ready.png'))
            page.click('#studioReturnEdit')
            assert page.evaluate('() => tetraStudioDiagnostics.export.url===null')
            page.get_by_label('Preset', exact=True).select_option('Prism Wave')
            number(page, 'duration', 2)
            page.get_by_label('FPS', exact=True).select_option('24')
            page.get_by_label('Resolution', exact=True).select_option('720')
            for aspect, samples in [('16:9', '4'), ('1:1', '16')]:
                page.get_by_label('Aspect', exact=True).select_option(aspect)
                page.get_by_label('Sampling', exact=True).select_option(samples)
                page.click('#studioVideo')
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
            page.get_by_label('Path', exact=True).select_option('hold')
            page.get_by_label('Sampling', exact=True).select_option('4')
            number(page, 'duration', 20)
            page.get_by_label('FPS', exact=True).select_option('30')
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
            number(page, 'rollDeg', 90)
            page.wait_for_function('() => tetraStudioDiagnostics.preview.displayedK===599 && !tetraStudioDiagnostics.preview.pending', timeout=120000)
            framing = page.evaluate('() => tetraStudioDiagnostics.draft')
            box = page.locator('#studioCanvas').bounding_box()
            page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.mouse.down()
            page.mouse.move(box['x'] + box['width'] / 2 + 24, box['y'] + box['height'] / 2, steps=4)
            page.mouse.up()
            after = page.evaluate('() => tetraStudioDiagnostics.draft')
            assert float(after['y']) < float(framing['y']), (framing, after)
            assert abs(float(after['x']) - float(framing['x'])) < 1e-12, (framing, after)
            assert page.evaluate('() => tetraStudioDiagnostics.project.look.kaleido.enabled && tetraStudioDiagnostics.project.shot.end.rollDeg===0')
            page.click('#studioPreviewView')
            page.get_by_role('button', name='Apply', exact=True).click()
            page.wait_for_function('() => tetraStudioDiagnostics.endpoint===null && tetraStudioDiagnostics.project.shot.end.rollDeg===90')
            suite.record('90 degree inverse-roll pan edits only the draft; spatial FX restore in Preview')
            page.click('#studioSave')
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
            # Mobile retains the canvas and exposes the same controls in a native sheet.
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(OUT / 'studio-mobile.png'))
            assert page.locator('#studioCanvas').bounding_box()['height'] > 100
            assert page.evaluate('() => document.documentElement.scrollWidth<=390')
            page.click('#studioSettingsBtn')
            page.get_by_label('Preset', exact=True).select_option('Prism Wave')
            page.screenshot(path=str(OUT / 'studio-mobile-settings.png'))
            page.keyboard.press('Escape')
            assert not page.locator('#studioSettings').is_visible()
            axe_path = ROOT / 'node_modules' / 'axe-core' / 'axe.min.js'
            if axe_path.exists():
                # CDP evaluation of a supplied function keeps the production script CSP intact.
                page.evaluate(axe_path.read_text())
                violations = page.evaluate('async () => (await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations')
                assert not violations, violations
                suite.record('Mobile WCAG checks')
            suite.record('390 px canvas and native settings sheet, Escape and no horizontal overflow')
            page.click('#leaveStudio')
            page.get_by_role('button', name='Return to Explore', exact=True).click()
            page.wait_for_function('() => tetraStudioDiagnostics.owner==="explore"', timeout=120000)
            assert page.evaluate('() => tetraStudioDiagnostics.owner==="explore" && location.hash=== ' + json.dumps(initial['hash']))
            assert page.evaluate('() => JSON.stringify(tetraDiagnostics.view)') == json.dumps(initial['explore'], separators=(',', ':'))
            suite.record('Return to exact Explore camera/hash, release video URL')
            suite.no_errors()
            browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    run()
