import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeIdentity, checkIdentity, normalizeInitialPack, verifyReopenIdentity } from './identity.mjs';
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
    attestations:Object.fromEntries(roles.map(role=>[role,{identity:checkIdentity(identity(role),pin(role),role)}]))};
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
 const receipt={mode:'real',status:'passed',acceptance:'six-client-multi-field',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{multiField:true},attestations:Object.fromEntries(roles.map(role=>[role,{identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));
 for(const changed of [{...receipt,finalDocumentHash:'e'.repeat(64)},{...receipt,scenario:{}},{...receipt,finalDocumentHash:undefined}])assert.throws(()=>verifyReopenIdentity(changed,config),/field pins/);
 assert.throws(()=>verifyReopenIdentity(receipt,{...config,multiField:false}),/field pins/);
});

test('ordinary file independent reopen binds full document and exact writer mode receipt',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];const fileWrites={role:'mac-cli',mode:'in-place',writes:3,intervalMs:10};
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,fileWrites,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-file-writes',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{fileWrites},attestations:Object.fromEntries(roles.map(role=>[role,{identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));for(const changed of [{...config,expectedDocumentHash:'e'.repeat(64)},{...config,fileWrites:{...fileWrites,mode:'atomic'}},{...config,fileWrites:undefined}])assert.throws(()=>verifyReopenIdentity(receipt,changed),/field pins/);
});

test('malformed independent reopen binds full document and exact fault role/kind/hold receipt',()=>{
 const roles=['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli'];const malformedRepair={role:'mac-cli',kind:'truncated-zip',holdMs:100};
 const config={fixture:{workspaceId:'workspace',itemId:'item'},expectedBaselineHash:H,malformedRepair,expectedDocumentHash:'d'.repeat(64),expectedIdentities:Object.fromEntries(roles.map(role=>[role,pin(role)]))};
 const receipt={mode:'real',status:'passed',acceptance:'six-client-malformed-repair',roundsCompleted:1,fixture:config.fixture,finalHash:H,finalDocumentHash:config.expectedDocumentHash,scenario:{malformedRepair},attestations:Object.fromEntries(roles.map(role=>[role,{identity:checkIdentity(identity(role),pin(role),role)}]))};
 assert.doesNotThrow(()=>verifyReopenIdentity(receipt,config));for(const changed of [{...config,expectedDocumentHash:'e'.repeat(64)},{...config,malformedRepair:{...malformedRepair,kind:'invalid-document-json'}},{...config,malformedRepair:undefined}])assert.throws(()=>verifyReopenIdentity(receipt,changed),/field pins/);
});
