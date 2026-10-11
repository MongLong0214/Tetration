"""GPU compositor contracts on real RGBA8/16F targets and the production CSP."""
from playwright.sync_api import sync_playwright
from browser_common import BASE, Suite, launch, graphics


def run():
    suite = Suite('studio-fx', ['This browser run does not qualify physical iPhone/Safari.'])
    try:
        with sync_playwright() as p:
            browser = launch(p)
            page = suite.watch(browser.new_page())
            page.goto(BASE)
            suite.report['graphics'] = graphics(page)
            result = page.evaluate('''async () => {
             const M=TetraStudioModel,FX=TetraStudioFX,gpu=new TetraGPU(document.createElement('canvas')),gl=gpu.gl;
             const width=48,height=32,frame=gpu.beginFrame(width,height),bytes=new Uint8Array(width*height*4);
             for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;bytes.set([x*5,y*7,(x+y)*3,64],i);}
             gl.bindTexture(gl.TEXTURE_2D,frame.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);await gpu.fence();
             const source={complete:true,frame,renderer:gpu},compose=FX.createCompositor(gpu,{width,height}),look=M.neutralLook();
             const read=()=>compose.canvas.getContext('2d').getImageData(0,0,width,height).data;
             const compare=(a,b)=>{let different=0,max=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])different++;max=Math.max(max,Math.abs(a[i]-b[i]));}return {different,max};};
             const expected=new Uint8Array(bytes.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;expected.set(bytes.slice(((height-1-y)*width+x)*4,((height-1-y)*width+x)*4+3),i);expected[i+3]=255;}
             await compose.compose(source,{look});const neutral=compare(read(),expected);
             let project=FX.applyPreset(M.createProject({x:'0',y:'0',span:'1'}),'Prism Wave');
             await compose.compose(source,{look:project.look,k:17,original:true});const original=compare(read(),expected);
             project.look.amount=0;await compose.compose(source,{look:project.look,k:17});const zero=compare(read(),expected);
             const exposed=M.neutralLook();exposed.exposureEV=1;await compose.compose(source,{look:exposed});
             const exposureExpected=expected.map((v,i)=>i%4===3?255:Math.round(FX.linearToSrgb(Math.min(1,FX.srgbToLinear(v/255)*2))*255));
             const exposure=compare(read(),exposureExpected);
             const wave=M.neutralLook();wave.wave.enabled=true;wave.wave.strengthEV=.8;wave.wave.fieldCycles=2;wave.wave.speed=-.25;
             await compose.compose(source,{look:wave,k:19,fps:24});
             const waveExpected=expected.map((v,i)=>{if(i%4===3)return 255;const pixel=Math.floor(i/4),x=pixel%width,y=height-1-Math.floor(pixel/width),ev=FX.waveEV(wave,19/24,(x+.5)/width,(y+.5)/height,width,height);return Math.round(FX.linearToSrgb(Math.min(1,FX.srgbToLinear(v/255)*2**ev))*255);});
             const waveMatch=compare(read(),waveExpected);
             const rows=[];for(const name of FX.PRESET_NAMES){project=FX.applyPreset(project,name);await compose.compose(source,{look:project.look,k:17});rows.push({name,changed:compare(read(),expected).different});}
             project=FX.applyPreset(project,'Prism Wave');await compose.compose(source,{look:project.look,k:17});const first=Uint8Array.from(read());
             await compose.compose(source,{look:project.look,k:50});await compose.compose(source,{look:project.look,k:17});const ordered=compare(read(),first);
             const diagnostic=compose.diagnostics();await compose.dispose();gpu.releaseFrame(frame);gpu.releaseAll();gpu.destroy();
             return {neutral,original,zero,exposure,waveMatch,rows,ordered,diagnostic};
            }''')
            assert all(result[k]['different'] == 0 for k in ['neutral', 'original', 'zero', 'ordered']), result
            assert result['exposure']['max'] <= 1 and result['waveMatch']['max'] <= 1, result
            assert all(r['changed'] > 0 for r in result['rows'] if r['name'] != 'Neutral'), result
            assert result['diagnostic']['targets'] <= 5 and result['diagnostic']['programs'] == 5, result
            suite.record('Opaque byte identity, independent linear EV/Wave and deterministic preset GPU passes', result)
            geometry = page.evaluate('''async () => {
             const gpu=new TetraGPU(document.createElement('canvas')),gl=gpu.gl,FX=TetraStudioFX,C=TetraStudioCamera,rows=[];
             const lerp=(a,b,t)=>a+(b-a)*t;
             for(const [width,height]of [[48,32],[32,48],[40,40]])for(const rollDeg of [0,45,90]){
              const extent=C.sourceExtent(width,height,[rollDeg]),frame=gpu.beginFrame(extent.width,extent.height),bytes=new Uint8Array(extent.width*extent.height*4);
              for(let y=0;y<extent.height;y++)for(let x=0;x<extent.width;x++)bytes.set([Math.round(x*220/(extent.width-1)),Math.round(y*220/(extent.height-1)),40,255],(y*extent.width+x)*4);
              gl.bindTexture(gl.TEXTURE_2D,frame.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,extent.width,extent.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);await gpu.fence();
              const fx=FX.createCompositor(gpu,{width,height});await fx.compose({complete:true,renderer:gpu,frame},{look:TetraStudioModel.neutralLook(),rollDeg});const data=fx.canvas.getContext('2d').getImageData(0,0,width,height).data;
              let maxError=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){
               const world=C.screenToWorld({x:'0',y:'0',span:String(width),rollDeg},x+.5,y+.5,width,height),px=Math.max(0,Math.min(extent.width-1,Number(world.x)+extent.width/2-.5)),py=Math.max(0,Math.min(extent.height-1,Number(world.y)+extent.height/2-.5));
               const ax=Math.floor(px),ay=Math.floor(py),bx=Math.min(ax+1,extent.width-1),by=Math.min(ay+1,extent.height-1),sx=px-ax,sy=py-ay;
               for(let c=0;c<3;c++){const at=(xx,yy)=>bytes[(yy*extent.width+xx)*4+c],expected=Math.round(lerp(lerp(at(ax,ay),at(bx,ay),sx),lerp(at(ax,by),at(bx,by),sx),sy));maxError=Math.max(maxError,Math.abs(expected-data[(y*width+x)*4+c]));}
              }
              rows.push({width,height,rollDeg,maxError});await fx.dispose();gpu.releaseFrame(frame);
             }
             // All spatial taps, including samples outside the image, must use
             // reflected extension. A smooth field makes each channel observable.
             const width=48,height=32,frame=gpu.beginFrame(width,height),bytes=new Uint8Array(width*height*4);
             for(let y=0;y<height;y++)for(let x=0;x<width;x++)bytes.set([x*5,y*7,(x+y)*3,255],(y*width+x)*4);
             gl.bindTexture(gl.TEXTURE_2D,frame.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);await gpu.fence();
             const sample=(u,v)=>{const x=Math.max(0,Math.min(width-1,FX.mirror(u)*width-.5)),y=Math.max(0,Math.min(height-1,FX.mirror(v)*height-.5)),ax=Math.floor(x),ay=Math.floor(y),bx=Math.min(ax+1,width-1),by=Math.min(ay+1,height-1);return [0,1,2].map(c=>{const at=(xx,yy)=>bytes[(yy*width+xx)*4+c];return lerp(lerp(at(ax,ay),at(bx,ay),x-ax),lerp(at(ax,by),at(bx,by),x-ax),y-ay);});};
             const look=TetraStudioModel.neutralLook();Object.assign(look.kaleido,{enabled:true,blend:.7,segments:6,angleDeg:15});Object.assign(look.prism,{enabled:true,amount:.55,offsetRatio:.015});
             const folded=(u,v)=>{const a=sample(u,v),uv=FX.foldUV(u,v,width,height,6,15),b=sample(...uv);return a.map((value,c)=>lerp(value,b[c],.7));};
             const fx=FX.createCompositor(gpu,{width,height});await fx.compose({complete:true,renderer:gpu,frame},{look});const data=fx.canvas.getContext('2d').getImageData(0,0,width,height).data;let spatialError=0;
             for(let y=0;y<height;y++)for(let x=0;x<width;x++){const u=(x+.5)/width,v=(height-y-.5)/height,d=FX.prismOffset(u,v,width,height,.015),a=folded(u,v),split=[folded(u+d[0],v+d[1])[0],a[1],folded(u-d[0],v-d[1])[2]];for(let c=0;c<3;c++)spatialError=Math.max(spatialError,Math.abs(Math.round(lerp(a[c],split[c],.55))-data[(y*width+x)*4+c]));}
             await fx.dispose();const unsupported=FX.createCompositor(gpu,{width,height});gpu.floatColor=false;let floatError='';try{await unsupported.compose({complete:true,renderer:gpu,frame},{look});}catch(e){floatError=e.message;}await unsupported.compose({complete:true,renderer:gpu,frame},{look,original:true});await unsupported.dispose();gpu.releaseFrame(frame);gpu.releaseAll();gpu.destroy();return {rows,spatialError,floatError};
            }''')
            assert all(r['maxError'] <= 1 for r in geometry['rows']), geometry
            assert geometry['spatialError'] <= 1 and 'half-float' in geometry['floatError'], geometry
            suite.record('Roll 0/45/90 in all aspects, mirrored spatial sampling and explicit half-float rejection', geometry)
            suite.no_errors()
            browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    run()
