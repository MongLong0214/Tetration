/* Optional WebGPU FP32 preview. Qualified against stable FP64 reference pixels.
 * Finite observation only; this does not improve orbit precision over WebGL2. */
(function (root) {
 'use strict';
 const shader = `
 struct Params { size: vec2f, center: vec2f, span: f32, iterations: u32, palette: u32, samples: u32, offset: vec2f, adaptive:u32, pad:u32 }
 @group(0) @binding(0) var<uniform> u: Params;
 @group(0) @binding(1) var source:texture_2d<f32>;
 ${TetraCore.paletteWGSL}
 @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u),f32(i & 2u));
  return vec4f(p*2.-1.,0.,1.);
 }
 fn orbitColor(point:vec2f) -> vec3f {
  let offset = (point-u.size*.5)*(u.span/u.size.x);
  let c = u.center+vec2f(offset.x,-offset.y);
  let radius = length(c);
  if (radius < 1e-30) { return color(4u,0.,vec2f(0.)); }
  var arg = atan2(c.y,c.x);
  if (c.y == 0. && c.x < 0.) { arg = 3.141592653589793; }
  let l = vec2f(log(radius),arg);
  var w = vec2f(1.,0.); var old = vec2f(0.);
  var fixed = 0u; var period = 0u; var kind = 0u; var steps = f32(u.iterations);
  for (var i = 1u; i <= 1024u; i++) {
   if (i > u.iterations) { break; }
   let a = w.x*l.x-w.y*l.y; let b = w.x*l.y+w.y*l.x;
   if (a > 23.02585092994) {
    kind = 3u; steps = f32(i)+min(1.,(a-23.02585092994)/23.02585092994); break;
   }
   if (a < -80. || abs(b) > 1e6) { kind = 4u; steps = f32(i); break; }
   let r = exp(a); let next = r*vec2f(cos(b),sin(b)); let tolerance = 2e-6*(1.+r);
   fixed = select(0u,fixed+1u,length(next-w)<tolerance);
   period = select(0u,period+1u,i>2u && length(next-old)<tolerance);
   old=w;w=next;
   if (fixed >= 8u) { kind=1u;steps=f32(i);break; }
   if (period >= 12u) { kind=2u;steps=f32(i);break; }
  }
  return color(kind,steps,w);
 }
 @fragment fn fragment(@builtin(position) point:vec4f)->@location(0) vec4f{
  let p=point.xy+u.offset;
  if(u.samples==4u && u.adaptive==1u){
   let pixel=vec2i(point.xy);let size=vec2i(textureDimensions(source));let center=textureLoad(source,pixel,0).rgb;var contrast=0.;
   for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let delta=abs(center-textureLoad(source,clamp(pixel+vec2i(x,y),vec2i(0),size-1),0).rgb);contrast=max(contrast,max(delta.r,max(delta.g,delta.b)));}}
   if(contrast<.035){return vec4f(center,1.);}
  }
  if(u.samples==4u){return vec4f((orbitColor(p+vec2f(-.25,-.25))+orbitColor(p+vec2f(.25,-.25))+orbitColor(p+vec2f(-.25,.25))+orbitColor(p+vec2f(.25,.25)))*.25,1.);}
  return vec4f(orbitColor(p),1.);
 }`;
 class TetraWebGPU {
  static async create(canvas, onlost) {
   if (!root.isSecureContext || !navigator.gpu) throw Error('WebGPU unavailable');
   const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
   if (!adapter) throw Error('No WebGPU adapter');
   const device = await adapter.requestDevice();
   const renderer = new TetraWebGPU(canvas, device, onlost);
   try {
    const module = device.createShaderModule({code:shader,label:'TETRA finite FP32 orbit'});
    renderer.pipeline = await device.createRenderPipelineAsync({
     layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format:renderer.format}]},
     primitive:{topology:'triangle-list'}
    });
    renderer.uniform = device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    renderer.empty=device.createTexture({size:[1,1],format:renderer.format,usage:GPUTextureUsage.TEXTURE_BINDING});
    renderer.bindGroup = device.createBindGroup({layout:renderer.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:1,resource:renderer.empty.createView()}]});
    const display=device.createShaderModule({code:`
     @group(0) @binding(0) var source:texture_2d<f32>; @group(0) @binding(1) var linear:sampler;
     struct VertexOut{@builtin(position) position:vec4f,@location(0) uv:vec2f}
     @vertex fn vertex(@builtin(vertex_index) i:u32)->VertexOut{let p=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:VertexOut;o.position=vec4f(p*2.-1.,0.,1.);o.uv=vec2f(p.x,1.-p.y);return o;}
     @fragment fn fragment(v:VertexOut)->@location(0) vec4f{return textureSample(source,linear,v.uv);}`});
    renderer.displayPipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:display,entryPoint:'vertex'},fragment:{module:display,entryPoint:'fragment',targets:[{format:renderer.format}]},primitive:{topology:'triangle-list'}});
    renderer.sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    renderer.qualification = await renderer.qualify();
    if (renderer.lost) throw Error('WebGPU device lost during qualification');
    return renderer;
   } catch (error) { renderer.destroy(); throw error; }
  }
  constructor(canvas, device, onlost) {
   this.canvas=canvas;this.device=device;this.kind='webgpu';this.bits=23;this.lost=false;this.onlost=onlost;
   this.format=navigator.gpu.getPreferredCanvasFormat();this.context=canvas.getContext('webgpu');
   if (!this.context) {device.destroy();throw Error('WebGPU canvas unavailable');}
   this.context.configure({device,format:this.format,alphaMode:'opaque'});
   this.data=new ArrayBuffer(48);this.floats=new Float32Array(this.data);this.ints=new Uint32Array(this.data);
   const lost=info=>{if(this.lost)return;this.failure=info?.error?.message||info?.message||'WebGPU device lost';console.warn('WebGPU fallback:',this.failure);this.lost=true;this.onlost?.(this);};
   device.lost.then(lost);
   device.addEventListener('uncapturederror',lost);
  }
  encode(view,width,height,iterations,palette,texture,options={}) {
   if(this.lost)throw Error('WebGPU device lost');
   this.floats.set([...(options.size||[width,height]),Number(view.x),Number(view.y),Number(view.span)]);
   this.floats.set(options.offset||[0,0],8);
   this.ints[5]=iterations;this.ints[6]=palette;this.ints[7]=options.samples||1;this.ints[10]=options.adaptive?1:0;
   this.device.queue.writeBuffer(this.uniform,0,this.data);
   const encoder=this.device.createCommandEncoder();
   const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:options.tile?'load':'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
   if(options.tile){const t=options.tile;pass.setScissorRect(t.x,t.y,t.width,t.height);}
   pass.setPipeline(this.pipeline);pass.setBindGroup(0,options.group||this.bindGroup);pass.draw(3);pass.end();return encoder;
  }
  render(view,width,height,iterations,palette,capture=true,options={}) {
   if(width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)throw Error('WebGPU texture limit');
   if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
   const encoder=this.encode(view,width,height,iterations,palette,this.context.getCurrentTexture(),options);
   this.device.queue.submit([encoder.finish()]);
   if(!capture)return;
   const preserve=source=>{
    const frame=document.createElement('canvas');frame.width=width;frame.height=height;
    frame.getContext('2d',{alpha:false}).drawImage(source,0,0);return frame;
   };
   // Request the snapshot before presentation expires, then let the main thread
   // keep handling input while the browser completes the GPU work.
   if(typeof createImageBitmap==='function')return createImageBitmap(this.canvas);
   return preserve(this.canvas);
  }
  beginFrame(width,height,seed=null,adaptive=false){
   if(width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)throw Error('WebGPU image limit');
   const texture=this.device.createTexture({size:[width,height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
   const group=this.device.createBindGroup({layout:this.displayPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.sampler}]});
   const orbitGroup=adaptive&&seed?this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:seed.texture.createView()}]}):this.bindGroup;
   const frame={width,height,texture,group,orbitGroup,seed:adaptive?seed:null};if(seed)this.blit(seed,texture);return frame;
  }
  blit(frame,target){
   if(this.lost)throw Error('WebGPU device lost');
   const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
   pass.setPipeline(this.displayPipeline);pass.setBindGroup(0,frame.group);pass.draw(3);pass.end();this.device.queue.submit([encoder.finish()]);
  }
  async paintTile(frame,tile,view,iterations,palette,samples){
   const encoder=this.encode(view,frame.width,frame.height,iterations,palette,frame.texture,{samples,tile,group:frame.orbitGroup,adaptive:!!frame.seed});
   this.device.queue.submit([encoder.finish()]);await this.device.queue.onSubmittedWorkDone();
  }
  presentFrame(frame){
   if(this.canvas.width!==frame.width||this.canvas.height!==frame.height){this.canvas.width=frame.width;this.canvas.height=frame.height;}
   this.blit(frame,this.context.getCurrentTexture());
  }
  capture(frame){
   this.presentFrame(frame);
   if(typeof createImageBitmap==='function')return createImageBitmap(this.canvas);
   const copy=document.createElement('canvas');copy.width=frame.width;copy.height=frame.height;copy.getContext('2d').drawImage(this.canvas,0,0);return Promise.resolve(copy);
  }
  releaseFrame(frame){frame?.texture.destroy();}

  async pixel(x,y,palette=0) {
   const texture=this.device.createTexture({size:[1,1],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const buffer=this.device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try {
    const encoder=this.encode({x:String(x),y:String(y),span:'1'},1,1,512,palette,texture);
    encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:256},[1,1]);this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);const actual=[...new Uint8Array(buffer.getMappedRange()).slice(0,4)];buffer.unmap();
    return this.format.startsWith('bgra')?[actual[2],actual[1],actual[0],actual[3]]:actual;
   } finally {buffer.destroy();texture.destroy();}
  }
  async qualify() {
   const evidence=[];
   for(const [name,x,y] of [['fixed',.5,0],['period2',.01,0],['threshold',2,0],['origin',0,0],['complex',.5,.25]]){
    const actual=await this.pixel(x,y),orbit=TetraCore.orbit64(x,y,512),expected=TetraCore.color(orbit.kind,orbit.steps,0,orbit.re,orbit.im);
    if(actual[3]!==255||expected.some((v,i)=>Math.abs(v-actual[i])>1))throw Error('WebGPU reference pixel mismatch: '+name);
    evidence.push({name,actual,expected});
   }
   return evidence;
  }
  destroy(){this.onlost=null;this.lost=true;this.uniform?.destroy();this.empty?.destroy();this.context?.unconfigure();this.device.destroy();}
 }
 root.TetraWebGPU=TetraWebGPU;
})(globalThis);
