'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/precision.js');const M=require('../src/studio-model.js');
const project=()=>M.createProject({x:'-0.5',y:'0',span:'8',palette:'ember'});
const copy=value=>JSON.parse(JSON.stringify(value));
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
test('new project and quantized duration/speed/fps use one time axis',()=>{
 const p=project();assert.equal(p.look.palette,'ember');assert.deepEqual(p.shot.end,p.shot.start);assert.equal(p.shot.motion,'hold');
 for(const key of ['bloom','pulse','prism','kaleido','wave'])assert.equal(p.look[key].enabled,false);
 assert.equal(p.shot.frameCount,300);assert.equal(M.setSpeed(p,2).shot.frameCount,150);assert.equal(M.setSpeed(p,0.5).shot.frameCount,600);
 assert.equal(M.setFps(p,24).shot.frameCount,240);assert.equal(M.setDuration(p,2.01).shot.frameCount,60);
 for(const fps of [24,30]){const q=M.setFps(p,fps),frames=Array.from({length:q.shot.frameCount},(_,k)=>M.timing(q,k));assert.equal(frames.reduce((sum,s)=>sum+s.durationUs,0),10000000);assert.equal(frames.at(-1).timestampUs,Math.round(1e6*(q.shot.frameCount-1)/fps));assert.throws(()=>M.timing(q,q.shot.frameCount));}
 for(const value of [NaN,Infinity,1.9,20.01,'10'])assert.throws(()=>M.setDuration(p,value));assert.throws(()=>M.setFps(p,60));
});
test('precise camera strings and every hidden FX value survive JSON, storage and Undo',()=>{
 const p=project();p.shot.start.x='-0.5'+'0'.repeat(208)+'1';p.shot.start.span='1e-200';p.shot.end.y='1e-210';
 for(const [key,rule]of Object.entries(M.RULES)){
  const path=key.split('.');if(path.length===2&&Object.hasOwn(p.look,path[0]))p.look[path[0]][path[1]]=rule.values?.at(-1)??rule.max;
 }
 const parsed=M.deserialize(M.serialize(p));assert.equal(parsed.shot.start.x,p.shot.start.x);assert.equal(parsed.shot.end.y,'0.'+'0'.repeat(209)+'1');
 const store=M.createStore(memory());store.save(parsed);assert.deepEqual(store.load(p.id),parsed);
 const session=M.createSession(parsed,{saved:true});session.applyEdit(q=>{q.shot.start.x='0';q.look.wave.enabled=true;});assert.equal(session.dirty,true);session.undo();assert.deepEqual(session.project,parsed);assert.equal(session.dirty,false);
});
test('validation rejects malformed documents atomically without clamping',()=>{
 const session=M.createSession(project()),before=M.serialize(session.project);
 const edits=[p=>p.schemaVersion=2,p=>p.extra=1,p=>delete p.look.prism,p=>p.look.kaleido.segments=3,p=>p.look.wave.enabled='false',p=>p.look.amount=1.01,p=>p.shot.start.x='1e-257',p=>p.shot.start.span='1e-201',p=>p.shot.start.y='1e13',p=>p.output.aspect='4:3',p=>p.name=' ',p=>p.look.bloom=[],p=>p.look.saturation=null,p=>p.shot.start.x='1'.repeat(601)];
 for(const edit of edits){const p=copy(session.project);edit(p);assert.throws(()=>session.import(JSON.stringify(p)));assert.equal(M.serialize(session.project),before);}
 const raw=before.replace('"look":{','"look":{"__proto__":{},');assert.throws(()=>session.import(raw));assert.equal({}.polluted,undefined);
 assert.throws(()=>session.import(' '.repeat(M.MAX_JSON_BYTES+1)));assert.throws(()=>M.validate(Object.assign(Object.create({evil:true}),session.project)));
 const p=project();p.shot.start.x='1e-256';assert.doesNotThrow(()=>M.validate(p));p.shot.start.x='0.'+'0'.repeat(255)+'1000';assert.equal(M.validate(p).shot.start.x,'0.'+'0'.repeat(255)+'1');
 p.look.hueDeg=360;p.look.pulse.phase=1;const normalized=M.validate(p);assert.equal(normalized.look.hueDeg,0);assert.equal(normalized.look.pulse.phase,0);
});
test('all numeric rule boundaries and boolean switches are strict',()=>{
 for(const [key,rule]of Object.entries(M.RULES)){
  if(['duration','speed','rollDeg','fixedIterations'].includes(key))continue;
  for(const value of rule.values||[rule.min,rule.max]){const p=project(),path=key.split('.');if(path.length===1)p.look[key]=value;else p.look[path[0]][path[1]]=value;assert.doesNotThrow(()=>M.validate(p),key);}
  for(const value of [NaN,Infinity,'0',rule.values?3:rule.min-0.01,rule.values?13:rule.max+0.01]){const p=project(),path=key.split('.');if(path.length===1)p.look[key]=value;else p.look[path[0]][path[1]]=value;assert.throws(()=>M.validate(p),key);}
 }
});
test('one drag produces one Undo, pointer cancel restores, failed edit preserves history',()=>{
 const s=M.createSession(project(),{saved:true});s.beginEdit();for(let n=1;n<=100;n++)s.applyEdit(p=>{p.look.hueDeg=n;});s.commitEdit();s.undo();assert.equal(s.project.look.hueDeg,0);assert.equal(s.dirty,false);assert.equal(s.canUndo,false);s.redo();assert.equal(s.project.look.hueDeg,100);
 s.beginEdit();s.applyEdit(p=>{p.look.prism.amount=0.9;});s.cancelEdit();assert.equal(s.project.look.prism.amount,0.35);
 assert.throws(()=>s.applyEdit(p=>{p.look.amount=NaN;}));s.undo();assert.equal(s.dirty,false);assert.equal(s.project.look.hueDeg,0);
 for(let n=1;n<=60;n++)s.applyEdit(p=>{p.name='Shot '+n;});let count=0;while(s.canUndo){s.undo();count++;}assert.equal(count,50);
});
test('Hold preserves B; reverse is atomic; invalidation distinguishes look from base',()=>{
 const s=M.createSession(project());s.applyEdit(p=>{p.shot.end.span='2';p.shot.end.rollDeg=45;});assert.equal(M.motionLabel(s.project),'Hold');s.applyEdit(p=>{p.shot.motion='travel';});assert.equal(M.motionLabel(s.project),'Tunnel In');
 const before=s.project;s.applyEdit(p=>{[p.shot.start,p.shot.end]=[p.shot.end,p.shot.start];});assert.equal(M.motionLabel(s.project),'Tunnel Out');assert.deepEqual(s.project.look,before.look);assert.deepEqual(s.project.output,before.output);s.undo();assert.deepEqual(s.project,before);
 assert.equal(s.applyEdit(p=>{p.look.wave.enabled=true;}).base,false);assert.equal(s.applyEdit(p=>{p.look.palette='mono';}).base,true);
});
test('storage is explicit, bounded and preserves corrupt or inaccessible data',()=>{
 const storage=memory(),store=M.createStore(storage),s=M.createSession(project());assert.equal(storage.values.size,0);s.save(store);assert.equal(s.dirty,false);
 s.applyEdit(p=>{p.name='Updated';});assert.equal(store.load(s.project.id).name,'Untitled shot');s.save(store);assert.equal(store.list().length,1);
 for(let n=1;n<10;n++){const p=project();p.id='project-'+n;store.save(p);}assert.equal(store.list().length,10);assert.throws(()=>store.save(project()),{code:'STORAGE_LIMIT'});store.delete('project-1');assert.equal(store.list().length,9);
 storage.values.set(M.KEY,'broken');assert.throws(()=>store.save(s.project),{code:'STORAGE_CORRUPT'});assert.equal(storage.values.get(M.KEY),'broken');assert.throws(()=>store.delete(s.project.id));
 const quota=M.createStore({getItem:()=>null,setItem:()=>{throw Error('quota');}});s.applyEdit(p=>{p.name='Unsaved';});assert.throws(()=>s.save(quota),{code:'NOT_SAVED'});assert.equal(s.dirty,true);assert.doesNotThrow(()=>M.serialize(s.project));
 assert.throws(()=>M.createStore({getItem:()=>{throw Error('denied');}}).list(),{code:'STORAGE_UNAVAILABLE'});
});
