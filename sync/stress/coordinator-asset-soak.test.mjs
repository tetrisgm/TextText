import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentObservation} from './multi-field.mjs';
const {Coordinator,ROLES,hashText,validateConfig}=await import(process.env.COORDINATOR_UNDER_TEST??'./coordinator.mjs');
import {SOAK_LIMITS} from './finite-soak.mjs';
const fixture={workspaceId:'11111111-1111-4111-8111-111111111111',itemId:'22222222-2222-4222-8222-222222222222',relativePath:'Owned/Asset.textpack'};
const hashes={'assets/real.jpg':'f'.repeat(64)};
const original={schemaVersion:1,content:{title:'Owned',body:'Existing fixture text.\n\n',fields:{nested:['preserved']},assets:[{path:'assets/real.jpg'}]},presentation:{template:{id:'texttext.article',version:1}}};
function identity(role,expected=false){const web=role.endsWith('-web'),cli=role.endsWith('-cli');return{schemaVersion:1,role,platform:role.startsWith('mac-')?'darwin':'win32',artifactKind:cli?'direct-file-driver':web?'browser':'private-acceptance',principalKind:cli?'workspace-owner-binding':'authenticated-account',principalScopeHash:(ROLES.indexOf(role)+1).toString().repeat(64),runtimeName:'simulation',runtimeVersion:'1',artifacts:{source:'a'.repeat(64)},sourceReceiptSha256:'b'.repeat(64),...(web?{deploymentId:'simulation',browserVersion:'1',driverSourceCommit:'c'.repeat(40),...(expected?{sourceCommit:'d'.repeat(40)}:{})}:{sourceCommit:'d'.repeat(40)})};}
function configuration(extra={}){return{mode:'simulated',seed:17,rounds:1,timeoutMs:3000,fixture:structuredClone(fixture),assetProof:{version:1},expectedAssetHashes:{...hashes},expectedIdentities:Object.fromEntries(ROLES.map(r=>[r,identity(r,true)])),roles:Object.fromEntries(ROLES.map(r=>[r,{command:['simulation-only']}])) ,outputDir:join(mkdtempSync(join(tmpdir(),'asset-coordinator-')),'out'),...extra};}
// This injected in-memory test producer never launches a process or advertises a
// live adapter capability. Its evidence is explicitly simulated, not acceptance.
function simulation(config,{fault,initial=original,phase='baseline',target='mac-app',generation=1,slow=false,clock,extraFault}={}){
 const shared={soakRequests:[],edits:[],mutations:0,requests:[],identities:[],stops:0};
 const factory=(role)=>{
  const actor=new EventEmitter();actor.role=role;actor.stderr='';actor.start=()=>{};actor.exit=null;
  actor.stop=async()=>{shared.stops++;actor.exit={code:0,signal:null};return actor.exit;};
  const session=role.endsWith('-cli')?null:{id:role+'-fresh-'+generation,generation};
  const snapshot=()=>{const doc=structuredClone(initial);for(const e of shared.edits){for(const f of e.fieldEdits??[{field:'body',text:e.text}])doc.content[f.field]=(doc.content[f.field]??'')+f.text;}return doc;};
  const deliver=m=>queueMicrotask(()=>actor.emit('message',m));
  actor.send=m=>{
   if(m.type==='hello'){const a={type:'attest',round:0,mode:'simulated',adapter:'in-memory-simulation',...fixture,machineId:role.split('-')[0]+'-simulation',identity:identity(role),binaryAssetObservation:1,finiteSoakCorrelation:1,...(role.endsWith('-cli')?{initialPack:{packSha256:documentObservation(initial).hash,bodySha256:hashText(initial.content.body),documentSha256:documentObservation(initial).hash,assetHashes:{...hashes}}}:{}),...(session?{sessionId:session.id,generation:session.generation}:{})};if(fault==='capability'&&role===target)delete a.binaryAssetObservation;if(fault==='hello-session'&&role===target)delete a.sessionId;deliver(a);return;}
   if(m.type==='prepare'){shared.mutations++;deliver({type:'ready',round:m.round});return;}
   if(m.type==='edit'){shared.mutations++;shared.edits.push(m.edit);const fields=m.edit.fieldEdits;deliver({type:'applied',round:m.round,editId:m.edit.id,...(fields?{fieldEditIds:fields.map(e=>e.id),...(!role.endsWith('-cli')?{fieldProgress:{role,fields:fields.map((e,i)=>({ordinal:i+1,editId:e.id,field:e.field,text:e.text,visible:true,preservedVisibleContent:true,elapsedMs:i+1}))}}:{})}:{})});return;}
   if(m.type!=='observe')throw Error('Unexpected simulated request '+m.type);
   const doc=snapshot(),state={type:'state',round:m.round,text:doc.content.body,editIds:shared.edits.map(e=>e.id),assetHashes:{...hashes},...(session?{editor:{sessionId:session.id,reloads:0}}:{}),...(m.documentSnapshot?{documentSnapshot:doc}:{})};
   if(m.soakSample){state.soakSample=structuredClone(m.soakSample);shared.soakRequests.push({role,id:m.soakSample.id,assetSample:m.assetProof?.sampleId});}
   if(m.assetProof){shared.requests.push({role,round:m.round,id:m.assetProof.sampleId});Object.assign(state,{identity:identity(role),session,assetProofRequiresValidatedLiveSnapshot:role.endsWith('-cli'),assetProof:{version:1,sampleId:m.assetProof.sampleId,source:role.endsWith('-cli')?'direct-local-pack':role.endsWith('-web')?'authenticated-server-pack':'native-local-pack',scopeHash:identity(role).principalScopeHash,...fixture,archiveSha256:documentObservation(doc).hash,documentSha256:documentObservation(doc).hash,assetHashes:{...hashes},selectedItemId:role.endsWith('-cli')?null:fixture.itemId,selectedPath:role.endsWith('-app')?fixture.relativePath:null}});
    const relevant=phase==='baseline'?shared.edits.length===0:shared.edits.length>0;
    if(relevant&&(role===target||fault?.startsWith('all-'))){
     if(fault==='missing')delete state.assetProof;
     if(fault==='stale')state.assetProof.sampleId='99999999-1111-4111-8111-111111111111';
     if(fault==='snapshot')delete state.documentSnapshot;
     if(fault==='marker')state.assetProofRequiresValidatedLiveSnapshot=!role.endsWith('-cli');
     if(fault==='identity')state.identity.principalScopeHash='0'.repeat(64);
     if(fault==='source')state.identity.artifacts.source='0'.repeat(64);
     if(fault==='session')state.session={id:'drift',generation};
     if(fault==='generation')state.session={...session,generation:2};
     if(fault==='path')state.assetProof.relativePath='Other.textpack';
     if(fault==='all-map')state.assetProof.assetHashes={'assets/real.jpg':'0'.repeat(64)};
     if(fault==='all-extra')state.assetProof.assetHashes['assets/hidden.jpg']='0'.repeat(64);
     if(fault==='all-hidden'){state.documentSnapshot.content.fields.nested=['drift'];state.assetProof.documentSha256=documentObservation(state.documentSnapshot).hash;}
     if(fault==='all-subtitle'){state.documentSnapshot.content.subtitle='';state.assetProof.documentSha256=documentObservation(state.documentSnapshot).hash;}
     if(fault==='missing-role')return;
     if(fault==='wrong-round')state.round--;
     if(fault==='duplicate'){deliver(state);deliver(state);return;}
    }
   }
   if(extraFault)extraFault({role,message:m,state,shared,deliver,clock});
   if(slow&&m.assetProof){setTimeout(()=>deliver(state),20);}else deliver(state);
  };return actor;
 };return{shared,coordinator:new Coordinator(config,{adapterFactory:factory,...(clock?{soakClock:()=>clock.now,soakSleep:async ms=>{clock.now+=ms;}}:{})})};
}

const soak={version:1,durationMs:3600000,cadenceMs:30000};
const mixed={version:1,rounds:[{kind:'plain'},{kind:'fields'}]};
const initial={...structuredClone(original),content:{...structuredClone(original.content),subtitle:'Existing subtitle.'}};
function setup(extra={}){const clock={now:100};const config=configuration({rounds:2,mixedSchedule:structuredClone(mixed),soak,...extra.config});return simulation(config,{initial,clock,...extra});}
test('asset-proof finite dwell adds one complete fresh proof wave to each of121 existing samples',async()=>{const {coordinator,shared}=setup();const r=await coordinator.run();assert.equal(r.status,'passed',JSON.stringify(r.failure));assert.equal(r.acceptance,'none');assert.equal(r.assetProofEvidence.length,3);assert.ok(r.assetProofEvidence.every(p=>p.stableWaves===3));assert.equal(r.soakEvidence.samples,121);assert.equal(r.soakEvidence.assetProof.samples.length,121);assert.equal(shared.soakRequests.length,726);assert.equal(new Set(shared.soakRequests.map(x=>x.assetSample)).size,121);assert.ok(r.soakEvidence.assetProof.stableWaves>=3);assert.equal(r.soakEvidence.durationMs,3600000);assert.ok(r.soakEvidence.evidenceBytes<=SOAK_LIMITS.evidenceBytes);assert.equal(shared.stops,6);});
for(const fault of ['missing-proof','stale-proof','missing-soak','old-soak','identity','session','source','marker','all-map','all-hidden','missing-snapshot','last-map','late','duplicate'])test('dwell fails first actual proof/correlation defect '+fault,async()=>{
 const priorUUID={};let failedSample;
 const s=setup({extraFault({role,message,state,deliver,clock}){
  if(!message.soakSample)return;
  const index=Number(message.soakSample.id.split(':').at(-1));
  const active=(fault==='last-map'?index===120:index===1);
  if(!active){priorUUID[role]=message.assetProof.sampleId;return;}
  if(role!=='mac-app'&&!fault.startsWith('all-'))return;
  failedSample??=index;
  if(fault==='missing-proof')delete state.assetProof;
  if(fault==='stale-proof')state.assetProof.sampleId=priorUUID[role];
  if(fault==='missing-soak')delete state.soakSample;
  if(fault==='old-soak')state.soakSample.id=state.soakSample.id.replace(/:1$/,':0');
  if(fault==='identity')state.identity.principalScopeHash='0'.repeat(64);
  if(fault==='source')state.identity.artifacts.source='0'.repeat(64);
  if(fault==='session')state.session.id+='-drift';
  if(fault==='marker')state.assetProofRequiresValidatedLiveSnapshot=!role.endsWith('-cli');
  if(fault==='all-map'||fault==='last-map')state.assetProof.assetHashes['assets/real.jpg']='0'.repeat(64);
  if(fault==='all-hidden'){state.documentSnapshot.content.fields.nested=['drift'];state.assetProof.documentSha256=documentObservation(state.documentSnapshot).hash;}
  if(fault==='missing-snapshot')delete state.documentSnapshot;
  if(fault==='late')clock.now+=SOAK_LIMITS.responseMs+1;
  if(fault==='duplicate')deliver(state);
 }});
 const r=await s.coordinator.run();assert.equal(r.status,'failed');assert.equal(r.soakEvidence,undefined);assert.match(r.failure.code,/soak/);assert.equal(r.roundsCompleted,2);assert.equal(failedSample,fault==='last-map'?120:1);assert.equal(s.shared.stops,6);
});
test('121-sample asset ledger is independent from new reopen proof and complete prior receipt required',async()=>{
 const s=setup(),r=await s.coordinator.run();assert.equal(r.status,'passed',JSON.stringify(r.failure));
 const file=join(mkdtempSync(join(tmpdir(),'soak-asset-prior-')),'receipt.json');
 const prior={...r,mode:'real',acceptance:'synthetic-constructor-fixture-only'};
 const config=configuration({mode:'real',rounds:0,soak,mixedSchedule:structuredClone(mixed),expectedBaselineHash:r.finalHash,expectedDocumentHash:r.finalDocumentHash,reopenReceipt:file});
 const check=p=>{writeFileSync(file,JSON.stringify(p));return()=>new Coordinator(structuredClone(config));};
 assert.doesNotThrow(check(prior));
 for(const alter of [p=>{delete p.soakEvidence.assetProof;},p=>{p.soakEvidence.assetProof.samples.pop();},p=>{p.soakEvidence.assetProof.samples[1].sampleId=p.soakEvidence.assetProof.samples[0].sampleId;},p=>{p.soakEvidence.assetProof.samples[0].id='old:soak:0';},p=>{p.soakEvidence.assetProof.samples[120].documentSha256='0'.repeat(64);},p=>{p.soakEvidence.assetProof.assetHashes['assets/real.jpg']='0'.repeat(64);},p=>{p.soakEvidence.assetProof.samples[120].stableWaves=999;},p=>{p.soakEvidence.samples=120;}]){const changed=structuredClone(prior);alter(changed);assert.throws(check(changed));}
 // Fresh simulated zero-round reopen uses new generations and proof UUIDs.
 const doc=structuredClone(initial);for(const e of s.shared.edits)for(const f of e.fieldEdits??[{field:'body',text:e.text}])doc.content[f.field]=(doc.content[f.field]??'')+f.text;
 const c=configuration({rounds:0,soak,mixedSchedule:structuredClone(mixed),expectedBaselineHash:r.finalHash,expectedDocumentHash:r.finalDocumentHash});
 // Existing mixed constructor only accepts prior real receipts even in the
 // simulated reopen fixture. It validates this constructor-only prior first.
 c.reopenReceipt=file;writeFileSync(file,JSON.stringify(prior));c.expectedIdentities=structuredClone(config.expectedIdentities);
 const next=simulation(c,{initial:doc,generation:2}), reopened=await next.coordinator.run();assert.equal(reopened.status,'passed',JSON.stringify(reopened.failure));assert.equal(next.shared.mutations,0);assert.equal(next.shared.soakRequests.length,0);assert.equal(reopened.assetProofEvidence[0].phase,'reopen');assert.ok(next.shared.requests.every(x=>!s.shared.requests.some(y=>y.id===x.id)));
});
test('121 extra full replies over64MiB and compact maps over16MiB reject before prepare',async()=>{
 const doc=structuredClone(initial);doc.content.fields.large='x'.repeat(80000);
 const many={version:1,rounds:Array.from({length:100},(_,i)=>({kind:i%2?'fields':'plain'}))};
 const s=setup({initial:doc,config:{rounds:100,mixedSchedule:many}});const r=await s.coordinator.run();assert.equal(r.failure?.code,'asset-proof-output-budget');assert.equal(s.shared.mutations,0);
 const assets=Object.fromEntries(Array.from({length:32},(_,i)=>['assets/'+String(i).padStart(2,'0')+'x'.repeat(900)+'.jpg','f'.repeat(64)]));
 const big=setup({config:{expectedAssetHashes:assets}});const report=await big.coordinator.run();assert.equal(report.failure?.code,'asset-proof-soak-evidence-budget');assert.equal(big.shared.mutations,0);
});
test('actual64MiB aggregate proof output is charged during dwell',async()=>{const s=setup();const run=s.coordinator.runSoak.bind(s.coordinator);s.coordinator.runSoak=async()=>{s.coordinator.assetOutputBytes['mac-app']=64*1024*1024;return run();};const r=await s.coordinator.run();assert.equal(r.failure?.code,'soak-sample-failed');assert.equal(r.soakEvidence,undefined);});
test('100-round real plan allowed but arbitrary clocks, cadence and unsupported combinations refuse',()=>{const many={version:1,rounds:Array.from({length:100},(_,i)=>({kind:i%2?'fields':'plain'}))};const c=configuration({mode:'real',rounds:100,soak,mixedSchedule:many});assert.doesNotThrow(()=>validateConfig(c));assert.throws(()=>new Coordinator(c,{soakClock:()=>0}));assert.throws(()=>validateConfig(configuration({soak:{...soak,cadenceMs:1000},mixedSchedule:many,rounds:100})));assert.throws(()=>validateConfig(configuration({soak,mixedSchedule:many,rounds:100,restart:{role:'mac-app',round:1}})));});
test('default-off finite dwell preserves original121 samples without any asset requests',async()=>{const s=setup({config:{assetProof:undefined}});const r=await s.coordinator.run();assert.equal(r.status,'passed',JSON.stringify(r.failure));assert.equal(r.soakEvidence.samples,121);assert.equal(r.soakEvidence.assetProof,undefined);assert.equal(s.shared.requests.length,0);assert.equal(s.shared.soakRequests.length,726);assert.equal(r.assetProofEvidence,undefined);});
for(const fault of ['raw-marker','raw-snapshot','generation'])test('dwell checks independent raw/validated boundary '+fault,async()=>{const s=setup({extraFault({role,message,state}){if(!message.soakSample?.id.endsWith(':1'))return;if(fault==='generation'&&role==='mac-app')state.session.generation=2;if(role==='pc-cli'){if(fault==='raw-marker')state.assetProofRequiresValidatedLiveSnapshot=false;if(fault==='raw-snapshot'){state.documentSnapshot.content.fields.nested=['raw drift'];state.assetProof.documentSha256=documentObservation(state.documentSnapshot).hash;}}}});const r=await s.coordinator.run();assert.equal(r.status,'failed');assert.equal(r.failure.code,'soak-sample-failed');assert.equal(r.soakEvidence,undefined);});
