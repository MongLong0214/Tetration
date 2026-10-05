/* Bounded image work, independent of orbit precision. */
(function(root){
 'use strict';
 function size(width,height,dpr=1,budget=8294400,maxWidth=8192){
  const d=Math.min(Math.max(dpr,0.25),3);let w=Math.max(1,width*d),h=Math.max(1,height*d);
  const shrink=Math.min(1,Math.sqrt(budget/(w*h)),maxWidth/w,maxWidth/h);
  return {width:Math.max(1,Math.round(w*shrink-1e-6)),height:Math.max(1,Math.round(h*shrink-1e-6))};
 }
 function tiles(width,height,edge=128){
  const out=[];
  for(let y=0;y<height;y+=edge)for(let x=0;x<width;x+=edge)out.push({x,y,width:Math.min(edge,width-x),height:Math.min(edge,height-y)});
  return out.sort((a,b)=>(a.x+a.width/2-width/2)**2+(a.y+a.height/2-height/2)**2-((b.x+b.width/2-width/2)**2+(b.y+b.height/2-height/2)**2));
 }
 // Fit the selected world rectangle without stretching it. Camera arithmetic stays
 // in the fixed decimal domain, including offsets much smaller than Number's ULP.
 function boxView(F,view,width,height,start,end){
  const clamp=(v,max)=>Math.max(0,Math.min(max,v));
  const x0=clamp(Math.min(start.x,end.x),width),x1=clamp(Math.max(start.x,end.x),width);
  const y0=clamp(Math.min(start.y,end.y),height),y1=clamp(Math.max(start.y,end.y),height);
  if(x1-x0<8||y1-y0<8||!(width>0&&height>0))return null;
  const fw=F.parse(String(width)),fh=F.parse(String(height));
  const left=F.parse(String(x0)),right=F.parse(String(x1)),top=F.parse(String(y0)),bottom=F.parse(String(y1));
  const sw=right-left,sh=bottom-top;
  return {x:view.x+view.span*(left+right-fw)/(2n*fw),y:view.y-view.span*(top+bottom-fh)/(2n*fw),span:sh*fw>sw*fh?view.span*sh/fh:view.span*sw/fw};
 }
 // Regions not covered by an integer-shifted image. y is top-down here, dy is
 // the camera's upward world shift. The four strips never overlap at corners.
 function exposedTiles(width,height,dx,dy,edge=128){
  if(Math.abs(dx)>=width||Math.abs(dy)>=height)return tiles(width,height,edge);
  const left=Math.max(0,-dx),top=Math.max(0,dy),w=width-Math.abs(dx),h=height-Math.abs(dy),out=[];
  const add=(x,y,width,height)=>{if(width<=0||height<=0)return;for(const t of tiles(width,height,edge))out.push({...t,x:t.x+x,y:t.y+y});};
  add(0,0,left,height);add(left+w,0,width-left-w,height);
  add(left,0,w,top);add(left,top+h,w,height-top-h);
  return out;
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
 root.TetraRender={size,tiles,boxView,exposedTiles,huePixels,perturbScene,referencePoint};
 if(typeof module!=='undefined')module.exports=root.TetraRender;
})(globalThis);
