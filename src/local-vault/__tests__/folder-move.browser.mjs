import assert from 'node:assert/strict';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'folder-move-'));await symlink(path.join(process.cwd(),'node_modules'),path.join(dir,'node_modules')); 
import {chromium} from 'playwright';
const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{VaultApp}from'./src/local-vault/VaultApp';import{setVaultTransport}from'./src/local-vault/bridge';import{createFolderViewPack}from'./src/local-vault/folder-view';import{openPack}from'./src/local-vault/pack';import{requireBuiltinTemplate}from'./src/lib/presentation/templates';
window.workspace='vault:one';window.calls=[];let file=openPack(createFolderViewPack('Notes',requireBuiltinTemplate('texttext.note')).bytes,'Notes/Folder view.textpack','hash').file;
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='list')return{root:window.workspace,name:'Test',folders:['Notes','Other'],items:[{path:file.path}],fullAccess:true,canCreateContent:true};if(method==='folderViews')return{files:params.folder==='Notes'?[file]:[]};if(method==='connection')return{connected:true,available:true,root:window.workspace};if(method==='collaborationConfig')return null;if(method==='read')return file;if(method==='preview')return{title:'Folder view'};if(method==='templates')return{files:[]};if(method==='folderMoveReview')return{reviewPath:'/proposals/11111111-1111-4111-8111-111111111111'};if(method==='agentStatus')return{state:'ready',message:'Ready'};if(method==='agentSend'){window.dispatchEvent(new CustomEvent('texttext:vault-agent',{detail:{type:'turn-completed',taskId:params.taskId}}));return{}};return{}});
createRoot(document.getElementById('root')).render(<VaultApp allowFolderPicker={false} webAssistant/>);`;
await writeFile(path.join(dir,'entry.tsx'),contents.replaceAll("'./src/", "'"+process.cwd()+"/src/"));
await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://folder.test/**',r=>r.request().url().includes('/access')?r.fulfill({json:{fullAccess:true,isOwner:true,canEditContent:true,canCreateContent:true,canComment:true,canManageShares:true,grants:[]}}):r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://folder.test');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.locator('summary').filter({hasText:'Notes'}).first().click();
 await page.getByText('More',{exact:true}).click();await page.getByRole('button',{name:'Rename or move folder',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Move folder'});await dialog.waitFor();
 await dialog.getByRole('textbox',{name:'New folder path'}).fill('Notes/Inside');await dialog.getByRole('button',{name:'Prepare move',exact:true}).click();
 await dialog.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='folderMoveReview').length),0);
 await dialog.getByRole('textbox',{name:'New folder path'}).fill('Archive/Notes');await dialog.getByRole('button',{name:'Prepare move',exact:true}).click();
 const link=dialog.getByRole('link',{name:'Review folder move'});await link.waitFor();assert.equal(await link.getAttribute('href'),'/proposals/11111111-1111-4111-8111-111111111111');
 assert.deepEqual(await page.evaluate(()=>window.calls.find(c=>c.method==='folderMoveReview').params),{source:'Notes',destination:'Archive/Notes'});
 for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:'/tmp/texttext-folder-move-'+colorScheme+'.png'});}
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByText('More',{exact:true}).click();await page.getByRole('button',{name:'Rename or move folder',exact:true}).click();await dialog.waitFor();
 await page.evaluate(()=>{window.workspace='vault:two';window.dispatchEvent(new Event('texttext:vault-changed'))});await dialog.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='folderMoveReview').length),1);assert.deepEqual(errors,[]);
 console.log('PASS shared folder move: path validation, canonical review staging, light/dark dialog and workspace departure.');
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
