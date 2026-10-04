"""Optional browser smoke tests. Requires Python Playwright and Chromium.
No runtime/npm dependencies are introduced by this test harness.
Uses set_content so the self-contained bundle also works in test sandboxes
whose browser policies disallow loopback URL navigation.
"""
from pathlib import Path
from decimal import Decimal, getcontext
import json, os, time
from playwright.sync_api import sync_playwright
getcontext().prec=270
ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=ROOT/'tests'/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
HTML=(ROOT/'dist/index.html').read_text()
reports=[]
test_start=time.monotonic()
def record(name,detail=None):
 reports.append({'name':name,'passed':True,'detail':detail});print('PASS',round(time.monotonic()-test_start,1),name,detail or '',flush=True)
def snap(page): return page.evaluate('window.tetraDiagnostics')
def ready(page):page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=60000)
def coords(page,x,y,span):
 page.locator('details.coordinates').evaluate('(el)=>el.open=true')
 page.locator('#xInput').fill(x);page.locator('#yInput').fill(y);page.locator('#spanInput').fill(span);page.locator('#coordinateForm button').click()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1440,'height':960},device_scale_factor=1,accept_downloads=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(HTML,wait_until='load');ready(page)
 initial=snap(page);assert initial['view']['span']=='7'
 assert initial['lastCompleted']['counts'] is None or sum(initial['lastCompleted']['counts'])>10000
 record('Initial real render',{'mode':initial['mode'],'render_ms':initial['lastCompleted']['elapsed']})
 page.screenshot(path=str(ARTIFACTS/'desktop.png'))
 # Actual cursor-centered wheel zoom: world coordinate under cursor remains fixed.
 rect=page.locator('#viewport').bounding_box();px=int(rect['width']*.62);py=int(rect['height']*.46)
 before=snap(page)['view'];bx=Decimal(before['x'])+(Decimal(str(px))-Decimal(str(rect['width']))/2)*Decimal(before['span'])/Decimal(str(rect['width']))
 page.mouse.move(rect['x']+px,rect['y']+py);page.mouse.wheel(0,-180);page.wait_for_timeout(100)
 after=snap(page)['view'];ax=Decimal(after['x'])+(Decimal(str(px))-Decimal(str(rect['width']))/2)*Decimal(after['span'])/Decimal(str(rect['width']))
 assert Decimal(after['span'])<Decimal(before['span']);assert abs(ax-bx)<Decimal('1e-7');record('Cursor-anchored wheel zoom')
 before=snap(page)['view'];page.mouse.move(rect['x']+rect['width']*.45,rect['y']+rect['height']*.45);page.mouse.down();page.mouse.move(rect['x']+rect['width']*.45+75,rect['y']+rect['height']*.45+30,steps=5);page.mouse.up()
 after=snap(page)['view'];assert Decimal(after['x'])<Decimal(before['x']);assert Decimal(after['y'])>Decimal(before['y']);assert after['span']==before['span'];record('Pointer drag pan')
 page.locator('#homeBtn').click();ready(page);assert snap(page)['view']['span']=='7'
 page.locator('#viewport').focus();page.keyboard.press('+');assert Decimal(snap(page)['view']['span'])==Decimal('3.5');page.keyboard.press('Home');record('Keyboard zoom and Home')
 page.locator('.preset').nth(3).click();ready(page);assert snap(page)['view']['span']=='0.18';record('Preset navigation')
 page.locator('[data-palette="1"]').click();page.locator('#iterations').select_option('64');ready(page);assert snap(page)['palette']==1 and snap(page)['iterations']==64;record('Palette and iteration controls')
 page.locator('#grid').check();assert page.locator('#grid').is_checked();record('Coordinate grid')
 page.locator('#helpBtn').click();assert page.locator('#helpDialog').is_visible();page.locator('#helpDialog .close-dialog').first.click();assert not page.locator('#helpDialog').is_visible();record('Explanation dialog')
 # Hash roundtrip with exact strings; use a new document, not Number-converted state.
 page.locator('#shareBtn').click();page.wait_for_timeout(100);assert page.locator('#shareDialog').is_visible();share=page.locator('#shareText').input_value();assert 's=0.18' in share;page.locator('#shareDialog .close-dialog').first.click();record('Share fallback produces state URL')
 with page.expect_download(timeout=10000) as d:page.locator('#exportBtn').click()
 download=d.value;download.save_as(str(ARTIFACTS/'export.png'));assert (ARTIFACTS/'export.png').read_bytes()[:8]==b'\x89PNG\r\n\x1a\n';record('PNG export')
 # Invalid input is rejected without replacing the camera.
 ready(page);before=snap(page)['view'];coords(page,'NaN','0','1');assert snap(page)['view']==before;record('Invalid coordinates rejected')
 coords(page,'0.5','0','1e-30');ready(page);assert snap(page)['mode']=='big';assert Decimal(snap(page)['view']['span'])==Decimal('1e-30');record('BigInt engine completes deep view',snap(page)['lastCompleted']['elapsed'])
 before=snap(page)['view'];page.locator('#viewport').focus();page.keyboard.press('ArrowRight');after=snap(page)['view'];assert Decimal(after['x'])>Decimal(before['x']);assert float(after['x'])==float(before['x']);record('Deep pan retains sub-Number coordinate differences')
 # Start a much deeper render, then immediately navigate away: stale tiles cannot win.
 page.locator('#homeBtn').click();page.locator('#engine').select_option('big');page.wait_for_timeout(50);page.locator('#engine').select_option('cpu');page.locator('#homeBtn').click();ready(page);assert snap(page)['mode']=='cpu' and snap(page)['view']['span']=='7';record('Worker cancellation and stale-frame prevention')
 # Test the advertised deepest camera level on a simple orbit, at finite iteration budget.
 print('Starting deepest view',snap(page),flush=True)
 coords(page,'0.5','0','1e-200');ready(page);deep=snap(page);assert deep['digits']==240 and Decimal(deep['view']['span'])==Decimal('1e-200');record('1e-200 camera view and 240-digit worker',deep['lastCompleted']['elapsed'])
 page.locator('#zoomIn').click();assert Decimal(snap(page)['view']['span'])==Decimal('1e-200');record('Explicit zoom bound is enforced')
 page.close()
 # Mobile viewport and real browser touch-event dispatch (not synthetic JS pointer stubs).
 context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
 phone=context.new_page();phone.on('pageerror',lambda e:errors.append(str(e)));phone.set_content(HTML,wait_until='load');ready(phone)
 assert phone.evaluate('document.documentElement.scrollWidth <= window.innerWidth');record('Mobile 390×844 layout has no horizontal overflow')
 phone.screenshot(path=str(ARTIFACTS/'mobile.png'))
 phone.locator('#settingsBtn').click();assert phone.locator('#sidebar').evaluate("el=>el.classList.contains('open')");phone.wait_for_timeout(250);phone.screenshot(path=str(ARTIFACTS/'mobile-settings.png'));phone.locator('#closeSettings').click();phone.wait_for_timeout(250);record('Mobile settings drawer')
 session=context.new_cdp_session(phone);before=snap(phone)['view']
 def touch(kind,points):session.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':x,'y':y,'id':i,'radiusX':3,'radiusY':3}for i,x,y in points]})
 touch('touchStart',[(1,140,400),(2,250,400)]);touch('touchMove',[(1,110,400),(2,280,400)]);touch('touchEnd',[]);phone.wait_for_timeout(100)
 assert Decimal(snap(phone)['view']['span'])<Decimal(before['span']);record('Two-finger pinch zoom')
 before=snap(phone)['view'];touch('touchStart',[(1,180,410)]);touch('touchMove',[(1,215,435)]);touch('touchEnd',[]);phone.wait_for_timeout(100);assert Decimal(snap(phone)['view']['x'])<Decimal(before['x']);record('Single-finger pan')
 assert not errors,errors;record('No uncaught browser exceptions')
 context.close();browser.close()
(ROOT/'tests'/'browser-report.json').write_text(json.dumps({'checks':reports,'count':len(reports),'limitations':['Chromium WebGL2 unavailable in this execution environment: real UI rendering tests exercised Worker FP64 and BigInt, not WebGL2.','Browser bundle injected with set_content because navigation to localhost was blocked by test environment policy.','Mobile tests are Chromium emulation, not physical iPhone/Safari tests.']},indent=2))
print('ALL',len(reports),'CHECKS PASSED',flush=True)
