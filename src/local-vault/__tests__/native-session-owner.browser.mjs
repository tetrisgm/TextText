import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const app=await build({stdin:{resolveDir:process.cwd(),contents:`
import * as Y from 'yjs';import{acquireVaultDocument,flushDocumentSessions}from'./src/local-vault/document-session';
import{setVaultTransport,VaultError}from'./src/local-vault/bridge';import{writePayload}from'./src/local-vault/model';
import{emptyDocumentSnapshot}from'./src/lib/documents/model';import{applyDocumentSnapshot,documentText,documentSnapshotFromYDoc}from'./src/lib/collab/document';
const document=emptyDocumentSnapshot();document.content.title='Native owner';document.content.body='Original';
const doc=new Y.Doc();applyDocumentSnapshot(doc,document,'seed');const update=btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc)));doc.destroy();
const initial={path:'Native.textpack',hash:'a'.repeat(64),markdown:'---\\ntextTextId: item\\n---\\nOriginal',documentJSON:JSON.stringify(document)};
let file={...initial},journal=null,token=null;
window.recoveries=0;window.rejectRecovery=false;window.opens=0;window.closes=0;window.commits=0;window.hold=false;window.fail=false;window.waiting=false;window.resume=null;window.openHeld=false;window.finishOpen=null;window.handles={};
setVaultTransport(async(method,params,signal)=>{
 if(method==='collaborationOpen'){
  window.opens++;if(window.openHeld)await new Promise(resolve=>window.finishOpen=resolve);
  token='native-'+window.opens;return{sessionToken:token,path:file.path,hash:file.hash,projectedHash:file.hash,acknowledgedRevision:initial.hash,journal,retiredReason:null,capabilities:['epoch-adoption']};
 }
 if(method==='collaborationCheckpoint'){
  if(params.sessionToken!==token)throw Error('Closed lease');
  if(window.hold){window.waiting=true;await new Promise(resolve=>window.resume=resolve)}
  if(window.fail)throw new VaultError('Injected disk rejection','checkpoint_failed');
  if(params.sessionToken!==token)throw Error('Released lease during checkpoint');
  journal=params.journal;file={...file,documentJSON:params.documentJSON,markdown:params.markdown,hash:file.hash+'x'};window.commits++;
  return{path:file.path,hash:file.hash};
 }
 if(method==='collaborationRecover'){
  if(window.rejectRecovery)throw new VaultError('Recovery copy not authorized','403');
  if(params.sessionToken!==token||params.recoveryPath!==window.recoveryFile.path||params.recoveryHash!==window.recoveryFile.hash)throw Error('Recovery copy does not match');
  token=null;window.recoveries++;return{};
 }
 if(method==='collaborationClose'){if(params.sessionToken!==token)throw Error('Wrong lease');token=null;window.closes++;return{};}
 if(method==='collaborationRead'){
  if(params.waitMs)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  return{epoch:1,seq:0,revision:initial.hash,relativePath:initial.path,update,canEditContent:true,canComment:true};
 }
 if(method==='collaborationPush')throw Object.assign(new Error('Offline'),{status:503});
 if(method==='read')return file;
 if(method.startsWith('presence'))throw Error('No presence in isolated fixture');
 throw Error(method);
});
const identity={namespace:'https://native-owner.test',workspaceId:'workspace',itemId:'item',accountId:'account-a',localFiles:true};
window.open=name=>{const h=acquireVaultDocument(identity,file,'/isolated-native-root');window.handles[name]=h;return h.ready};
window.pause=name=>window.handles[name].session.client.setActive(false,'offline');
window.edit=(name,text)=>window.handles[name].session.client.mutate(doc=>documentText(doc,'body').insert(documentText(doc,'body').length,text));
window.release=name=>window.handles[name].release();window.phase=name=>window.handles[name].phase;
window.flushAll=flushDocumentSessions;
window.text=name=>documentSnapshotFromYDoc(window.handles[name].session.client.doc).content.body;
window.saved=()=>JSON.parse(file.documentJSON).content.body;
window.same=(a,b)=>window.handles[a].session===window.handles[b].session;
window.recover=name=>window.handles[name].runExclusive(async()=>{
 const h=window.handles[name];window.recoveryFile={...file,...writePayload({...file,path:'Recovery.textpack',markdown:file.markdown.replace('textTextId: item','textTextId: recovered-item')},h.session.snapshot),hash:'copy-hash'};
 await h.session.recoverTo(window.recoveryFile);
 return h.closeExclusive(()=>h.session.client.clearRetiredAfterRecoveryDurably());
});
`},bundle:true,write:false,format:'iife',platform:'browser',target:['safari17']});
if(process.env.TEXTTEXT_SESSION_OWNER_BUNDLE){
 const output=process.env.TEXTTEXT_SESSION_OWNER_BUNDLE;await mkdir(output,{recursive:true});
 await writeFile(path.join(output,'app.js'),app.outputFiles[0].text);
 await writeFile(path.join(output,'index.html'),'<html><meta charset="utf-8"><p>Isolated session ownership fixture</p><script src="app.js"></script></html>');
}
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://native-owner.test/**',r=>r.fulfill({contentType:'text/html',body:'<p>Isolated native adapter ownership</p>'}));await page.goto('https://native-owner.test');
 await page.evaluate(()=>{
  const listeners=[],intervals=new Set();
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
  const capture=options=>typeof options==='boolean'?options:!!options?.capture;
  EventTarget.prototype.addEventListener=function(type,fn,options){
   if((this===window||this===document)&&!listeners.some(x=>x.target===this&&x.type===type&&x.fn===fn&&x.capture===capture(options)))listeners.push({target:this,type,fn,capture:capture(options)});
   return add.call(this,type,fn,options);
  };
  EventTarget.prototype.removeEventListener=function(type,fn,options){
   const i=listeners.findIndex(x=>x.target===this&&x.type===type&&x.fn===fn&&x.capture===capture(options));if(i>=0)listeners.splice(i,1);
   return remove.call(this,type,fn,options);
  };
  const start=window.setInterval.bind(window),stop=window.clearInterval.bind(window);
  window.setInterval=(...args)=>{const id=start(...args);intervals.add(id);return id;};
  window.clearInterval=id=>{intervals.delete(id);stop(id);};
  window.resources=()=>({listeners:listeners.length,intervals:intervals.size});
 });
 await page.addScriptTag({content:app.outputFiles[0].text});
 const baselineResources=await page.evaluate(()=>window.resources());
 await page.evaluate(()=>window.open('a'));await page.evaluate(()=>window.pause('a'));
 await page.evaluate(()=>{window.hold=true;window.edit('a',' delayed native save')});await page.waitForFunction(()=>window.waiting);
 await page.evaluate(()=>{window.done=null;window.release('a').then(result=>window.done=result)});
 assert.equal(await page.evaluate(()=>window.closes),0);assert.equal(await page.evaluate(()=>window.phase('a')),'draining');
 await page.evaluate(()=>window.open('b'));assert.equal(await page.evaluate(()=>window.same('a','b')),true);
 await page.evaluate(()=>{window.hold=false;window.resume()});await page.waitForFunction(()=>window.done!==null);
 assert.equal(await page.evaluate(()=>window.closes),0);await page.evaluate(()=>window.pause('b'));
 assert.equal(await page.evaluate(()=>window.release('b')),true);
 assert.equal(await page.evaluate(()=>window.saved()),'Original delayed native save');assert.equal(await page.evaluate(()=>window.closes),1);
 await page.evaluate(()=>{window.openHeld=true;void window.open('c')});await page.waitForFunction(()=>typeof window.finishOpen==='function');
 await page.evaluate(()=>{window.cancelledDone=false;window.release('c').then(result=>window.cancelledDone=result)});
 assert.equal(await page.evaluate(()=>window.closes),1);
 await page.evaluate(()=>{window.openHeld=false;window.finishOpen()});await page.waitForFunction(()=>window.cancelledDone);
 assert.equal(await page.evaluate(()=>window.closes),2);
 for(let cycle=0;cycle<25;cycle++){
  await page.evaluate(async()=>{
   await window.open('cycle-a');await window.open('cycle-b');window.pause('cycle-a');
   if(!window.same('cycle-a','cycle-b'))throw Error('Duplicate owner');
   if(!await window.release('cycle-a')||!await window.release('cycle-b'))throw Error('Failed release');
   if(window.phase('cycle-b')!=='closed')throw Error('Owner remained live');
  });
  assert.deepEqual(await page.evaluate(()=>window.resources()),baselineResources,'Global listeners and intervals return to baseline after cycle '+cycle);
 }
 await page.evaluate(()=>window.open('d'));await page.evaluate(()=>window.pause('d'));
 await page.evaluate(()=>{window.fail=true;window.edit('d',' retained on rejection')});
 assert.equal(await page.evaluate(()=>window.release('d')),false);assert.equal(await page.evaluate(()=>window.phase('d')),'retained-error');
 assert.equal(await page.evaluate(()=>window.closes),27);
 assert.equal(await page.evaluate(()=>window.flushAll()),false,'A detached unsaved owner must block application shutdown');
 await page.evaluate(()=>window.open('e'));assert.equal(await page.evaluate(()=>window.same('d','e')),true);
 assert.ok((await page.evaluate(()=>window.text('e'))).endsWith('retained on rejection'));
 assert.equal(await page.evaluate(()=>window.opens),28);
 await page.evaluate(()=>window.rejectRecovery=true);
 assert.equal(await page.evaluate(()=>window.recover('e').then(()=>false,()=>true)),true);
 assert.equal(await page.evaluate(()=>window.recoveries),0);assert.equal(await page.evaluate(()=>window.closes),27);
 await page.evaluate(()=>window.rejectRecovery=false);
 assert.equal(await page.evaluate(()=>window.recover('e')),true);
 assert.equal(await page.evaluate(()=>window.recoveries),1);assert.equal(await page.evaluate(()=>window.closes),27);
 assert.equal(await page.evaluate(()=>window.flushAll()),true,'Confirmed durable recovery permits application shutdown');
 assert.deepEqual(errors,[]);
 console.log('PASS production native owner with controlled adapter: last release waits for native checkpoint; reacquire keeps lease; cancelled open closes only after completion; checkpoint rejection retains the exact document and lease for recovery.');
}finally{await browser.close();}
