"""Planned deep reference changes and branch-cut frames through the actual adapter."""
from playwright.sync_api import sync_playwright
from browser_common import BASE, Suite, launch


def run():
    suite = Suite('studio-deep', ['Small complete GPU frames inspect reference continuity, not every possible chaotic shot.'])
    try:
        with sync_playwright() as p:
            browser = launch(p)
            page = suite.watch(browser.new_page(viewport={'width': 1200, 'height': 800}))
            page.goto(BASE)
            rows = page.evaluate('''async () => {
             const M=TetraStudioModel,R=TetraStudioRender,C=TetraStudioCamera,gpu=new TetraGPU(document.createElement('canvas')),size={width:48,height:32},results=[];
             const hash=a=>{let h=2166136261;for(const b of a)h=Math.imul(h^b,16777619);return h>>>0;};
             const cases=[
              {name:'Horizon reference precision change',x:'-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206',y:'0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475',span:'7e-80',endSpan:'7e-100',cap:4096},
              {name:'Negative-axis branch crossing',x:'-2.5',y:'2e-10',endY:'-2e-10',span:'1e-9',endSpan:'1e-9',cap:512}
             ];
             try{for(const item of cases){
              const p=M.setDuration(M.createProject(item),2);p.shot.motion='travel';p.shot.end.span=item.endSpan;p.shot.end.y=item.endY||item.y;p.shot.easing='linear';p.numerics.iterations='fixed';p.numerics.fixedIterations=item.cap;
              const start=performance.now(),session=await R.prepare(p,{renderer:gpu,size}),firstUseful=[];
              const switches=session.numerical.descriptors.slice(1).map(d=>d.startFrame),indices=[...new Set([0,28,29,30,31,59,...switches.flatMap(k=>[k-1,k,k+1]).filter(k=>k<60)])].sort((a,b)=>a-b),reference=new Map();
              let freshDifferent=0;for(const k of indices){
               const frame=await session.renderBase(k),bytes=gpu.readFrame(frame.frame);if(!firstUseful.length)firstUseful.push(performance.now()-start);reference.set(k,{hash:hash(bytes),descriptor:frame.descriptor});frame.release();
               // A fresh same-camera shot chooses its own sufficient precision.
               // On these structured frames it must match the planned reference.
               const exact=M.validate(p);exact.shot.start=C.evaluateFrame(p,k).camera;exact.shot.end=exact.shot.start;exact.shot.motion='hold';
               const independent=await R.prepare(exact,{renderer:gpu,size}),check=await independent.renderBase(0),other=gpu.readFrame(check.frame);
               for(let i=0;i<bytes.length;i++)if(bytes[i]!==other[i])freshDifferent++;check.release();await independent.dispose();
              }
              let reorderDifferent=0;for(const k of [...indices].reverse()){
               const frame=await session.renderBase(k),value={hash:hash(gpu.readFrame(frame.frame)),descriptor:frame.descriptor};if(JSON.stringify(value)!==JSON.stringify(reference.get(k)))reorderDifferent++;frame.release();
              }
              results.push({name:item.name,switches,indices,freshDifferent,reorderDifferent,firstUsefulMs:firstUseful[0],diagnostics:session.diagnostics()});await session.dispose();
             }}finally{gpu.releaseAll();gpu.destroy();}return results;
            }''')
            assert rows[0]['switches'], rows
            assert all(r['freshDifferent'] == 0 and r['reorderDifferent'] == 0 for r in rows), rows
            suite.record('Deep reference-switch neighbours and branch crossing match fresh cameras byte for byte in both seek orders', rows)
            suite.no_errors()
            browser.close()
        suite.write(True)
    except Exception as error:
        suite.write(False, str(error))
        raise


if __name__ == '__main__':
    run()
