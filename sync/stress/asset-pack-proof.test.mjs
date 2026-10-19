import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { inspectFileAssetPack, inspectServerAssetPack, AssetPackInspectionError } from './asset-pack-proof.mjs';
import { sha256, canonicalJSON } from './identity-observation.mjs';

const itemId='32345678-1234-1234-1234-123456789abc';
const context={role:'mac-cli',sampleId:'12345678-1234-1234-1234-123456789abc',scopeHash:'a'.repeat(64),workspaceId:'22345678-1234-1234-1234-123456789abc',itemId,relativePath:'Owned/Item.textpack',selectedItemId:null,selectedPath:null};
const document={schemaVersion:1,content:{title:'Owned article',body:'Actual body\n'},presentation:{template:{id:'texttext.article',version:1}}};
const image=new Uint8Array([0,255,7,8]);
function pack({root='',doc=document,id=itemId,body=doc.content.body,assets=true,extra={}}={}) {
  return zipSync({[root+'text.md']:strToU8(`---\ntextTextId: "${id}"\ntitle: ${JSON.stringify(doc.content.title)}\n---\n\n${body}`),[root+'document.json']:strToU8(JSON.stringify(doc)),...(assets?{[root+'assets/photo.bin']:image,[root+'assets/text.md']:strToU8('attachment, not the document')}:{}),...extra});
}
function envelope(bytes){return{status:200,etag:`"${sha256(bytes)}"`,encodedPath:encodeURIComponent(context.relativePath)};}
test('pure pack proof hashes actual bytes and preserves omitted subtitle without modifying archive',()=>{
  for(const root of ['', 'Bundle/']) {
    const bytes=pack({root}),before=Buffer.from(bytes),result=inspectFileAssetPack(bytes,context);
    assert.equal(result.proof.archiveSha256,sha256(bytes));
    assert.equal(result.proof.documentSha256,sha256(canonicalJSON(document)));
    assert.equal(result.proof.assetHashes['assets/photo.bin'],sha256(image));
    assert.deepEqual(Object.keys(result.proof.assetHashes).sort(),['assets/photo.bin','assets/text.md']);
    assert.equal(Object.hasOwn(result.documentSnapshot.content,'subtitle'),false);
    assert.deepEqual(bytes,new Uint8Array(before));
    assert.ok(Object.isFrozen(result.documentSnapshot.content));
    assert.throws(()=>inspectFileAssetPack(bytes,{...context,expectedAssetHashes:{'assets/photo.bin':'f'.repeat(64)}}));
  }
});
test('server pack proof binds existing GET status etag path and browser selection without fetching',()=>{
  const bytes=pack(),web={...context,role:'pc-web',selectedItemId:itemId};
  const result=inspectServerAssetPack(bytes,web,envelope(bytes));
  assert.equal(result.proof.source,'authenticated-server-pack');
  for(const patch of [{status:409},{status:201},{etag:'W/'+envelope(bytes).etag},{etag:'"'+'f'.repeat(64)+'"'},{encodedPath:encodeURIComponent('Other.textpack')},{encodedPath:'%xy'},{extra:true}]) assert.throws(()=>inspectServerAssetPack(bytes,web,{...envelope(bytes),...patch}));
  assert.throws(()=>inspectServerAssetPack(bytes,context,envelope(bytes)));
  assert.throws(()=>inspectFileAssetPack(bytes,web));
});
test('bounded projection mismatch has distinct code but never certifies full schema or pending state',()=>{
  const bytes=pack({body:'New external projection\n'});
  assert.throws(()=>inspectFileAssetPack(bytes,context),e=>e instanceof AssetPackInspectionError&&e.code==='projection-mismatch');
  for(const options of [{body:'new',id:'42345678-1234-1234-1234-123456789abc'},{body:'new',assets:false},{body:'new',extra:{'../foreign':image}},{body:'new',doc:{...document,schemaVersion:2}}]) assert.throws(()=>inspectFileAssetPack(pack(options),context),e=>e.code==='invalid-pack');
  const web={...context,role:'mac-web',selectedItemId:itemId};
  assert.throws(()=>inspectServerAssetPack(bytes,web,{...envelope(bytes),etag:'bad'}),e=>e.code==='invalid-pack');
});
test('malformed foreign ambiguous unsupported and oversized packs never become pending proof',()=>{
  const cases=[new Uint8Array([0,1,2]),pack({id:'foreign'}),pack({assets:false}),pack({extra:{'Second/text.md':strToU8('x'),'Second/document.json':strToU8('{}')}}),pack({extra:{'document.json':new Uint8Array([255])}}),pack({extra:{'assets/../bad':image}}),new Uint8Array(64*1024*1024+1)];
  for(const bytes of cases)assert.throws(()=>inspectFileAssetPack(bytes,context),e=>e.code==='invalid-pack');
  const assets=Object.fromEntries(Array.from({length:33},(_,i)=>[`assets/${i}.bin`,image]));
  assert.throws(()=>inspectFileAssetPack(pack({assets:false,extra:assets}),context),e=>e.code==='invalid-pack');
  assert.throws(()=>inspectFileAssetPack('not bytes',context),e=>e.code==='invalid-pack');
});

test('context and server envelope getters refuse without execution; input snapshot stays detached',()=>{
  let reads=0;const bad={...context};Object.defineProperty(bad,'role',{get(){reads++;return 'mac-cli';},enumerable:true});
  assert.throws(()=>inspectFileAssetPack(pack(),bad),e=>e.code==='invalid-pack');assert.equal(reads,0);
  const bytes=pack(),web={...context,role:'mac-web',selectedItemId:itemId},headers=envelope(bytes);
  Object.defineProperty(headers,'etag',{get(){reads++;return 'bad';},enumerable:true});
  assert.throws(()=>inspectServerAssetPack(bytes,web,headers),e=>e.code==='invalid-pack');assert.equal(reads,0);
  const result=inspectFileAssetPack(bytes,context),hash=result.proof.archiveSha256;bytes.fill(0);
  assert.equal(result.proof.archiveSha256,hash);assert.equal(result.documentSnapshot.content.body,document.content.body);
  const shared=new Uint8Array(new SharedArrayBuffer(100));
  assert.throws(()=>inspectFileAssetPack(shared,context),e=>e.code==='invalid-pack');
});
test('snapshot absence and actual asset mutations remain independently observable',()=>{
  const base=inspectFileAssetPack(pack(),context);
  const empty=inspectFileAssetPack(pack({doc:{...document,content:{...document.content,subtitle:''}}}),context);
  assert.notEqual(base.proof.documentSha256,empty.proof.documentSha256);
  assert.equal(Object.hasOwn(empty.documentSnapshot.content,'subtitle'),true);
  const changed=inspectFileAssetPack(pack({extra:{'assets/photo.bin':new Uint8Array([9,8,7])}}),context);
  assert.notEqual(base.proof.assetHashes['assets/photo.bin'],changed.proof.assetHashes['assets/photo.bin']);
  assert.equal(base.proof.documentSha256,changed.proof.documentSha256);
});

test('hidden fields remain raw and explicitly require product-validated live snapshot comparison',()=>{
  const malformedHidden={...document,content:{...document.content,fields:{invalid:{nested:'not a valid field scalar'}},tags:23,assets:'not an asset array'},presentation:{...document.presentation,theme:{unknownToken:'unvalidated'}}};
  const inspected=inspectFileAssetPack(pack({doc:malformedHidden}),context);
  assert.equal(inspected.requiresValidatedLiveSnapshot,true);
  assert.deepEqual(inspected.documentSnapshot,malformedHidden);
  assert.equal(inspected.proof.documentSha256,sha256(canonicalJSON(malformedHidden)));
  assert.equal(inspected.documentSnapshot.content.tags,23);
  assert.throws(()=>inspectFileAssetPack(pack({doc:malformedHidden,body:'changed projection'}),context),e=>e.code==='projection-mismatch');
});
