import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-trash-'));
let browser;
try {
 const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import '${root}/src/local-vault/style.css';
window.restores=[];window.copies=[];window.calls=[];let restored=false;const doc=emptyDocumentSnapshot({id:'texttext.note',version:1});doc.content.title='Kept';doc.content.body='Retained body';const file={path:'Notes/Deleted.textpack',hash:'b'.repeat(64),markdown:'---\\ntextTextId: stable-id\\n---\\nRetained body',documentJSON:JSON.stringify(doc)};
setVaultTransport(async(method,params)=>{window.calls.push(method);if(method==='list')return{root:'vault:test',name:'Test',folders:['Notes'],items:restored?[{path:file.path}]:[]};if(method==='folderViews')return{files:[]};if(method==='connection')return{connected:true,available:true};if(method==='collaborationConfig')return null;if(method==='read')return file;if(method==='preview')return{path:file.path,title:'Kept',document:doc};if(method==='trashList')return{items:[{itemId:'stable-id',relativePath:file.path,revision:'a'.repeat(64)}],truncated:false};if(method==='recoveryList')return{entries:[{id:'revision',path:'Blog/Old.textpack',kind:'revision',savedAt:'2026-10-07',hash:'hash'}],truncated:false};if(method==='recoveryRead')return{...file,path:'Blog/Old.textpack',hash:'hash',data:'complete-pack'};if(method==='trashRestore'){window.restores.push(params);if(window.restores.length===1)throw Error('Response lost. Try again.');restored=true;return{status:'restored',relativePath:file.path,revision:file.hash};}if(method==='trashReconcile')return null;if(method==='importPack'){window.copies.push(params);throw Error('Must not copy');}throw Error(method);});
createRoot(document.getElementById('root')).render(<VaultApp allowFolderPicker={false}/>);
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage();
 await page.route('https://trash.test/**',route=>route.request().url().endsWith('/access')?route.fulfill({json:{fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]}}):route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://trash.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.getByText('More',{exact:true}).click();await page.getByRole('button',{name:'Trash and recovery',exact:true}).click();
 await page.getByRole('button',{name:/Blog\/Old.textpack/}).click();await page.getByLabel('Restore into folder').waitFor();assert.equal(await page.getByLabel('Restore into folder').inputValue(),'Blog');
 await page.getByRole('button',{name:/Notes\/Deleted.textpack/}).click();await page.getByRole('button',{name:'Restore item',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('button',{name:'Restore item',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Restore item',exact:true}).click();
 await page.getByRole('button',{name:'Edit card',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByText('Retained body',{exact:true}).count(),1);const calls=await page.evaluate(()=>window.restores);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].itemId,'stable-id');assert.equal(calls[0].baseRevision,'a'.repeat(64));assert.equal(await page.evaluate(()=>window.copies.length),0);
 console.log('PASS Trash restore: same identity/retry operation after lost response, no import copy, original recovery parent, bounded error state.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
