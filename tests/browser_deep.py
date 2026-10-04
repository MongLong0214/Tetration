"""Infinite-zoom quality: GPU perturbation against FP64 perturbation and exact BigInt orbits,
full display resolution at every depth, symmetry and seam invariants, reference reuse and a
continuous deep zoom session. Software WebGL2 (SwiftShader); not hardware qualification."""
from decimal import Decimal, getcontext
from browser_common import *
from playwright.sync_api import sync_playwright

getcontext().prec = 300
PIXELS = (ROOT / 'tests/browser_pixels.js').read_text()
suite = Suite('deep', ['SwiftShader WebGL2 on a Linux runner; FP32 GPU arithmetic as on hardware, but no hardware driver qualification.',
                       'Chaotic regions are compared statistically: finite precision of any kind changes individual chaotic pixels.'])
PLUME = ('-2.2930579295624999999999991', '0.33208044555625', '5e-11')
ABYSS = ('-0.605137938972379900971816986088586258864125', '0.437740442074800562969426507709712806289976004723289995229', '7e-25')
HORIZON = ('-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206',
           '0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475', '7e-100')


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        page = suite.watch(browser.new_page(viewport={'width': 480, 'height': 320}))
        page.add_init_script(NO_WEBGPU)
        open_app(page, 'v=1&x=0.5&y=0&s=1&q=1')
        page.evaluate(PIXELS)

        # 1. Structured views must match FP64 perturbation pixel for pixel on the GPU.
        exact_views = [
            ('threshold boundary at 1e-55', '1.3594182965158676173336178455', '2.2496614865153754494134386028', '1e-55', 512),
            ('convergence boundary at 2e-6', '1.4447', '0.0001', '2e-6', 512),
            ('negative real axis at 1e-9', '-2.5', '0', '1e-9', 512),
            ('lower half plane at 1e-30', '0.7', '-0.3', '1e-30', 512),
            ('view containing the origin at 1e-20', '0', '0', '1e-20', 512),
            ('fixed-point interior at 1e-150', '0.5', '0', '1e-150', 512),
            ('reference above the axis at 3e-9', '-1.84', '0.0000000003', '3e-9', 512),
        ]
        for name, x, y, s, n in exact_views:
            r = page.evaluate('([x,y,s,n]) => __tetraPixels.compare(x,y,s,64,40,n,0,"perturb",1e9)', [x, y, s, n])
            assert r['shortMismatch'] == 0 and r['blockDiff'] == 0, (name, r)
            suite.record('GPU perturbation equals FP64 pixel for pixel: ' + name, {k: r[k] for k in ['kinds', 'total', 'refLength', 'gpuMs']})

        # 2. Chaotic deep views: identical structure and class statistics at every depth.
        for name, (x, y, s), n in [('Plume 10^11', PLUME, 1024), ('Abyss 10^25', ABYSS, 2048), ('Horizon 10^100', HORIZON, 4096)]:
            r = page.evaluate('([x,y,s,n]) => __tetraPixels.compare(x,y,s,64,40,n,0,"perturb",1e9)', [x, y, s, n])
            gpu_kinds = page.evaluate('''([x,y,s,n]) => {
              const F=createFixed(256),view={x:F.parse(x),y:F.parse(y),span:F.parse(s)},point=TetraRender.referencePoint(F,view);
              const ref=TetraReference.compute({x:F.text(point.x),y:F.text(point.y),digits:Math.ceil(-Math.log10(Number(s)))+40,iterations:n,maxRe:80});ref.point=point;
              const r=new TetraGPU(document.createElement('canvas')),frame=r.beginFrame(64,40);
              r.draw(frame,{x:0,y:0,width:64,height:40},{...TetraRender.perturbScene(F,view,point.x,point.y),ref,iterations:n,palette:0,rules:TetraCore.RULES.gpu},1);
              const px=r.readFrame(frame);let numeric=0,unresolved=0;
              for(let i=0;i<px.length;i+=4){if(px[i]===42&&px[i+1]===31&&px[i+2]===47)numeric++;else if(px[i]===10&&px[i+1]===9&&px[i+2]===24)unresolved++;}
              return {numeric,unresolved};
            }''', [x, y, s, n])
            total = r['total']
            assert abs(gpu_kinds['numeric'] - r['kinds'][4]) <= total * 0.06, (name, gpu_kinds, r['kinds'])
            assert abs(gpu_kinds['unresolved'] - r['kinds'][0]) <= total * 0.06, (name, gpu_kinds, r['kinds'])
            assert r['blockDiff'] <= 18, (name, r['blockDiff'])
            suite.record('Chaotic view keeps FP64 structure and class statistics: ' + name,
                         {'fp64_kinds': r['kinds'], 'gpu_numeric': gpu_kinds['numeric'], 'gpu_unresolved': gpu_kinds['unresolved'], 'block_diff': round(r['blockDiff'], 2)})

        # 3. Exact decimal orbits at sampled pixels of a structured deep view.
        picks = [[3, 3], [10, 20], [24, 16], [40, 5], [44, 28], [30, 10], [8, 28], [20, 2], [55, 33], [60, 1]]
        results = page.evaluate('([p]) => __tetraPixels.exact("1.3594182965158676173336178455","2.2496614865153754494134386028","1e-55",64,40,512,p)', [picks])
        assert all(item['diff'] <= 3 for item in results), results
        suite.record('GPU perturbation pixels equal exact 95-digit orbits at 1e-55', results)

        # 4. Conjugate symmetry is exact for perturbation (mirrored pixels repeat the same arithmetic).
        for x, s in [('-2.5', '1e-7'), ('-1.84', '1e-12'), ('1.4447', '1e-5')]:
            sym = page.evaluate('([x,s]) => __tetraPixels.symmetry(x,s,64,40,1024,"perturb")', [x, s])
            assert sym['differing'] == 0, (x, s, sym)
        suite.record('Views centred on the real axis are exactly conjugate-symmetric at depth')

        # 5. Tiles agree with one full-frame draw, also with 4 and 16 adaptive samples.
        for samples in [1, 4, 16]:
            worst = page.evaluate('([x,y,s,k]) => __tetraPixels.seams(x,y,s,96,64,1024,"perturb",k)', [*PLUME, samples])
            assert worst == 0, (samples, worst)
        suite.record('Perturbation tiles are seamless at 1, 4 and 16 samples')

        # 6. The direct/perturbation handover keeps structured pixels identical.
        for x, y, s in [('-0.72', '0.36', '0.0003'), ('-2.5', '0.1', '0.0005')]:
            d = page.evaluate('([x,y,s]) => __tetraPixels.compare(x,y,s,64,40,384,0,"direct",1e9)', [x, y, s])
            q = page.evaluate('([x,y,s]) => __tetraPixels.compare(x,y,s,64,40,384,0,"perturb",1e9)', [x, y, s])
            assert q['blockDiff'] <= d['blockDiff'] + 1, (d['blockDiff'], q['blockDiff'])
            assert q['shortMismatch'] <= d['shortMismatch'], (d['shortMismatch'], q['shortMismatch'])
        suite.record('Perturbation is at least as faithful to FP64 as direct FP32 near the handover depth')

        # 7. The app renders every depth at full display resolution with perturbation.
        for x, y, s in [PLUME, ABYSS, HORIZON, ('0.5', '0', '1e-200')]:
            info = open_app(page, f'v=1&x={x}&y={y}&s={s}&q=1', 'perturb')
            last = info['lastCompleted']
            assert last['width'] == 480 and last['height'] == round(page.locator('#viewport').bounding_box()['height']), last
            assert last['mode'] == 'perturb' and info['references'], info
            suite.record(f'Full display resolution at span {s}', {'size': [last['width'], last['height']], 'iterations': last['iterations'], 'ms': round(last['elapsed'])})
        page.screenshot(path=str(OUT / 'deep-1e-200.png'))

        # 8. Auto iterations deepen with zoom; fixed limits stay fixed.
        expected = {'7': 384, '5e-11': 768, '7e-25': 1536, '7e-100': 4096, '1e-200': 8192}
        for s, n in expected.items():
            page.evaluate(f"location.hash='v=1&x=0.5&y=0&s={s}&q=1'")
            page.wait_for_function(f'() => tetraDiagnostics.iterations === {n}')
        page.evaluate("location.hash='v=1&x=0.5&y=0&s=1e-100&n=1024&q=1'")
        page.wait_for_function('() => tetraDiagnostics.iterationSetting === 1024')
        assert state(page)['iterations'] == 1024
        suite.record('Auto iteration limit follows depth', expected)
        ready(page)

        # 9. Reference reuse: small pans and moderate zoom keep the same exact orbit.
        before = open_app(page, f'v=1&x={ABYSS[0]}&y={ABYSS[1]}&s={ABYSS[2]}&q=1', 'perturb')
        assert before['referencesComputed'] == 1 and before['reference']['digits'] >= 64, before['reference']
        page.locator('#viewport').focus()
        for key in ['ArrowRight', 'ArrowUp', 'ArrowLeft', '+', '+', 'Shift+ArrowDown']:
            page.keyboard.press(key)
            settle(page)
            after = state(page)
            assert after['referencesComputed'] == 1 and after['reference'] == before['reference'], (key, after['reference'])
        page.keyboard.press('Home')
        settle(page)
        assert state(page)['mode'] == 'gpu'
        page.keyboard.press('Alt+ArrowLeft')
        settle(page)
        assert state(page)['referencesComputed'] == 1 and state(page)['mode'] == 'perturb', state(page)['referencesComputed']
        suite.record('Pans, zooms and history return reuse one exact reference orbit', before['reference'])

        # 10. Continuous deep zoom session from 10^11 towards 10^20 with live frames.
        open_app(page, f'v=1&x={PLUME[0]}&y={PLUME[1]}&s={PLUME[2]}&q=1', 'perturb')
        box = page.locator('#viewport').bounding_box()
        page.mouse.move(box['x'] + box['width'] * 0.55, box['y'] + box['height'] * 0.45)
        frames0 = state(page)['interactiveFrames']
        span0 = Decimal(state(page)['view']['span'])
        for _ in range(56):
            page.mouse.wheel(0, -200)
            page.wait_for_timeout(45)
        settle(page)
        info = state(page)
        assert Decimal(info['view']['span']) < span0 / Decimal(10 ** 8), info['view']
        assert info['interactiveFrames'] - frames0 >= 8, info['interactiveFrames']
        assert info['mode'] == 'perturb' and info['lastCompleted']['width'] == 480
        assert len(info['references']) <= 6
        suite.record('Continuous wheel zoom over eight decades keeps live perturbation frames', {'span': info['view']['span'][:40], 'frames': info['interactiveFrames'] - frames0, 'references': len(info['references'])})
        page.screenshot(path=str(OUT / 'deep-session.png'))

        # 11. CPU engine renders deep views at full resolution with FP64 perturbation.
        info = open_app(page, f'v=1&x={ABYSS[0]}&y={ABYSS[1]}&s={ABYSS[2]}&e=cpu&n=512', 'cpu-perturb')
        assert info['lastCompleted']['width'] == 480 and sum(info['lastCompleted']['counts']) == info['lastCompleted']['width'] * info['lastCompleted']['height']
        suite.record('CPU FP64 perturbation completes every pixel at full resolution', info['lastCompleted']['counts'])

        # 12. Exact mode remains available as a slow per-pixel check.
        info = open_app(page, 'v=1&x=0.500000000000000000000000000001&y=0&s=1e-30&e=exact&n=128', 'exact')
        assert info['lastCompleted']['width'] <= 72
        suite.record('Exact per-pixel mode still renders deep views', info['lastCompleted']['width'])
        suite.no_errors()
        browser.close()


run(suite, body)
