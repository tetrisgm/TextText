import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLiveFieldDocument} from './multi-field-page.mjs';

const scope={itemId:'fixture-item',workspaceId:'fixture-workspace',title:'Six-client acceptance fixture'};
function fixture(t, subtitle) {
  const previousDocument=globalThis.document,previousWindow=globalThis.window;
  t.after(()=>{globalThis.document=previousDocument;globalThis.window=previousWindow;});
  const doc={schemaVersion:1,content:{title:scope.title,body:'Baseline\n\n![square](assets/square.jpg)\n'},presentation:{template:{id:'texttext.article'}}};
  if(subtitle!==undefined)doc.content.subtitle=subtitle;
  const controls={subtitle:{value:subtitle??''},body:{textContent:doc.content.body}};
  const editor={dataset:{aiItemId:scope.itemId},querySelector(selector){return selector.startsWith('textarea')?controls.subtitle:controls.body;}};
  globalThis.document={querySelectorAll:()=>[editor]};
  globalThis.window={texttextDocumentInspection:{version:1,read:key=>key===scope.itemId?doc:null}};
  return {doc,controls,editor};
}

test('full live article observation accepts omitted optional subtitle displayed as empty',t=>{
  const {doc}=fixture(t,undefined);
  assert.equal(readLiveFieldDocument(scope),doc);
  assert.equal(Object.hasOwn(doc.content,'subtitle'),false);
});

test('an invalid null subtitle is not treated as an omitted optional value',t=>{
  fixture(t,null);
  assert.equal(readLiveFieldDocument(scope),null);
});

test('live observation retains actual subtitle, body, item, title and template guards',t=>{
  const {doc,controls,editor}=fixture(t,'Actual subtitle');
  assert.equal(readLiveFieldDocument(scope),doc);
  controls.subtitle.value='different';assert.equal(readLiveFieldDocument(scope),null);controls.subtitle.value='Actual subtitle';
  controls.body.textContent='different';assert.equal(readLiveFieldDocument(scope),null);controls.body.textContent=doc.content.body;
  editor.dataset.aiItemId='other';assert.equal(readLiveFieldDocument(scope),null);editor.dataset.aiItemId=scope.itemId;
  assert.equal(readLiveFieldDocument({...scope,title:'other'}),null);
  doc.presentation.template.id='texttext.note';assert.equal(readLiveFieldDocument(scope),null);
});
