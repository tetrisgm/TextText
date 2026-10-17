import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const nativeMode=process.argv.includes('--native');
const dir=await mkdtemp(path.join(tmpdir(),'texttext-session-views-'));let browser;
try{
 const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{CollaborativeVaultEditor}from'${root}/src/local-vault/CollaborativeVaultEditor';
import{VaultApp}from'${root}/src/local-vault/VaultApp';
import{acquireVaultDocument}from'${root}/src/local-vault/document-session';
import{writePayload}from'${root}/src/local-vault/model';
import{setVaultTransport}from'${root}/src/local-vault/bridge';
import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import{applyDocumentSnapshot,documentText}from'${root}/src/lib/collab/document';import*as Y from'yjs';
import '${root}/src/local-vault/style.css';
const doc=emptyDocumentSnapshot({id:'texttext.note',version:1});doc.content.title='Shared views';doc.content.body='Original';
const seed=new Y.Doc();applyDocumentSnapshot(seed,doc,'seed');const update=btoa(String.fromCharCode(...Y.encodeStateAsUpdate(seed)));seed.destroy();
const initial={path:'Shared.textpack',hash:'a'.repeat(64),markdown:'---\\ntextTextId: item-views\\n---\\nOriginal',documentJSON:JSON.stringify(doc)};
window.initialReads=0;window.pushes=0;window.presenceJoins=0;window.presenceLeaves=0;window.nativeOpens=0;window.nativeCloses=0;window.lateCheckpoints=0;
let projected={...initial},journal=null,token=null;

setVaultTransport(async(method,params,signal)=>{
 if(method==='list')return{root:'/isolated-views',items:[],folders:[]};
 if(method==='connection')return{connected:false};
 if(method==='collaborationOpen'){window.nativeOpens++;token='session-'+window.nativeOpens;return{sessionToken:token,path:projected.path,hash:projected.hash,projectedHash:projected.hash,acknowledgedRevision:initial.hash,journal,retiredReason:null,capabilities:['epoch-adoption']};}
 if(method==='collaborationCheckpoint'){
  if(window.failCheckpoint)throw Error('Injected unavailable storage');
  if(params.sessionToken!==token){window.lateCheckpoints++;throw Error('Closed native lease');}
  if(params.hash!==projected.hash)throw Error('Projection changed');
  journal=params.journal;projected={...projected,markdown:params.markdown,documentJSON:params.documentJSON,hash:projected.hash+'x'};return{path:projected.path,hash:projected.hash};
 }
 if(method==='collaborationClose'){if(params.sessionToken!==token)throw Error('Wrong native lease');token=null;window.nativeCloses++;return{};}
 if(method==='collaborationRecover'){
  if(params.sessionToken!==token||params.recoveryPath!==window.recovered.path||params.recoveryHash!==window.recovered.hash)throw Error('Invalid recovery');
  token=null;return{};
 }
 if(method==='collaborationRead'){
  if(params.waitMs)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  else window.initialReads++;
  return{epoch:1,seq:0,revision:initial.hash,relativePath:initial.path,update,canEditContent:true,canComment:true};
 }
 if(method==='collaborationPush'){window.pushes++;throw Object.assign(new Error('Offline fixture'),{status:503})}
 if(method==='read')return projected;
 if(method==='presenceJoin'){window.presenceJoins++;return{epoch:1,presence:[],session:{clientId:'p-'+crypto.randomUUID(),sessionCredential:'v1:test',expiresAt:Date.now()+600000}};}
 if(method==='presenceRead'||method==='presenceUpdate')return{epoch:1,presence:[]};
 if(method==='presenceLeave'){window.presenceLeaves++;return{};}
 throw Error(method);
});
const app=createRoot(document.getElementById('root')),noop=()=>{};
window.render=names=>app.render(<div className="vault-app">{names.map(name=><div key={name} data-view={name}><CollaborativeVaultEditor initial={initial} root="web:views" startEditing config={{namespace:'https://views.test',workspaceId:'workspace',itemId:'item-views',accountId:'account-a',localFiles:${nativeMode}}} registerFlush={noop} onChanged={noop} onRemoved={noop}/></div>)}</div>);
window.render(['a','b']);
window.home=()=>app.render(<VaultApp/>);
window.hiddenDraft=async()=>{
 const h=acquireVaultDocument({namespace:'https://views.test',workspaceId:'workspace',itemId:'item-views',accountId:'account-a',localFiles:true},projected,'web:views');
 await h.ready;h.session.client.setActive(false,'offline');window.failCheckpoint=true;
 h.session.client.mutate(doc=>documentText(doc,'body').insert(documentText(doc,'body').length,' hidden unsaved draft'));
 return h.release();
};
window.recoverHidden=async()=>{
 const h=acquireVaultDocument({namespace:'https://views.test',workspaceId:'workspace',itemId:'item-views',accountId:'account-a',localFiles:true},projected,'web:views');await h.ready;
 window.recovered={...projected,...writePayload({...projected,path:'Recovery.textpack',markdown:projected.markdown.replace('textTextId: item-views','textTextId: recovered-item')},h.session.snapshot),hash:'recovery-hash'};
 return h.runExclusive(async()=>{await h.session.recoverTo(window.recovered);return h.closeExclusive(()=>h.session.client.clearRetiredAfterRecoveryDurably())});
};
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://views.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://views.test');
 await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.locator('[data-view="b"] [aria-label="Document body"]').waitFor();
 assert.equal(await page.evaluate(()=>window.initialReads),1);if(nativeMode)assert.equal(await page.evaluate(()=>window.nativeOpens),1);
 await page.waitForFunction(()=>window.presenceJoins===1);
 await page.evaluate(()=>window.render(['b']));await page.waitForFunction(()=>!document.querySelector('[data-view="a"]'));
 assert.equal(await page.evaluate(()=>window.presenceLeaves),0);
 await page.evaluate(()=>window.render(['a','b']));await page.locator('[data-view="a"] [aria-label="Document body"]').waitFor();
 assert.equal(await page.evaluate(()=>window.presenceJoins),1);
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});window.dispatchEvent(new Event('offline'))});
 const body=name=>page.locator('[data-view="'+name+'"] [aria-label="Document body"]');
 await body('a').click();await page.keyboard.press('End');await page.keyboard.type(' first view');
 await page.waitForFunction(()=>document.querySelector('[data-view="b"] [aria-label="Document body"]').textContent.includes('first view'));
 await body('b').evaluate(el=>el.dataset.continuity='kept');
 await page.evaluate(()=>window.render(['b']));await page.waitForFunction(()=>!document.querySelector('[data-view="a"]'));
 assert.equal(await body('b').getAttribute('data-continuity'),'kept');if(nativeMode)assert.equal(await page.evaluate(()=>window.nativeCloses),0);
 await body('b').click();await page.keyboard.press('End');await page.keyboard.type(' second view');
 const expected=await body('b').innerText();assert.ok(expected.includes('first view second view'));
 await page.evaluate(()=>window.render([]));await page.waitForFunction(()=>!document.querySelector('[data-view]'));
 // Reacquire immediately, including while the old IDB drain may still run.
 await page.evaluate(()=>window.render(['c']));await body('c').waitFor();
 assert.equal(await body('c').innerText(),expected);assert.equal(await page.evaluate(()=>window.pushes),0);
 assert.deepEqual(errors,[]);await page.evaluate(()=>window.render([]));
 if(nativeMode){await page.waitForFunction(()=>window.nativeCloses===window.nativeOpens);assert.equal(await page.evaluate(()=>window.lateCheckpoints),0);}
 if(nativeMode){
  assert.equal(await page.evaluate(()=>window.hiddenDraft()),false);
  await page.evaluate(()=>window.home());await page.waitForFunction(()=>typeof window.texttextFlushForNativeClose==='function');
  assert.deepEqual(await page.evaluate(()=>window.texttextFlushForNativeClose()),{ok:false,idle:false,durability:{outcome:'pending'}});
  assert.equal(await page.evaluate(()=>window.texttextFlushForSignOut()),false);
  assert.ok((await page.locator('body').innerText()).includes('Some edits have not finished saving'));
  await page.evaluate(()=>window.failCheckpoint=false);
  // Native checkpoint failures freeze the original lease; use the existing
  // explicit durable-copy recovery instead of clearing that safety fence.
  assert.equal(await page.evaluate(()=>window.recoverHidden()),true);
  assert.equal(await page.evaluate(()=>window.texttextFlushForSignOut()),true);
  assert.deepEqual(await page.evaluate(()=>window.texttextFlushForNativeClose()),{ok:true,idle:true,durability:{outcome:'durable'}});
  assert.deepEqual(errors,[]);
 }
 console.log('PASS '+(nativeMode?'native-adapter':'web')+' production React views: one collaboration open for two editors; edits appear in both; unmount preserves the remaining editor; offline last-release/reopen retains exact text without upload.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
