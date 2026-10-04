"""Image quality and interaction evidence; software GPU is not hardware qualification."""
from pathlib import Path
import hashlib,json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/review-output';OUT.mkdir(exist_ok=True)
BASE=os.environ.get('TETRA_BASE_URL','http://127.0.0.1:4173').rstrip('/')
checks=[];errors=[];report={'bundle_sha256':hashlib.sha256((ROOT/'dist/index.html').read_bytes()).hexdigest(),'limitations':['Software WebGL2; one sampled camera for the image error comparison. No universal error or frame-rate bound.','Color flow is exercised briefly; this is not a five-hour thermal or memory soak.']}
def record(name,detail=None):checks.append({'name':name,'passed':True,'detail':detail});print('PASS',name,detail or '',flush=True)
def ready(page):page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=120000)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox','--enable-unsafe-swiftshader']);report['browser_version']=browser.version
  page=browser.new_page(viewport={'width':1280,'height':800},permissions=['clipboard-read','clipboard-write'])
  page.add_init_script("Object.defineProperty(navigator,'gpu',{get:()=>undefined})")
  page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE);ready(page)
  state=page.evaluate('tetraDiagnostics');assert state['lastCompleted']['width']==1280 and state['lastCompleted']['height']==710 and state['quality']==4
  record('Default detail reaches display resolution with adaptive four-sample edges',state['lastCompleted'])
  result=page.evaluate('''async()=>{
   const r=new TetraGPU(document.createElement('canvas')),view={x:'-.2',y:'0',span:'7'},n=192;
   function read(source){const c=document.createElement('canvas');c.width=source.width;c.height=source.height;const x=c.getContext('2d');x.drawImage(source,0,0);source.close?.();return x.getImageData(0,0,c.width,c.height).data;}
   const single=read(await r.render(view,n,n,256,0,true));
   const fine=read(await r.render(view,n*4,n*4,256,0,true));
   const base=r.beginFrame(n,n);for(const t of TetraRender.tiles(n,n,64))await r.paintTile(base,t,view,256,0,1);
   const tiled=read(await r.capture(base));let seamError=0;for(let i=0;i<single.length;i++)seamError=Math.max(seamError,Math.abs(single[i]-tiled[i]));
   const aa=r.beginFrame(n,n,base,true);for(const t of TetraRender.tiles(n,n,64))await r.paintTile(aa,t,view,256,0,4);
   const adaptive=read(await r.capture(aa));let rawError=0,aaError=0,changed=0;
   for(let y=0;y<n;y++)for(let x=0;x<n;x++){let differs=false;for(let c=0;c<3;c++){let target=0;for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++)target+=fine[((y*4+dy)*n*4+x*4+dx)*4+c]/16;const i=(y*n+x)*4+c;rawError+=(single[i]-target)**2;aaError+=(adaptive[i]-target)**2;if(single[i]!==adaptive[i])differs=true;}if(differs)changed++;}
   r.releaseFrame(aa);r.releaseFrame(base);r.gl.deleteProgram(r.program);r.gl.deleteTexture(r.empty);
   return {camera:view,reference:'16 samples per pixel, box averaged in JS',tile_max_channel_error:seamError,single_rmse:Math.sqrt(rawError/(n*n*3)),adaptive_rmse:Math.sqrt(aaError/(n*n*3)),changed_pixels:changed,total_pixels:n*n};
  }''')
  assert result['tile_max_channel_error']<=1,result;record('GPU-resident tiles agree with one full-frame draw without seams',result['tile_max_channel_error'])
  assert result['adaptive_rmse']<result['single_rmse']*.85,result;record('Adaptive antialiasing reduces image error against a 16-sample reference',result)
  page.evaluate('''()=>{window.__paints=0;const paint=TetraGPU.prototype.paintTile;TetraGPU.prototype.paintTile=function(...a){__paints++;return paint.apply(this,a)}}''')
  page.mouse.move(600,400);page.mouse.down()
  for i in range(15):page.mouse.move(600+i*6,400+i*2)
  assert page.evaluate('__paints')==0
  assert page.evaluate("getComputedStyle(document.querySelector('#gpuCanvas')).transform!=='none'")
  page.mouse.up();ready(page);record('Dragging reprojects the cached GPU image without orbit draws')
  page.locator('#settingsBtn').click();page.locator('#flow').check();page.locator('#closeSettings').click();before=page.evaluate('({calls:__paints,view:tetraDiagnostics.view,phase:tetraDiagnostics.colorPhase})');page.wait_for_timeout(500);after=page.evaluate('({calls:__paints,view:tetraDiagnostics.view,phase:tetraDiagnostics.colorPhase})')
  assert after['calls']==before['calls'] and after['view']==before['view'] and after['phase']>before['phase'];record('Color flow changes only presentation, without recomputing or moving coordinates')
  page.locator('#shareBtn').click();link=page.evaluate('navigator.clipboard.readText()');assert '&c=' in link and '&q=4' in link
  other=browser.new_page(viewport={'width':800,'height':600});other.add_init_script("Object.defineProperty(navigator,'gpu',{get:()=>undefined})");other.goto(link);ready(other)
  assert other.evaluate('tetraDiagnostics.view')==after['view'] and not other.evaluate('tetraDiagnostics.flow');other.close();record('A shared view retains quality and hue and opens without automatic motion')
  page.emulate_media(reduced_motion='reduce');page.wait_for_function('() => !tetraDiagnostics.flow');record('Reduced-motion preference changes stop active color flow')
  page.screenshot(path=str(OUT/'quality-desktop.png'))
  page.locator('#settingsBtn').click();page.locator('#engine').select_option('cpu');ready(page);page.locator('#closeSettings').click()
  page.evaluate('''()=>{const c=document.querySelector('#cpuCanvas');window.__cpuBefore=c.getContext('2d').getImageData(0,0,c.width,c.height);window.__workerPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(){};}''')
  page.mouse.move(550,350);page.mouse.down();page.mouse.move(650,390);page.mouse.up()
  page.wait_for_function('() => tetraDiagnostics.workers>0 && !tetraDiagnostics.complete');page.wait_for_timeout(100)
  cpuError=page.evaluate('''()=>{const c=document.querySelector('#cpuCanvas'),now=c.getContext('2d').getImageData(0,0,c.width,c.height);let error=0;for(let y=60;y<c.height-20;y+=7)for(let x=120;x<c.width-20;x+=7)for(let k=0;k<3;k++)error=Math.max(error,Math.abs(now.data[(y*c.width+x)*4+k]-__cpuBefore.data[((y-40)*c.width+x-100)*4+k]));return error;}''')
  assert cpuError<=1,cpuError;record('CPU keeps the reprojected camera while replacement Workers are pending',cpuError)
  page.evaluate('() => {Worker.prototype.postMessage=__workerPost;}');page.locator('#homeBtn').click();ready(page)
  assert not errors,errors;record('No uncaught exceptions in quality and motion flows');browser.close()
 report['passed']=True
except Exception as e:
 report['passed']=False;report['failure']=str(e);raise
finally:
 report['checks']=checks;report['count']=len(checks);report['uncaught_errors']=errors
 (OUT/'browser-quality.json').write_text(json.dumps(report,indent=2)+'\n')
