"""Reproducible browser regression checks. Requires Playwright + Chromium.
Keeps the production CSP enabled; never adds unsafe-eval just for the harness.
Set TETRA_BASE_URL for a real served URL, otherwise use the self-contained bundle.
"""
from pathlib import Path
from decimal import Decimal, getcontext
from importlib.metadata import version
import json, os, time
from playwright.sync_api import sync_playwright
getcontext().prec=270
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'review-output';OUT.mkdir(exist_ok=True)
HTML=(ROOT/'dist/index.html').read_text()
checks=[];errors=[];base_url=os.environ.get('TETRA_BASE_URL')
def record(name,detail=None):
 checks.append({'name':name,'passed':True,'detail':detail});print('PASS',name,detail or '',flush=True)
def ready(page):page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=90000)
def state(page):return page.evaluate('window.tetraDiagnostics')
def load(page,fragment=''):
 page.on('pageerror',lambda e:errors.append(str(e)))
 if base_url:page.goto(base_url+('#'+fragment if fragment else ''))
 else:
  if fragment:page.evaluate('(h)=>location.hash=h',fragment)
  page.set_content(HTML,wait_until='load')
 ready(page)
def coords(page,x,y,s):
 page.locator('details.coordinates').evaluate('(el)=>el.open=true')
 page.locator('#xInput').fill(x);page.locator('#yInput').fill(y);page.locator('#spanInput').fill(s);page.locator('#coordinateForm button').click()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1440,'height':960},accept_downloads=True)
 load(page);initial=state(page);record('Initial production-CSP render',initial['lastCompleted'])
 page.screenshot(path=str(OUT/'desktop.png'))
 # Untrusted scripts are blocked, rather than allowing unsafe-inline for the bundle.
 page.evaluate('window.__violations=[];document.addEventListener("securitypolicyviolation",e=>window.__violations.push(e.effectiveDirective));let s=document.createElement("script");s.textContent="window.__injected=true";document.body.appendChild(s)')
 page.wait_for_timeout(80);assert not page.evaluate('!!window.__injected');assert 'script-src-elem' in page.evaluate('window.__violations');record('CSP blocks unapproved inline JavaScript')
 page.evaluate('window.__violations=[];fetch("https://example.invalid/tetra-test").catch(()=>{})');page.wait_for_timeout(80);assert 'connect-src' in page.evaluate('window.__violations');record('CSP blocks outbound fetch')
 # Wheel anchor is invariant at normal depth.
 box=page.locator('#viewport').bounding_box();px=round(box['width']*.65);py=round(box['height']*.45);before=state(page)['view']
 def at(v):return Decimal(v['x'])+(Decimal(px)-Decimal(str(box['width']))/2)*Decimal(v['span'])/Decimal(str(box['width']))
 page.mouse.move(box['x']+px,box['y']+py);page.mouse.wheel(0,-180);page.wait_for_timeout(80);after=state(page)['view'];assert Decimal(after['span'])<Decimal(before['span']);assert abs(at(before)-at(after))<Decimal('1e-8');record('Wheel zoom preserves cursor anchor')
 before=state(page)['view'];page.mouse.move(box['x']+px,box['y']+py);page.mouse.down();page.mouse.move(box['x']+px+45,box['y']+py+20);page.mouse.up();after=state(page)['view'];assert Decimal(after['x'])<Decimal(before['x']);assert Decimal(after['y'])>Decimal(before['y']);record('Drag pans without changing scale')
 page.locator('#homeBtn').click();page.locator('#viewport').focus();page.keyboard.press('+');assert state(page)['view']['span']=='3.5';page.keyboard.press('Home');assert state(page)['view']['span']=='7';record('Keyboard zoom and reset')
 page.locator('.preset').nth(3).click();page.locator('#iterations').select_option('64');page.locator('[data-palette="1"]').click();ready(page);assert state(page)['view']['span']=='0.18';record('Preset, iterations, palette complete a render')
 page.locator('#grid').check();assert page.locator('#grid').is_checked();record('Coordinate grid')
 page.locator('#helpBtn').click();assert page.locator('#helpDialog').is_visible();assert page.locator('#helpDialog').get_attribute('aria-label');page.keyboard.press('Escape');record('Named explanation dialog and Escape')
 page.locator('#shareBtn').click();page.wait_for_timeout(80)
 if page.locator('#shareDialog').is_visible():
  assert 's=0.18' in page.locator('#shareText').input_value();page.locator('#shareDialog .close-dialog').first.click();record('Share fallback contains complete state URL')
 else:record('Clipboard branch returned without an uncaught error (contents not asserted)')
 with page.expect_download() as event:page.locator('#exportBtn').click()
 event.value.save_as(str(OUT/'export.png'));assert (OUT/'export.png').read_bytes().startswith(b'\x89PNG\r\n\x1a\n');record('PNG download is a PNG file')
 before=state(page)['view'];coords(page,'<script>','0','1');assert state(page)['view']==before;record('Invalid coordinates do not replace view')
 coords(page,'0.5','0','1e-30');ready(page);assert state(page)['mode']=='big';record('BigInt deep view completes')
 before=state(page)['view'];page.locator('#viewport').focus();page.keyboard.press('ArrowRight');after=state(page)['view'];assert Decimal(before['x'])<Decimal(after['x']);assert float(before['x'])==float(after['x']);record('Deep pan retains sub-Number coordinate change')
 page.locator('#homeBtn').click();page.locator('#engine').select_option('big');page.wait_for_timeout(30);page.locator('#engine').select_option('cpu');page.locator('#homeBtn').click();ready(page);assert state(page)['mode']=='cpu';assert state(page)['view']['span']=='7';record('Cancellation prevents stale BigInt tiles replacing CPU result')
 coords(page,'0.5','0','1e-200');ready(page);assert state(page)['digits']==240;record('Minimum span renders using 240 decimal places',state(page)['lastCompleted']['elapsed'])
 before=state(page)['view'];page.mouse.move(box['x']+px,box['y']+py);page.mouse.wheel(0,-180);page.wait_for_timeout(60);assert state(page)['view']==before;record('Minimum zoom boundary does not drift off-anchor')
 coords(page,'0.5','0','1e12');before=state(page)['view'];page.mouse.wheel(0,180);page.wait_for_timeout(60);assert state(page)['view']==before;record('Maximum zoom boundary does not drift off-anchor')
 page.close()
 # Hash rehydration is tested using an exact decimal, not Number conversion.
 page=browser.new_page(viewport={'width':800,'height':700});x='2.000000000000000000000000000001';load(page,'v=1&x='+x+'&y=0&s=1e-30&n=64&p=1&e=big&g=1');assert state(page)['view']['x']==x;assert state(page)['mode']=='big';record('Exact shared URL rehydration and render')
 previous=state(page)['view'];page.evaluate('location.hash="v=99&x=0&y=0&s=1"');page.wait_for_timeout(80);assert state(page)['view']==previous;record('Unsupported share schema does not replace current view');page.close()
 context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
 phone=context.new_page();load(phone);assert phone.evaluate('document.documentElement.scrollWidth<=innerWidth');phone.screenshot(path=str(OUT/'mobile.png'));record('Mobile layout: no horizontal overflow')
 assert phone.locator('#sidebar').evaluate('(el)=>el.inert');phone.locator('#iterations').evaluate('(el)=>el.focus()');assert phone.evaluate('document.activeElement.id')!='iterations';record('Closed mobile drawer cannot receive focus')
 phone.locator('#settingsBtn').click();phone.locator('#sidebar').evaluate('(el)=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})))');assert phone.locator('#sidebar').bounding_box()['x']>=-0.5;assert phone.evaluate('document.activeElement.id')=='closeSettings';assert phone.locator('#viewport').evaluate('(el)=>el.inert');assert phone.locator('.topbar').evaluate('(el)=>el.inert');record('Open mobile drawer moves focus and inerts background')
 phone.keyboard.press('Shift+Tab');assert phone.evaluate('document.activeElement.id')=='mobileHelpBtn';phone.keyboard.press('Tab');assert phone.evaluate('document.activeElement.id')=='closeSettings';record('Mobile drawer traps forward and reverse Tab')
 phone.screenshot(path=str(OUT/'mobile-settings.png'));phone.keyboard.press('Escape');assert phone.evaluate('document.activeElement.id')=='settingsBtn';assert phone.locator('#sidebar').evaluate('(el)=>el.inert');record('Escape closes drawer and restores focus')
 phone.locator('#settingsBtn').click();phone.locator('#mobileHelpBtn').click();assert phone.locator('#helpDialog').is_visible();phone.keyboard.press('Escape');record('Mobile explanation is reachable')
 session=context.new_cdp_session(phone)
 def touch(kind,points):session.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'id':i,'x':x,'y':y,'radiusX':3,'radiusY':3} for i,x,y in points]})
 before=state(phone)['view'];touch('touchStart',[(1,130,400),(2,250,400)]);touch('touchMove',[(1,100,400),(2,280,400)]);touch('touchEnd',[]);phone.wait_for_timeout(60);assert Decimal(state(phone)['view']['span'])<Decimal(before['span']);record('Real browser touch dispatch: pinch zoom')
 before=state(phone)['view'];touch('touchStart',[(1,180,410)]);touch('touchMove',[(1,215,435)]);touch('touchEnd',[]);phone.wait_for_timeout(60);assert Decimal(state(phone)['view']['x'])<Decimal(before['x']);record('Real browser touch dispatch: single finger pan')
 context.close();assert not errors,errors;record('No uncaught browser exceptions')
 report={'checks':checks,'count':len(checks),'browser_version':browser.version,'playwright':version('playwright'),'bundle_mode':'served URL' if base_url else 'set_content: not a deployed URL','gpu_in_browser':initial['mode']=='gpu','limitations':['Touch testing uses Chromium emulation, not physical iPhone/Safari.','No public HTTPS deployment was tested.','Untrusted script and network probes intentionally create CSP console messages.']};browser.close()
(OUT/'browser-review.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n');print('ALL',len(checks),'PASSED',flush=True)
