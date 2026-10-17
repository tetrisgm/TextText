import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-session-views-'));let browser;
try{
 const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{CollaborativeVaultEditor}from'${root}/src/local-vault/CollaborativeVaultEditor';
import{setVaultTransport}from'${root}/src/local-vault/bridge';
import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import{applyDocumentSnapshot}from'${root}/src/lib/collab/document';import*as Y from'yjs';
import '${root}/src/local-vault/style.css';
const doc=emptyDocumentSnapshot({id:'texttext.note',version:1});doc.content.title='Shared views';doc.content.body='Original';
const seed=new Y.Doc();applyDocumentSnapshot(seed,doc,'seed');const update=btoa(String.fromCharCode(...Y.encodeStateAsUpdate(seed)));seed.destroy();
const initial={path:'Shared.textpack',hash:'a'.repeat(64),markdown:'---\\ntextTextId: item-views\\n---\\nOriginal',documentJSON:JSON.stringify(doc)};
window.initialReads=0;window.pushes=0;
setVaultTransport(async(method,params,signal)=>{
 if(method==='collaborationRead'){
  if(params.waitMs)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  else window.initialReads++;
  return{epoch:1,seq:0,revision:initial.hash,relativePath:initial.path,update,canEditContent:true,canComment:true};
 }
 if(method==='collaborationPush'){window.pushes++;throw Object.assign(new Error('Offline fixture'),{status:503})}
 if(method==='read')return initial;
 if(method==='presenceJoin')return{epoch:1,presence:[],session:{clientId:'p-'+crypto.randomUUID(),sessionCredential:'v1:test',expiresAt:Date.now()+600000}};
 if(method==='presenceRead'||method==='presenceUpdate')return{epoch:1,presence:[]};
 if(method==='presenceLeave')return{};
 throw Error(method);
});
const app=createRoot(document.getElementById('root')),noop=()=>{};
window.render=names=>app.render(<div className="vault-app">{names.map(name=><div key={name} data-view={name}><CollaborativeVaultEditor initial={initial} root="web:views" startEditing config={{namespace:'https://views.test',workspaceId:'workspace',itemId:'item-views',accountId:'account-a'}} registerFlush={noop} onChanged={noop} onRemoved={noop}/></div>)}</div>);
window.render(['a','b']);
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://views.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://views.test');
 await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.locator('[data-view="b"] [aria-label="Document body"]').waitFor();
 assert.equal(await page.evaluate(()=>window.initialReads),1);
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});window.dispatchEvent(new Event('offline'))});
 const body=name=>page.locator('[data-view="'+name+'"] [aria-label="Document body"]');
 await body('a').click();await page.keyboard.press('End');await page.keyboard.type(' first view');
 await page.waitForFunction(()=>document.querySelector('[data-view="b"] [aria-label="Document body"]').textContent.includes('first view'));
 await body('b').evaluate(el=>el.dataset.continuity='kept');
 await page.evaluate(()=>window.render(['b']));await page.waitForFunction(()=>!document.querySelector('[data-view="a"]'));
 assert.equal(await body('b').getAttribute('data-continuity'),'kept');
 await body('b').click();await page.keyboard.press('End');await page.keyboard.type(' second view');
 const expected=await body('b').innerText();assert.ok(expected.includes('first view second view'));
 await page.evaluate(()=>window.render([]));await page.waitForFunction(()=>!document.querySelector('[data-view]'));
 // Reacquire immediately, including while the old IDB drain may still run.
 await page.evaluate(()=>window.render(['c']));await body('c').waitFor();
 assert.equal(await body('c').innerText(),expected);assert.equal(await page.evaluate(()=>window.pushes),0);
 assert.deepEqual(errors,[]);await page.evaluate(()=>window.render([]));
 console.log('PASS production React views: one collaboration open for two editors; edits appear in both; unmount preserves the remaining editor; offline last-release/reopen retains exact text without upload.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
