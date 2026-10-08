import assert from 'node:assert/strict';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'folder-agent-'));await symlink(path.join(process.cwd(),'node_modules'),path.join(dir,'node_modules'));
import {chromium} from 'playwright';
const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{VaultApp}from'./src/local-vault/VaultApp';import{setVaultTransport}from'./src/local-vault/bridge';import{createFolderViewPack}from'./src/local-vault/folder-view';import{openPack}from'./src/local-vault/pack';import{requireBuiltinTemplate}from'./src/lib/presentation/templates';
window.workspace='vault:one';window.calls=[];let file=openPack(createFolderViewPack('Notes',requireBuiltinTemplate('texttext.note')).bytes,'Notes/Folder view.textpack','hash').file;
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='list')return{root:window.workspace,name:'Test',folders:['Notes','Other'],items:[{path:file.path}],fullAccess:true,canCreateContent:true};if(method==='folderViews')return{files:params.folder==='Notes'?[file]:[]};if(method==='connection')return{connected:true,available:true,root:window.workspace};if(method==='collaborationConfig')return null;if(method==='read')return file;if(method==='preview')return{title:'Folder view'};if(method==='templates')return{files:[]};if(method==='agentStatus')return{state:'ready',message:'Ready'};if(method==='agentSend'){if(!window.holdTurn)window.dispatchEvent(new CustomEvent('texttext:vault-agent',{detail:{type:'turn-completed',taskId:params.taskId}}));return{}};return{}});
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
 // Folder drafts must follow navigation without carrying the previous prompt.
 await composer.fill('Notes draft stays in Notes');
 await page.locator('summary').filter({hasText:'Other'}).first().click();
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Message assistant"]')?.value==='');
 await composer.fill('Other draft stays in Other');
 await page.locator('summary').filter({hasText:'Notes'}).first().click();
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Message assistant"]')?.value==='Notes draft stays in Notes');
 // An in-flight Notes task stays fenced there while the selection changes.
 await page.evaluate(()=>window.holdTurn=true);
 await page.getByRole('button',{name:'Start task',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(c=>c.method==='agentSend').length===2);
 await page.locator('summary').filter({hasText:'Other'}).first().click();
 await page.getByRole('button',{name:'Stop',exact:true}).waitFor();
 const running=await page.evaluate(()=>window.calls.filter(c=>c.method==='agentSend').at(-1).params);
 assert.equal(running.folderPath,'Notes');
 await page.evaluate(taskId=>{window.holdTurn=false;window.dispatchEvent(new CustomEvent('texttext:vault-agent',{detail:{type:'turn-completed',taskId}}));},running.taskId);
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Message assistant"]')?.value==='Other draft stays in Other');
 await page.getByRole('button',{name:'Start task',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(c=>c.method==='agentSend').length===3);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='agentSend').at(-1).params.folderPath),'Other');
 // Empty root is a valid explicit folder target, not a missing item target.
 await page.getByRole('button',{name:'TextText',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Message assistant"]')?.value==='');
 await composer.fill('Create in workspace root');await page.getByRole('button',{name:'Start task',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(c=>c.method==='agentSend').length===4);
 const rootSend=await page.evaluate(()=>window.calls.filter(c=>c.method==='agentSend').at(-1).params);
 assert.equal(rootSend.scope,'folder');assert.equal(rootSend.folderPath,'');assert.equal(rootSend.path,undefined);
 assert.deepEqual(errors,[]);
 console.log('PASS native folder agent: explicit dispatch, isolated drafts, active-turn navigation fence, root scope.');

}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
