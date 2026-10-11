/* Motion projects: exact coordinates, explicit persistence and transactional edits. */
(function(root){
 'use strict';
 const f=createFixed(256),KEY='tetra.motion.projects.v1',LIMIT=10,MAX_JSON_BYTES=128*1024,UNDO_LIMIT=50;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
 const RULES=freeze({
  duration:{min:2,max:20,default:10,unit:'s'},speed:{min:0.5,max:5,default:1,unit:'×'},
  rollDeg:{min:-180,max:180,default:0,unit:'°'},
  hueDeg:{min:0,max:360,default:0,unit:'°'},hueRate:{min:-0.25,max:0.25,default:0,unit:'turns/s'},
  saturation:{min:0,max:2,default:1,unit:'×'},exposureEV:{min:-2,max:2,default:0,unit:'EV'},
  'bloom.intensity':{min:0,max:2,default:0.35,unit:'×'},'bloom.radiusRatio':{min:0,max:0.03,default:0.008,unit:'short-side ratio'},'bloom.threshold':{min:0,max:1,default:0.65,unit:'linear'},
  'pulse.period':{min:0.5,max:8,default:1,unit:'s'},'pulse.strength':{min:0,max:1,default:0.4,unit:'×'},'pulse.sharpness':{min:1,max:4,default:2,unit:'×'},'pulse.phase':{min:0,max:1,default:0,unit:'turns'},
  'pulse.exposureEV':{min:0,max:0.5,default:0.35,unit:'EV'},'pulse.bloomGain':{min:0,max:1.5,default:0.8,unit:'×'},
  'prism.amount':{min:0,max:1,default:0.35,unit:'×'},'prism.offsetRatio':{min:0,max:0.015,default:0.003,unit:'short-side ratio'},
  'kaleido.segments':{values:[2,4,6,8,10,12],default:6,unit:'segments'},'kaleido.blend':{min:0,max:1,default:0.5,unit:'×'},'kaleido.angleDeg':{min:-180,max:180,default:0,unit:'°'},
  'wave.strengthEV':{min:0,max:1,default:0.35,unit:'EV'},'wave.fieldCycles':{min:0.25,max:4,default:1,unit:'cycles'},'wave.speed':{min:-1,max:1,default:0.25,unit:'cycles/s'},amount:{min:0,max:1,default:1,unit:'×'},
  fixedIterations:{min:64,max:16384,default:1024,integer:true,unit:'iterations'}
 });
 const ENUMS=freeze({palette:['aurora','ember','tidal','mono'],motion:['hold','travel'],fps:[24,30],easing:['linear','ease-in','ease-out','ease-in-out'],aspect:['16:9','9:16','1:1'],resolution:[720,1080],samples:[4,16],container:['auto','mp4','webm'],iterations:['auto-shot','fixed']});
 function fail(code,message){const error=new Error(message);error.code=code;throw error;}
 function shape(value,keys,path){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_PROJECT',path+' must be an object');
  const actual=Object.keys(value);
  if(actual.length!==keys.length||actual.some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))fail('INVALID_PROJECT',path+' has missing or unknown fields');
 }
 function text(value,path){if(typeof value!=='string'||!value.trim()||value.trim().length>80)fail('INVALID_PROJECT',path+' must have 1–80 characters');return value.trim();}
 function choice(value,key){if(!ENUMS[key].includes(value))fail('INVALID_PROJECT','Invalid '+key);return value;}
 function numeric(value,key){const r=RULES[key];if(typeof value!=='number'||!Number.isFinite(value)||(r.values?!r.values.includes(value):value<r.min||value>r.max)||(r.integer&&!Number.isInteger(value)))fail('INVALID_PROJECT','Invalid '+key);return value;}
 function decimal(value,key){
  if(typeof value!=='string'||value.length>600)fail('INVALID_COORDINATE',key+' must be a decimal string of at most 600 characters');
  const match=/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d{1,4}))?$/i.exec(value);
  if(!match||!(match[2]||match[3])||Math.abs(Number(match[4]||0))>512)fail('INVALID_COORDINATE','Invalid '+key);
  const coefficient=BigInt((match[2]||'0')+(match[3]||'')),shift=256+Number(match[4]||0)-(match[3]||'').length;
  if(shift<0&&coefficient%10n**BigInt(-shift)!==0n)fail('COORDINATE_PRECISION',key+' exceeds 256 decimal places');
  const number=f.parse(value),bound=f.parse('1e12');
  if(key==='span'?(number<f.parse('1e-200')||number>bound):f.abs(number)>bound)fail('INVALID_COORDINATE',key+' is out of range');
  return f.text(number);
 }
 function camera(value){shape(value,['x','y','span','rollDeg'],'camera');return {x:decimal(value.x,'x'),y:decimal(value.y,'y'),span:decimal(value.span,'span'),rollDeg:numeric(value.rollDeg,'rollDeg')};}
 const lookKeys=['palette','hueDeg','hueRate','saturation','exposureEV','bloom','pulse','prism','kaleido','wave','amount'];
 const groups={bloom:['intensity','radiusRatio','threshold'],pulse:['period','strength','sharpness','phase','exposureEV','bloomGain'],prism:['amount','offsetRatio'],kaleido:['segments','blend','angleDeg'],wave:['strengthEV','fieldCycles','speed']};
 function neutralLook(palette='aurora'){
  const look={palette:choice(palette,'palette')};
  for(const key of lookKeys)if(RULES[key])look[key]=RULES[key].default;
  for(const [group,keys]of Object.entries(groups)){look[group]={enabled:false};for(const key of keys)look[group][key]=RULES[group+'.'+key].default;}
  return look;
 }
 function validate(value){
  shape(value,['kind','schemaVersion','id','name','shot','look','output','numerics'],'project');
  if(value.kind!=='tetra-motion'||value.schemaVersion!==1)fail('SCHEMA_VERSION','Unsupported Motion project schema');
  shape(value.shot,['start','end','motion','frameCount','fps','easing'],'shot');
  const fps=choice(value.shot.fps,'fps'),N=value.shot.frameCount;
  if(!Number.isInteger(N)||N<RULES.duration.min*fps||N>RULES.duration.max*fps)fail('INVALID_PROJECT','frameCount must describe 2–20 seconds');
  const shot={start:camera(value.shot.start),end:camera(value.shot.end),motion:choice(value.shot.motion,'motion'),frameCount:N,fps,easing:choice(value.shot.easing,'easing')};
  shape(value.look,lookKeys,'look');
  const look={palette:choice(value.look.palette,'palette')};
  for(const key of lookKeys)if(RULES[key])look[key]=numeric(value.look[key],key);
  for(const [group,keys]of Object.entries(groups)){
   shape(value.look[group],['enabled',...keys],group);
   if(typeof value.look[group].enabled!=='boolean')fail('INVALID_PROJECT',group+'.enabled must be boolean');
   look[group]={enabled:value.look[group].enabled};for(const key of keys)look[group][key]=numeric(value.look[group][key],group+'.'+key);
  }
  if(look.hueDeg===360)look.hueDeg=0;if(look.pulse.phase===1)look.pulse.phase=0;
  shape(value.output,['aspect','resolution','samples','container'],'output');
  const output={};for(const key of ['aspect','resolution','samples','container'])output[key]=choice(value.output[key],key);
  shape(value.numerics,['iterations','fixedIterations'],'numerics');
  return {kind:'tetra-motion',schemaVersion:1,id:text(value.id,'id'),name:text(value.name,'name'),shot,look,output,numerics:{iterations:choice(value.numerics.iterations,'iterations'),fixedIterations:numeric(value.numerics.fixedIterations,'fixedIterations')}};
 }
 function createProject(explore){
  const source=explore.camera||explore,start=camera({x:source.x,y:source.y,span:source.span,rollDeg:0});
  return validate({kind:'tetra-motion',schemaVersion:1,id:root.crypto?.randomUUID?.()||'shot-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),name:'Untitled shot',
   shot:{start,end:{...start},motion:'hold',frameCount:RULES.duration.default*30,fps:30,easing:'ease-in-out'},look:neutralLook(explore.palette||'aurora'),
   output:{aspect:'9:16',resolution:1080,samples:4,container:'auto'},numerics:{iterations:'auto-shot',fixedIterations:RULES.fixedIterations.default}});
 }
 function byteLength(value){return new TextEncoder().encode(value).length;}
 function serialize(value){const result=JSON.stringify(validate(value));if(byteLength(result)>MAX_JSON_BYTES)fail('JSON_TOO_LARGE','Project exceeds 128 KiB');return result;}
 function deserialize(raw){
  if(typeof raw!=='string'||byteLength(raw)>MAX_JSON_BYTES)fail('JSON_TOO_LARGE','Project exceeds 128 KiB');
  let value;try{value=JSON.parse(raw);}catch{fail('INVALID_JSON','Invalid project JSON');}return validate(value);
 }
 function setDuration(project,seconds){numeric(seconds,'duration');const result=clone(project);result.shot.frameCount=Math.round(seconds*result.shot.fps);return validate(result);}
 function setSpeed(project,speed){numeric(speed,'speed');return setDuration(project,RULES.duration.default/speed);}
 function setFps(project,fps){choice(fps,'fps');const result=clone(project);result.shot.frameCount=Math.round(result.shot.frameCount/result.shot.fps*fps);result.shot.fps=fps;return validate(result);}
 function timing(project,k){const {frameCount:N,fps}=project.shot;if(!Number.isInteger(k)||k<0||k>=N)fail('INVALID_FRAME','Frame is outside the shot');const timestampUs=Math.round(1e6*k/fps);return {k,u:k/(N-1),seconds:k/fps,timestampUs,durationUs:Math.round(1e6*(k+1)/fps)-timestampUs};}
 function dimensions(output){const short=output.resolution,long=short===720?1280:1920;return output.aspect==='16:9'?{width:long,height:short}:output.aspect==='9:16'?{width:short,height:long}:{width:short,height:short};}
 function motionLabel(project){const {start,end,motion}=project.shot;if(motion==='hold')return 'Hold';const a=f.parse(start.span),b=f.parse(end.span);return b<a?'Tunnel In':b>a?'Tunnel Out':'Drift';}
 function changeKind(before,after){
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  return {model:!same(before,after),time:!same(before.shot,after.shot),
   base:!same(before.shot,after.shot)||!same(before.numerics,after.numerics)||before.look.palette!==after.look.palette||['aspect','resolution','samples'].some(k=>before.output[k]!==after.output[k]),look:!same(before.look,after.look)};
 }
 function createSession(project,{saved=false}={}){
  let current=freeze(validate(project)),baseline=saved?serialize(current):null,transaction=null,revision=0;
  const past=[],future=[];
  function push(before){past.push(before);if(past.length>UNDO_LIMIT)past.shift();future.length=0;}
  function replace(next){const before=current;current=freeze(validate(next));const changed=changeKind(before,current);if(changed.model)revision++;return changed;}
  return {
   get project(){return current;},get dirty(){return serialize(current)!==baseline;},get revision(){return revision;},get canUndo(){return past.length>0;},get canRedo(){return future.length>0;},get editing(){return transaction!==null;},
   applyEdit(edit){const next=clone(current),before=current;const returned=edit(next);const validated=validate(returned||next);if(serialize(before)!==serialize(validated)&&transaction===null)push(before);return replace(validated);},
   beginEdit(){if(transaction!==null)fail('EDIT_ACTIVE','An edit is already active');transaction=current;},
   commitEdit(){if(transaction===null)return;const before=transaction;transaction=null;if(serialize(before)!==serialize(current))push(before);},
   cancelEdit(){if(transaction!==null){const before=transaction;transaction=null;return replace(before);}},
   undo(){if(transaction!==null)fail('EDIT_ACTIVE','Finish the current edit first');if(past.length){future.push(current);return replace(past.pop());}},
   redo(){if(transaction!==null)fail('EDIT_ACTIVE','Finish the current edit first');if(future.length){past.push(current);return replace(future.pop());}},
   markSaved(){baseline=serialize(current);},
   markUnsaved(){baseline=null;},
   import(raw){const next=deserialize(raw);if(transaction!==null)fail('EDIT_ACTIVE','Finish the current edit first');push(current);return replace(next);},
   load(next){const validated=validate(next);if(transaction!==null)fail('EDIT_ACTIVE','Finish the current edit first');past.length=0;future.length=0;replace(validated);baseline=serialize(current);},
   save(store){store.save(current);baseline=serialize(current);}
  };
 }
 function createStore(storage){
  function read(){
   let raw;try{raw=storage.getItem(KEY);}catch{fail('STORAGE_UNAVAILABLE','Cannot access saved projects. Export JSON to keep your work.');}
   if(raw===null)return [];
   try{
    if(typeof raw!=='string'||byteLength(raw)>LIMIT*MAX_JSON_BYTES+1024)throw Error();
    const data=JSON.parse(raw);shape(data,['schemaVersion','projects'],'saved projects');
    if(data.schemaVersion!==1||!Array.isArray(data.projects)||data.projects.length>LIMIT)throw Error();
    const projects=data.projects.map(validate);if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error();return projects;
   }catch{fail('STORAGE_CORRUPT','Saved projects are damaged. Existing data was preserved; export JSON to keep your current work.');}
  }
  function write(projects){try{storage.setItem(KEY,JSON.stringify({schemaVersion:1,projects}));}catch{fail('NOT_SAVED','Not saved. Storage is unavailable or full; export JSON to keep your work.');}}
  return {list:read,load(id){const project=read().find(p=>p.id===id);if(!project)fail('PROJECT_MISSING','Saved project was not found');return project;},
   save(value){const project=validate(value),projects=read(),index=projects.findIndex(p=>p.id===project.id);if(index<0){if(projects.length>=LIMIT)fail('STORAGE_LIMIT','Up to 10 projects can be saved. Delete a project or export JSON.');projects.push(project);}else projects[index]=project;write(projects);return project;},
   delete(id){const projects=read(),remaining=projects.filter(p=>p.id!==id);if(remaining.length!==projects.length)write(remaining);}
  };
 }
 root.TetraStudioModel={KEY,LIMIT,MAX_JSON_BYTES,UNDO_LIMIT,RULES,ENUMS,neutralLook,createProject,validate,serialize,deserialize,setDuration,setSpeed,setFps,timing,dimensions,motionLabel,changeKind,createSession,createStore};
 if(typeof module!=='undefined')module.exports=root.TetraStudioModel;
})(globalThis);
