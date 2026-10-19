import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssetProof, validateAssetProofConfig, validateAssetProofRequest } from './asset-proof.mjs';
import { documentObservation } from './multi-field.mjs';
const snapshot = {schemaVersion:1,content:{title:'Owned',body:'Body'},presentation:{template:{id:'texttext.article'}}};
const context = {role:'mac-app',sampleId:'12345678-1234-1234-1234-123456789abc',scopeHash:'a'.repeat(64),workspaceId:'22345678-1234-1234-1234-123456789abc',itemId:'32345678-1234-1234-1234-123456789abc',relativePath:'Owned/Item.textpack',documentSnapshot:snapshot};
function proof() { return {version:1,sampleId:context.sampleId,source:'native-local-pack',scopeHash:context.scopeHash,workspaceId:context.workspaceId,itemId:context.itemId,relativePath:context.relativePath,archiveSha256:'b'.repeat(64),documentSha256:documentObservation(snapshot).hash,assetHashes:{'assets/photo.jpg':'c'.repeat(64)},selectedItemId:context.itemId,selectedPath:context.relativePath}; }
test('asset proof preserves full canonical omission and detaches asset map',()=>{
  const input=proof(), result=validateAssetProof(input,context);
  input.assetHashes['assets/photo.jpg']='d'.repeat(64);
  assert.equal(result.assetHashes['assets/photo.jpg'],'c'.repeat(64));
  assert.ok(Object.isFrozen(result.assetHashes));
  assert.throws(()=>validateAssetProof(proof(),{...context,documentSnapshot:{...snapshot,content:{...snapshot.content,subtitle:''}}}));
});
test('asset proof binds all role sources and actual selected sessions',()=>{
  for(const role of ['mac-app','pc-app','mac-web','pc-web','mac-cli','pc-cli']) {
    const input=proof();input.source=role.endsWith('-cli')?'direct-local-pack':role.endsWith('-web')?'authenticated-server-pack':'native-local-pack';
    if(role.endsWith('-cli')) input.selectedItemId=null;
    if(!role.endsWith('-app')) input.selectedPath=null;
    validateAssetProof(input,{...context,role});
    assert.throws(()=>validateAssetProof({...input,source:'simulator'},{...context,role}));
  }
});
test('asset proof refuses stale scope sample identity and unsafe maps',()=>{
  for(const patch of [{sampleId:'22345678-1234-1234-1234-123456789abc'},{scopeHash:'d'.repeat(64)},{itemId:'other'},{relativePath:'../Other.textpack'},{relativePath:'C:Other.textpack'},{selectedPath:'Other.textpack'},{extra:true},{assetHashes:{}},{assetHashes:{'assets/../photo.jpg':'c'.repeat(64)}},{assetHashes:Object.fromEntries(Array.from({length:33},(_,i)=>[`assets/${i}`,'c'.repeat(64)]))}]) assert.throws(()=>validateAssetProof({...proof(),...patch},context));
});
test('asset proof refuses getters sparse data unknown config without invoking accessors',()=>{
  let calls=0;const input=proof();Object.defineProperty(input,'source',{get(){calls++;return 'native-local-pack';},enumerable:true});
  assert.throws(()=>validateAssetProof(input,context));assert.equal(calls,0);
  const assets={};Object.defineProperty(assets,'assets/a',{get(){calls++;return 'c'.repeat(64);},enumerable:true});
  assert.throws(()=>validateAssetProof({...proof(),assetHashes:assets},context));assert.equal(calls,0);
  assert.throws(()=>validateAssetProof(proof(),{...context,documentSnapshot:{...snapshot,extra:Array(1)}}));
  assert.throws(()=>validateAssetProofConfig({version:1,extra:true}));
  assert.throws(()=>validateAssetProofRequest({version:1,sampleId:context.sampleId+'\n'}));
  assert.deepEqual(validateAssetProofConfig({version:1}),{version:1});
});

test('asset proof refuses malformed equal caller identities independently',()=>{
  for(const key of ['workspaceId','itemId']) {
    for(const bad of ['not-a-uuid', context.itemId.toUpperCase(), context.itemId+'\n']) {
      assert.throws(()=>validateAssetProof({...proof(),[key]:bad},{...context,[key]:bad}));
    }
  }
});

test('asset proof rejects matching unsafe paths and nonstring digests',()=>{
  for(const relativePath of ['../Other.textpack','C:Other.textpack','/Other.textpack','Owned\\Other.textpack']) {
    assert.throws(()=>validateAssetProof({...proof(),relativePath,selectedPath:relativePath},{...context,relativePath}));
  }
  assert.throws(()=>validateAssetProof({...proof(),archiveSha256:{toString(){throw Error('must not coerce');}}},context));
});
