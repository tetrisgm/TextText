import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAssetProofOracle,MAX_ASSET_WAVES,ASSET_WAVE_ROLES as roles} from './asset-proof-wave.mjs';
import {validateAssetHashes} from './asset-proof.mjs';
import {documentObservation} from './multi-field.mjs';
const fixture={workspaceId:'11111111-1111-4111-8111-111111111111',itemId:'22222222-2222-4222-8222-222222222222',relativePath:'Owned/Asset.textpack'};
const sample=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const document={schemaVersion:1,content:{title:'Owned',body:'Actual',fields:{nested:['retained']}},presentation:{template:{id:'texttext.article'}}};
function identity(role,expected=false) {
 const web=role.endsWith('-web'),cli=role.endsWith('-cli');
 const value={schemaVersion:1,role,platform:role.startsWith('mac-')?'darwin':'win32',artifactKind:cli?'direct-file-driver':web?'browser':'private-acceptance',principalKind:cli?'workspace-owner-binding':'authenticated-account',principalScopeHash:(roles.indexOf(role)+1).toString().repeat(64),runtimeName:'controlled',runtimeVersion:'1',artifacts:{source:'a'.repeat(64)},sourceReceiptSha256:'b'.repeat(64)};
 if(web) Object.assign(value,{deploymentId:'owned-deployment',browserVersion:'1',driverSourceCommit:'c'.repeat(40),...(expected?{sourceCommit:'d'.repeat(40)}:{})});
 else value.sourceCommit='d'.repeat(40);
 return value;
}
const session=role=>role.endsWith('-cli')?null:{id:role+'-session',generation:1};
function config(){return{fixture:structuredClone(fixture),pins:Object.fromEntries(roles.map(role=>[role,{identity:identity(role,true),session:session(role)}])),timeoutMs:1000,expectedAssetHashes:{'assets/real.jpg':'f'.repeat(64)}};}
function reply(role,id=sample(1),snapshot=document){return{identity:identity(role),session:session(role),documentSnapshot:structuredClone(snapshot),assetProofRequiresValidatedLiveSnapshot:role.endsWith('-cli'),assetProof:{version:1,sampleId:id,source:role.endsWith('-cli')?'direct-local-pack':role.endsWith('-web')?'authenticated-server-pack':'native-local-pack',scopeHash:identity(role).principalScopeHash,...fixture,archiveSha256:(roles.indexOf(role)+1).toString().repeat(64),documentSha256:documentObservation(snapshot).hash,assetHashes:{'assets/real.jpg':'f'.repeat(64)},selectedItemId:role.endsWith('-cli')?null:fixture.itemId,selectedPath:role.endsWith('-app')?fixture.relativePath:null}};}
function complete(oracle,id=sample(1),now=0,make=reply){oracle.begin(id,now);for(const role of [...roles].reverse())oracle.add(role,make(role,id),now);return oracle.finish(now);}
test('fixed six-role wave accepts independent archive hashes and freezes detached evidence',()=>{
 const c=config(),oracle=createAssetProofOracle(c);oracle.begin(sample(1),0);
 const inputs=roles.map(role=>reply(role));for(let i=0;i<6;i++)oracle.add(roles[i],inputs[i],1);
 inputs[0].documentSnapshot.content.fields.nested[0]='mutated';inputs[0].assetProof.assetHashes['assets/real.jpg']='0'.repeat(64);c.pins['mac-app'].session.id='mutated';
 const result=oracle.finish(2);assert.equal(result.replies['mac-app'].documentSnapshot.content.fields.nested[0],'retained');assert.equal(Object.keys(result.replies).length,6);
 assert.notEqual(result.replies['mac-app'].proof.archiveSha256,result.replies['pc-app'].proof.archiveSha256);assert.ok(Object.isFrozen(result.replies['mac-app'].documentSnapshot.content.fields.nested));assert.equal(result.stable,false);
});
test('three complete stable waves exclude sampleUUID but retain per-role archive stability',()=>{
 const oracle=createAssetProofOracle(config());assert.equal(complete(oracle,sample(1),0).stableWaves,1);assert.equal(complete(oracle,sample(2),10).stableWaves,2);assert.equal(complete(oracle,sample(3),20).stable,true);
 assert.equal(complete(oracle,sample(4),30,(role,id)=>{const r=reply(role,id);r.assetProof.archiveSha256='9'.repeat(64);return r;}).stableWaves,1);
});
test('cannot reduce quorum or finish from raw file replies alone',()=>{
 assert.throws(()=>createAssetProofOracle({...config(),expectedRoles:['mac-cli']}));
 const c=config();delete c.pins['pc-cli'];assert.throws(()=>createAssetProofOracle(c));
 const o=createAssetProofOracle(config());o.begin(sample(1),0);for(const role of roles.filter(x=>x.endsWith('-cli')))o.add(role,reply(role),0);assert.throws(()=>o.finish(0));
});
for(const [name,alter] of Object.entries({
 wrongSample:r=>{r.assetProof.sampleId=sample(2);},wrongScope:r=>{r.assetProof.scopeHash='0'.repeat(64);},wrongSource:r=>{r.assetProof.source='direct-local-pack';},wrongItem:r=>{r.assetProof.itemId=fixture.workspaceId;},wrongSelected:r=>{r.assetProof.selectedPath='Other.textpack';},wrongSession:r=>{r.session.id='other';},wrongGeneration:r=>{r.session.generation++;},wrongPrincipal:r=>{r.identity.principalKind='workspace-owner-binding';},rawMarker:r=>{r.assetProofRequiresValidatedLiveSnapshot=true;},missingMarker:r=>{delete r.assetProofRequiresValidatedLiveSnapshot;},emptyAssets:r=>{r.assetProof.assetHashes={};},extraProof:r=>{r.assetProof.future=true;},futureVersion:r=>{r.assetProof.version=2;},hiddenDrift:r=>{r.documentSnapshot.content.fields.nested.push('drift');r.assetProof.documentSha256=documentObservation(r.documentSnapshot).hash;},subtitleDrift:r=>{r.documentSnapshot.content.subtitle='';r.assetProof.documentSha256=documentObservation(r.documentSnapshot).hash;},assetDrift:r=>{r.assetProof.assetHashes['assets/real.jpg']='0'.repeat(64);}
}))test('refuses '+name,()=>{
 const o=createAssetProofOracle(config());o.begin(sample(1),0);const r=reply('mac-app');alter(r);assert.throws(()=>{o.add('mac-app',r,0);for(const role of roles.slice(1))o.add(role,reply(role),0);o.finish(0);});assert.throws(()=>o.begin(sample(3),1));
});
test('both raw file snapshots must match independent validated live same wave',()=>{
 const o=createAssetProofOracle(config());o.begin(sample(1),0);for(const role of roles){const r=reply(role);if(role.endsWith('-cli')){r.documentSnapshot.content.fields.nested=['malformed raw shape'];r.assetProof.documentSha256=documentObservation(r.documentSnapshot).hash;}o.add(role,r,0);}assert.throws(()=>o.finish(0));
});
test('strict sparse/accessor/symbol boundaries never invoke getter',()=>{
 for(const make of [()=>{const r=reply('mac-app');r.documentSnapshot.content.fields.nested=Array(1);return r;},()=>{const r=reply('mac-app');Object.defineProperty(r,'assetProof',{get(){throw Error('GETTER EXECUTED');},enumerable:true});return r;},()=>{const r=reply('mac-app');r[Symbol('extra')]=1;return r;}]){
  const o=createAssetProofOracle(config());o.begin(sample(1),0);assert.throws(()=>o.add('mac-app',make(),0),error=>!error.message.includes('GETTER EXECUTED'));
 }
});
test('duplicates unknown role stale UUID monotonic deadline and fatal cleanup refuse',()=>{
 let o=createAssetProofOracle(config());o.begin(sample(1),0);o.add('mac-app',reply('mac-app'),0);assert.throws(()=>o.add('mac-app',reply('mac-app'),0));assert.throws(()=>o.finish(0));
 o=createAssetProofOracle(config());o.begin(sample(1),0);assert.throws(()=>o.add('other',reply('mac-app'),0));
 o=createAssetProofOracle(config());complete(o);assert.throws(()=>o.begin(sample(1),1));
 o=createAssetProofOracle(config());o.begin(sample(1),0);assert.throws(()=>o.add('mac-app',reply('mac-app'),1000));
 o=createAssetProofOracle(config());o.begin(sample(1),10);assert.throws(()=>o.add('mac-app',reply('mac-app'),9));
 o=createAssetProofOracle(config());assert.throws(()=>o.begin(sample(1),NaN));
});
test('no expected hash can replace actual observed document/asset proof',()=>{
 const c=config();c.expectedAssetHashes={};assert.throws(()=>createAssetProofOracle(c));
 const o=createAssetProofOracle(config());o.begin(sample(1),0);const r=reply('mac-app');r.assetProof.documentSha256='0'.repeat(64);assert.throws(()=>o.add('mac-app',r,0));
});

test('invalid fixture/session pins refuse before collecting a wave',()=>{
 for(const alter of [c=>{c.fixture.itemId='invalid';},c=>{c.fixture.relativePath='../Owned.textpack';},c=>{c.pins['mac-app'].session.id+='\n';},c=>{c.pins['mac-cli'].session={id:'invented',generation:1};},c=>{c.timeoutMs=120001;}]){const c=config();alter(c);assert.throws(()=>createAssetProofOracle(c));}
});
test('uniform new full content starts new stability series; old completed wave cannot reply',()=>{
 const o=createAssetProofOracle(config());complete(o);const next=structuredClone(document);next.content.subtitle='new';
 const r=complete(o,sample(2),10,(role,id)=>reply(role,id,next));assert.equal(r.stableWaves,1);
 assert.throws(()=>o.add('mac-app',reply('mac-app',sample(2),next),11));
});

for(const [name,alter] of Object.entries({
  sameWrong:r=>{r.assetProof.assetHashes['assets/real.jpg']='0'.repeat(64);},
  sameExtra:r=>{r.assetProof.assetHashes['assets/extra.jpg']='1'.repeat(64);},
  sameMissing:r=>{r.assetProof.assetHashes={'assets/other.jpg':'f'.repeat(64)};}
}))test('all six matching '+name+' maps cannot replace explicit expected pin',()=>{
 const o=createAssetProofOracle(config());o.begin(sample(1),0);
 for(const role of roles){const r=reply(role);alter(r);o.add(role,r,0);}
 assert.throws(()=>o.finish(0));
});
test('missing one of multiple pinned assets refuses even when all six agree',()=>{
 const c=config();c.expectedAssetHashes['assets/second.jpg']='a'.repeat(64);
 const o=createAssetProofOracle(c);assert.throws(()=>complete(o));
});
test('expected map is strict nonempty detached pin, never observed output',()=>{
 for(const map of [{},{'../unsafe':'f'.repeat(64)},{'assets/a':'bad'},Object.fromEntries(Array.from({length:33},(_,i)=>['assets/'+i,'f'.repeat(64)]))]){const c=config();c.expectedAssetHashes=map;assert.throws(()=>createAssetProofOracle(c));}
 let calls=0;const c=config();Object.defineProperty(c.expectedAssetHashes,'assets/real.jpg',{enumerable:true,get(){calls++;return 'f'.repeat(64);}});assert.throws(()=>createAssetProofOracle(c));assert.equal(calls,0);
 const pin=config(),o=createAssetProofOracle(pin);pin.expectedAssetHashes['assets/real.jpg']='0'.repeat(64);assert.equal(complete(o).assetHashes['assets/real.jpg'],'f'.repeat(64));
});
test('foreign and subclass array prototypes refuse strict JSON boundary',()=>{
 for(const array of [Object.setPrototypeOf(['retained'],null),new(class extends Array {} )('retained')]){
 const o=createAssetProofOracle(config());o.begin(sample(1),0);const r=reply('mac-app');r.documentSnapshot.content.fields.nested=array;assert.throws(()=>o.add('mac-app',r,0));
 }
});

test('shared exported map validator refuses symbolic/accessor entries and detaches',()=>{
 const map={'assets/a':'a'.repeat(64)};map[Symbol('hidden')]='b'.repeat(64);assert.throws(()=>validateAssetHashes(map));
 let calls=0;const getter={};Object.defineProperty(getter,'assets/a',{enumerable:true,get(){calls++;return 'a'.repeat(64);}});assert.throws(()=>validateAssetHashes(getter));assert.equal(calls,0);
 const input={'assets/a':'a'.repeat(64)},output=validateAssetHashes(input);input['assets/a']='b'.repeat(64);assert.equal(output['assets/a'],'a'.repeat(64));assert.ok(Object.isFrozen(output));
});

test('phase UUID ledger is finite and explicitly capped, not campaign-wide',()=>{
 assert.equal(MAX_ASSET_WAVES,256);const o=createAssetProofOracle(config());
 for(let i=1;i<=MAX_ASSET_WAVES;i++)complete(o,sample(i),i);
 assert.throws(()=>o.begin(sample(MAX_ASSET_WAVES+1),MAX_ASSET_WAVES+1));
});
