/* Pure frame-index camera planning. World coordinates never pass through Number. */
(function(root){
 'use strict';
 const F=createFixed(256),M=root.TetraStudioModel;
 function canceled(signal){if(signal?.aborted)throw new DOMException('Camera planning canceled','AbortError');}
 function ease(u,type){
  if(type==='linear')return u;
  if(type==='ease-in')return F.mul(u,u);
  if(type==='ease-out')return F.Q-F.mul(F.Q-u,F.Q-u);
  return F.mul(F.mul(u,u),3n*F.Q-2n*u);
 }
 function createEvaluator(input){
  const project=M.validate(input),{start:A,end:B,motion,easing,frameCount:N}=project.shot;
  const start={x:F.parse(A.x),y:F.parse(A.y),span:F.parse(A.span)},end={x:F.parse(B.x),y:F.parse(B.y),span:F.parse(B.span)};
  const lnA=motion==='travel'?F.ln(start.span):0n,lnB=motion==='travel'?F.ln(end.span):0n;
  const equal=F.abs(lnB-lnA)<F.parse('0.000001')||start.span===end.span;
  return k=>{
   const time=M.timing(project,k);let camera;
   if(motion==='hold'||k===0)camera={...A};else if(k===N-1)camera={...B};else{
    const progress=BigInt(k)*F.Q/BigInt(N-1),e=ease(progress,easing);
    const span=start.span===end.span?start.span:F.exp(F.mul(F.Q-e,lnA)+F.mul(e,lnB));
    const w=equal?e:F.div(span-start.span,end.span-start.span);
    camera={x:F.text(start.x+F.mul(end.x-start.x,w)),y:F.text(start.y+F.mul(end.y-start.y,w)),span:F.text(span),rollDeg:A.rollDeg+(B.rollDeg-A.rollDeg)*F.number(e)};
   }
   return {...time,camera};
  };
 }
 function evaluateFrame(project,k){return createEvaluator(project)(k);}
 function reverseEndpoints(project){const next=M.validate(project);[next.shot.start,next.shot.end]=[next.shot.end,next.shot.start];return next;}
 function matchEndSpan(project){const next=M.validate(project);next.shot.end.span=next.shot.start.span;return next;}
 function sourceExtent(width,height,rolls){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!Array.isArray(rolls)||!rolls.length||rolls.some(r=>!Number.isFinite(r)||r<-180||r>180))throw Error('Invalid camera source extent');
  if(rolls.every(r=>r===0))return {width,height,identity:true};
  let w=0,h=0;for(const roll of rolls){const angle=roll*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));w=Math.max(w,width*c+height*s);h=Math.max(h,width*s+height*c);}
  return {width:Math.ceil((w+2)/2)*2,height:Math.ceil((h+2)/2)*2,identity:false};
 }
 function sourceCamera(camera,outputWidth,extent){return {...camera,span:F.text(F.parse(camera.span)*BigInt(extent.width)/BigInt(outputWidth))};}
 // Screen y is down, world y is up; positive roll rotates the displayed image clockwise.
 function screenToWorld(camera,x,y,width,height){
  const angle=camera.rollDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=x-width/2,dy=y-height/2;
  const sx=c*dx+s*dy,sy=-s*dx+c*dy,span=F.parse(camera.span);
  return {x:F.text(F.parse(camera.x)+F.mul(span,F.parse(String(sx/width)))),y:F.text(F.parse(camera.y)-F.mul(span,F.parse(String(sy/width))))};
 }
 function autoIterations(camera){return root.TetraRender.autoIterations(camera.span);}
 // Canvas affine transform from a completed camera to a new camera. Subtract
 // decimal centres before conversion so this also works at 1e-200 zoom.
 function screenMatrix(from,to,width,height){
  const span=F.parse(to.span),scale=F.number(F.div(F.parse(from.span),span)),angle=(to.rollDeg-from.rollDeg)*Math.PI/180,
   a=scale*Math.cos(angle),b=scale*Math.sin(angle),c=-b,d=a,roll=to.rollDeg*Math.PI/180,
   x=F.number(F.div(F.parse(from.x)-F.parse(to.x),span))*width,y=F.number(F.div(F.parse(from.y)-F.parse(to.y),span))*width,
   tx=Math.cos(roll)*x+Math.sin(roll)*y,ty=Math.sin(roll)*x-Math.cos(roll)*y;
  return [a,b,c,d,width/2+tx-a*width/2-c*height/2,height/2+ty-b*width/2-d*height/2];
 }
 async function plan(input,{signal,size=M.dimensions(input.output),yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  canceled(signal);const project=M.validate(input),evaluate=createEvaluator(project),frames=[];
  // A held camera has no interpolation work. In particular, framing a single
  // endpoint must not pay a timer hop for every twelve unused video frames.
  const held=project.shot.motion==='hold';
  for(let k=0;k<project.shot.frameCount;k++){canceled(signal);frames.push(evaluate(k));if(!held&&(k+1)%12===0)await yieldTask();}
  canceled(signal);const extent=sourceExtent(size.width,size.height,frames.map(frame=>frame.camera.rollDeg));
  const iterations=project.numerics.iterations==='fixed'?project.numerics.fixedIterations:Math.max(...frames.map(frame=>autoIterations(frame.camera)));
  return {project,frames,size:{...size},extent,iterations};
 }
 root.TetraStudioCamera={createEvaluator,evaluateFrame,reverseEndpoints,matchEndSpan,sourceExtent,sourceCamera,screenToWorld,screenMatrix,autoIterations,plan};
 if(typeof module!=='undefined')module.exports=root.TetraStudioCamera;
})(globalThis);
