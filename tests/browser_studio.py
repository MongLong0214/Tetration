"""Motion contracts on the served, CSP-protected offline build. Independent decode.

Synthetic encoding is a media-path test, not qualification of moving fractal FX.
No codec support skips are counted as successful output. ffmpeg/ffprobe are QA
tools on the host, never runtime dependencies of the application.
"""
import json
import shutil
import subprocess
from playwright.sync_api import sync_playwright
from browser_common import BASE, OUT, Suite, launch, graphics


ENCODE = r"""async ({width,height,fps,container,slow}) => {
 const encoder=TetraStudioEncoder, N=2*fps;
 const support=await encoder.probe({width,height,fps,container,frameCount:N});
 if(!support.supported)return {support};
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{alpha:false}),sink=await encoder.createSink(canvas,support.config);
 const draw=k=>{
  const colors=['#e02020','#20d040','#2040e0'];
  colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i*width/3,0,width/3,height);});
  ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,width,height/8);
  ctx.fillStyle='#101010';ctx.fillRect(0,7*height/8,width,height/8);
  // Eight byte-identifying cells (white/black) across the middle of each frame.
  for(let bit=0;bit<8;bit++){ctx.fillStyle=(k&(1<<bit))?'#eeeeee':'#101010';ctx.fillRect(bit*width/8,height*0.45,width/8,height*0.1);}
 };
 for(let k=0;k<N;k++){
  draw(k);const timestampUs=Math.round(1e6*k/fps);
  await sink.addFrame({timestampUs,durationUs:Math.round(1e6*(k+1)/fps)-timestampUs});
  if(slow)await new Promise(resolve=>setTimeout(resolve,40));
 }
 const result=await sink.finish(),url=URL.createObjectURL(result.blob);
 const link=document.createElement('a');link.href=url;link.download='synthetic.'+result.extension;document.body.append(link);link.click();link.remove();
 // Download has captured the Blob; release URL when this task returns to the host.
 window.__studioTestURL=url;
 canvas.width=1;canvas.height=1;
 return {support,submittedFrames:result.submittedFrames,durationUs:result.durationUs,mimeType:result.mimeType,extension:result.extension,bytes:result.bytes,encoderConfig:result.encoderConfig};
}"""


def inspect_video(path, width, height, fps):
    metadata = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format',
        '-show_frames', '-of', 'json', str(path)], text=True))
    video = [s for s in metadata['streams'] if s['codec_type'] == 'video']
    assert len(video) == 1 and len(metadata['streams']) == 1, metadata['streams']
    stream = video[0]
    assert (stream['width'], stream['height']) == (width, height), stream
    assert int(stream['nb_read_frames']) == fps * 2, stream
    assert abs(float(metadata['format']['duration']) - 2) <= 0.002, metadata['format']
    frames = metadata['frames']
    pts = [float(f['best_effort_timestamp_time']) for f in frames]
    assert len(pts) == 2 * fps and all(b > a for a, b in zip(pts, pts[1:])), pts
    assert all(abs(t - k / fps) <= 0.002 for k, t in enumerate(pts)), pts
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
                                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    stride = width * height * 3
    assert len(raw) == stride * 2 * fps, len(raw)

    def pixel(k, x, y):
        start = k * stride + (int(y * height) * width + int(x * width)) * 3
        return tuple(raw[start:start + 3])

    for k in range(2 * fps):
        # Inspect every input ID, not just first/end or HTMLVideoElement metadata.
        decoded_id = sum((1 << bit) for bit in range(8)
                         if sum(pixel(k, (bit + 0.5) / 8, 0.5)) > 384)
        assert decoded_id == k, (k, decoded_id)
        assert min(pixel(k, 0.5, 0.05)) > 200, (k, 'top')
        assert max(pixel(k, 0.5, 0.95)) < 40, (k, 'bottom')
        for channel, x in enumerate([1 / 6, 0.5, 5 / 6]):
            color = pixel(k, x, 0.25)
            assert color[channel] > 150 and all(v < 100 for c, v in enumerate(color) if c != channel), color
    return {'codec': stream['codec_name'], 'width': width, 'height': height,
            'frames': len(pts), 'duration': metadata['format']['duration'],
            'pts_first': pts[0], 'pts_last': pts[-1], 'bytes': path.stat().st_size,
            'all_frame_ids_and_color_orientation': True}


def run():
    assert shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Install ffmpeg for independent QA decode'
    suite = Suite('studio', ['Synthetic encoding does not qualify fractal camera/FX or physical iPhone/Safari.',
                             'Collector byte cap is not an overall process RAM guarantee.'])
    try:
        with sync_playwright() as playwright:
            browser = launch(playwright)
            suite.report['browser'] = browser.version
            context = browser.new_context(accept_downloads=True)
            page = suite.watch(context.new_page())
            external = []
            page.on('request', lambda request: external.append(request.url)
                    if not request.url.startswith(BASE) and not request.url.startswith(('blob:', 'data:')) else None)
            page.goto(BASE)
            page.wait_for_function('() => typeof TetraStudioEncoder !== "undefined"')
            suite.report['graphics'] = graphics(page)
            page.set_default_timeout(180000)
            source_checks = page.evaluate('''async () => {
             const canvas=document.createElement('canvas'),gpu=new TetraGPU(canvas),rows=[];
             try {
              for(const samples of [4,16]){
               const project=TetraStudioModel.createProject({x:'-0.5',y:'0',span:'8'});
               project.output.samples=samples;project.numerics.iterations='fixed';project.numerics.fixedIterations=1024;
               const size={width:160,height:90},session=await TetraStudioRender.prepare(project,{renderer:gpu,size});
               const actual=await session.renderBase(0),data=gpu.readFrame(actual.frame);
               const expected=gpu.beginFrame(160,90),scene={mode:'direct',center:[-0.5,0],span:8,iterations:1024,palette:0,rules:TetraCore.RULES.gpu,aspect:90/160};
               gpu.draw(expected,{x:0,y:0,width:160,height:90},scene,samples,0);await gpu.fence();
               const reference=gpu.readFrame(expected);let different=0,wrongAlpha=0;
               for(let n=0;n<data.length;n++){if(data[n]!==reference[n])different++;if(n%4===3&&data[n]!== (samples===4?64:255))wrongAlpha++;}
               actual.release();gpu.releaseFrame(expected);
               const cached=await session.renderBase(299);cached.release();const diagnostic=session.diagnostics();
               rows.push({samples,different,wrongAlpha,diagnostic});await session.dispose();
              }
              const project=TetraStudioModel.createProject({x:'-2.2930579295624999999999991',y:'0.33208044555625',span:'0.02'});
              project.shot.motion='travel';project.shot.frameCount=60;project.shot.end.span='5e-11';
              const session=await TetraStudioRender.prepare(project,{renderer:gpu,size:{width:96,height:64}}),hashes=new Map();
              const hash=bytes=>{let h=2166136261;for(const b of bytes)h=Math.imul(h^b,16777619);return h>>>0;};
              for(const k of [0,1,2,25,26,27,58,59]){const handle=await session.renderBase(k);hashes.set(k,{hash:hash(gpu.readFrame(handle.frame)),descriptor:handle.descriptor});handle.release();}
              let mismatches=0;for(const k of [59,25,0,58,2,27,1,26]){const handle=await session.renderBase(k),value={hash:hash(gpu.readFrame(handle.frame)),descriptor:handle.descriptor};if(JSON.stringify(value)!==JSON.stringify(hashes.get(k)))mismatches++;handle.release();}
              rows.push({seekMismatches:mismatches,diagnostic:session.diagnostics(),descriptors:session.numerical.descriptors});await session.dispose();
             }finally{gpu.releaseAll();gpu.destroy();canvas.width=canvas.height=1;}
             return rows;
            }''')
            assert all(row.get('different', 0) == 0 and row.get('wrongAlpha', 0) == 0
                       and row.get('seekMismatches', 0) == 0 for row in source_checks), source_checks
            suite.record('Actual GPU complete AA4/16 and reference-consistent random seek', source_checks)
            support = page.evaluate('''async () => {
             const values=[];
             for(const resolution of [720,1080])for(const aspect of ['16:9','9:16','1:1'])for(const fps of [24,30]){
              const size=TetraStudioModel.dimensions({resolution,aspect});
              const result=await TetraStudioEncoder.probe({...size,resolution,fps,container:'mp4'});
              values.push({resolution,aspect,fps,...result});
             }return values;
            }''')
            suite.record('Exact 720/1080 × three aspects × 24/30 configuration probes', support)
            success = 0
            for width, height, fps, container, slow in [
                    (320, 180, 30, 'mp4', True), (720, 720, 24, 'mp4', False),
                    (1080, 1920, 30, 'mp4', False), (320, 180, 30, 'webm', False)]:
                # Check support before expecting a download; unsupported is evidence of its own.
                available = page.evaluate('async c => TetraStudioEncoder.probe(c)',
                                          {'width': width, 'height': height, 'fps': fps, 'container': container})
                if not available['supported']:
                    suite.record('Unsupported output configuration is reported', available)
                    continue
                with page.expect_download() as download:
                    result = page.evaluate(ENCODE, dict(width=width, height=height, fps=fps,
                                                       container=container, slow=slow))
                path = OUT / f'studio-synthetic-{width}x{height}-{fps}.{result["extension"]}'
                download.value.save_as(path)
                metadata = inspect_video(path, width, height, fps)
                assert metadata['codec'] == ('h264' if container == 'mp4' else 'vp9'), metadata
                signature = path.read_bytes()[:16]
                assert (signature[4:8] == b'ftyp') if container == 'mp4' else (signature[:4] == b'\x1aE\xdf\xa3')
                assert result['mimeType'] == 'video/' + ('mp4' if container == 'mp4' else 'webm')
                suite.record('Actual encode and independent decode', {'input': result, 'decoded': metadata})
                playback = page.evaluate('''async () => {
                 const video=document.createElement('video');video.src=window.__studioTestURL;
                 await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('Blob preview failed under CSP'));});
                 const result={width:video.videoWidth,height:video.videoHeight,duration:video.duration,paused:video.paused};
                 video.removeAttribute('src');video.load();URL.revokeObjectURL(window.__studioTestURL);delete window.__studioTestURL;return result;
                }''')
                assert (playback['width'], playback['height']) == (width, height) and playback['paused'], playback
                suite.record('Blob preview allowed by CSP without autoplay', playback)
                success += container == 'mp4'
            suite.report['actual_mp4_successes'] = success
            assert success > 0, 'No actual MP4 succeeded; unsupported checks do not certify video output'
            assert not external, external
            suite.record('No external runtime fetch under production CSP')
            page.evaluate('navigator.serviceWorker.ready')
            page.reload()
            page.wait_for_function('() => !!navigator.serviceWorker.controller')
            context.set_offline(True)
            page.reload()
            page.wait_for_function('() => typeof TetraStudioEncoder !== "undefined"')
            assert page.evaluate('TetraStudioModel.serialize(TetraStudioModel.createProject({x:"0",y:"0",span:"1"})).length') > 0
            suite.record('Offline reload retains model and committed encoder bytes')
            suite.no_errors()
            browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    run()
