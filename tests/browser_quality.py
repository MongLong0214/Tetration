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

        # Live temporal accumulation converges to the Ultra 16-sample image and pans copy it exactly.
        for name, args in [('direct filaments, 1 sample per frame', ['-1.84', '0.09', '0.46', 160, 96, 384, 'direct', 1]),
                           ('direct filaments, 4 samples per frame', ['-1.84', '0.09', '0.46', 160, 96, 384, 'direct', 4]),
                           ('perturbation plume, 1 sample per frame', ['-2.2930579295624999999999991', '0.33208044555625', '5e-11', 120, 72, 768, 'perturb', 1])]:
            r = page.evaluate('(a) => __tetraPixels.accumulate(...a)', args)
            per = args[-1]
            assert r['frames'] == 16 // per and r['notSixteen'] == 0, (name, r)
            # 8-bit running means round once per frame: within 3 of 255 of the float 16-sample average.
            assert r['worst'] <= 3 and r['mean'] < 0.6, (name, r)
            assert r['stillDiff'] == 0 and r['overlapDiff'] == 0 and r['overlap'] > 0, (name, r)
            assert r['revealed'] > 0 and r['revealedWrong'] == 0, (name, r)
            assert r['resampledMax'] == 4 + per and r['resampledTrusted'] > r['pixels'] * 0.95, (name, r)
            suite.record('Live accumulation converges to the 16-sample image, still and panned frames copy it: ' + name, r)
        # Interleaved refinement (slow GPUs: a quarter of the pixels per frame, four times as many pixels).
        for name, args in [('direct filaments', ['-1.84', '0.09', '0.46', 160, 96, 384, 'direct', 1, True]),
                           ('perturbation abyss', ['-0.605137938972379900971816986088586258864125', '0.437740442074800562969426507709712806289976004723289995229', '7e-25', 120, 72, 1536, 'perturb', 1, True])]:
            r = page.evaluate('(a) => __tetraPixels.accumulate(...a)', args)
            assert r['phaseWrong'] == 0 and r['frames'] == 61 and r['notSixteen'] == 0, (name, r)
            assert r['worst'] <= 3 and r['mean'] < 0.6 and r['stillDiff'] == 0 and r['overlapDiff'] == 0 and r['revealedWrong'] == 0, (name, r)
            suite.record('Interleaved live refinement updates one 2x2 phase per frame and converges to the 16-sample image: ' + name, r)

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
        assert draws['16'] == 0 and (draws['4'] == 0 or during['liveSamples'] == 4) and not during['complete'], draws
        assert page.evaluate("getComputedStyle(document.querySelector('#gpuCanvas')).transform") in ('none', 'matrix(1, 0, 0, 1, 0, 0)') or during['interactiveFrames'] > frames0
        page.mouse.up()
        settle(page)
        assert state(page)['lastCompleted']['samples'] == 4
        suite.record('Dragging shows live single-sample frames, then refines on release', {'frames': during['interactiveFrames'] - frames0, 'draws': draws})

        # Grid-locked live frames: consecutive frames of a pan sample the same fractal points and
        # carry their accumulated samples, so once converged the overlapping pixels are identical
        # (no shimmer while moving, no noise when holding still).
        compared, frames = 0, []
        for link, mode in [('v=1&x=-0.605137938972379900971816986088586258864125&y=0.437740442074800562969426507709712806289976004723289995229&s=7e-25&q=4', 'perturb'), ('v=1&x=-0.72&y=0.36&s=0.7&q=4', 'gpu')]:
            open_app(page, link, mode)
            grab = """() => { const c = document.querySelector('#gpuCanvas'), t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
              const g = t.getContext('2d'); g.drawImage(c, 0, 0); return {w: c.width, h: c.height, data: Array.from(g.getImageData(0, 0, c.width, c.height).data)}; }"""
            page.mouse.move(cx, cy)
            page.mouse.down()
            shots = []
            for step in [(31, 13), (77, 41), (113, -23)]:
                count = state(page)['interactiveFrames']
                page.mouse.move(cx + step[0], cy + step[1])
                page.wait_for_function(f'() => tetraDiagnostics.interactiveFrames > {count} && tetraDiagnostics.displayCanvas === "gpuCanvas"', timeout=20000)
                # Held still, every live pixel reaches its 16 samples.
                page.wait_for_function('() => tetraDiagnostics.liveMin >= 16 && tetraDiagnostics.displaySmooth', timeout=60000)
                info = state(page)
                shots.append((page.evaluate(grab), info['displayView']))
            page.mouse.up()
            for (a, va), (b, vb) in zip(shots, shots[1:]):
                assert (a['w'], a['h']) == (b['w'], b['h']), 'live frame size changed during the gesture'
                px = Decimal(va['span']) / a['w']
                kx = (Decimal(vb['x']) - Decimal(va['x'])) / px
                assert abs(kx - kx.to_integral_value()) < Decimal('1e-6'), kx
                kx = int(kx.to_integral_value())
                # Vertical step from the frame's own pixel grid: find the integer shift with identical overlap.
                best = None
                for ky in range(-a['h'] // 2, a['h'] // 2):
                    diff = same_px = 0
                    for y in range(max(0, ky), min(a['h'], a['h'] + ky), 3):
                        for x in range(max(0, kx), min(a['w'], a['w'] + kx), 3):
                            i, j = (y * a['w'] + x) * 4, ((y - ky) * a['w'] + (x - kx)) * 4
                            if a['data'][i:i + 3] != b['data'][j:j + 3]: diff += 1
                            else: same_px += 1
                    if same_px > 50 and (best is None or diff < best[0]): best = (diff, ky, same_px)
                assert best and best[0] == 0, best
                compared += best[2]
            frames.append([shots[0][0]['w'], shots[0][0]['h']])
        suite.record('Panning is grid-locked at 10^25 and the overview: converged overlapping live-frame pixels are identical', {'compared_pixels': compared, 'frames': frames, 'depths': ['7e-25 perturbation', '0.7 direct']})
        settle(page)

        page.evaluate('''() => {window.__draws={1:0,4:0,16:0};const prepare=TetraGPU.prototype.prepare;
          TetraGPU.prototype.prepare=function(frame,scene,samples,...rest){__draws[samples]=(__draws[samples]||0)+1;return prepare.call(this,frame,scene,samples,...rest);};}''')

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

        # From the first live frame to the finished image nothing noisier than an antialiased
        # picture is shown: live frames start from the final image, and single-sample stages
        # stay hidden behind them.
        small = suite.watch(browser.new_page(viewport={'width': 640, 'height': 420}))
        small.add_init_script(NO_WEBGPU)
        open_app(small, 'v=1&x=-1.84&y=0.09&s=0.46&q=4')
        small.evaluate('''() => { window.__shown = []; window.__on = true; let last = null;
          const tick = () => { const d = tetraDiagnostics; const k = d.displaySmooth + "|" + d.displaySoft + "|" + d.interactiveFrames + "|" + d.renderStage;
            if (k !== last) { __shown.push({smooth: d.displaySmooth, soft: d.displaySoft, live: d.liveMin, stage: d.renderStage, complete: d.complete}); last = k; }
            if (__on) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }''')
        sbox = small.locator('#viewport').bounding_box()
        sx, sy = sbox['x'] + sbox['width'] / 2, sbox['y'] + sbox['height'] / 2
        small.mouse.move(sx, sy)
        small.mouse.down()
        for i in range(30):
            small.mouse.move(sx + i * 3, sy + i)
            small.wait_for_timeout(30)
        small.mouse.up()
        settle(small)
        shown = small.evaluate('() => { __on = false; return __shown; }')
        rough = [s for s in shown if not s['smooth']]
        assert len(shown) > 10 and not rough and state(small)['lastCompleted']['samples'] == 4, (rough[:5], len(shown))
        suite.record('Dragging and settling never show a single-sample image over an antialiased one', {'observed_states': len(shown), 'soft_states': sum(1 for s in shown if s['soft']), 'live_frames_min_samples': min(s['live'] for s in shown if s['live'] is not None)})
        small.close()
        suite.no_errors()
        browser.close()


run(suite, body)
