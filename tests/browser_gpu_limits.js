/* Native bounded-work probes. Float outputs compare finite machine states, not proofs. */
window.__gpuPhaseComparison = async()=>{
  const r=new TetraGPU(document.createElement('canvas')),nativeProgram=r.program.bind(r),probes={},rows=[];
  const rawProgram=name=>{
   if(probes[name])return probes[name];
   const original=nativeProgram(name);let src=TetraGPU.sources[name];
   src=src.slice(0,src.lastIndexOf('void main(){'))+'void main(){pixel=orbitColor(gl_FragCoord.xy+uOffset);}';
   src=src.replace('vec3 orbitColor','vec4 orbitColor').replace('return palette(kind,steps,w);','return vec4(w,float(kind),steps);').replaceAll('return palette(4,0.,vec2(0.));','return vec4(0.,0.,4.,0.);');
   return probes[name]=r.link(src,Object.keys(original.uniforms));
  };
  const views=[['-2.2930579295624999999999991','0.33208044555625','5e-11'],['-0.605137938972379900971816986088586258864125','0.437740442074800562969426507709712806289976004723289995229','7e-25'],['-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206','0.437740442074800562969426586669113155808012201307319340609925561376648113051190710894591896027315034323404945092475','7e-100']];
  for(const [x,y,s] of views)for(const blaMode of ['off','on'])for(const n of [8192,8193,16383,16384]){
   r.blaMode=blaMode;const f=createFixed(256),v={x:f.parse(x),y:f.parse(y),span:f.parse(s)},point=TetraRender.referencePoint(f,v);
   const ref=TetraReference.compute({x:f.text(point.x),y:f.text(point.y),digits:Math.min(256,Math.ceil(-Math.log10(Number(s)))+40),iterations:n,maxRe:80});
   const scene={...TetraRender.perturbScene(f,v,point.x,point.y),mode:'perturb',ref,iterations:n,palette:0,aspect:1,rules:TetraCore.RULES.gpu};
   const outputs=[];const timings=[];
   for(const cycle of [false,true]){
    r.program=name=>rawProgram(cycle?name:name.replace('Cycle',''));
    const frame=r.ultraFrames(16)[0],g=r.gl,t=performance.now();
    r.draw(frame,{x:0,y:0,width:16,height:16},scene,1);await r.fence();
    timings.push(performance.now()-t);const data=new Float32Array(16*16*4);
    r.refreshFrame(frame);g.bindFramebuffer(g.FRAMEBUFFER,frame.buffer);g.readPixels(0,0,16,16,g.RGBA,g.FLOAT,data);
    outputs.push(Array.from(new Uint32Array(data.buffer)));
   }
   let changed=0;for(let i=0;i<outputs[0].length;i++)if(outputs[0][i]!==outputs[1][i])changed++;
   rows.push({x,s,blaMode,n,changed,timings,outputs});
  }
  const error=r.gl.getError();for(const p of Object.values(probes))r.gl.deleteProgram(p.program);r.destroy();return {rows,error};
 };
window.__gpuPartialComparison = async(samples=16)=>{
  const r=new TetraGPU(document.createElement('canvas')),cases=[],W=48,H=30;
  r.program('perturb');
  for(const threshold of [0.035,0])for(const blaMode of ['off','on'])for(const n of [128,1024,4096])for(const mode of ['direct','perturb'])for(const adaptive of [false,true]){
   if(window.__traceKernels)console.log('AA_CASE',JSON.stringify({samples,threshold,blaMode,n,mode,adaptive}));
   r.blaMode=blaMode;
   const scene={mode,iterations:n,palette:0,aspect:H/W,rules:TetraCore.RULES.gpu};
   if(mode==='direct'){scene.center=[-1.84,.09];scene.span=.46;}
   else{
    const f=createFixed(256),v={x:f.parse('-2.2930579295624999999999991'),y:f.parse('0.33208044555625'),span:f.parse('5e-11')},point=TetraRender.referencePoint(f,v);
    Object.assign(scene,TetraRender.perturbScene(f,v,point.x,point.y));
    scene.ref=TetraReference.compute({x:f.text(point.x),y:f.text(point.y),digits:60,iterations:n,maxRe:80});
   }
   let seed=null;
   if(adaptive){seed=r.beginFrame(W,H);r.draw(seed,{x:0,y:0,width:W,height:H},scene,samples===4?1:4);await r.fence();}
   const a=r.beginFrame(W,H,seed,adaptive),b=r.beginFrame(W,H,seed,adaptive);
   // Keep the original bounded 8px baseline. Both paths now share the exact
   // orbit call site; only sample count and FP32 sum storage differ.
   for(let y=0;y<H;y+=8)for(let x=0;x<W;x+=8){r.draw(a,{x,y,width:Math.min(8,W-x),height:Math.min(8,H-y)},scene,samples,threshold);await r.fence();}
   const immediately=r.readFrame(a);
   // Production uses 64px partial tiles at 4096/16x and 32px at higher caps;
   // compare both sizes, including partial columns/heights, to the original.
   const edge=n===4096&&samples===16?64:32;
   for(let y=0;y<H;y+=edge)for(let x=0;x<W;x+=edge)await r.drawAATile(b,{x,y,width:Math.min(edge,W-x),height:Math.min(edge,H-y)},scene,()=>false,threshold,samples);
   const before=r.readFrame(a),after=r.readFrame(b);let changed=0,max=0,priorChanged=0;
   for(let i=0;i<before.length;i++)if(before[i]!==immediately[i])priorChanged++;
   for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);if(d)changed++;max=Math.max(max,d);}
   const channelChanged=[0,0,0,0];for(let i=0;i<before.length;i++)if(before[i]!==after[i])channelChanged[i%4]++;
   const cancelledFrame=r.beginFrame(W,H,seed,adaptive),cancelBefore=r.readFrame(cancelledFrame);
   const completed=await r.drawAATile(cancelledFrame,{x:0,y:0,width:8,height:8},scene,()=>true,threshold,samples);
   const cancelAfter=r.readFrame(cancelledFrame);let cancelChanges=0;
   for(let i=0;i<cancelBefore.length;i++)if(cancelBefore[i]!==cancelAfter[i])cancelChanges++;
   r.releaseFrame(cancelledFrame);
   cases.push({samples,threshold,blaMode,n,mode,adaptive,changed,max,priorChanged,cancelled:!completed,cancelChanges,channelChanged,before:Array.from(before),after:Array.from(after)});
   r.releaseFrame(a);r.releaseFrame(b);r.releaseFrame(seed);
  }
  const error=r.gl.getError();r.destroy();return {cases,error};
 };
window.__gpuAdaptiveMaskComparison = async()=>{
 const r=new TetraGPU(document.createElement('canvas')),g=r.gl,W=17,H=13,tile={x:0,y:0,width:W,height:H},rows=[];
 const scene={mode:'direct',center:[.5,0],span:.1,aspect:H/W,iterations:128,palette:0,rules:TetraCore.RULES.gpu};
 const nativeFence=r.fence.bind(r),nativeQuery=g.getQueryParameter.bind(g);let fences=0,results=0;
 r.fence=()=>{fences++;return nativeFence();};
 g.getQueryParameter=(q,p)=>{if(p===g.QUERY_RESULT)results++;return nativeQuery(q,p);};
 const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 for(const samples of [4,16]){
  const seed=r.beginFrame(W,H);r.refreshFrame(seed);g.bindFramebuffer(g.FRAMEBUFFER,seed.buffer);
  g.clearColor(.2,.3,.4,64/255);g.clear(g.COLOR_BUFFER_BIT);
  const a=r.beginFrame(W,H,seed,true),b=r.beginFrame(W,H,seed,true);
  r.draw(a,tile,scene,samples);await r.fence();const expected=r.readFrame(a),start=fences,q=results;
  const complete=await r.drawAATile(b,tile,scene,()=>false,.035,samples);
  const flat=complete&&fences===start&&results===q+1&&equal(expected,r.readFrame(b));
  const cancelled=!(await r.drawAATile(b,tile,scene,()=>true,.035,samples))&&equal(expected,r.readFrame(b));
  // Forced new pan strips must compute real samples even for a flat seed.
  const forcedStart=fences,forcedQuery=results;r.draw(a,tile,scene,samples,0);await r.fence();
  await r.drawAATile(b,tile,scene,()=>false,0,samples);
  const forced=fences===forcedStart+samples+2&&results===forcedQuery&&equal(r.readFrame(a),r.readFrame(b))&&!equal(expected,r.readFrame(b));
  r.releaseFrame(a);r.releaseFrame(b);
  // Reusing a pooled target must discard its prior all-flat result. A real
  // seed edge inside the tile must trigger the original sample computation.
  r.refreshFrame(seed);g.bindFramebuffer(g.FRAMEBUFFER,seed.buffer);g.enable(g.SCISSOR_TEST);g.scissor(8,6,1,1);
  g.clearColor(1,1,1,64/255);g.clear(g.COLOR_BUFFER_BIT);g.disable(g.SCISSOR_TEST);
  const edgeA=r.beginFrame(W,H,seed,true),edgeB=r.beginFrame(W,H,seed,true);r.draw(edgeA,tile,scene,samples);await r.fence();
  const edgeStart=fences;await r.drawAATile(edgeB,tile,scene,()=>false,.035,samples);
  const edgeExpected=r.readFrame(edgeA);
  const edge=fences===edgeStart+samples+1&&equal(edgeExpected,r.readFrame(edgeB));
  r.releaseFrame(edgeA);r.releaseFrame(edgeB);
  // An API error result cannot certify the tile as flat.
  const invalid=r.beginFrame(W,H,seed,true),invalidStart=fences;
  g.getQueryParameter=(q,p)=>p===g.QUERY_RESULT?null:nativeQuery(q,p);
  await r.drawAATile(invalid,tile,scene,()=>false,.035,samples);
  const invalidComputed=fences===invalidStart+samples+1;
  g.getQueryParameter=(q,p)=>{if(p===g.QUERY_RESULT)results++;return nativeQuery(q,p);};
  // A failed mask submission produces a real zero query result too. It
  // must not be accepted as proof that this nonflat seed needs no samples.
  const failed=r.beginFrame(W,H,seed,true),failedStart=fences,nativeProgram=r.program.bind(r),nativeDraw=g.drawArrays.bind(g);let current='';
  r.program=name=>{current=name;return nativeProgram(name);};
  g.drawArrays=(...args)=>nativeDraw(...(current==='adaptiveMask'?[g.TRIANGLES,0,-1]:args));
  await r.drawAATile(failed,tile,scene,()=>false,.035,samples);
  r.program=nativeProgram;g.drawArrays=nativeDraw;
  const failedComputed=fences===failedStart+samples+1&&equal(edgeExpected,r.readFrame(failed));
  rows.push({samples,flat,cancelled,forced,edge,invalidComputed,failedComputed});
  r.releaseFrame(failed);
  r.releaseFrame(invalid);r.releaseFrame(seed);
 }
 const error=g.getError();r.destroy();return {rows,error};
};
