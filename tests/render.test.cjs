'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {size,tiles,boxView,exposedTiles,huePixels}=require('../src/render.js');
test('display resolution respects density, pixel and dimension limits',()=>{
 assert.deepEqual(size(1440,870,1),{width:1440,height:870});
 assert.deepEqual(size(390,760,2),{width:780,height:1520});
 for(const [w,h,dpr] of [[7680,4320,3],[320,20000,2],[20000,320,2]]){
  const r=size(w,h,dpr);assert.ok(r.width*r.height<=8294400);assert.ok(r.width<=8192&&r.height<=8192);assert.ok(r.width>0&&r.height>0);
 }
});
test('center-first partial tiles cover every destination pixel exactly once',()=>{
 const w=273,h=181,coverage=new Uint8Array(w*h),ordered=tiles(w,h,64);
 for(const t of ordered){assert.ok(t.width>0&&t.height>0&&t.x+t.width<=w&&t.y+t.height<=h);for(let y=t.y;y<t.y+t.height;y++)for(let x=t.x;x<t.x+t.width;x++)coverage[y*w+x]++;}
 assert.ok(coverage.every(n=>n===1));assert.ok(ordered[0].x>0&&ordered[0].y>0);
});
test('PNG hue fallback preserves alpha and neutral tones and changes chromatic tones',()=>{
 const input=new Uint8ClampedArray([240,32,128,255,70,70,70,90]);assert.deepEqual(huePixels(input.slice(),0),input);
 const turned=huePixels(input.slice(),180);assert.equal(turned[3],255);assert.deepEqual([...turned.slice(4)],[70,70,70,90]);assert.notDeepEqual(turned,input);
});
test('region zoom fits the entire selection and preserves the complex-plane aspect',()=>{
 const F=require('../src/precision.js').createFixed(256),view={x:F.parse('-2'),y:F.parse('.4'),span:F.parse('4')};
 const next=boxView(F,view,1000,500,{x:700,y:300},{x:500,y:200});
 assert.equal(next.x,F.parse('-1.6'));assert.equal(next.y,view.y);assert.equal(next.span,F.parse('.8'));
 const tall=boxView(F,view,1000,500,{x:480,y:100},{x:520,y:400});
 assert.equal(tall.span,F.parse('2.4'));assert.equal(tall.x,view.x);assert.equal(tall.y,view.y);
 assert.equal(boxView(F,view,1000,500,{x:20,y:20},{x:24,y:60}),null);
});
test('region zoom retains exact centre offsets at 1e-200 and clips to the viewport',()=>{
 const F=require('../src/precision.js').createFixed(256),view={x:F.parse('-0.605137938972379900971817'),y:F.parse('.4377404420748'),span:F.parse('1e-200')};
 const next=boxView(F,view,1000,500,{x:600,y:200},{x:800,y:300});
 assert.equal(next.x-view.x,F.parse('2e-201'));assert.equal(next.y,view.y);assert.equal(next.span,F.parse('2e-201'));
 const full=boxView(F,view,1000,500,{x:-100,y:-100},{x:1100,y:600});assert.deepEqual(full,view);
});
test('pan strips cover precisely the new pixels for every shift direction, without overlap',()=>{
 const w=273,h=181;
 for(const [dx,dy] of [[0,0],[37,19],[-37,19],[37,-19],[-37,-19],[0,19],[37,0],[w,0],[0,-h]]){
  const coverage=new Uint8Array(w*h);
  for(const t of exposedTiles(w,h,dx,dy,32))for(let y=t.y;y<t.y+t.height;y++)for(let x=t.x;x<t.x+t.width;x++)coverage[y*w+x]++;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)assert.equal(coverage[y*w+x],x+dx<0||x+dx>=w||y-dy<0||y-dy>=h?1:0,`${dx},${dy}: ${x},${y}`);
 }
});
