"""WebGPU + parallel Worker qualification on an HTTP(S) origin, with CSP intact.
The launch flags request software Vulkan; this is not a hardware GPU qualification.
"""
import hashlib,json,os
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/review-output';OUT.mkdir(exist_ok=True)
BASE=os.environ.get('TETRA_BASE_URL','http://127.0.0.1:4173').rstrip('/')
checks=[];errors=[]
report={'origin':BASE,'bundle_sha256':hashlib.sha256((ROOT/'dist/index.html').read_bytes()).hexdigest(),
        'limitations':['Software Vulkan/SwiftShader; no physical GPU or Safari validation.']}
def record(name,detail=None):
 checks.append({'name':name,'passed':True,'detail':detail});print('PASS',name,detail or '',flush=True)
def ready(page,mode=None):
 page.wait_for_selector('body[data-complete="true"]'+('[data-mode="'+mode+'"]' if mode else ''),state='attached',timeout=90000)
def state(page):return page.evaluate('tetraDiagnostics')
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox','--enable-unsafe-swiftshader','--enable-unsafe-webgpu','--use-angle=swiftshader','--use-vulkan=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface'])
  report['browser_version']=browser.version
  context=browser.new_context(viewport={'width':1000,'height':720})
  context.add_init_script('''(() => {
   window.__devices=[];
   if(globalThis.GPUAdapter){const original=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...args){const d=await original.apply(this,args);__devices.push(d);return d;};}
  })()''')
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'#v=1&x=0.5&y=0&s=0.1&n=64')
  page.wait_for_function('() => tetraDiagnostics.webgpuStatus!=="pending"');ready(page,'gpu')
  assert state(page)['backend']=='webgpu',state(page)
  report['adapter']=page.evaluate('''async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture,description:a.info.description};}''')
  record('Qualified WebGPU is the application renderer',report['adapter'])
  pixels=page.evaluate('''async()=>{
   const r=await TetraWebGPU.create(document.createElement('canvas'));const out=[];
   for(let palette=0;palette<3;palette++)for(const [x,y] of [[.5,0],[.01,0],[2,0],[0,0],[.5,.25]]){
    const actual=await r.pixel(x,y,palette),o=TetraCore.orbit64(x,y,512);out.push({x,y,palette,actual,expected:TetraCore.color(o.kind,o.steps,palette)});
   }r.destroy();return out;
  }''')
  for pixel in pixels:
   assert pixel['actual'][3]==255 and max(abs(a-b) for a,b in zip(pixel['actual'],pixel['expected']))<=1,pixel
  record('15 WebGPU reference pixels match FP64 across all palettes',pixels)
  page.wait_for_timeout(250)
  with page.expect_download() as event:page.locator('#exportBtn').click()
  event.value.save_as(str(OUT/'webgpu-export.png'))
  with Image.open(OUT/'webgpu-export.png') as img:
   actual=img.convert('RGB').getpixel((img.width//2,img.height//2));assert actual==(18,18,18),actual
  record('WebGPU PNG retains completed image after presentation',actual)
  page.screenshot(path=str(OUT/'webgpu-desktop.png'))
  # Start an asynchronous partial export, then navigate before it resolves.
  page.evaluate('''() => {window.__exportLabels=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(typeof text==='string'&&(text.startsWith('TETRA /')||text.startsWith('Re ')))__exportLabels.push(text);return fill.call(this,text,...args)};}''')
  with page.expect_download() as event:
   page.evaluate("document.querySelector('#zoomIn').click();document.querySelector('#exportBtn').click();document.querySelector('#homeBtn').click()")
  event.value.save_as(str(OUT/'webgpu-partial-export.png'))
  with Image.open(OUT/'webgpu-partial-export.png') as img:
   assert img.convert('RGB').getpixel((img.width//2,img.height//2))==(18,18,18)
  labels=page.evaluate('__exportLabels');assert any('PARTIAL PREVIEW' in t for t in labels) and 'Re 0.5  Im 0  Span 0.05' in labels,labels
  ready(page,'gpu');assert state(page)['view']['span']=='7'
  record('A partial WebGPU export freezes its pixels and coordinates across navigation',labels)
  page.evaluate("window.__bitmap=window.createImageBitmap;window.createImageBitmap=undefined;location.hash='v=1&x=0.5&y=0&s=0.1&n=64'")
  page.wait_for_function("tetraDiagnostics.view.span==='0.1'");ready(page,'gpu')
  with page.expect_download() as event:page.locator('#exportBtn').click()
  event.value.save_as(str(OUT/'webgpu-fallback-export.png'))
  with Image.open(OUT/'webgpu-fallback-export.png') as img:
   assert img.convert('RGB').getpixel((img.width//2,img.height//2))==(18,18,18)
  page.evaluate('() => {window.createImageBitmap=window.__bitmap;}')
  record('WebGPU preserves export pixels when createImageBitmap is unavailable')
  page.locator('#settingsBtn').click();page.locator('#engine').select_option('cpu');ready(page,'cpu')
  cpu=state(page);assert cpu['poolLimit']>=1 and cpu['workerTransfer']=='bitmap',cpu
  assert sum(cpu['lastCompleted']['counts'])==cpu['lastCompleted']['width']*cpu['lastCompleted']['height']
  record('Parallel FP64 completes every pixel through OffscreenCanvas transfer',cpu)
  page.locator('#engine').select_option('big');page.wait_for_timeout(35)
  page.locator('#engine').select_option('auto');page.locator('#closeSettings').click();ready(page,'gpu');assert state(page)['backend']=='webgpu'
  record('Cancelled parallel high-precision work cannot overwrite WebGPU')
  page.evaluate('__devices[0].destroy()')
  page.wait_for_function('() => tetraDiagnostics.webgpuStatus==="lost"');ready(page,'gpu')
  assert state(page)['backend']=='webgl2',state(page)
  record('Actual WebGPU device destruction falls back to WebGL2')
  page.evaluate('document.querySelector("#gpuCanvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()')
  ready(page,'cpu');record('Subsequent WebGL2 context loss falls back to parallel FP64')
  context.close()
  # Exercise feature-unavailable paths independently of the enhanced browser.
  for name,init in [
   ('No WebGPU, OffscreenCanvas or scheduler',"Object.defineProperty(navigator,'gpu',{get:()=>undefined});"),
   ('Single active Worker quota',"Object.defineProperty(navigator,'gpu',{get:()=>undefined});const Old=Worker;let active=0;window.Worker=class extends Old{constructor(...args){if(active>=1)throw Error('quota');super(...args);active++;this.closed=false;}terminate(){if(!this.closed){active--;this.closed=true;}super.terminate();}};")]:
   fallback=browser.new_context(viewport={'width':800,'height':600})
   # Remove worker-only APIs from the blob source to test the real pixel-buffer path.
   fallback.add_init_script(init+'''const OriginalBlob=Blob;window.Blob=class extends OriginalBlob{constructor(parts,options){super(options?.type==='text/javascript'?['self.OffscreenCanvas=undefined;self.scheduler=undefined;\\n',...parts]:parts,options)}};''')
   pg=fallback.new_page();pg.on('pageerror',lambda e:errors.append(str(e)))
   pg.goto(BASE+'#v=1&x=0.5&y=0&s=0.1&n=64&e=cpu');ready(pg,'cpu')
   assert state(pg)['workerTransfer']=='pixels',state(pg)
   record(name+' uses transferable pixel buffers and timer yield',state(pg)['lastCompleted']['counts'])
   fallback.close()
  assert not errors,errors;record('No uncaught browser exceptions')
  browser.close();report['passed']=True
except Exception as error:
 report['passed']=False;report['failure']=str(error);raise
finally:
 report['checks']=checks;report['count']=len(checks);report['uncaught_errors']=errors
 (OUT/'browser-modern.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
