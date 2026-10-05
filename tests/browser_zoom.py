"""Reproduce iteration-dependent emergence with native zoom controls.

An odd-sized, single-sample canvas keeps its central sample at exactly the same
world coordinate. AA images sample areas and cannot serve as point oracles.
"""
from browser_common import *
from playwright.sync_api import sync_playwright

suite = Suite('zoom', ['One reproducible finite-orbit location; this does not certify every chaotic pixel or physical device.'])
X = '-2.2930579295428124999999991'
Y = '0.3320804455471875'
POINT = 'v=1&x=' + X + '&y=' + Y
PIXELS = (ROOT / 'tests/browser_pixels.js').read_text()


def center(page):
    return page.evaluate('''()=>{const s=document.getElementById(tetraDiagnostics.displayCanvas),c=document.createElement('canvas');
      c.width=s.width;c.height=s.height;const g=c.getContext('2d');g.drawImage(s,0,0);
      const pixel=g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
      if(pixel[3]!==255)throw Error('The displayed image must be opaque');return Array.from(pixel).slice(0,3);}''')


def near(page, actual, expected):
    if max(abs(a-b) for a,b in zip(actual,expected)) > 2:
        suite.report['failure_state'] = state(page)
        page.screenshot(path=str(OUT/f'{suite.name}-failure.png'))
    assert max(abs(a-b) for a,b in zip(actual,expected)) <= 2, (actual, expected)


def body():
    with sync_playwright() as p:
        browser = launch(p)
        suite.report['browser_version'] = browser.version
        page = suite.watch(browser.new_page(viewport={'width':481,'height':321}, device_scale_factor=1))
        page.emulate_media(reduced_motion='reduce')
        open_app(page, POINT+'&s=5e-11&n=auto&q=1')
        d = state(page)
        w,h = d['lastCompleted']['width'],d['lastCompleted']['height']
        assert w % 2 == h % 2 == 1 and d['mode'] == 'perturb' and d['quality'] == 1
        assert page.evaluate("document.querySelector('#gpuCanvas').getContext('webgl2').getError()") == 0
        suite.record('Completed presentation has no GL error, including the framebuffer copies')
        expected = page.evaluate('TetraCore.color(3,838,0,0,0)')
        page.evaluate(PIXELS.replace('window.__tetraPixels = {', 'window.__exactPoint=exactOrbit;window.__tetraPixels = {'))
        observations = page.evaluate('''([x,y])=>[80,120,180].map(digits=>({digits,
          short:__exactPoint(x,y,768,digits),long:__exactPoint(x,y,1024,digits)}))''', [X,Y])
        assert all(o['short']['kind']==0 and o['short']['steps']==768 and o['long']['kind']==3 and o['long']['steps']==838 for o in observations), observations
        suite.record('Independent decimal point orbits agree at 80/120/180 digits: unresolved at 768, threshold crossed at 838', observations)
        zooms=[]
        for step in range(9):
            d = state(page)
            assert d['complete'] and d['view']['x']==X and d['view']['y']==Y
            assert d['lastCompleted']['samples']==1 and d['iterationSetting']=='auto'
            rgb=center(page)
            if step<4:
                assert d['iterations']==768; near(page,rgb,[10,9,24])
            else:
                assert d['iterations']==1024; near(page,rgb,expected)
            zooms.append({'step':step,'span':d['view']['span'],'iterations':d['iterations'],'center':rgb})
            if step in [3,4]:
                page.screenshot(path=str(OUT/f'{suite.name}-auto-{step}.png'))
            if step<8:
                page.locator('#zoomIn').click();page.locator('#zoomIn').click();settle(page)
        suite.record('Native repeated zoom reproduces the point changing when Auto rises from 768 to 1024', zooms)

        open_app(page,POINT+'&s=5e-11&n=1024&q=1')
        for step in range(32):
            d=state(page)
            assert d['complete'] and d['view']['x']==X and d['view']['y']==Y and d['iterations']==d['iterationSetting']==1024
            near(page,center(page),expected)
            if step<31:
                page.locator('#zoomIn').click();page.locator('#zoomIn').click();settle(page)
        assert state(page)['referencesComputed']>1, state(page)
        suite.record('With 1024 fixed, the identical world point remains stable through 62 native zooms and reference refreshes')
        for span in ['1e-100','1e-200']:
            page.evaluate('(h)=>location.hash=h',POINT+'&s='+span+'&n=1024&q=1');settle(page)
            assert state(page)['complete'] and state(page)['mode']=='perturb'
            near(page,center(page),expected)
        suite.record('The same fixed-limit point remains stable at spans 1e-100 and 1e-200')
        # Identical camera and native Ultra sampling; only the iteration limit changes.
        for n in [512,1024]:
            open_app(page,POINT+'&s=1e-50&n='+str(n)+'&q=16')
            d=state(page);assert d['quality']==d['lastCompleted']['samples']==16 and d['lastCompleted']['iterations']==n
            near(page,center(page),[10,9,24] if n==512 else expected)
            page.screenshot(path=str(OUT/f'{suite.name}-same-camera-{n}.png'))
        suite.record('At the identical camera and Ultra AA, changing the limit alone changes an unresolved area to its observed threshold color')
        suite.no_errors();browser.close()


run(suite,body)
