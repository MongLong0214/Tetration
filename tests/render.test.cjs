'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {size,tiles,huePixels}=require('../src/render.js');
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
