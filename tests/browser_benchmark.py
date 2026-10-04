from pathlib import Path
import json,os,time,hashlib,argparse
parser=argparse.ArgumentParser(description="Controlled software-WebGL navigation measurement; not a hardware benchmark")
parser.add_argument("--result",default="tests/review-output/performance.json")
parser.add_argument("--image",default="tests/review-output/performance.png")
args=parser.parse_args()
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':1440,'height':960})
 page.add_init_script("Object.defineProperty(navigator,'gpu',{get:()=>undefined})")
 page.add_init_script("""window.__visualTimes={};document.addEventListener('DOMContentLoaded',()=>{function tick(){const d=window.tetraDiagnostics;if(d){if(document.body.dataset.ready==='true'&&!__visualTimes.preview_ms)__visualTimes.preview_ms=performance.now();if(d.renderStage==='antialias'&&!__visualTimes.native_ms)__visualTimes.native_ms=performance.now();if(d.complete){__visualTimes.complete_ms=performance.now();return;}}requestAnimationFrame(tick)}requestAnimationFrame(tick)});""")
 started=time.time();response=page.goto(os.environ.get('TETRA_BASE_URL','http://127.0.0.1:4173').rstrip('/')+'/#v=1&x=-0.2&y=0&s=7&n=256&q=4');page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=180000)
 result={'bundle_sha256':hashlib.sha256(response.body()).hexdigest(),'visual_times':page.evaluate('__visualTimes'),'browser':b.version,'initial_seconds':time.time()-started,'initial':page.evaluate('tetraDiagnostics'),'scope':'Chromium, ANGLE/SwiftShader, 1440x960, DPR 1. Mouse input through Playwright; not a hardware benchmark.'}
 page.screenshot(path=args.image)
 page.evaluate('''()=>{window.__gaps=[];window.__draws=0;let prev=performance.now();window.__measure=true;function frame(t){if(!__measure)return;__gaps.push(t-prev);prev=t;requestAnimationFrame(frame)}requestAnimationFrame(frame);const method=TetraGPU.prototype.paintTile?'paintTile':'render';const draw=TetraGPU.prototype[method];TetraGPU.prototype[method]=function(...a){__draws++;return draw.apply(this,a)}}''')
 page.mouse.move(700,400);page.mouse.down();t=time.time()
 for i in range(30):page.mouse.move(700+i*5,400+i*1.5)
 result['drag_seconds']=time.time()-t;result['drag_gpu_calls']=page.evaluate('__draws');page.mouse.up()
 gaps=page.evaluate('()=>{__measure=false;return __gaps}');result['frames']=len(gaps);result['frame_gap_p95_ms']=sorted(gaps)[int(len(gaps)*.95)] if gaps else None;result['frame_gap_max_ms']=max(gaps) if gaps else None
 page.wait_for_selector('body[data-complete="true"]',state='attached',timeout=180000);result['after']=page.evaluate('tetraDiagnostics')
 Path(args.result).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['initial','after']}));b.close()
