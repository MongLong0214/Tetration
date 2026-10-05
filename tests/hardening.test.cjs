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
 assert.match(policy,/worker-src 'self' blob:/);assert.match(policy,/connect-src 'none'/);assert.doesNotMatch(policy,/unsafe-inline|unsafe-eval/);
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
test('bundle carries the perturbation engine, one GPU backend and a complete Worker source',()=>{
 execFileSync(process.execPath,['build.cjs'],{cwd:root});const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 assert.doesNotThrow(()=>new Function(script),'bundle parses');
 for(const name of ['TetraReference','TetraGPU','TetraCore','TetraRender','TetraSaved','perturbScene','uRefLength'])assert.ok(script.includes(name),name);
 assert.doesNotMatch(script,/TetraWebGPU|navigator\.gpu/);
 const worker=JSON.parse(script.match(/const workerSource = (".*?");\n/s)[1]);
 assert.doesNotThrow(()=>new Function(worker),'worker source parses');
 for(const name of ['createFixed','TetraReference','perturb64','discover','referenceJob','tileJob'])assert.ok(worker.includes(name),name);
 assert.ok(Buffer.byteLength(html)<400000,`bundle size ${Buffer.byteLength(html)}`);
});
test('production headers add transport, isolation and resource policies',()=>{
 const headers=Object.fromEntries(require('../vercel.json').headers[0].headers.map(({key,value})=>[key,value]));
 assert.match(headers['Strict-Transport-Security'],/max-age=\d{7,}/);
 assert.equal(headers['Cross-Origin-Opener-Policy'],'same-origin');assert.equal(headers['Cross-Origin-Resource-Policy'],'same-origin');
 assert.match(headers['Permissions-Policy'],/camera=\(\)/);assert.equal(headers['Referrer-Policy'],'no-referrer');
});
test('shader sources compile-time constants match the shared classification rules',()=>{
 require('../src/core.js');require('../src/gpu.js');
 const {direct,perturb,perturbBla}=globalThis.TetraGPU.sources;
 for(const source of [direct,perturb,perturbBla]){assert.match(source,/const float LOG_R=23\.0258509299404/);assert.match(source,/uniform float uLowA,uMaxB,uTol,uThreshold;/);}
 assert.match(perturb,/intBitsToFloat/);assert.match(perturb,/uniform highp sampler2D uRef,uBla;/);
 // The BLA program ends in exactly the plain program's orbit loop (plain FP32 and floatexp steps),
 // so both classify alike after the approach.
 const orbitLoop=perturb.slice(perturb.indexOf('int i=1;bool done=false;')+'int i=1;bool done=false;'.length,perturb.indexOf('\n  if(mirrored)w.y=-w.y;'));
 assert.ok(orbitLoop.includes('while(!done&&i<=uIterations){')&&orbitLoop.includes('vec2 dp=scaled(dm,de)'),'orbit loop with the plain FP32 phase');
 assert.ok(perturbBla.includes(orbitLoop+'\n  if(mirrored)w.y=-w.y;'),'orbit loop reused verbatim');
 // orbitColor is inlined by GPU compilers: one call site keeps the programs small.
 for(const source of [direct,perturb,perturbBla])assert.equal(source.split('orbitColor(').length-1,2,'orbitColor defined once and called once');
 assert.match(perturbBla,/uniform int uBlaBase\[16\];/);assert.match(perturbBla,/blaAt\(e,1\)/);assert.doesNotMatch(perturb,/while\(linear/);
 assert.ok(Math.abs(Math.log(1e10)-23.025850929940457)<1e-14);
});
test('offline shell: service worker, manifest and icons are emitted and versioned',()=>{
 execFileSync(process.execPath,['build.cjs'],{cwd:root});
 const dist=name=>fs.readFileSync(path.join(root,'dist',name));
 const sw=dist('sw.js').toString();assert.match(sw,/const CACHE = 'tetra-[0-9a-f]{16}';/);assert.doesNotMatch(sw,/__BUILD__/);
 assert.doesNotThrow(()=>new Function(sw.replace("'use strict';",'')),'service worker parses');
 const manifest=JSON.parse(dist('manifest.webmanifest'));
 assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');
 for(const icon of manifest.icons){
  const png=dist(icon.src);assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),icon.src);
  const [w,h]=icon.sizes.split('x').map(Number);assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);
 }
 const html=dist('index.html').toString(),policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 assert.match(policy,/manifest-src 'self'/);assert.match(policy,/worker-src 'self' blob:/);
 assert.match(html,/<link rel="manifest" href="manifest.webmanifest">/);
 // A different bundle produces a different cache name, so stale shells are evicted on activation.
 const name=sw.match(/tetra-[0-9a-f]{16}/)[0];fs.appendFileSync(path.join(root,'src/assets/icon-192.png'),'');
 execFileSync(process.execPath,['build.cjs'],{cwd:root});assert.equal(dist('sw.js').toString().match(/tetra-[0-9a-f]{16}/)[0],name,'deterministic');
});
test('local server sends the right MIME types for the offline shell',async()=>{
 execFileSync(process.execPath,['build.cjs'],{cwd:root});
 const server=createServer(path.join(root,'dist'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const head=url=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method:'HEAD'},res=>{res.resume();resolve(res.headers['content-type']);});req.on('error',reject);req.end();});
 try{
  assert.match(await head('/sw.js'),/^text\/javascript/);assert.equal(await head('/manifest.webmanifest'),'application/manifest+json');
  assert.equal(await head('/icon-512.png'),'image/png');assert.match(await head('/'),/^text\/html/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('display sizing follows the true device density (below 1 and up to 3) and the texture limit',()=>{
 const {size}=require('../src/render.js');
 assert.deepEqual(size(1000,500,0.5),{width:500,height:250});
 assert.deepEqual(size(390,844,3),{width:1170,height:2532});
 assert.deepEqual(size(1366.4,700,1.25),{width:1708,height:875});
 const capped=size(3000,2000,2,8294400,4096);assert.ok(capped.width<=4096&&capped.height<=4096,JSON.stringify(capped));
});
