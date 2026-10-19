import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeIdentity, checkIdentity, checkRetainedWindowAttestation, checkMacWindowCloseProof, normalizeInitialPack, verifyReopenIdentity } from './identity.mjs';
import { boundedFile, observeSealedSource, sha256, ownerBindingScope, captureOwnerBindingGuard, accountScopeHash, createWebAssetObserver } from './identity-observation.mjs';
const H = 'a'.repeat(64), C = 'b'.repeat(40);
function identity(role) {
  return { schemaVersion:1, role, platform:role.startsWith('mac-')?'darwin':'win32', artifactKind:role.endsWith('-cli')?'direct-file-driver':role.endsWith('-web')?'browser':'private-acceptance',
    principalKind:role.endsWith('-cli')?'workspace-owner-binding':'authenticated-account', principalScopeHash:H,
    runtimeName:'observed-runtime', runtimeVersion:'1.2.3', artifacts:{driver:H}, sourceReceiptSha256:H,
    ...(role.endsWith('-web')?{deploymentId:'oracle-build-123',browserVersion:'155.0',driverSourceCommit:C}:{sourceCommit:C}) };
}
const pin = role => ({...identity(role),sourceCommit:C});

test('observed identities retain only bounded allowlisted fields and match exact artifact pins', () => {
  const value = {...identity('mac-app'), token:'must-not-persist', nested:{password:'must-not-persist'}};
  const accepted = checkIdentity(value,pin('mac-app'),'mac-app');
  assert.equal(accepted.sourceProvenance,'verified-source-receipt');
  assert.equal(JSON.stringify(accepted).includes('must-not-persist'),false);
  for (const changes of [{role:'pc-app'},{platform:'linux'},{artifacts:{}},{artifacts:{driver:'wrong'}},{sourceCommit:undefined},{principalKind:'workspace-owner-binding'},{runtimeVersion:''}])
    assert.throws(()=>checkIdentity({...value,...changes},pin('mac-app'),'mac-app'));
  assert.throws(()=>checkIdentity({...value,artifacts:{driver:'c'.repeat(64)}},pin('mac-app'),'mac-app'),/does not match/);
});

test('browser observes build/assets/version but source commit comes only from trusted deployment mapping', () => {
  const value=identity('pc-web'), expected=pin('pc-web');
  const accepted=checkIdentity(value,expected,'pc-web');
  assert.equal(accepted.sourceCommit,C);
  assert.equal(accepted.sourceProvenance,'trusted-web-deployment-pin');
  for(const changes of [{sourceCommit:C},{deploymentId:'stale-build'},{browserVersion:undefined},{driverSourceCommit:undefined},{sourceReceiptSha256:undefined},{artifacts:{'web/_next/static/app.js?token=secret':H}}])
    assert.throws(()=>checkIdentity({...value,...changes},expected,'pc-web'));
});

test('direct-file identity cannot claim authenticated account authority and fixture evidence is bounded', () => {
  assert.throws(()=>normalizeIdentity({...identity('mac-cli'),principalKind:'authenticated-account'},'mac-cli'));
  assert.deepEqual(normalizeInitialPack({packSha256:H,bodySha256:H,documentSha256:H,assetHashes:{},ignored:'secret'}),{packSha256:H,bodySha256:H,documentSha256:H,assetHashes:{}});
  assert.throws(()=>normalizeInitialPack({packSha256:H,bodySha256:H,documentSha256:H,assetHashes:{'../bad':H}}));
});

test('reopen binds prior passing physical fixture/hash/assets and all identity pins', () => {
  const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];
  const expectedIdentities=Object.fromEntries(roles.map(role=>[role,pin(role)]));
  const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,expectedIdentities};
  const receipt={mode:'real',status:'passed',acceptance:'six-client-append-only',roundsCompleted:1,fixture:config.fixture,finalHash:H,
    attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
  assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));
  for(const changes of [{mode:'simulated'},{acceptance:'none'},{roundsCompleted:0},{finalHash:'c'.repeat(64)},{fixture:{workspaceId:'other',itemId:'item'}},{expectedAssetHashes:{'assets/new':H}}])
    assert.throws(()=>verifyReopenIdentity({...receipt,...changes},config));
  const changed=structuredClone(config);changed.expectedIdentities['pc-app'].runtimeVersion='new-version';
  assert.throws(()=>verifyReopenIdentity(receipt,changed),/pin changed/);
});

test('sealed source reads actual fixed artifacts and refuses changed or redirected receipt hashes', () => {
  const dir=mkdtempSync(join(tmpdir(),'texttext-identity-')),driver=join(dir,'driver.mjs'),receipt=join(dir,'identity.json');
  writeFileSync(driver,'observed bytes');
  const value={schemaVersion:1,role:'mac-cli',sourceCommit:C,sourceReceiptSha256:H,sourceInputSha256:H,artifacts:{driver:sha256('observed bytes')}};
  writeFileSync(receipt,JSON.stringify(value));
  assert.equal(observeSealedSource(receipt,'mac-cli',{driver}).sourceCommit,C);
  assert.throws(()=>observeSealedSource(receipt,'pc-cli',{driver}),/invalid/);
  writeFileSync(driver,'changed bytes');
  assert.throws(()=>observeSealedSource(receipt,'mac-cli',{driver}),/loaded artifacts/);
  assert.throws(()=>boundedFile(driver,1),/outside bounds/);
});

test('workspace binding scope is separate from authenticated account scope and tied to exact root', () => {
  const root=mkdtempSync(join(tmpdir(),'texttext-owner-')),file=join(root,'fixture.textpack'),ownerBindingPath=join(root,'.texttext','account-owner.json');
  mkdirSync(join(root,'.texttext')); 
  writeFileSync(file,'fixture');
  const owner={version:1,binding:{origin:'https://texttext.app',workspaceId:'workspace'},accountId:'canonical-account',rootHash:sha256(realpathSync(root))};
  writeFileSync(ownerBindingPath,JSON.stringify(owner));
  const config={role:'mac-cli',file,workspaceRoot:root,ownerBindingPath,workspaceId:'workspace'};
  assert.notEqual(ownerBindingScope(config),accountScopeHash('https://texttext.app','canonical-account'));
  const guard = captureOwnerBindingGuard(config);assert.equal(guard(),ownerBindingScope(config));
  writeFileSync(ownerBindingPath,JSON.stringify({...owner,accountId:'changed-account'}));assert.throws(guard,/changed/);
  writeFileSync(ownerBindingPath,JSON.stringify(owner));
  assert.throws(()=>ownerBindingScope({...config,workspaceId:'different'}),/scope/);
  writeFileSync(ownerBindingPath,JSON.stringify({...owner,rootHash:H}));
  assert.throws(()=>ownerBindingScope(config),/scope/);
});

test('web asset observer hashes actual loaded response bytes and strips query strings', async () => {
  const page=new EventEmitter();page.evaluate=async()=>['web/_next/static/app.js'];
  const snapshot=createWebAssetObserver(page,'https://texttext.app');
  const response=bytes=>({url:()=> 'https://texttext.app/_next/static/app.js?cache=123',request:()=>({resourceType:()=> 'script'}),ok:()=>true,body:async()=>Buffer.from(bytes)});
  page.emit('response',response('actual loaded bytes'));
  assert.deepEqual(await snapshot(),{'web/_next/static/app.js':sha256('actual loaded bytes')});
  page.emit('response',response('different bytes'));
  await assert.rejects(snapshot(),/changed/);
  const missing=new EventEmitter();missing.evaluate=page.evaluate;
  await assert.rejects(createWebAssetObserver(missing,'https://texttext.app')(),/incomplete/);
});

test('fresh restart attestation rechecks every pinned identity and binds the next editor session', async () => {
  const { checkRestartAttestation } = await import('./identity.mjs');
  const role='mac-app',expected=pin(role),scope={fixture:{workspaceId:'workspace',itemId:'item'},machineId:'actual-mac',sessionId:'old-session',generation:2};
  const fresh={type:'attest',round:0,mode:'real',adapter:'native-product',machineId:'actual-mac',workspaceId:'workspace',itemId:'item',generation:2,sessionId:'new-session',identity:identity(role)};
  assert.equal(checkRestartAttestation(fresh,expected,role,scope).sessionId,'new-session');
  for(const changes of [{mode:'simulated'},{adapter:'fake-adapter'},{machineId:'other-machine'},{workspaceId:'other-workspace'},{sessionId:'old-session'},{generation:1},{identity:{...fresh.identity,sourceCommit:'c'.repeat(40)}},{identity:{...fresh.identity,principalScopeHash:'d'.repeat(64)}},{identity:{...fresh.identity,artifacts:{driver:'e'.repeat(64)}}}])
    assert.throws(()=>checkRestartAttestation({...fresh,...changes},expected,role,scope));
});

test('multi-field independent reopen binds full document hash and scenario in addition to body and artifact pins',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,multiField:true,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-multi-field',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{multiField:true},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));
 for(const changed of [{...receipt,finalDocumentHash:'e'.repeat(64)},{...receipt,scenario:{}},{...receipt,finalDocumentHash:undefined}])assert.throws(()=>verifyReopenIdentity(changed,config),/field pins/);
 assert.throws(()=>verifyReopenIdentity(receipt,{...config,multiField:false}),/field pins/);
});

test('ordinary file independent reopen binds full document and exact writer mode receipt',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];const fileWrites={role:'mac-cli',mode:'in-place',writes:3,intervalMs:10};
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,fileWrites,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-file-writes',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{fileWrites},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));for(const changed of [{...config,expectedDocumentHash:'e'.repeat(64)},{...config,fileWrites:{...fileWrites,mode:'atomic'}},{...config,fileWrites:undefined}])assert.throws(()=>verifyReopenIdentity(receipt,changed),/field pins/);
});

test('malformed independent reopen binds full document and exact fault role/kind/hold receipt',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];const malformedRepair={role:'mac-cli',kind:'truncated-zip',holdMs:100};
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,malformedRepair,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-malformed-repair',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{malformedRepair},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));for(const changed of [{...config,expectedDocumentHash:'e'.repeat(64)},{...config,malformedRepair:{...malformedRepair,kind:'invalid-document-json'}},{...config,malformedRepair:undefined}])assert.throws(()=>verifyReopenIdentity(receipt,changed),/field pins/);
});

test('close traffic independent reopen binds exact role, browser peer, chunks, timing and full document',()=>{const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'],closeDuringTraffic={role:'pc-app',trafficRole:'mac-web',chunks:4,intervalMs:100};const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,closeDuringTraffic,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};const receipt={mode:'real',status:'passed',acceptance:'six-client-close-during-traffic',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{closeDuringTraffic},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));for(const changed of[{...config,closeDuringTraffic:{...closeDuringTraffic,role:'mac-app'}},{...config,closeDuringTraffic:{...closeDuringTraffic,trafficRole:'pc-web'}},{...config,closeDuringTraffic:{...closeDuringTraffic,chunks:5}},{...config,closeDuringTraffic:{...closeDuringTraffic,intervalMs:250}},{...config,closeDuringTraffic:undefined},{...config,expectedDocumentHash:'e'.repeat(64)}])assert.throws(()=>verifyReopenIdentity(receipt,changed),/field pins/);});

test('retained Mac window attestation binds same generation/session and fresh actual identity pins',()=>{const fixture={workspaceId:'workspace',itemId:'item'},value={type:'attest',round:0,mode:'real',adapter:'native',machineId:'mac',...fixture,generation:1,windowGeneration:2,sessionId:'original-session',identity:identity('mac-app')},expected={fixture,machineId:'mac',sessionId:'original-session',generation:1};assert.doesNotThrow(()=>checkRetainedWindowAttestation(value,pin('mac-app'),expected));for(const patch of [{generation:2},{sessionId:'new-session'},{windowGeneration:1},{mode:'simulated'},{itemId:'other'},{machineId:'pc'},{identity:{...value.identity,sourceCommit:'c'.repeat(40)}}])assert.throws(()=>checkRetainedWindowAttestation({...value,...patch},pin('mac-app'),expected));});
test('Mac normal window proof requires actual close/own intent and scoped typed shared durability',()=>{const fixture={workspaceId:'workspace',itemId:'item'},expected={fixture,ownEditId:'r1-mac-app',sessionId:'session',generation:1},value={closed:true,flushed:true,keepEditingDialog:false,lifecycle:'normal-window-close',windowCloseObserved:true,retained:true,ownEditId:'r1-mac-app',ownEditOccurrences:1,fileHash:H,sessionId:'session',generation:1,windowGeneration:1,durability:{outcome:'durable',...fixture,lifecycle:'lifetime',generation:3}};assert.ok(checkMacWindowCloseProof(value,expected));for(const patch of[{windowCloseObserved:false},{ownEditId:'r1-pc-app'},{ownEditOccurrences:0},{generation:2},{sessionId:'other'},{durability:{outcome:'durable'}},{durability:{...value.durability,itemId:'other'}},{durability:{...value.durability,outcome:'local-file-durable'}}])assert.equal(checkMacWindowCloseProof({...value,...patch},expected),false);});

test('browser normal-close independent reopen binds exact browser role and declared fault round',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'],browserClose={role:'mac-web',round:1};
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,browserClose,expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-browser-normal-close',roundsCompleted:1,fixture:config.fixture,finalHash:H,scenario:{browserClose},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));
 for(const changed of [{...config,browserClose:undefined},{...config,browserClose:{...browserClose,role:'pc-web'}},{...config,browserClose:{...browserClose,round:2}}])assert.throws(()=>verifyReopenIdentity(receipt,changed),/field pins/);
});

test('leaf independent reopen binds full document and immutable exact old/new path scenario',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'],leafMove={role:'mac-cli',round:1,source:'Owned/Original.textpack',destination:'Owned/Moved.textpack'};
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,leafMove,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-external-leaf-move',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{leafMove},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));for(const changed of [{...config,leafMove:undefined},{...config,leafMove:{...leafMove,destination:'Owned/Other.textpack'}},{...config,expectedDocumentHash:'e'.repeat(64)}])assert.throws(()=>verifyReopenIdentity(receipt,changed),/field pins/);
});

test('lost ACK independent reopen binds fault role and complete document pins',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'],lostAck={role:'mac-web',round:1};
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,lostAck,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-browser-lost-ack',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{lostAck},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));for(const patch of [{lostAck:undefined},{lostAck:{role:'pc-web',round:1}},{expectedDocumentHash:'e'.repeat(64)}])assert.throws(()=>verifyReopenIdentity(receipt,{...config,...patch}),/field pins/);
});

test('mixed reopen binds descriptors, seed and complete document semantics', () => {
  const roles = ['mac-app', 'mac-web', 'mac-cli', 'pc-app', 'pc-web', 'pc-cli'],
    mixedSchedule = {
      version: 1,
      rounds: [{
        kind: 'plain'
      }, {
        kind: 'fields'
      }]
    };
  const config = {
    seed: 42,
    fixture: {
      workspaceId: 'workspace',
      itemId: 'item'
    },
    expectedBaselineHash: H,
    mixedSchedule,
    expectedDocumentHash: 'd'.repeat(64),
    expectedIdentities: Object.fromEntries(roles.map(role => [role, pin(role)]))
  };
  const receipt = {
    mode: 'real',
    status: 'passed',
    acceptance: 'six-client-compatible-mixed-schedule',
    roundsCompleted: 2,
    fixture: config.fixture,
    finalHash: H,
    finalDocumentHash: config.expectedDocumentHash,
    scenario: {
      mixedSchedule
    },
    mixedScheduleEvidence: {
      seed: 42,
      sha256: 'f'.repeat(64)
    },
    attestations: Object.fromEntries(roles.map(role => [role, {
      identity: checkIdentity(identity(role), pin(role), role)
    }]))
  };
  assert.doesNotThrow(() => verifyReopenIdentity(receipt, config));
  for (const patch of [{
    seed: 43
  }, {
    mixedSchedule: {
      version: 1,
      rounds: [{
        kind: 'fields'
      }, {
        kind: 'plain'
      }]
    }
  }, {
    expectedDocumentHash: 'e'.repeat(64)
  }, {
    mixedSchedule: undefined
  }]) assert.throws(() => verifyReopenIdentity(receipt, {
    ...config,
    ...patch
  }));
  assert.throws(() => verifyReopenIdentity({
    ...receipt,
    mixedScheduleEvidence: undefined
  }, config));
});


test('independent reopen binds exact partial dwell descriptor and completion without promoting T24',()=>{
  const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];
  const soak={version:1,durationMs:3600000,cadenceMs:30000};
  const config={fixture:{workspaceId:'ws',itemId:'item'},expectedBaselineHash:H,expectedDocumentHash:H,expectedAssetHashes:{},expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)])),soak};
  const receipt={mode:'real',status:'passed',acceptance:'six-client-finite-dwell-partial-not-full-T24',roundsCompleted:100,fixture:config.fixture,finalHash:H,expectedAssetHashes:{},scenario:{soak},soakEvidence:{status:'dwell-complete',samples:121,durationMs:3600000,acceptance:'partial-not-full-T24'},attestations:Object.fromEntries(roles.map(role=>[role,{finiteSoakCorrelation:1,identity:checkIdentity(identity(role),pin(role),role)}]))};
  assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));
  for(const patch of [{soakEvidence:undefined},{soakEvidence:{...receipt.soakEvidence,samples:120}},{soakEvidence:{...receipt.soakEvidence,acceptance:'full-T24'}}])assert.throws(()=>verifyReopenIdentity({...receipt,...patch},config));
  assert.throws(()=>verifyReopenIdentity(receipt,{...config,soak:{...soak,cadenceMs:60000}}));
});


test('applicable scripts omit nomodule only after positive runtime module support', async () => {
  const { applicableScriptPaths } = await import('./identity-observation.mjs');
  const script = (name, noModule = false, type = '') => ({ src: 'https://texttext.app/_next/static/' + name, noModule, type });
  const doc = { scripts: [script('classic.js'), script('module.js', false, 'module'), script('fallback.js', true), { src: 'https://elsewhere.test/ignored.js' }], location: { origin: 'https://texttext.app' } };
  assert.deepEqual(applicableScriptPaths(doc, true), ['web/_next/static/classic.js', 'web/_next/static/module.js']);
  for (const unknown of [false, undefined, null]) assert.deepEqual(applicableScriptPaths(doc, unknown), ['web/_next/static/classic.js', 'web/_next/static/module.js', 'web/_next/static/fallback.js']);
});

test('missing applicable classic and module responses still refuse attestation', async () => {
  for (const path of ['web/_next/static/classic.js', 'web/_next/static/module.js']) {
    const page = new EventEmitter(); page.evaluate = async () => [path];
    await assert.rejects(createWebAssetObserver(page, 'https://texttext.app')(), /incomplete/);
  }
});
