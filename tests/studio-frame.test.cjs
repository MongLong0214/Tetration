'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
require('../src/precision.js');
require('../src/studio-frame.js');
const createFixed=globalThis.createFixed,F=createFixed(256),Frame=globalThis.TetraStudioFrame;

test('output frame maps to the viewport span without changing the exact camera center',()=>{
 const rect=Frame.geometry(1920,785,9/16);
 assert.equal(rect.width,Math.min(1920,785*9/16));
 assert.equal(rect.fraction,createFixed(256).text(createFixed(256).div(createFixed(256).parse(String(785e6*9)),createFixed(256).parse(String(1920e6*16)))));
 assert.equal(rect.x,(1920-rect.width)/2);
 const source={x:'-0.605137938972379900971817048132147498249950297815856628491748908858224992290680363711703001492344905661729028182206',y:'0.437740442074800562969426586669113155808012201307319340609925561376648113155',span:'7e-100'};
 const frame=Frame.fromView(source,rect,F),restored=Frame.toView(frame,rect,F);
 assert.equal(frame.x,source.x);assert.equal(frame.y,source.y);
 assert.equal(restored.x,source.x);assert.equal(restored.y,source.y);
 const error=F.abs(F.parse(restored.span)-F.parse(source.span));
 assert.ok(error<F.parse('1e-240'),F.text(error));
});

test('wide and square output frames letterbox the same viewport instead of resizing it',()=>{
 const wide=Frame.geometry(390,720,16/9),square=Frame.geometry(390,720,1);
 assert.equal(wide.width,390);assert.equal(wide.height,390/(16/9));
 assert.equal(square.width,390);assert.equal(square.height,390);
 assert.notEqual(wide.height,square.height);
});

for(const rollDeg of [0,45,90,-45])for(const [width,height]of [[1920,785],[390,720],[720,390]])for(const aspect of [9/16,1,16/9]){
 test(`rotated ${rollDeg}° ${aspect} frame fits ${width}×${height} and matches screenToWorld`,()=>{
  require('../src/studio-model.js');require('../src/studio-camera.js');
  const rect=Frame.geometry(width,height,aspect,rollDeg),camera={x:'-0.123456789012345678901234567890123456789',y:'0.432109876543210987654321098765432109876',span:'2e-100',rollDeg};
  const view=Frame.toView(camera,rect,F),roundTrip=Frame.fromView(view,rect,F);
  assert.equal(roundTrip.x,camera.x);assert.equal(roundTrip.y,camera.y);
  assert.ok(F.abs(F.parse(roundTrip.span)-F.parse(camera.span))<F.parse('1e-240'));
  const angle=-rollDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  for(const [x,y]of [[0,0],[rect.width,0],[0,rect.height],[rect.width,rect.height]]){
   const dx=x-rect.width/2,dy=y-rect.height/2,screenX=width/2+c*dx-s*dy,screenY=height/2+s*dx+c*dy;
   assert.ok(screenX>=-1e-8&&screenX<=width+1e-8);assert.ok(screenY>=-1e-8&&screenY<=height+1e-8);
   const expected=globalThis.TetraStudioCamera.screenToWorld(camera,x,y,rect.width,rect.height);
   const actual={x:F.text(F.parse(view.x)+F.mul(F.parse(view.span),F.parse(String((screenX-width/2)/width)))),y:F.text(F.parse(view.y)-F.mul(F.parse(view.span),F.parse(String((screenY-height/2)/width))))};
   for(const key of ['x','y'])assert.ok(F.abs(F.parse(actual[key])-F.parse(expected[key]))<F.parse('1e-114'),key);
  }
 });
}

test('span limits reject an unrepresentable frame rather than clamping the captured camera',()=>{
 const rect=Frame.geometry(1920,785,9/16,45),full=Frame.geometry(600,600,1),center={x:'0.12345678901234567890123456789',y:'-1.2345678901234567890123456789'};
 for(const span of ['1e-200','1e12'])assert.equal(Frame.fromView({...center,span},full,F).span,F.text(F.parse(span)));
 assert.throws(()=>Frame.fromView({...center,span:'1e-200'},rect,F),RangeError);
 assert.throws(()=>Frame.toView({...center,span:'1e12'},rect,F),RangeError);
 assert.throws(()=>Frame.fromView({...center,span:'2'},null,F),RangeError);
 assert.throws(()=>Frame.toView({...center,span:'1e-201'},rect,F),RangeError);
 assert.throws(()=>Frame.fromView({...center,x:'1.1e12',span:'2'},rect,F),RangeError);
 const custom=Frame.geometry(1440,785,1.2);
 assert.ok(Math.abs(Number(custom.fraction)-custom.width/1440)<1e-15);
 assert.equal(Frame.geometry(0,785,1),null);assert.equal(Frame.geometry(Infinity,785,1),null);
 const resized=Frame.geometry(785,1920,9/16,45);
 const camera={...center,span:'1e-199'},view=Frame.toView(camera,resized,F),restored=Frame.fromView(view,resized,F);
 assert.equal(restored.x,center.x);assert.equal(restored.y,center.y);
 assert.ok(F.abs(F.parse(restored.span)-F.parse(camera.span))<F.parse('1e-250'));
});

test('supported boundary cameras survive fractional rotated framing and resize',()=>{
 const center={x:'-0.60513793897237990097181704813214749824995029781585662849',y:'0.43774044207480056296942658666911315580801220130731934060'};
 for(const [width,height]of [[1440,785],[785,1440],[390,720]])for(const aspect of [9/16,1,16/9])for(const rollDeg of [0,45,90])for(const span of ['1e-200','1e12']){
  const frame=Frame.geometry(width,height,aspect,rollDeg),camera={...center,span,rollDeg},numerator=F.parse(span)*F.Q,fraction=F.parse(frame.fraction);
  if(numerator<F.parse('1e-200')*fraction||numerator>F.parse('1e12')*fraction){assert.throws(()=>Frame.toView(camera,frame,F),RangeError);continue;}
  const restored=Frame.fromView(Frame.toView(camera,frame,F),frame,F);
  assert.equal(restored.x,center.x);assert.equal(restored.y,center.y);
  assert.ok(F.abs(F.parse(restored.span)-F.parse(span))<F.parse('1e-250'),`${width}×${height}, ${aspect}, ${rollDeg}°, ${span}`);
 }
});
