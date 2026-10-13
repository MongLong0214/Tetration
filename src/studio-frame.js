/* Output-frame mapping for Studio's shared Explore camera. */
(function(root){
 'use strict';
 const F=root.createFixed(256);
 function geometry(width,height,aspect,rollDeg=0){
  if(![width,height,aspect,rollDeg].every(Number.isFinite)||!(width>0&&height>0&&aspect>0))return null;
  const angle=rollDeg*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle)),
   cosine=c<1e-15?0:c,sine=s<1e-15?0:s,
   frameWidth=Math.min(width/(cosine+sine/aspect),height/(sine+cosine/aspect)),frameHeight=frameWidth/aspect;
  // Axis-aligned frames keep the rational aspect exactly, even at deep zoom.
  const [a,b]=aspect===9/16?[9,16]:aspect===1?[1,1]:aspect===16/9?[16,9]:[null,null],w=F.parse(String(width)),h=F.parse(String(height)),A=a&&BigInt(a),B=b&&BigInt(b);
  const fraction=rollDeg===0&&a?F.text(w*B<=h*A?F.Q:F.div(h*A,w*B)):F.text(F.div(F.parse(String(frameWidth)),F.parse(String(width))));
  return {x:(width-frameWidth)/2,y:(height-frameHeight)/2,width:frameWidth,height:frameHeight,fraction,aspect,rollDeg};
 }
 function mapped(camera,frame,fixed,inverse){
  if(!frame)throw RangeError('Output frame is unavailable.');
  const span=fixed.parse(camera.span),fraction=fixed.parse(frame.fraction),min=fixed.parse('1e-200'),max=fixed.parse('1e12');
  if(fraction<=0n)throw RangeError('Output frame is unavailable.');
  let value=inverse?fixed.div(span,fraction):fixed.mul(span,fraction);
  if(inverse&&span>0n&&span*fixed.Q%fraction){
   // Round up so recapturing the minimum camera cannot truncate below the limit.
   // A rotated frame wider than View may instead need the lower neighbour at max.
   const upper=value+1n;if(fixed.mul(upper,fraction)<=max)value=upper;
  }
  if(span<min||span>max||value<min||value>max||fixed.abs(fixed.parse(camera.x))>max||fixed.abs(fixed.parse(camera.y))>max)throw RangeError('Output frame span must be between 1e-200 and 1e12. Zoom away from the limit before capturing.');
  return {...camera,x:camera.x,y:camera.y,span:fixed.text(value)};
 }
 function fromView(view,frame,fixed){return mapped(view,frame,fixed,false);}
 function toView(camera,frame,fixed){return mapped(camera,frame,fixed,true);}
 root.TetraStudioFrame={geometry,fromView,toView};
})(globalThis);
