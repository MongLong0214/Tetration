from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];html=(root/'dist/index.html').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':960});page.set_content(html);page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=20000);page.screenshot(path=str(root/'tests/artifacts/desktop.png'))
 page.close()
 context=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
 page=context.new_page();page.set_content(html);page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=15000);page.screenshot(path=str(root/'tests/artifacts/mobile.png'))
 page.locator('#settingsBtn').click();page.wait_for_timeout(220);page.locator('#mobileHelpBtn').click();assert page.locator('#helpDialog').is_visible();print('PASS mobile explanation access')
 context.close()
 page=b.new_page(viewport={'width':800,'height':700});expected='2.000000000000000000000000000001';fragment='v=1&x='+expected+'&y=0&s=1e-30&n=64&p=1&e=big&g=1'
 page.evaluate('(h)=>location.hash=h',fragment);page.set_content(html);state=page.evaluate('tetraDiagnostics');assert state['view']['x']==expected and state['iterations']==64 and state['palette']==1;print('PASS exact URL coordinate rehydration')
 page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=20000);assert page.evaluate('tetraDiagnostics.mode')=='big';print('PASS rehydrated high-precision render')
 b.close()
report=json.loads((root/'tests/browser-report.json').read_text());report['additional_checks']=[{'name':n,'passed':True}for n in ['Mobile explanation dialog is reachable','URL state rehydration preserves decimal coordinate strings','Rehydrated deep state completes BigInt render']];report['count']=len(report['checks'])+len(report['additional_checks']);(root/'tests/browser-report.json').write_text(json.dumps(report,indent=2))
