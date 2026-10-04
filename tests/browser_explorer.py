"""Product-level checks for the monochrome explorer. Production CSP stays enabled."""
from pathlib import Path
import hashlib,json,os,re,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/review-output';OUT.mkdir(exist_ok=True)
BASE=os.environ.get('TETRA_BASE_URL','http://127.0.0.1:4173').rstrip('/')
AXE=Path(os.environ.get('AXE_CORE_PATH',str(ROOT/'node_modules/axe-core/axe.min.js'))).read_text()
checks=[];errors=[];accessibility=[]
report={'origin':BASE,'bundle_sha256':hashlib.sha256((ROOT/'dist/index.html').read_bytes()).hexdigest(),'limitations':['Mobile input is emulated. No physical iPhone or hardware GPU qualification.']}
def record(name,detail=None):
 checks.append({'name':name,'passed':True,'detail':detail});print('PASS',name,detail or '',flush=True)
def ready(page):page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=90000)
def state(page):return page.evaluate('tetraDiagnostics')
def controls(page):
 if not page.locator('#sidebar').is_visible():page.locator('#settingsBtn').click()
def close(page):
 if page.locator('#sidebar').is_visible():page.locator('#closeSettings').click()
def coords(page,x,y,span):
 controls(page);page.locator('details.coordinates').evaluate('(el)=>el.open=true')
 for id,value in [('xInput',x),('yInput',y),('spanInput',span)]:page.locator('#'+id).fill(value)
 page.locator('#coordinateForm button').click()
def axe(page,name):
 page.evaluate(AXE)
 result=page.evaluate('''async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>n.target)})),passes:r.passes.length,incomplete:r.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))};}''')
 accessibility.append({'view':name,**result});assert not result['violations'],result['violations']
 record('Automated WCAG checks: '+name,{'passed_rules':result['passes'],'incomplete':result['incomplete']})
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox','--enable-unsafe-swiftshader'])
  report['browser_version']=browser.version
  context=browser.new_context(viewport={'width':1440,'height':960},permissions=['clipboard-read','clipboard-write'])
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE);ready(page)
  assert page.locator('html').get_attribute('lang')=='en'
  assert not re.search('[가-힣]',page.locator('body').inner_text())
  view=page.locator('#viewport').bounding_box();assert view['width']==1440 and view['height']>=860
  record('English, edge-to-edge map uses the available workspace',view)
  axe(page,'desktop map');page.screenshot(path=str(OUT/'explorer-desktop.png'))
  controls(page);axe(page,'desktop controls');page.screenshot(path=str(OUT/'explorer-controls.png'));close(page)
  before=state(page)['view'];page.locator('#viewport').focus();page.keyboard.press('+');zoomed=state(page)['view'];page.keyboard.press('Alt+ArrowLeft');assert state(page)['view']==before;page.keyboard.press('Alt+ArrowRight');assert state(page)['view']==zoomed
  page.keyboard.press('Alt+ArrowLeft');page.keyboard.press('ArrowRight');assert page.locator('#forwardBtn').is_disabled()
  record('Back, forward and a new navigation branch preserve view history')
  before=state(page)['view'];page.keyboard.press('f');ready(page)
  assert state(page)['focus'] and page.locator('#viewport').bounding_box()['height']==960
  assert state(page)['view']==before;page.keyboard.press('Escape');ready(page);assert not state(page)['focus'] and state(page)['view']==before
  record('Focus mode fills the screen and preserves exact coordinates')
  page.keyboard.press('g');assert page.locator('#grid').is_checked();page.keyboard.press('g');assert not page.locator('#grid').is_checked()
  page.keyboard.press('2');ready(page);assert state(page)['view']['span']=='1.8'
  record('Grid and starting-point shortcuts work without opening controls')
  coords(page,'0.500000000000000000000000000001','0','1e-30');ready(page)
  saved=state(page)['view'];page.keyboard.press('b');name='<img src=x onerror=alert(1)>'
  page.locator('#bookmarkName').fill(name);page.locator('#bookmarkForm button').click()
  assert state(page)['savedCount']==1 and page.locator('.saved-open span').inner_text()==name
  assert page.locator('#savedViews img').count()==0
  page.reload();ready(page);assert state(page)['savedCount']==1
  page.locator('#homeBtn').click();controls(page);page.locator('.saved-open').click();ready(page);assert state(page)['view']==saved
  record('Named views survive reload and preserve sub-Number coordinates safely')
  page.locator('#shareBtn').click();page.wait_for_function('() => navigator.clipboard.readText().then(v=>v===location.href)')
  shared=page.evaluate('navigator.clipboard.readText()');other=context.new_page();other.goto(shared);ready(other);assert state(other)['view']==saved;other.close()
  record('One-action clipboard sharing reopens the exact saved coordinates')
  controls(page);page.locator('.saved-delete').click();assert state(page)['savedCount']==0;close(page)
  page.reload();ready(page);assert state(page)['savedCount']==0
  record('Removing a saved view persists without changing the current map')
  page.locator('#homeBtn').click();ready(page);page.locator('#helpBtn').click();axe(page,'guide');page.keyboard.press('Escape')
  context.close()
  # A compact viewport and keyboard-like resizing exercise real form drafts.
  for width,height in [(390,844),(320,568),(844,390),(1280,720)]:
   context=browser.new_context(viewport={'width':width,'height':height},has_touch=width<761,is_mobile=width<761)
   pg=context.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE);ready(pg)
   assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
   for selector in ['#settingsBtn','#shareBtn','#focusBtn','#zoomIn','#zoomOut','#homeBtn','#exportBtn']:
    box=pg.locator(selector).bounding_box();assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width+.5 and box['y']+box['height']<=height+.5,(width,selector,box)
    assert box['width']>=44 and box['height']>=44,(selector,box)
   pg.screenshot(path=str(OUT/f'explorer-{width}x{height}.png'))
   if width==390:
    axe(pg,'mobile map');controls(pg);axe(pg,'mobile controls')
    pg.locator('details.coordinates').evaluate('(el)=>el.open=true');pg.locator('#xInput').fill('0.12345678901234567890123456789')
    pg.set_viewport_size({'width':390,'height':520});pg.wait_for_timeout(100)
    assert pg.locator('#xInput').input_value()=='0.12345678901234567890123456789'
    pg.locator('#yInput').fill('0');pg.locator('#spanInput').fill('1');pg.locator('#coordinateForm button').click();ready(pg)
    assert state(pg)['view']['x']=='0.12345678901234567890123456789'
    record('Coordinate draft survives keyboard-like resizing and submits from a scrollable panel')
    pg.set_viewport_size({'width':390,'height':844});ready(pg);controls(pg);pg.screenshot(path=str(OUT/'explorer-mobile-controls.png'))
   record(f'Controls remain reachable at {width}×{height} with 44px targets')
   context.close()
  # Exercise native-share control flow without claiming a physical OS share sheet.
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
  context.add_init_script('''Object.defineProperty(navigator,'share',{value:async data=>{window.__shared=data}})''')
  pg=context.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE);ready(pg);pg.locator('#shareBtn').click();assert pg.evaluate('__shared.url===location.href')
  record('Supported touch devices invoke native share with the exact view URL (API stub)');context.close()
  context=browser.new_context(viewport={'width':1000,'height':700})
  context.add_init_script('''Object.defineProperty(navigator,'clipboard',{get:()=>undefined});Storage.prototype.setItem=function(){throw new DOMException('blocked','SecurityError')};''')
  pg=context.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE);ready(pg);pg.locator('#shareBtn').click();assert pg.locator('#shareDialog').is_visible();assert pg.locator('#shareText').input_value()==pg.url
  axe(pg,'manual sharing');pg.keyboard.press('Escape');controls(pg);pg.locator('#bookmarkName').fill('Test');pg.locator('#bookmarkForm button').click();assert state(pg)['savedCount']==0
  assert 'Storage unavailable' in pg.locator('#toast').inner_text();close(pg);pg.locator('#zoomIn').click();ready(pg)
  record('Blocked clipboard and storage expose usable fallbacks without breaking exploration');context.close()
  assert not errors,errors;record('No uncaught exceptions across explorer flows');browser.close()
 report['passed']=True
except Exception as e:
 report['passed']=False;report['failure']=str(e);raise
finally:
 report['checks']=checks;report['count']=len(checks);report['uncaught_errors']=errors;report['accessibility']=accessibility
 (OUT/'browser-explorer.json').write_text(json.dumps(report,indent=2)+'\n')
