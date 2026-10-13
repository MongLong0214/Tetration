"""Serial, same-browser product comparison; exact pixels before lossy encoding."""
import argparse
import base64
import json
import hashlib
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_common import launch, graphics, ready, browser_deadline

WORK = r'''async ({deep,hold}) => {
 const M=TetraStudioModel,canvas=document.createElement('canvas'),gpu=new TetraGPU(canvas);
 const compute=await TetraCompute.create();if(!compute)throw Error('WebGPU comparison unavailable');
 let builds=0;const build=TetraCore.blaTable;TetraCore.blaTable=(...a)=>{builds++;return build(...a);};
 const p=M.createProject(deep?{x:'-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206',y:'0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475',span:'7e-100'}:{x:'-2.5',y:'0',span:'1.8'});
 p.id='performance-shot';p.name='performance-shot';p.output={aspect:'16:9',resolution:720,samples:4,container:'mp4'};
 p.shot.fps=24;p.shot.frameCount=48;p.shot.motion=hold?'hold':'travel';p.shot.easing='linear';p.shot.end.span=deep?'3.5e-100':'0.9';
 const times={prepareMs:0,renderMs:0,fxMs:0,encodeMs:0,finalizeMs:0,cleanupMs:0},hashes=[],images={};
 const start=performance.now();let session,fx,sink,result,diagnostics;
 try{
  const support=await TetraStudioEncoder.probe({...M.dimensions(p.output),resolution:720,fps:24,container:'mp4',frameCount:48});if(!support.supported)throw Error(support.reason);
  session=await TetraStudioRender.prepare(p,{renderer:gpu,compute});fx=TetraStudioFX.createCompositor(gpu,M.dimensions(p.output));sink=await TetraStudioEncoder.createSink(fx.canvas,support.config);times.prepareMs=performance.now()-start;
  for(let k=0;k<48;k++){
   let t=performance.now();const frame=await session.renderBase(k);times.renderMs+=performance.now()-t;
   try{
    t=performance.now();await fx.compose(frame,{look:p.look,k,fps:24,rollDeg:session.plan.frames[k].camera.rollDeg});times.fxMs+=performance.now()-t;
    const bytes=fx.canvas.getContext('2d').getImageData(0,0,1280,720).data;
    hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join(''));
    if([0,24,47].includes(k))images[k]=fx.canvas.toDataURL('image/png').split(',')[1];
    t=performance.now();await sink.addFrame(M.timing(p,k));times.encodeMs+=performance.now()-t;
   }finally{frame.release();}
  }
  const t=performance.now();result=await sink.finish();times.finalizeMs=performance.now()-t;
  diagnostics={render:session.diagnostics(),fx:fx.diagnostics(),builds,computeSubmits:compute.batches};
  const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download='performance.mp4';link.click();window.__perfURL=url;
 }finally{
  const t=performance.now();await fx?.dispose();await session?.dispose();compute.destroy();gpu.releaseAll();gpu.destroy();TetraCore.blaTable=build;times.cleanupMs=performance.now()-t;
 }
 const info=compute.device.adapterInfo;
 return {project:p,backend:session.backend,adapter:info?{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:null,times,elapsedMs:performance.now()-start,hashes,images,diagnostics,bytes:result.bytes,submittedFrames:result.submittedFrames};
}'''


def inspect(path, images):
    meta = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_frames', '-show_format', '-of', 'json', str(path)], text=True))
    stream = meta['streams'][0]
    pts = [float(f['best_effort_timestamp_time']) for f in meta['frames']]
    assert int(stream['nb_read_frames']) == 48 and len(pts) == 48
    assert (stream['width'], stream['height']) == (1280, 720)
    assert all(abs(t-k/24) <= .002 for k, t in enumerate(pts))
    assert abs(float(meta['format']['duration'])-2) <= .002
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    errors = {}
    stride = 1280*720*3
    for key, image in images.items():
        png = path.with_name(path.stem+f'-{key}.png')
        png.write_bytes(base64.b64decode(image))
        expected = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(png), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
        actual = raw[int(key)*stride:(int(key)+1)*stride]
        errors[key] = sum(abs(a-b) for a, b in zip(expected, actual))/stride
        assert errors[key] < 40, errors  # Deep fine texture is lossy at the product AVC bitrate.
    return {'frames':len(pts), 'firstPTS':pts[0], 'lastPTS':pts[-1], 'duration':meta['format']['duration'], 'bytes':path.stat().st_size, 'decodedMeanAbsoluteRGBError':errors}


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origins', nargs='+', default=['http://127.0.0.1:4185', 'http://127.0.0.1:4184'])
    parser.add_argument('--output', default='/tmp/tetration-performance-before.json')
    args = parser.parse_args()
    report = {'runs':[]}
    with sync_playwright() as p:
        browser = launch(p)
        report['browser'] = browser.version
        for origin in args.origins:
            for deep, hold in [(False, False), (True, False), (False, True), (True, True)]:
                context = browser.new_context(accept_downloads=True, service_workers='block', viewport={'width':640,'height':480})
                page = context.new_page()
                page.goto(origin)
                ready(page)
                # Acquire/drain the app's View and leave its preview behind a
                # modal; the measured session is the only GPU workload.
                page.click('#openStudioBtn')
                page.click('#studioVideo')
                page.wait_for_selector('#studioExportDialog[open]')
                driver = graphics(page)
                bundle = hashlib.sha256(page.request.get(origin).body()).hexdigest()
                with page.expect_download(timeout=600000) as download, browser_deadline(600000):
                    row = page.evaluate(WORK, {'deep':deep,'hold':hold})
                path = Path(args.output).with_name(Path(args.output).stem+f'-{len(report["runs"])}.mp4')
                download.value.save_as(path)
                row.update(origin=origin, deep=deep, hold=hold, driver=driver, bundleSHA256=bundle, video=str(path))
                row['decoded'] = inspect(path, row.pop('images'))
                assert row['backend'] == 'webgpu' and row['submittedFrames'] == 48
                if hold: assert len(set(row['hashes'])) == 1
                else: assert len(set(row['hashes'])) > 1
                report['runs'].append(row)
                Path(args.output).write_text(json.dumps(report, indent=2)+'\n')
                print(json.dumps({k:v for k,v in row.items() if k not in ('project','hashes')}), flush=True)
                context.close()
        if len(args.origins) == 2:
            pairs = list(zip(report['runs'][:4], report['runs'][4:]))
            for baseline, modified in pairs:
                assert baseline['project'] == modified['project']
                assert baseline['backend'] == modified['backend'] and baseline['driver'] == modified['driver']
                assert baseline['adapter'] == modified['adapter']
                assert baseline['hashes'] == modified['hashes'], (baseline['deep'], baseline['hold'], 'pre-encode pixels changed')
            report['allPreEncodeHashesEqual'] = True
            Path(args.output).write_text(json.dumps(report, indent=2)+'\n')
        browser.close()


if __name__ == '__main__':
    run()
