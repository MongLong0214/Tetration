"""Motion stability and immediate framing through the real GPU and public UI."""
from playwright.sync_api import sync_playwright
from browser_common import BASE, Suite, launch


def run():
    suite = Suite('studio-motion', ['Desktop automation; physical touch devices and every chaotic camera path are not qualified.'])
    try:
        with sync_playwright() as p:
            browser = launch(p)
            page = suite.watch(browser.new_page(viewport={'width': 1200, 'height': 800}))
            page.goto(BASE + '/#v=1&x=-2.2930579295625&y=0.33208044555625&s=0.02&n=auto&p=0&e=auto&g=0&q=4&c=0')
            result = page.evaluate('''async()=>{
              const M=TetraStudioModel,gpu=new TetraGPU(document.createElement('canvas')),W=128,H=72,size={width:W,height:H},rows=[];
              const project=M.createProject({x:'-2.2930579295625',y:'0.33208044555625',span:'0.02'});
              project.shot.motion='travel';project.shot.end.span='0.018';project.shot.end.x='-2.2928579295625';project.shot.frameCount=60;project.shot.easing='linear';
              const pixels=fx=>fx.canvas.getContext('2d').getImageData(0,0,W,H).data;
              function change(current,previous,old,camera){
               const ratio=Number(camera.span)/Number(old.span),dx=(Number(camera.x)-Number(old.x))/Number(old.span)*W,dy=-(Number(camera.y)-Number(old.y))/Number(old.span)*W;let sum=0,n=0;
               for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){
                const u=(x+.5-W/2)*ratio+W/2-.5+dx,v=(y+.5-H/2)*ratio+H/2-.5+dy;if(u<1||u>W-2||v<1||v>H-2)continue;
                const i=Math.floor(u),j=Math.floor(v),fx=u-i,fy=v-j;
                for(let c=0;c<3;c++){const at=(a,b)=>previous[(b*W+a)*4+c],value=(at(i,j)*(1-fx)+at(i+1,j)*fx)*(1-fy)+(at(i,j+1)*(1-fx)+at(i+1,j+1)*fx)*fy;sum+=Math.abs(current[(y*W+x)*4+c]-value);n++;}
               }return sum/n;
              }
              try{for(const samples of [4,16]){
               project.output.samples=samples;const render=await TetraStudioRender.prepare(project,{renderer:gpu,size}),raw=TetraStudioFX.createCompositor(gpu,size),smooth=TetraStudioFX.createCompositor(gpu,size);
               let previous=null,rawChange=0,smoothChange=0,spread=0;const started=performance.now();
               try{for(let k=0;k<32;k++){
                const base=await render.renderBase(k);try{
                 await raw.compose(base,{look:project.look,k});await smooth.compose(base,{look:project.look,k,motion:true,sequence:1});
                 const a=Uint8Array.from(pixels(raw)),b=Uint8Array.from(pixels(smooth));
                 if(previous){rawChange+=change(a,previous.a,previous.camera,base.camera);smoothChange+=change(b,previous.b,previous.camera,base.camera);}
                 for(let i=0;i<b.length;i+=4)spread+=Math.abs(b[i]-b[i+1])+Math.abs(b[i+1]-b[i+2]);
                 if(k===0&&a.some((v,i)=>v!==b[i]))throw Error('First motion frame changed');
                 previous={a,b,camera:base.camera};
                }finally{base.release();}
               }
               // A seek and a new sequence must discard history, rather than
               // smearing another view into this frame.
               const base=await render.renderBase(50);try{await raw.compose(base,{look:project.look,k:50});await smooth.compose(base,{look:project.look,k:50,motion:true,sequence:2});const a=pixels(raw),b=pixels(smooth);if(a.some((v,i)=>v!==b[i]))throw Error('Seek retained stale motion history');}finally{base.release();}
               const jump=await render.renderBase(51);try{
                await raw.compose(jump,{look:project.look,k:51});const expected=Uint8Array.from(pixels(raw));
                for(const [k,x]of [[51,'1e12'],[52,'-1e12']]){await smooth.compose({...jump,camera:{x,y:'0',span:'1e-200',rollDeg:0}},{look:project.look,k,motion:true,sequence:3});if(expected.some((v,i)=>v!==pixels(smooth)[i]))throw Error('Extreme jump poisoned the history transform');}
                await smooth.compose(jump,{look:project.look,k:51,motion:true,original:true});if(expected.some((v,i)=>v!==pixels(smooth)[i]))throw Error('Original used motion history');
               }finally{jump.release();}
               const edge=gpu.beginFrame(W,H);let edgeErrors=0;
               try{for(let k=0;k<8;k++){
                const bytes=new Uint8Array(W*H*4),boundary=W/2-k*.25;
                for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,value=x+.5>=boundary?255:0;bytes[i]=bytes[i+1]=bytes[i+2]=value;bytes[i+3]=255;}
                gpu.gl.bindTexture(gpu.gl.TEXTURE_2D,edge.texture);gpu.gl.texSubImage2D(gpu.gl.TEXTURE_2D,0,0,0,W,H,gpu.gl.RGBA,gpu.gl.UNSIGNED_BYTE,bytes);await gpu.fence();
                const source={complete:true,renderer:gpu,frame:edge,camera:{x:String(k*.25*8/W),y:'0',span:'8',rollDeg:0}};
                await smooth.compose(source,{look:project.look,k,motion:true,sequence:4});const actual=pixels(smooth);
                for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(Math.abs(x+.5-boundary)>2&&actual[(y*W+x)*4]!==bytes[(y*W+x)*4])edgeErrors++;
               }}finally{gpu.releaseFrame(edge);}if(edgeErrors)throw Error('Motion history blurred or trailed a crisp moving edge');
               rows.push({samples,rawChange:rawChange/31,smoothChange:smoothChange/31,ratio:smoothChange/rawChange,colourSpread:spread/(32*W*H),ms:performance.now()-started,diagnostics:smooth.diagnostics()});
               }finally{await raw.dispose();await smooth.dispose();await render.dispose();}
              }}finally{gpu.releaseAll();gpu.destroy();}return rows;
            }''')
            assert all(r['ratio'] < .5 and r['colourSpread'] > 15 and r['diagnostics']['motionPasses'] == 43 for r in result), result
            suite.record('Camera-aligned AA4/16 motion reduces variation without broad edge trails; first frame, seek, extreme jump and Original stay exact', result)
            page.click('#openStudioBtn')
            page.wait_for_function('()=>tetraStudioDiagnostics.preview?.displayedK===0 && !tetraStudioDiagnostics.preview.pending')
            page.wait_for_timeout(700)
            page.evaluate('''()=>{window.__prepareTimes=[];const prepare=TetraStudioRender.prepare;TetraStudioRender.prepare=async(...args)=>{const t=performance.now(),r=await prepare(...args);__prepareTimes.push(performance.now()-t);return r;};}''')
            # Delay orbit work to distinguish immediate feedback from waiting
            # for a completed frame. The completed source must remain intact.
            page.evaluate('''()=>{window.__delay=true;const prepare=TetraStudioRender.prepare;TetraStudioRender.prepare=async(...args)=>{if(__delay)await new Promise(r=>setTimeout(r,180));return prepare(...args);};}''')
            before = page.locator('#studioCanvas').evaluate('(canvas)=>canvas.toDataURL()')
            page.click('#studioZoomIn')
            after = page.locator('#studioCanvas').evaluate('(canvas)=>canvas.toDataURL()')
            assert before != after, 'Framing waited for delayed GPU work'
            page.wait_for_function('()=>!tetraStudioDiagnostics.preview.pending && JSON.stringify(tetraStudioDiagnostics.displayedCamera)===JSON.stringify(tetraStudioDiagnostics.draft)')
            page.evaluate('()=>{__delay=false;}')
            page.click('#studioZoomOut')
            page.wait_for_function('()=>!tetraStudioDiagnostics.preview.pending')
            timing = page.evaluate('()=>__prepareTimes')
            assert timing and max(timing) < 100, timing
            suite.record('Public zoom controls immediately reproject completed pixels while delayed GPU work refines; held planning stays under 100 ms', timing)
            page.click('#studioApply');page.click('#studioZoomIn');page.click('#studioApply');page.click('#studioPlay')
            page.wait_for_function('()=>tetraStudioDiagnostics.preview.displayedK>=3')
            state = page.evaluate('()=>tetraStudioDiagnostics')
            assert state['render']['completedFrames'] > 0 and state['fx']['motionPasses'] > 0, state
            assert max(state['requested']['width'], state['requested']['height']) <= 1024
            page.click('#studioPause')
            suite.record('Actual Start → End → Preview uses motion stability and bounded display-density resolution')
            page.close()
            page = suite.watch(browser.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=2))
            page.add_init_script('''window.__renders=[];window.__fxs=[];window.__abortedAtEntry=0;addEventListener('load',()=>{
             const prepare=TetraStudioRender.prepare;TetraStudioRender.prepare=async(...a)=>{if(a[1]?.signal?.aborted)__abortedAtEntry++;const r=await prepare(...a);__renders.push(r);return r;};
             const create=TetraStudioFX.createCompositor;TetraStudioFX.createCompositor=(...a)=>{const f=create(...a);__fxs.push(f);return f;};
            });''')
            page.goto(BASE);page.click('#openStudioBtn')
            page.wait_for_function('()=>tetraStudioDiagnostics.requested?.quality==="detailed" && !tetraStudioDiagnostics.preview.pending && tetraStudioDiagnostics.thumbnails.completed===tetraStudioDiagnostics.thumbnails.revision')
            page.evaluate('''()=>{window.__oldRender=__renders.filter(r=>r.plan.size.height>512&&r.diagnostics().cachedFrames===1).at(-1);const fx=__fxs.filter(f=>f.canvas.height>512).at(-1),dispose=fx.dispose;fx.dispose=async()=>{await dispose();throw Error('injected FX cleanup failure');};}''')
            page.click('#studioZoomIn')
            page.wait_for_function('()=>!tetraStudioDiagnostics.preview.pending && JSON.stringify(tetraStudioDiagnostics.displayedCamera)===JSON.stringify(tetraStudioDiagnostics.draft)')
            assert page.evaluate('()=>__oldRender.diagnostics().cachedFrames') == 0, 'FX cleanup failure skipped source cleanup'
            page.wait_for_function('()=>tetraStudioDiagnostics.requested.quality==="detailed" && !tetraStudioDiagnostics.preview.pending')
            page.evaluate('''()=>{const r=__renders.filter(r=>r.plan.size.height>512&&r.diagnostics().cachedFrames===1).at(-1),dispose=r.dispose;window.__disposalStarted=false;r.dispose=async()=>{__disposalStarted=true;await new Promise(resolve=>setTimeout(resolve,400));await dispose();};}''')
            page.click('#studioZoomOut');page.wait_for_function('()=>__disposalStarted');page.click('#studioZoomIn')
            page.wait_for_function('()=>__abortedAtEntry>0 && !tetraStudioDiagnostics.preview.pending && JSON.stringify(tetraStudioDiagnostics.displayedCamera)===JSON.stringify(tetraStudioDiagnostics.draft)')
            suite.record('FX cleanup failure still releases its source; input during delayed disposal aborts preparation before camera work')
            suite.no_errors()
            browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    run()
