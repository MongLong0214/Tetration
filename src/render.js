/* Bounded image work, independent of orbit precision. */
(function(root){
 'use strict';
 function size(width,height,dpr=1,budget=8294400,maxWidth=8192){
  let w=Math.max(1,width*Math.min(Math.max(dpr,1),2)),h=Math.max(1,height*Math.min(Math.max(dpr,1),2));
  const shrink=Math.min(1,Math.sqrt(budget/(w*h)),maxWidth/w,8192/h);
  return {width:Math.max(1,Math.floor(w*shrink)),height:Math.max(1,Math.floor(h*shrink))};
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
 root.TetraRender={size,tiles,huePixels};
 if(typeof module!=='undefined')module.exports=root.TetraRender;
})(globalThis);
