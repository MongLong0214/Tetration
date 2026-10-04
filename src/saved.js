/* Local, explicitly saved coordinates. No network or background writes. */
(function(root){
 'use strict';
 const KEY='tetra.saved.v1',LIMIT=24,f=createFixed(256),bound=f.parse('1e12');
 function validHash(hash){
  if(typeof hash!=='string'||hash.length>2400)return false;
  try{
   const p=new URLSearchParams(hash.replace(/^#/,''));if(p.get('v')!=='1')return false;
   const x=f.parse(p.get('x')),y=f.parse(p.get('y')),span=f.parse(p.get('s'));
   return f.abs(x)<=bound&&f.abs(y)<=bound&&span>=f.parse('1e-200')&&span<=bound;
  }catch{return false;}
 }
 function decode(raw){
  if(typeof raw!=='string'||raw.length>65536)return [];
  try{
   const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.views))return [];
   const ids=new Set();
   return data.views.slice(0,LIMIT).filter(v=>{
    if(!v||typeof v.id!=='string'||v.id.length>80||ids.has(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>48||!validHash(v.hash))return false;
    ids.add(v.id);return true;
   }).map(({id,name,hash})=>({id,name,hash}));
  }catch{return [];}
 }
 function encode(views){
  const data=JSON.stringify({version:1,views});
  if(views.length>LIMIT||decode(data).length!==views.length)throw Error('Invalid saved views');
  return data;
 }
 root.TetraSaved={KEY,LIMIT,decode,encode,validHash};
 if(typeof module!=='undefined')module.exports=root.TetraSaved;
})(globalThis);
