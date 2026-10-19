import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {observeFileAssetProof,observeBrowserAssetProof} from './asset-proof-observation.mjs';
import {sha256} from './identity-observation.mjs';
const itemId='32345678-1234-1234-1234-123456789abc',sampleId='12345678-1234-1234-1234-123456789abc';
const doc={schemaVersion:1,content:{title:'Owned',body:'body',fields:{},tags:[],assets:[]},presentation:{template:{id:'texttext.article',version:1},theme:{}}};
const bytes=zipSync({'text.md':strToU8(`---\ntextTextId: "${itemId}"\ntitle: "Owned"\n---\n\nbody`),'document.json':strToU8(JSON.stringify(doc)),'assets/a.bin':new Uint8Array([0,255])});
const fileContext={role:'mac-cli',scopeHash:'a'.repeat(64),workspaceId:'22345678-1234-1234-1234-123456789abc',itemId,relativePath:'Owned/Item.textpack',selectedItemId:null,selectedPath:null};
const request={version:1,sampleId};
const envelope={status:200,etag:`"${sha256(bytes)}"`,encodedPath:encodeURIComponent(fileContext.relativePath)};
const authority=context=>({context,authorityHash:'b'.repeat(64)});
test('file proof remains raw and retains mandatory independent live-validation requirement',async()=>{
  let reads=0;const result=await observeFileAssetProof(request,{capture:async()=>authority(fileContext),readPack:async()=>{reads++;return bytes;}});
  assert.equal(reads,1);assert.equal(result.assetProof.source,'direct-local-pack');assert.equal(result.assetProofRequiresValidatedLiveSnapshot,true);
  assert.deepEqual(result.documentSnapshot,doc);
});
test('browser proof consumes raw requirement only with matching before/after validated live snapshots',async()=>{
  let liveReads=0;const context={...fileContext,role:'pc-web',relativePath:null,selectedItemId:itemId};
  const result=await observeBrowserAssetProof(request,{capture:async()=>authority(context),readPack:async()=>({bytes,envelope}),readValidatedLiveSnapshot:async()=>{liveReads++;return structuredClone(doc);}});
  assert.equal(liveReads,2);assert.equal(result.assetProof.relativePath,fileContext.relativePath);
  assert.equal(result.assetProofRequiresValidatedLiveSnapshot,false);
  for(const field of ['subtitle','body']) {
    let n=0;await assert.rejects(()=>observeBrowserAssetProof(request,{capture:async()=>authority(context),readPack:async()=>({bytes,envelope}),readValidatedLiveSnapshot:async()=>++n===1?doc:{...doc,content:{...doc.content,[field]:'changed'}}}));
  }
});
test('every browser await rechecks source scope selected session and authority without yielding proof',async()=>{
  const context={...fileContext,role:'mac-web',relativePath:null,selectedItemId:itemId};
  for(const at of [2,3,4]) for(const kind of ['source','scope','selection']) {
    let calls=0;await assert.rejects(()=>observeBrowserAssetProof(request,{capture:async()=>{
      const value=authority({...context});if(++calls===at){if(kind==='source')value.authorityHash='c'.repeat(64);if(kind==='scope')value.context.scopeHash='c'.repeat(64);if(kind==='selection')value.context.selectedItemId='42345678-1234-1234-1234-123456789abc';}return value;},readPack:async()=>({bytes,envelope}),readValidatedLiveSnapshot:async()=>doc}));
  }
});
test('file await changed owner/root/bytes authority refuses, invalid request performs no reads',async()=>{
  let calls=0;await assert.rejects(()=>observeFileAssetProof(request,{capture:async()=>({context:fileContext,authorityHash:++calls===1?'b'.repeat(64):'c'.repeat(64)}),readPack:async()=>bytes}));
  let reads=0;await assert.rejects(()=>observeFileAssetProof({...request,extra:true},{capture:async()=>{reads++;return authority(fileContext);},readPack:async()=>{reads++;return bytes;}}));assert.equal(reads,0);
});

test('guarded browser packet headers refuse accessors without reading them',async()=>{
  let reads=0;const context={...fileContext,role:'mac-web',relativePath:null,selectedItemId:itemId};
  const headers={...envelope};Object.defineProperty(headers,'encodedPath',{get(){reads++;return envelope.encodedPath;},enumerable:true});
  await assert.rejects(()=>observeBrowserAssetProof(request,{capture:async()=>authority(context),readPack:async()=>({bytes,envelope:headers}),readValidatedLiveSnapshot:async()=>doc}));
  assert.equal(reads,0);
});
