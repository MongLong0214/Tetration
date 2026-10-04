'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {createServer}=require('../serve.cjs');
require('../src/precision.js');
const {makePreciseOrbit}=require('../src/core.js');

test('numeric failures identify the actual failing step',()=>{
 const result=makePreciseOrbit(40)('2','0.2',256);
 assert.equal(result.kind,4);assert.ok(result.steps>0 && result.steps<256,JSON.stringify(result));assert.match(result.reason,/Underflow|precision/);
 const invalid=makePreciseOrbit(40)('nope','0',256);assert.equal(invalid.steps,0);
});
test('build is deterministic and CSP authorizes exact script and CSS bytes',()=>{
 execFileSync(process.execPath,['build.cjs'],{cwd:root});const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
 execFileSync(process.execPath,['build.cjs'],{cwd:root});assert.equal(html,fs.readFileSync(path.join(root,'dist/index.html'),'utf8'));
 const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 for(const tag of ['script','style']){
  const block=html.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))[1];
  const digest=createHash('sha256').update(block).digest('base64');assert.ok(policy.includes(`'sha256-${digest}'`));
 }
 assert.match(policy,/worker-src blob:/);assert.match(policy,/connect-src 'none'/);assert.doesNotMatch(policy,/unsafe-inline|unsafe-eval/);
 assert.doesNotMatch(html,/__(?:SCRIPT|STYLES|WORKER_SOURCE)__/);
});
test('production headers block framing and revalidate unversioned bundles',()=>{
 const headers=Object.fromEntries(require('../vercel.json').headers[0].headers.map(({key,value})=>[key,value]));
 assert.equal(headers['Content-Security-Policy'],"frame-ancestors 'none'");assert.equal(headers['Cache-Control'],'no-cache');assert.equal(headers['X-Content-Type-Options'],'nosniff');
});
test('local server handles methods, HEAD, malformed paths, symlinks and missing files',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tetra-test-'));const publicDir=path.join(temp,'public');fs.mkdirSync(publicDir);fs.writeFileSync(path.join(publicDir,'index.html'),'fixture');fs.writeFileSync(path.join(temp,'secret.txt'),'not public');fs.symlinkSync(path.join(temp,'secret.txt'),path.join(publicDir,'leak.txt'));
 const server=createServer(publicDir);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=(url,method='GET')=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();
 });
 try{
  assert.equal((await request('/')).body,'fixture');const head=await request('/','HEAD');assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers['content-length'],'7');
  assert.equal((await request('/','POST')).status,405);assert.equal((await request('/absent')).status,404);assert.equal((await request('/%')).status,400);assert.equal((await request('/%00')).status,400);assert.equal((await request('/leak.txt')).status,403);assert.notEqual((await request('/..%2Fsecret.txt')).body,'not public');
  assert.equal((await request('/')).headers['x-frame-options'],'DENY');
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
});
