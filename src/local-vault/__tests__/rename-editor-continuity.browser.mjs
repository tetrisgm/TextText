// Native listings identify rows from the sync manifest, which lags a filesystem
// rename. The open editor must keep its element, caret and undo stack through the
// stale listing and the later identified one, and still lose editing on an
// explicit revocation for the same item.
import assert from 'node:assert/strict';import{mkdtemp,writeFile,readFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{chromium}from'playwright';import{buildLocalVault}from'../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-rename-continuity-'));let browser;
try{
const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';import '${root}/src/local-vault/style.css';
const id='243d5ab9-b356-4e70-8453-85f90010b503';const oldPath='Notes/Untitled 15.textpack',newPath='Notes/Rename continuity 1238.textpack';
let doc=emptyDocumentSnapshot();doc.content.title='Rename continuity 1238';doc.content.body='Baseline before external rename.';
let file={path:oldPath,hash:'a',markdown:'---\\ntextTextId: '+id+'\\n---\\nBaseline before external rename.',documentJSON:JSON.stringify(doc)};
window.phase='before';window.calls=[];
const rows=()=>({before:[{path:oldPath,itemId:id,canEditContent:true}],stale:[{path:newPath,canEditContent:true}],indexed:[{path:newPath,itemId:id,canEditContent:true}],revoked:[{path:newPath,itemId:id,canEditContent:false}]})[window.phase];
setVaultTransport(async(method,params)=>{window.calls.push({method,params});
 if(method==='list')return{root:'/shared',folders:['Notes'],items:rows(),fullAccess:false,canCreateContent:false,writableFolders:[]};
 if(method==='resolveItemId'){if(params.itemId!==id||window.phase==='before')throw Error('This linked card is no longer in the workspace.');return{path:newPath};}
 if(method==='folderViews')return{files:[]};if(method==='connection')return{connected:true,available:true,root:'/shared'};if(method==='collaborationConfig')return null;
 if(method==='read'){if(params.path!==(window.phase==='before'?oldPath:newPath))throw Error('Missing file '+params.path);return{...file,path:params.path};}
 if(method==='write'){file={...file,...params,hash:file.hash+'x'};return file;}
 if(method==='preview')return{title:doc.content.title,cardBody:doc.content.body,document:doc};if(method==='templates')return{files:[]};throw Error(method);});
createRoot(document.getElementById('root')).render(<VaultApp/>);
`);
await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://rename.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://rename.test');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
await page.waitForFunction(()=>window.calls.some(c=>c.method==='list'));
await page.evaluate(()=>window.dispatchEvent(new CustomEvent('texttext:vault-open',{detail:{path:'Notes/Untitled 15.textpack'}})));
await page.getByRole('button',{name:'Edit story',exact:true}).click();
const body=page.getByLabel('Document body');await body.waitFor();await body.click();await page.keyboard.press('End');await page.keyboard.type(' [typed 1238]');
await page.evaluate(()=>{const el=document.querySelector('[aria-label="Document body"]');el.__continuity='mounted';});
const state=()=>page.evaluate(()=>{const el=document.querySelector('[aria-label="Document body"]');return{marked:el?.__continuity??null,focused:document.activeElement===el,readOnly:document.body.innerText.includes('Read only'),text:el?.innerText??null};});
const refresh=async phase=>{const listed=await page.evaluate(()=>window.calls.filter(c=>c.method==='list').length);await page.evaluate(p=>{window.phase=p;window.dispatchEvent(new Event('texttext:vault-changed'));},phase);await page.waitForFunction(n=>window.calls.filter(c=>c.method==='list').length>n,listed);await page.waitForTimeout(150);};

// Stale listing: new path present, not yet identified; old path gone.
await refresh('stale');
let s=await state();assert.deepEqual({marked:s.marked,focused:s.focused,readOnly:s.readOnly},{marked:'mounted',focused:true,readOnly:false},'editor must stay mounted and focused through the stale listing: '+JSON.stringify(s));
assert.ok(await page.evaluate(()=>window.calls.some(c=>c.method==='resolveItemId'&&c.params.itemId==='243d5ab9-b356-4e70-8453-85f90010b503')),'identity resolved by id');
// Listing later identifies the renamed row.
await refresh('indexed');
s=await state();assert.deepEqual({marked:s.marked,focused:s.focused,readOnly:s.readOnly},{marked:'mounted',focused:true,readOnly:false},'editor must stay mounted through the identified listing: '+JSON.stringify(s));
assert.ok(s.text.endsWith('[typed 1238]'),'typed text present: '+s.text);
// Undo stack survived both listings.
await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
s=await state();assert.equal(s.marked,'mounted');assert.ok(!s.text.includes('[typed 1238]'),'undo reverted typing: '+s.text);
// Saves go to the resolved path, never the stale one.
await page.keyboard.type(' [after 1238]');await page.getByRole('button',{name:/^(Done|Save)/}).first().click();
await page.waitForFunction(()=>window.calls.some(c=>c.method==='write'),null,{timeout:8000}).catch(async e=>{console.log(await page.evaluate(()=>({calls:window.calls.slice(-10).map(c=>c.method+':'+(c.params?.path??'')),text:document.body.innerText.slice(-600)})));throw e;});
assert.deepEqual(await page.evaluate(()=>[...new Set(window.calls.filter(c=>c.method==='write').map(c=>c.params.path))]),['Notes/Rename continuity 1238.textpack']);
// Explicit revocation for the same identity still fails closed.
await page.getByRole('button',{name:'Edit story',exact:true}).click();await body.waitFor();
await refresh('revoked');
await page.getByText('Read only',{exact:true}).waitFor();assert.equal(await page.locator('[contenteditable="true"]').count(),0);
assert.deepEqual(errors,[]);
console.log('PASS rename continuity: editor element, caret and undo survive a stale then identified listing after an external rename; explicit revocation still removes editing.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
