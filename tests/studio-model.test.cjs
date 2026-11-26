'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('../src/precision.js');const M=require('../src/studio-model.js');
const project=()=>M.createProject({x:'-0.5',y:'0',span:'8',palette:'ember'});
const copy=value=>JSON.parse(JSON.stringify(value));
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
test('new project and quantized duration/speed/fps use one time axis',()=>{
 const p=project();assert.equal(p.look.palette,'ember');assert.deepEqual(p.shot.end,p.shot.start);assert.equal(p.shot.motion,'hold');
 for(const key of ['bloom','pulse','prism','kaleido','wave'])assert.equal(p.look[key].enabled,false);
 assert.equal(p.shot.frameCount,300);assert.equal(M.setSpeed(p,2).shot.frameCount,150);assert.equal(M.setSpeed(p,0.5).shot.frameCount,600);assert.equal(M.setSpeed(p,1/12).shot.frameCount,3600);
 assert.equal(M.setFps(p,24).shot.frameCount,240);assert.equal(M.setDuration(p,2.01).shot.frameCount,60);
 for(const fps of [24,30]){const q=M.setFps(p,fps),frames=Array.from({length:q.shot.frameCount},(_,k)=>M.timing(q,k));assert.equal(frames.reduce((sum,s)=>sum+s.durationUs,0),10000000);assert.equal(frames.at(-1).timestampUs,Math.round(1e6*(q.shot.frameCount-1)/fps));assert.throws(()=>M.timing(q,q.shot.frameCount));}
 for(const value of [NaN,Infinity,1.9,120.01,'10'])assert.throws(()=>M.setDuration(p,value));assert.throws(()=>M.setFps(p,25));
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
 const edits=[p=>p.schemaVersion=3,p=>p.shot.holdFrames=-1,p=>p.shot.holdFrames=1.5,p=>delete p.output.bitrate,p=>p.output.bitrate='ultra',p=>p.output.temporal='smooth',p=>p.shot.frameCount=3601,p=>p.extra=1,p=>delete p.look.prism,p=>p.look.kaleido.segments=3,p=>p.look.wave.enabled='false',p=>p.look.amount=1.01,p=>p.shot.start.x='1e-257',p=>p.shot.start.span='1e-201',p=>p.shot.start.y='1e13',p=>p.output.aspect='4:3',p=>p.name=' ',p=>p.look.bloom=[],p=>p.look.saturation=null,p=>p.shot.start.x='1'.repeat(601)];
 for(const edit of edits){const p=copy(session.project);edit(p);assert.throws(()=>session.import(JSON.stringify(p)));assert.equal(M.serialize(session.project),before);}
 const raw=before.replace('"look":{','"look":{"__proto__":{},');assert.throws(()=>session.import(raw));assert.equal({}.polluted,undefined);
 assert.throws(()=>session.import(' '.repeat(M.MAX_JSON_BYTES+1)));assert.throws(()=>M.validate(Object.assign(Object.create({evil:true}),session.project)));
 const p=project();p.shot.start.x='1e-256';assert.doesNotThrow(()=>M.validate(p));p.shot.start.x='0.'+'0'.repeat(255)+'1000';assert.equal(M.validate(p).shot.start.x,'0.'+'0'.repeat(255)+'1');
 p.look.hueDeg=360;p.look.pulse.phase=1;const normalized=M.validate(p);assert.equal(normalized.look.hueDeg,0);assert.equal(normalized.look.pulse.phase,0);
});
test('all numeric rule boundaries and boolean switches are strict',()=>{
 for(const [key,rule]of Object.entries(M.RULES)){
  if(['duration','hold','speed','rollDeg','fixedIterations'].includes(key))continue;
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

const v1=p=>{const q=copy(p);q.schemaVersion=1;delete q.shot.holdFrames;delete q.output.bitrate;delete q.output.temporal;return q;};
test('schema v2 is emitted; v1 import and saved storage migrate without changing cameras or timing',()=>{
 const p=project();p.shot.motion='travel';p.shot.end={x:'-0.25',y:'0.1',span:'1e-100',rollDeg:30};p.shot.easing='ease-in';p.shot.frameCount=480;p.shot.fps=24;p.output.container='webm';
 const old=v1(p),migrated=M.deserialize(JSON.stringify(old));
 assert.equal(migrated.schemaVersion,2);assert.equal(migrated.shot.holdFrames,0);assert.equal(migrated.output.bitrate,'standard');assert.equal(migrated.output.temporal,'raw');
 assert.deepEqual(migrated.shot.start,M.validate(p).shot.start);assert.deepEqual(migrated.shot.end,M.validate(p).shot.end);assert.equal(migrated.shot.frameCount,480);assert.equal(migrated.shot.fps,24);assert.equal(migrated.output.container,'webm');assert.deepEqual(migrated,M.validate(p));
 assert.equal(JSON.parse(M.serialize(old)).schemaVersion,2);assert.equal(M.createSession(project()).project.schemaVersion,2);
 const session=M.createSession(project());session.import(JSON.stringify(old));assert.equal(session.project.shot.frameCount,480);
 for(const edit of [q=>q.shot.holdFrames=0,q=>q.output.bitrate='standard',q=>q.output.temporal='raw',q=>q.extra=1,q=>delete q.shot.easing]){const q=copy(old);edit(q);assert.throws(()=>M.deserialize(JSON.stringify(q)));}
 const storage=memory();storage.setItem(M.KEY,JSON.stringify({schemaVersion:1,projects:[old]}));assert.equal(M.KEY,'tetra.motion.projects.v1');
 const store=M.createStore(storage);assert.deepEqual(store.load(old.id),migrated);assert.equal(store.list().length,1);
 const extra=project();extra.id='second';store.save(extra);assert.equal(JSON.parse(storage.values.get(M.KEY)).schemaVersion,2);assert.deepEqual(store.load(old.id),migrated);
 storage.setItem(M.KEY,JSON.stringify({schemaVersion:3,projects:[]}));assert.throws(()=>store.list(),{code:'STORAGE_CORRUPT'});
});
test('Hold at end, bitrate and temporal fields validate strictly and keep one time axis',()=>{
 const p=project();assert.equal(p.shot.holdFrames,0);assert.equal(p.output.bitrate,'standard');assert.equal(p.output.temporal,'raw');assert.deepEqual(M.RULES.hold,{min:0,max:10,default:0,unit:'s'});assert.equal(M.RULES.duration.max,120);
 for(const [hold,ok] of [[0,true],[1,true],[300,true],[301,false],[-1,false],[1.5,false],['1',false],[NaN,false],[null,false],[undefined,false]]){const q=copy(p);q.shot.frameCount=600;q.shot.holdFrames=hold;if(ok)assert.equal(M.validate(q).shot.holdFrames,hold);else assert.throws(()=>M.validate(q));}
 const short=copy(p);short.shot.frameCount=60;for(const [hold,ok] of [[58,true],[59,false],[60,false]]){short.shot.holdFrames=hold;if(ok)assert.doesNotThrow(()=>M.validate(short));else assert.throws(()=>M.validate(short));}
 const travel=copy(p);travel.shot.motion='travel';travel.shot.end.span='2';travel.shot.holdFrames=59;travel.shot.frameCount=60;assert.throws(()=>M.validate(travel));
 for(const bitrate of M.ENUMS.bitrate)assert.equal(M.validate({...p,output:{...p.output,bitrate}}).output.bitrate,bitrate);
 for(const temporal of M.ENUMS.temporal)assert.equal(M.validate({...p,output:{...p.output,temporal}}).output.temporal,temporal);
 assert.deepEqual(M.ENUMS.bitrate,['standard','high','master']);assert.deepEqual(M.ENUMS.temporal,['raw','stable']);
 const long=M.setDuration(p,120);assert.equal(long.shot.frameCount,3600);assert.equal(M.setFps(long,24).shot.frameCount,2880);assert.throws(()=>M.setDuration(p,120.04));assert.equal(M.setDuration(p,2).shot.frameCount,60);
 const changed=M.createSession(p).applyEdit(q=>{q.shot.holdFrames=30;});assert.equal(changed.time,true);assert.equal(changed.base,true);
 const temporal=M.createSession(p).applyEdit(q=>{q.output.temporal='stable';});assert.equal(temporal.model,true);assert.equal(temporal.base,false);
});
test('setHold, setDuration, setSpeed and setFps keep the moving travel frames',()=>{
 const long=M.setDuration(project(),20),p=M.setHold(project(),2);assert.equal(p.shot.holdFrames,60);assert.equal(M.setHold(p,0).shot.holdFrames,0);assert.throws(()=>M.setHold(p,10.1));assert.throws(()=>M.setHold(M.setDuration(p,2),2));
 assert.equal(M.setFps(p,24).shot.holdFrames,48);assert.equal(M.setFps(M.setFps(p,24),30).shot.holdFrames,60);assert.equal(M.setFps(M.setHold(long,10),24).shot.holdFrames,240);
 const clamped=M.setDuration(M.setHold(long,10),2);assert.equal(clamped.shot.frameCount,60);assert.equal(clamped.shot.holdFrames,58);
 assert.equal(M.setSpeed(M.setHold(long,10),5).shot.holdFrames,58);assert.equal(M.setDuration(p,60).shot.holdFrames,60);
 const frames=Array.from({length:p.shot.frameCount},(_,k)=>M.timing(p,k));assert.equal(frames.reduce((sum,s)=>sum+s.durationUs,0),10000000);
});
test('bitrate maps the quality tier to the target bit rate for each output size',()=>{
 const table={standard:[12e6,6e6],high:[24e6,12e6],master:[40e6,20e6]};
 for(const [bitrate,[full,hd]] of Object.entries(table)){assert.equal(M.bitrate({resolution:1080,bitrate}),full);assert.equal(M.bitrate({resolution:720,bitrate}),hd);}
 assert.equal(M.bitrate(project().output),12e6);assert.equal(M.bitrate({...project().output,resolution:720}),6e6);
 // 1440p/2160p tiers and the 1.5× 60 fps ratio; 24/30 fps targets are unchanged.
 assert.deepEqual(['standard','high','master'].map(bitrate=>[1440,2160].map(resolution=>M.bitrate({resolution,bitrate}))),[[24e6,45e6],[40e6,68e6],[60e6,100e6]]);
 for(const fps of [24,30])assert.equal(M.bitrate({resolution:1080,bitrate:'high'},fps),24e6);assert.equal(M.bitrate({resolution:1080,bitrate:'high'},60),36e6);assert.equal(M.bitrate({resolution:2160,bitrate:'master'},60),150e6);
 assert.deepEqual(['16:9','9:16','1:1'].map(aspect=>M.dimensions({aspect,resolution:2160})),[{width:3840,height:2160},{width:2160,height:3840},{width:2160,height:2160}]);
 assert.deepEqual(M.dimensions({aspect:'16:9',resolution:1440}),{width:2560,height:1440});
 const sixty=M.setDuration(M.setFps(project(),60),120);assert.equal(sixty.shot.frameCount,7200);assert.equal(M.validate(JSON.parse(M.serialize(sixty))).shot.fps,60);
});
test('every shown numeric value reads back inside its rule, including Speed 1/12 at 120 s',()=>{
 for(const [key,rule]of Object.entries(M.RULES))for(const scale of rule.values?[1]:[1,100]){
  const range=M.inputRange(key,scale);
  for(const value of rule.values||[rule.min,rule.max,rule.default]){const shown=M.display(value*scale),read=M.readInput(key,shown,scale);assert.ok(Number(shown)>=range.min&&Number(shown)<=range.max,key);assert.notEqual(read,null,key+' '+shown);assert.ok(rule.values?rule.values.includes(read):read>=rule.min&&read<=rule.max,key);}
  for(const text of ['',' ','abc','NaN','Infinity',null,String(range.min-0.00001),String(range.max+0.00001)])assert.equal(M.readInput(key,text,scale),null,key+' '+text);
 }
 assert.deepEqual(M.inputRange('speed'),{min:0.08333,max:5});assert.equal(M.readInput('speed','0.08333'),1/12);assert.equal(M.readInput('speed','0.08332'),null);assert.equal(M.readInput('fixedIterations','64.5'),null);
 // Speed is derived from whole frames; every shown Speed re-enters as the same frame count.
 for(const fps of [24,30]){const p=M.setFps(project(),fps);for(let N=2*fps;N<=120*fps;N++){const shown=M.display(10/(N/fps)),read=M.readInput('speed',shown);assert.notEqual(read,null,shown);assert.equal(M.setSpeed(p,read).shot.frameCount,N,fps+'/'+N);}}
});
test('Hold beyond the moving frames names the control and its limit, not a JSON field',()=>{
 const p=M.setDuration(project(),2);
 assert.throws(()=>M.setHold(p,2),error=>error.code==='INVALID_HOLD'&&/^Hold at end can be at most 1\.93333 s/.test(error.message)&&!/holdFrames/.test(error.message));
 assert.equal(M.setHold(p,M.readInput('hold',M.display((p.shot.frameCount-2)/p.shot.fps))).shot.holdFrames,58);
 const raw=copy(p);raw.shot.holdFrames=59;assert.throws(()=>M.validate(raw),error=>/^Hold at end/.test(error.message)&&!/holdFrames/.test(error.message));
});
