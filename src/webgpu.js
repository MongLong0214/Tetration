/* Optional WebGPU FP32 preview. Qualified against stable FP64 reference pixels.
 * Finite observation only; this does not improve orbit precision over WebGL2. */
(function (root) {
 'use strict';
 const shader = `
 struct Params { size: vec2f, center: vec2f, span: f32, iterations: u32, palette: u32, pad: u32 }
 @group(0) @binding(0) var<uniform> u: Params;
 const dusk = array<vec3f, 7>(vec3f(9,24,31),vec3f(39,79,89),vec3f(81,130,132),vec3f(213,204,167),vec3f(234,142,82),vec3f(110,60,59),vec3f(30,32,46));
 const blue = array<vec3f, 7>(vec3f(13,16,44),vec3f(34,63,147),vec3f(69,151,199),vec3f(191,223,226),vec3f(192,122,205),vec3f(89,48,139),vec3f(16,20,58));
 fn color(kind: u32, steps: f32) -> vec3f {
  if (u.palette == 2u) {
   if (kind == 3u) { return vec3f(232,235,226)/255.; }
   if (kind == 4u) { return vec3f(95,90,98)/255.; }
   return vec3f(9,14,17)/255.;
  }
  if (kind != 3u) {
   if (u.palette == 0u) {
    if (kind == 1u) { return vec3f(21,44,43)/255.; }
    if (kind == 2u) { return vec3f(27,36,49)/255.; }
    if (kind == 4u) { return vec3f(78,52,68)/255.; }
    return vec3f(8,15,18)/255.;
   }
   if (kind == 1u) { return vec3f(19,33,64)/255.; }
   if (kind == 2u) { return vec3f(39,24,57)/255.; }
   if (kind == 4u) { return vec3f(92,56,96)/255.; }
   return vec3f(9,12,23)/255.;
  }
  let pos = fract(log2(max(steps,1.)+1.)*.28)*6.;
  let i = min(u32(floor(pos)), 5u);
  if (u.palette == 0u) { return mix(dusk[i],dusk[i+1u],fract(pos))/255.; }
  return mix(blue[i],blue[i+1u],fract(pos))/255.;
 }
 @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u),f32(i & 2u));
  return vec4f(p*2.-1.,0.,1.);
 }
 @fragment fn fragment(@builtin(position) point: vec4f) -> @location(0) vec4f {
  let offset = (point.xy-u.size*.5)*(u.span/u.size.x);
  let c = u.center+vec2f(offset.x,-offset.y);
  let radius = length(c);
  if (radius < 1e-30) { return vec4f(color(4u,0.),1.); }
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
  return vec4f(color(kind,steps),1.);
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
    renderer.uniform = device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    renderer.bindGroup = device.createBindGroup({layout:renderer.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}}]});
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
   this.frame=document.createElement('canvas');this.frameContext=this.frame.getContext('2d',{alpha:false});
   this.data=new ArrayBuffer(32);this.floats=new Float32Array(this.data);this.ints=new Uint32Array(this.data);
   const lost=info=>{if(this.lost)return;this.failure=info?.error?.message||info?.message||'WebGPU device lost';console.warn('WebGPU fallback:',this.failure);this.lost=true;this.onlost?.(this);};
   device.lost.then(lost);
   device.addEventListener('uncapturederror',lost);
  }
  encode(view,width,height,iterations,palette,texture) {
   if(this.lost)throw Error('WebGPU device lost');
   this.floats.set([width,height,Number(view.x),Number(view.y),Number(view.span)]);
   this.ints[5]=iterations;this.ints[6]=palette;
   this.device.queue.writeBuffer(this.uniform,0,this.data);
   const encoder=this.device.createCommandEncoder();
   const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
   pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.draw(3);pass.end();return encoder;
  }
  render(view,width,height,iterations,palette) {
   if(width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)throw Error('WebGPU texture limit');
   if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
   const encoder=this.encode(view,width,height,iterations,palette,this.context.getCurrentTexture());
   this.device.queue.submit([encoder.finish()]);
   // The presentation texture expires at the next frame. Preserve an explicit
   // snapshot in this task for PNG export and navigation previews.
   if(this.frame.width!==width||this.frame.height!==height){this.frame.width=width;this.frame.height=height;}
   this.frameContext.drawImage(this.canvas,0,0);
  }
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
    const actual=await this.pixel(x,y),orbit=TetraCore.orbit64(x,y,512),expected=TetraCore.color(orbit.kind,orbit.steps,0);
    if(actual[3]!==255||expected.some((v,i)=>Math.abs(v-actual[i])>1))throw Error('WebGPU reference pixel mismatch: '+name);
    evidence.push({name,actual,expected});
   }
   return evidence;
  }
  destroy(){this.onlost=null;this.lost=true;this.uniform?.destroy();this.context?.unconfigure();this.device.destroy();}
 }
 root.TetraWebGPU=TetraWebGPU;
})(globalThis);
