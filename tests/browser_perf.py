"""Performance and resource budgets on software WebGL2 (SwiftShader on a CPU runner).
Hardware GPUs are typically one to two orders of magnitude faster; these bounds catch
regressions in scheduling, main-thread blocking and resource leaks, not device speed."""
import statistics
from browser_common import *
from playwright.sync_api import sync_playwright

suite = Suite('perf', ['SwiftShader timings on a shared CPU runner; budgets are regression bounds, not device forecasts.'])
OBSERVE = '''(() => {
  window.__perf = {ready: null, longTasks: []};
  new MutationObserver(() => { if (!__perf.ready && document.body.dataset.ready === 'true') __perf.ready = performance.now(); })
    .observe(document, {subtree: true, attributes: true, attributeFilter: ['data-ready']});
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) __perf.longTasks.push(Math.round(e.duration)); }).observe({type: 'longtask', buffered: true}); } catch {}
})()'''


def frame_gaps(page, action):
    page.evaluate('() => { window.__gaps=[]; window.__measure=true; let prev=performance.now(); const tick=t=>{ if(!__measure) return; __gaps.push(t-prev); prev=t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }')
    action()
    gaps = page.evaluate('() => { __measure=false; return __gaps; }')
    return sorted(gaps)


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        page = suite.watch(browser.new_page(viewport={'width': 960, 'height': 640}))
        page.add_init_script(NO_WEBGPU)
        page.add_init_script(OBSERVE)
        started = time.time()
        open_app(page, 'v=1&x=-2.5&y=0&s=1.8&q=4')
        first = page.evaluate('__perf.ready')
        total = time.time() - started
        assert first is not None and first < 3000, first
        suite.record('First image appears quickly after navigation', {'first_frame_ms': round(first), 'complete_s': round(total, 2)})
        long_tasks = page.evaluate('__perf.longTasks')
        assert not long_tasks or max(long_tasks) < 400, long_tasks
        suite.record('Initial render keeps the main thread responsive', {'long_tasks_ms': long_tasks[:12]})
        # Shallow exploration never compiles the deep-zoom (BLA) program.
        page.wait_for_timeout(3000)
        assert not state(page)['blaReady'], 'BLA program compiled outside perturbation depths'
        suite.record('Shallow views never compile the deep-zoom (BLA) program')
        # The plain perturbation program is used once in a quiet moment, so the first deep frame does not compile it.
        page.wait_for_function('() => tetraDiagnostics.perturbWarm', timeout=20000)
        long_tasks = page.evaluate('__perf.longTasks')
        assert not long_tasks or max(long_tasks) < 400, long_tasks
        suite.record('Shallow views prepare the perturbation program in a quiet moment')

        box = page.locator('#viewport').bounding_box()
        cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2

        def drag():
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(60):
                page.mouse.move(cx + (i % 30) * 4 - 60, cy + (i % 20) * 3 - 30)
                page.wait_for_timeout(30)
            page.mouse.up()

        frames0 = state(page)['interactiveFrames']
        gaps = frame_gaps(page, drag)
        frames = state(page)['interactiveFrames'] - frames0
        p95 = gaps[int(len(gaps) * .95)] if gaps else None
        assert frames >= 25, frames
        assert p95 is not None and p95 < 120, p95
        suite.record('Shallow drag: live frames and display cadence', {'frames_in_2s': frames, 'frame_gap_p95_ms': round(p95, 1), 'median_ms': round(statistics.median(gaps), 1)})
        settle(page)

        # A close-up can need perturbation without having any useful BLA levels.
        # Its idle preparation must not compile an unused large deep-zoom shader.
        open_app(page, 'v=1&x=-2.2930579&y=0.3320804&s=0.00025&q=4', 'perturb')
        assert state(page)['bla']['levels'] == 0
        page.wait_for_timeout(3500)
        idle = state(page)
        assert not idle['blaReady'] and not idle['blaCompile']['pending'], idle['blaCompile']
        suite.record('The Bloom close-up does not compile BLA when its table has no valid levels')

        # At perturbation depth the BLA program is prepared in a quiet moment, without long tasks.
        open_app(page, 'v=1&x=-2.2930579295624999999999991&y=0.33208044555625&s=5e-11&q=1', 'perturb')
        page.evaluate('() => { __perf.longTasks.length = 0; }')
        page.wait_for_function('() => tetraDiagnostics.blaReady', timeout=30000)
        long_tasks = page.evaluate('__perf.longTasks')
        assert not long_tasks or max(long_tasks) < 400, long_tasks
        suite.record('Deep-zoom (BLA) program compiles in a quiet moment at perturbation depth', {'long_tasks_ms': long_tasks[:12]})

        open_app(page, 'v=1&x=-0.605137938972379900971816986088586258864125&y=0.437740442074800562969426507709712806289976004723289995229&s=7e-25&q=1', 'perturb')
        frames0 = state(page)['interactiveFrames']
        gaps = frame_gaps(page, drag)
        frames = state(page)['interactiveFrames'] - frames0
        p95 = gaps[int(len(gaps) * .95)]
        assert frames >= 15 and p95 < 150, (frames, p95)
        live = state(page)
        suite.record('Deep (10^25) drag keeps live perturbation frames', {'frames_in_2s': frames, 'frame_gap_p95_ms': round(p95, 1), 'live_size': live['liveSize'], 'interleave': live['liveInterleave']})
        settle(page)

        def wheel():
            page.mouse.move(cx, cy)
            for _ in range(10):
                page.mouse.wheel(0, -120)
                page.wait_for_timeout(40)
            page.wait_for_function('() => !tetraDiagnostics.animating')

        gaps = frame_gaps(page, wheel)
        p95 = gaps[int(len(gaps) * .95)]
        assert p95 < 120, p95
        suite.record('Smooth wheel zoom keeps display cadence', {'frames': len(gaps), 'frame_gap_p95_ms': round(p95, 1)})
        settle(page)

        info = open_app(page, 'v=1&x=-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206&y=0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475&s=7e-100&q=1', 'perturb')
        assert info['reference']['elapsed'] < 3000, info['reference']
        suite.record('Exact 10^100 reference orbit (6,144 steps, 140 digits) computes in a Worker', info['reference'])

        # At 10^100 bilinear approximation keeps live frames as fluid as at 10^25.
        assert info['bla'] and info['bla']['levels'] > 0 and info['bla']['compiled'], info['bla']
        frames0 = state(page)['interactiveFrames']
        gaps = frame_gaps(page, drag)
        frames = state(page)['interactiveFrames'] - frames0
        p95 = gaps[int(len(gaps) * .95)]
        # Grid-locked live frames are re-used while a move stays within one live pixel, so fewer
        # draws are needed for the same motion; the display cadence (p95) is the smoothness measure.
        assert frames >= 12 and p95 < 150, (frames, p95)
        live = state(page)
        suite.record('Deep (10^100) drag keeps live BLA perturbation frames', {'frames_in_2s': frames, 'frame_gap_p95_ms': round(p95, 1), 'complete_s': round(info['lastCompleted']['elapsed'] / 1000, 1), 'live_size': live['liveSize'], 'interleave': live['liveInterleave'], 'bla': info['bla']})
        settle(page)

        # Resource stability across a long exploration session.
        open_app(page, 'v=1&x=-2.5&y=0&s=1.8&q=4')
        cdp = page.context.new_cdp_session(page)
        cdp.send('HeapProfiler.collectGarbage')
        heap0 = page.evaluate('performance.memory ? performance.memory.usedJSHeapSize : 0')
        page.locator('#viewport').focus()
        keys = ['+', '+', 'ArrowRight', '-', 'ArrowUp', '+', 'ArrowLeft', '-', '-', 'ArrowDown']
        for i in range(60):
            if i % 15 == 14:
                page.keyboard.press(str(1 + (i // 15) % 4))
            else:
                page.keyboard.press(keys[i % len(keys)])
            if i % 5 == 4:
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.mouse.move(cx + 40, cy + 15, steps=4)
                page.mouse.up()
            page.wait_for_timeout(35)
        settle(page)
        cdp.send('HeapProfiler.collectGarbage')
        heap1 = page.evaluate('performance.memory ? performance.memory.usedJSHeapSize : 0')
        info = state(page)
        assert info['gpuFrames'] <= 6 and info['gpuPooled'] <= 3, (info['gpuFrames'], info['gpuPooled'])
        assert info['workers'] <= info['poolLimit']
        assert heap1 - heap0 < 40 * 1024 * 1024, (heap0, heap1)
        suite.record('Sixty-action session keeps GPU textures, Workers and heap bounded',
                     {'live_gpu_frames': info['gpuFrames'], 'pooled': info['gpuPooled'], 'workers': info['workers'], 'heap_growth_mb': round((heap1 - heap0) / 2 ** 20, 2)})
        suite.no_errors()
        browser.close()


run(suite, body)
