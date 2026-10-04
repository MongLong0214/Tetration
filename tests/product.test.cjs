'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('the product remains English and uses only neutral CSS colors',()=>{
 const source=fs.readdirSync(path.join(root,'src'),{withFileTypes:true}).filter(e=>e.isFile()).map(e=>fs.readFileSync(path.join(root,'src',e.name),'utf8')).join('\n');
 assert.doesNotMatch(source,/[\uac00-\ud7a3]/);assert.match(fs.readFileSync(path.join(root,'src/index.html'),'utf8'),/<html lang="en">/);
 const css=fs.readFileSync(path.join(root,'src/style.css'),'utf8');
 for(const [,hex] of css.matchAll(/#([a-f0-9]{8}|[a-f0-9]{6}|[a-f0-9]{4}|[a-f0-9]{3})(?![a-z0-9-])/gi)){
  const channels=hex.length<=4?hex.slice(0,3).split(''):hex.slice(0,6).match(/../g);assert.equal(channels[0],channels[1],hex);assert.equal(channels[1],channels[2],hex);
 }
});
test('current project documentation contains no video-platform reference URLs',()=>{
 const files=['README.md','CHANGELOG.md','docs/PRODUCTION_REVIEW.md','docs/VALIDATION.md','docs/PUBLISHING.md'];
 for(const file of files)assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/https?:\/\/(?:www\.)?(?:youtu\.be|youtube\.com)\//i,file);
});
