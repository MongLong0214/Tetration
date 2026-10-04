/* Bounded image work, independent of orbit precision. */
(function(root){
 'use strict';
 function size(width,height,dpr=1,budget=8294400,maxWidth=8192){
  let w=Math.max(1,width*Math.min(Math.max(dpr,1),3)),h=Math.max(1,height*Math.min(Math.max(dpr,1),3));
  const shrink=Math.min(1,Math.sqrt(budget/(w*h)),maxWidth/w,8192/h);
  return {width:Math.max(1,Math.round(w*shrink-1e-6)),height:Math.max(1,Math.round(h*shrink-1e-6))};
 }
 function tiles(width,height,edge=128){
  const out=[];
  for(let y=0;y<height;y+=edge)for(let x=0;x<width;x+=edge)out.push({x,y,width:Math.min(edge,width-x),height:Math.min(edge,height-y)});
  return out.sort((a,b)=>(a.x+a.width/2-width/2)**2+(a.y+a.height/2-height/2)**2-((b.x+b.width/2-width/2)**2+(b.y+b.height/2-height/2)**2));
 }
 function huePixels(data,angle){
  // Same matrix as CSS hue-rotate; used only for PNG fallback without Canvas filter.
  const c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
  const m=[.213+.787*c-.213*s,.715-.715*c-.715*s,.072-.072*c+.928*s,
   .213-.213*c+.143*s,.715+.285*c+.140*s,.072-.072*c-.283*s,
   .213-.213*c-.787*s,.715-.715*c+.715*s,.072+.928*c+.072*s];
  for(let i=0;i<data.length;i+=4){const r=data[i],g=data[i+1],b=data[i+2];data[i]=m[0]*r+m[1]*g+m[2]*b;data[i+1]=m[3]*r+m[4]*g+m[5]*b;data[i+2]=m[6]*r+m[7]*g+m[8]*b;}
  return data;
 }
 /* GPU uniforms for perturbation around reference c0 = (c0x, c0y), Im(c0) >= 0.
  * Camera values are decimal BigInts from createFixed(256). Offsets are expressed in
  * units of 2^scale (close to the span) so FP32 sees O(1) mantissas at any depth. */
 function perturbScene(F,view,c0x,c0y){
  const span=Number(F.text(view.span));let scale=Math.floor(Math.log2(span));
  if(!Number.isFinite(scale))throw Error('Invalid span');
  const spanMant=span/2**scale;
  const clamp=v=>Math.max(-1e30,Math.min(1e30,v));
  const units=v=>clamp(scale<=0?F.number(v*(1n<<BigInt(-scale))):F.number(v/(1n<<BigInt(scale))));
  const c0r=F.number(c0x),c0i=F.number(c0y);
  const [ir,ii]=TetraCore.cdiv(1,0,c0r,c0i);
  const invExp=Math.floor(Math.log2(Math.max(Math.abs(ir),Math.abs(ii))));
  return {mode:'perturb',scale,spanMant,delta:[units(view.x-c0x),units(view.y-c0y)],deltaMirror:[units(view.x-c0x),units(-view.y-c0y)],imCenter:units(view.y),inv:[ir/2**invExp,ii/2**invExp],invExp};
 }
 // Reference point for a view: its centre, moved off the origin, reflected into Im >= 0.
 function referencePoint(F,view){
  let x=view.x,y=view.y;
  if(F.abs(x)+F.abs(y)<view.span*2n){x+=view.span*37n/100n;y+=view.span*29n/100n;}
  return {x,y:y<0n?-y:y};
 }
 root.TetraRender={size,tiles,huePixels,perturbScene,referencePoint};
 if(typeof module!=='undefined')module.exports=root.TetraRender;
})(globalThis);
