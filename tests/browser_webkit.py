"""Linux Playwright WebKit checks. This is not a physical Safari/iPhone test."""
from pathlib import Path
import hashlib,json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/review-output';OUT.mkdir(exist_ok=True)
BASE=os.environ.get('TETRA_BASE_URL','http://127.0.0.1:4173').rstrip('/')
checks=[];errors=[];report={'origin':BASE,'bundle_sha256':hashlib.sha256((ROOT/'dist/index.html').read_bytes()).hexdigest(),'limitations':['Linux WebKit with mobile viewport emulation; not physical Safari/iPhone.','CPU rendering path; not hardware GPU qualification.']}
def record(name,detail=None):
 checks.append({'name':name,'passed':True,'detail':detail});print('PASS',name,detail or '',flush=True)
def ready(page):page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=90000)
def state(page):return page.evaluate('tetraDiagnostics')
try:
 with sync_playwright() as p:
  browser=p.webkit.launch();report['browser_version']=browser.version
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
  context.add_init_script("Object.defineProperty(navigator,'clipboard',{get:()=>undefined});Object.defineProperty(navigator,'share',{value:undefined});")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'#v=1&x=0.5&y=0&s=0.1&n=64&e=cpu');ready(page);assert state(page)['mode']=='cpu'
  record('WebKit completes the production-CSP Worker render',state(page)['workerTransfer'])
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');record('Mobile viewport has no horizontal overflow')
  page.locator('#viewport').focus();before=state(page)['view'];page.keyboard.press('+');ready(page);assert state(page)['view']['span']=='0.05';page.keyboard.press('Alt+ArrowLeft');ready(page);assert state(page)['view']==before
  record('Keyboard zoom and history restore the view')
  page.locator('#settingsBtn').click();assert page.evaluate('document.activeElement.id')=='closeSettings';page.locator('#viewport').evaluate('(el)=>el.focus()');assert page.evaluate('!!document.activeElement.closest("#sidebar")')
  record('Native modal prevents background focus')
  page.locator('details.coordinates').evaluate('(el)=>el.open=true');page.locator('#xInput').fill('0.500000000000000000000000000001');page.set_viewport_size({'width':390,'height':520});page.wait_for_timeout(120);assert page.locator('#xInput').input_value()=='0.500000000000000000000000000001';page.locator('#spanInput').fill('1e-30');page.locator('#coordinateForm button').click();ready(page);assert state(page)['mode']=='big';exact=state(page)['view']
  record('A coordinate draft survives resize and enters high precision')
  page.set_viewport_size({'width':390,'height':844});page.locator('#settingsBtn').click();page.locator('#bookmarkName').fill('WebKit view');page.locator('#bookmarkForm button').click();assert state(page)['savedCount']==1;page.reload();ready(page);assert state(page)['savedCount']==1 and state(page)['view']==exact
  record('Saved coordinates and URL state survive reload')
  page.locator('#shareBtn').click();assert page.locator('#shareDialog').is_visible();assert page.locator('#shareText').input_value()==page.url;page.keyboard.press('Escape')
  record('Manual link sharing exposes the exact current URL')
  page.locator('#focusBtn').click();ready(page);assert state(page)['focus'];page.locator('#exitFocusBtn').click();ready(page);assert not state(page)['focus'] and state(page)['view']==exact
  record('Focus mode preserves deep coordinates')
  with page.expect_download() as event:page.locator('#exportBtn').click()
  event.value.save_as(str(OUT/'webkit-export.png'));assert (OUT/'webkit-export.png').read_bytes().startswith(b'\x89PNG\r\n\x1a\n');record('WebKit exports a PNG')
  page.screenshot(path=str(OUT/'webkit-mobile.png'));assert not errors,errors;record('No uncaught WebKit exceptions');browser.close()
 report['passed']=True
except Exception as e:
 report['passed']=False;report['failure']=str(e);raise
finally:
 report['checks']=checks;report['count']=len(checks);report['uncaught_errors']=errors
 (OUT/'browser-webkit.json').write_text(json.dumps(report,indent=2)+'\n')
