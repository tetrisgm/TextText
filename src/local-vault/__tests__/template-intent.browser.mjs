import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-template-intent-'));
let browser;
try {
 const root=process.cwd();
 await symlink(path.join(root,"node_modules"),path.join(dir,"node_modules"));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import {openPack} from '${root}/src/local-vault/pack';import {createFolderViewPack,FOLDER_DEFAULT_FIELD,FOLDER_STANDARD_LAYOUT_FIELD} from '${root}/src/local-vault/folder-view';import {requireBuiltinTemplate} from '${root}/src/lib/presentation/templates';
import '${root}/src/local-vault/style.css';
let file;window.calls=[];window.intent={query:'Note'};
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='list')return{root:'vault:test',name:'Test',folders:['Notes'],items:file?[{path:file.path}]:[]};if(method==='folderViews'){const pack=openPack(createFolderViewPack('Notes',requireBuiltinTemplate('texttext.note')).bytes,'Notes/Folder view.textpack','view');const doc=JSON.parse(pack.file.documentJSON);doc.content.fields[FOLDER_DEFAULT_FIELD]=JSON.stringify({version:1,template:{...requireBuiltinTemplate('texttext.article'),starter:{title:'Default title',body:'Default body',fields:{}}}});doc.content.fields[FOLDER_STANDARD_LAYOUT_FIELD]='v1';return{files:[{...pack.file,documentJSON:JSON.stringify(doc)}]};}if(method==='importPack'){file=openPack(Uint8Array.from(atob(params.data),c=>c.charCodeAt(0)),params.folder+'/Untitled.textpack','1').file;window.imported=JSON.parse(file.documentJSON);return file;}if(method==='connection')return{connected:true,available:true};if(method==='collaborationConfig')return null;if(method==='create'){const doc=emptyDocumentSnapshot();file={path:'Notes/Untitled.textpack',hash:'1',markdown:'---\\ntextTextId: 4c417b9d-f935-40c4-a537-7cb70658f898\\n---\\n',documentJSON:JSON.stringify(doc)};return file;}if(method==='write'){file={...file,...params,hash:'2'};return file;}if(method==='read')return file;if(method==='preview')return{path:file.path,title:'Untitled'};throw Error(method);});
const app=createRoot(document.getElementById('root'));window.render=()=>app.render(<VaultApp key={window.generation||0} allowFolderPicker={false} templateIntent={window.intent}/>);window.render();
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let permit;const permission=new Promise(resolve=>permit=resolve);
 await page.route('https://template.test/**',async route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/access')){await permission;return route.fulfill({json:{fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]}});}if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});return route.fulfill({status:404});});
 await page.goto('https://template.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.waitForFunction(()=>window.calls.some(c=>c.method==='list'));assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='create').length),0);
 permit();const dialog=page.getByRole('dialog',{name:'New from template'});await dialog.waitFor();assert.equal(await dialog.getByRole('searchbox',{name:'Search templates'}).inputValue(),'Note');assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='create').length),0);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>window.render());await page.waitForTimeout(100);assert.equal(await dialog.count(),0);
 await page.evaluate(()=>{window.intent={query:''};window.render()});await dialog.waitFor();assert.equal(await dialog.getByRole('searchbox').inputValue(),'');assert.ok(await dialog.getByRole('button').count()>3);
 await dialog.getByRole('button',{name:'Note',exact:true}).click();await page.waitForFunction(()=>window.calls.some(c=>c.method==='importPack'));assert.equal(await page.evaluate(()=>window.calls.slice(0,window.calls.findIndex(c=>c.method==='importPack')).filter(c=>c.method==='create'||c.method==='write').length),0);assert.equal(await page.evaluate(()=>window.calls.find(c=>c.method==='importPack').params.folder),'Notes');assert.equal(await page.evaluate(()=>window.imported.presentation.template.id),'texttext.note');assert.notEqual(await page.evaluate(()=>window.imported.content.title),'Default title');assert.deepEqual(errors,[]);
 await page.evaluate(()=>{window.calls=[];window.intent=null;window.generation=1;window.render()});await page.getByRole('button',{name:'New note',exact:true}).first().click();await page.waitForFunction(()=>window.calls.some(c=>c.method==='importPack'));assert.equal(await page.evaluate(()=>window.imported.presentation.template.id),'texttext.article');assert.equal(await page.evaluate(()=>window.imported.content.title),'Default title');assert.equal(await page.evaluate(()=>window.imported.content.body),'Default body');
 console.log('PASS template intent: permission gate, filtered picker, no GET creation, consumed rerender, full picker fallback, explicit template overrides folder default with one complete import.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
