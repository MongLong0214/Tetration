'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=['precision.js','core.js','worker.js'].map(p=>fs.readFileSync(path.join(__dirname,'../src',p),'utf8')).join('\n');
async function render(mode,parallel,yieldAPI){
 const width=29,height=17,pixels=new Uint8ClampedArray(width*height*4),covered=new Uint8Array(width*height),counts=[0,0,0,0,0];let yields=0;
 await Promise.all(Array.from({length:parallel},async(_,index)=>{
  let complete=false,clock=0;
  const self={postMessage(d){assert.ok(!d.error,d.error);if(d.tile){let p=0;for(let y=d.tile.y;y<d.tile.y+d.tile.height;y++)for(let x=d.tile.x;x<d.tile.x+d.tile.width;x++){const offset=y*width+x;covered[offset]++;pixels.set(d.pixels.slice(p,p+4),offset*4);p+=4;}}if(d.complete){complete=true;d.counts.forEach((n,i)=>counts[i]+=n);}},scheduler:yieldAPI?{yield:async()=>{yields++;}}:undefined};
  const context=vm.createContext({self,Uint8ClampedArray,performance:{now:()=>clock+=20},setTimeout:f=>{yields++;f();}});
  vm.runInContext(source,context);
  await self.onmessage({data:{id:1,x:'0.5',y:'0.1',span:'0.15',width,height,mode,digits:40,iterations:64,palette:1,index,workers:parallel,bitmap:false}});
  assert.ok(complete);
 }));
 assert.ok(covered.every(n=>n===1),'each pixel computed exactly once');assert.equal(counts.reduce((a,b)=>a+b),width*height);assert.ok(yields>0);
 return {pixels,counts};
}
for(const mode of ['cpu','big'])test(`${mode} worker pool matches serial pixels and counts across partial edge tiles`,async()=>{
 const serial=await render(mode,1,false),parallel=await render(mode,4,true);assert.deepEqual(parallel,serial);
});
