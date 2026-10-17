import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const result=await build({stdin:{resolveDir:process.cwd(),contents:`
import * as Y from 'yjs';
import {acquireWebDocument} from './src/local-vault/web-document-session';
import {setVaultTransport} from './src/local-vault/bridge';
import {emptyDocumentSnapshot} from './src/lib/documents/model';
import {applyDocumentSnapshot,documentText,documentSnapshotFromYDoc} from './src/lib/collab/document';
const document=emptyDocumentSnapshot();document.content.title='Shared owner';document.content.body='Original';
const seed=new Y.Doc();applyDocumentSnapshot(seed,document,'seed');const update=btoa(String.fromCharCode(...Y.encodeStateAsUpdate(seed)));seed.destroy();
window.calls=[];window.handles={};window.events=[];
const identity={namespace:'https://owner.test',accountId:'account-a',workspaceId:'workspace',itemId:'item'};
const file={path:'Note.textpack',hash:'initial',markdown:'---\\ntextTextId: item\\n---\\nOriginal',documentJSON:JSON.stringify(document)};
const transport=account=>async(method,params,signal)=>{
 window.calls.push({account,method});
 if(method==='collaborationRead'){
  if(params.waitMs)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  return {epoch:1,seq:0,revision:'a'.repeat(64),relativePath:file.path,update,canEditContent:true,canComment:true};
 }
 if(method==='collaborationPush')throw Object.assign(new Error('Offline test transport'),{status:503});
 if(method==='read')return file;
 throw Error(method);
};
setVaultTransport(transport('account-a'));
window.useB=()=>setVaultTransport(transport('account-b'));
window.open=async(name,accountId='account-a')=>{const h=acquireWebDocument({...identity,accountId},file);window.handles[name]=h;await h.ready;return h.lifecycle};
window.same=(a,b)=>window.handles[a].session===window.handles[b].session;
window.text=name=>documentSnapshotFromYDoc(window.handles[name].session.client.doc).content.body;
window.edit=(name,text)=>window.handles[name].session.client.mutate(doc=>documentText(doc,'body').insert(documentText(doc,'body').length,text));
window.release=name=>window.handles[name].release();
window.reset=name=>window.handles[name].closeExclusive(()=>window.handles[name].session.client.discardCleanJournalDurably());
window.pause=name=>window.handles[name].session.client.setActive(false,'offline');
window.phase=name=>window.handles[name].phase;
window.hold=false;window.fail=false;window.blocked=false;window.continue=null;
const transaction=IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(...args){
 if(window.fail&&args[1]==='readwrite')throw new DOMException('No space','QuotaExceededError');
 const tx=transaction.apply(this,args);
 if(window.hold&&args[1]==='readwrite'){
  const complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
  Object.defineProperty(tx,'oncomplete',{set(callback){complete.set.call(tx,event=>{window.blocked=true;window.continue=()=>callback.call(tx,event)})},get(){return complete.get.call(tx)}});
 }
 return tx;
};
`},bundle:true,write:false,platform:'browser',format:'iife',target:['safari17']});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://owner.test/**',r=>r.fulfill({contentType:'text/html',body:'<p>Isolated production session owner</p>'}));
 await page.goto('https://owner.test');await page.addScriptTag({content:result.outputFiles[0].text});
 const first=await page.evaluate(()=>window.open('a'));await page.evaluate(()=>window.open('b'));
 assert.equal(await page.evaluate(()=>window.same('a','b')),true);
 await page.evaluate(()=>window.pause('a'));await page.evaluate(()=>window.edit('a',' shared text'));
 assert.equal(await page.evaluate(()=>window.text('b')),'Original shared text');
 assert.equal(await page.evaluate(()=>window.release('a')),true);
 await page.evaluate(()=>window.edit('b',' second view'));
 assert.equal(await page.evaluate(()=>window.text('b')),'Original shared text second view');
 await page.evaluate(()=>{window.hold=true;window.edit('b',' delayed commit')});
 await page.waitForFunction(()=>window.blocked);
 await page.evaluate(()=>{window.releaseDone=false;window.release('b').then(v=>{window.releaseDone=v})});
 assert.equal(await page.evaluate(()=>window.phase('b')),'draining');
 assert.equal(await page.evaluate(()=>window.releaseDone),false);
 await page.evaluate(()=>window.open('c'));assert.equal(await page.evaluate(()=>window.same('b','c')),true);
 await page.evaluate(()=>{window.hold=false;window.continue()});
 assert.equal(await page.evaluate(()=>window.text('c')),'Original shared text second view delayed commit');
 await page.evaluate(()=>window.pause('c'));
 assert.equal(await page.evaluate(()=>window.release('c')),true);
 const reopened=await page.evaluate(()=>window.open('d'));assert.notEqual(reopened,first);
 await page.evaluate(()=>window.pause('d'));
 assert.equal(await page.evaluate(()=>window.text('d')),'Original shared text second view delayed commit');
 await page.evaluate(()=>{window.fail=true;window.edit('d',' storage failure')});
 assert.equal(await page.evaluate(()=>window.release('d')),false);
 assert.equal(await page.evaluate(()=>window.phase('d')),'retained-error');
 await page.evaluate(()=>window.open('e'));assert.equal(await page.evaluate(()=>window.same('d','e')),true);
 assert.ok((await page.evaluate(()=>window.text('e'))).endsWith('storage failure'));
 await page.evaluate(()=>{window.fail=false;window.useB()});
 await page.evaluate(()=>window.open('B','account-b'));
 assert.equal(await page.evaluate(()=>window.same('e','B')),false);
 assert.equal(await page.evaluate(()=>window.text('B')),'Original');
 await page.evaluate(()=>{window.hold=true;window.blocked=false;window.resetDone=false;window.reset('B').then(v=>window.resetDone=v)});
 await page.waitForFunction(()=>window.blocked);assert.equal(await page.evaluate(()=>window.resetDone),false);
 await page.evaluate(()=>{window.hold=false;window.continue()});await page.waitForFunction(()=>window.resetDone);
 assert.equal(await page.evaluate(()=>window.release('B')),true);
 assert.equal(await page.evaluate(()=>window.release('e')),true);
 assert.deepEqual(errors,[]);
 console.log('PASS real IndexedDB session owner: two views share one client; release waits for commit; reacquire fences old drain; restart preserves edits; storage failure retains the same owner; account separation prevents foreign replay.');
}finally{await browser.close();}
