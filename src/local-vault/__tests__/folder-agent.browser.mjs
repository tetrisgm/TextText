import assert from 'node:assert/strict';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'folder-customize-'));await symlink(path.join(process.cwd(),'node_modules'),path.join(dir,'node_modules')); 
import {chromium} from 'playwright';
const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{VaultApp}from'./src/local-vault/VaultApp';import{setVaultTransport}from'./src/local-vault/bridge';import{createFolderViewPack}from'./src/local-vault/folder-view';import{openPack}from'./src/local-vault/pack';import{requireBuiltinTemplate}from'./src/lib/presentation/templates';
window.workspace='vault:one';window.calls=[];let file=openPack(createFolderViewPack('Notes',requireBuiltinTemplate('texttext.note')).bytes,'Notes/Folder view.textpack','hash').file;
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='list')return{root:window.workspace,name:'Test',folders:['Notes','Other'],items:[{path:file.path}],fullAccess:true,canCreateContent:true};if(method==='folderViews')return{files:params.folder==='Notes'?[file]:[]};if(method==='connection')return{connected:true,available:true,root:window.workspace};if(method==='collaborationConfig')return null;if(method==='read')return file;if(method==='preview')return{title:'Folder view'};if(method==='templates')return{files:[]};if(method==='agentStatus')return{state:'ready',message:'Ready'};if(method==='agentSend'){window.dispatchEvent(new CustomEvent('texttext:vault-agent',{detail:{type:'turn-completed',taskId:params.taskId}}));return{}};return{}});
createRoot(document.getElementById('root')).render(<VaultApp allowFolderPicker/>);`;
await writeFile(path.join(dir,'entry.tsx'),contents.replaceAll("'./src/", "'"+process.cwd()+"/src/"));
await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://folder.test/**',r=>r.request().url().includes('/access')?r.fulfill({json:{fullAccess:true,isOwner:true,canEditContent:true,canCreateContent:true,canComment:true,canManageShares:true,grants:[]}}):r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://folder.test');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.locator('summary').filter({hasText:'Notes'}).first().click();
 await page.getByText('More',{exact:true}).click();await page.getByRole('button',{name:'Add agent',exact:true}).click();
 const composer=page.getByRole('textbox',{name:'Message assistant'});await composer.waitFor();
 await composer.fill('Create a note in this folder');await page.getByRole('button',{name:'Start task',exact:true}).click();
 await page.waitForFunction(()=>window.calls.some(c=>c.method==='agentSend'));
 const sent=await page.evaluate(()=>window.calls.find(c=>c.method==='agentSend').params);
 assert.equal(sent.scope,'folder');assert.equal(sent.folderPath,'Notes');assert.equal(sent.path,undefined);
 for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:'/tmp/texttext-folder-agent-'+colorScheme+'.png'});}
 assert.deepEqual(errors,[]);
 console.log('PASS native folder agent action sends explicit folder scope without an item path.');

}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
