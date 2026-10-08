import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-note-template-'));
let browser;
try {
 const root=process.cwd();
 await symlink(path.join(root,"node_modules"),path.join(dir,"node_modules"));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import {openPack} from '${root}/src/local-vault/pack';
import '${root}/src/local-vault/style.css';
let files=new Map();let version=0;window.calls=[];window.intent=null;window.files=files;
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='list')return{root:'vault:test',name:'Test',folders:['Notes'],items:[...files.keys()].map(path=>({path}))};if(method==='folderViews')return{files:[]};if(method==='connection')return{connected:true,available:true};if(method==='collaborationConfig')return null;if(method==='importPack'){const file=openPack(Uint8Array.from(atob(params.data),c=>c.charCodeAt(0)),params.folder+'/'+params.title+'.textpack',String(++version)).file;files.set(file.path,file);return file;}if(method==='create'){const doc=emptyDocumentSnapshot();const file={path:params.folder+'/'+params.title+'.textpack',hash:String(++version),markdown:'---\\ntextTextId: '+crypto.randomUUID()+'\\n---\\n',documentJSON:JSON.stringify(doc)};files.set(file.path,file);return file;}if(method==='write'){const file={...files.get(params.path),...params,hash:String(++version)};files.set(file.path,file);return file;}if(method==='read')return files.get(params.path);if(method==='template'){const file=files.get(params.path);return{path:file.path,hash:file.hash,templateJSON:file.templateJSON}}if(method==='preview'){const file=files.get(params.path);return{path:file.path,title:JSON.parse(file.documentJSON).content.title,excerpt:JSON.parse(file.documentJSON).content.body,document:JSON.parse(file.documentJSON)}}throw Error(method);});
const app=createRoot(document.getElementById('root'));window.render=()=>app.render(<VaultApp allowFolderPicker={false} templateIntent={window.intent}/>);window.render();
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let permit;const permission=new Promise(resolve=>permit=resolve);
 await page.route('https://template.test/**',async route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/access')){await permission;return route.fulfill({json:{fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]}});}if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});return route.fulfill({status:404});});
 await page.goto('https://template.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});

 permit();await page.getByText('Notes',{exact:true}).first().click();
 await page.getByRole('button',{name:'Start typing to create a new card'}).click();
 await page.getByLabel('New card title').fill('Keep title');await page.getByLabel('New card body').fill('Agenda');
 await page.getByRole('button',{name:'Add to new card',exact:true}).click();await page.getByRole('menu',{name:'Add to new card'}).getByRole('menuitem').first().press('=');
 await page.getByLabel('Find or name a text template').fill('Meeting');await page.getByRole('button',{name:'Save current text as Meeting',exact:true}).click();
 await page.waitForFunction(()=>[...window.files.values()].some(f=>f.path==='Templates/Meeting.textpack'&&JSON.parse(f.documentJSON).content.body==='Agenda'));
 assert.equal(await page.getByLabel('New card body').inputValue(),'Agenda');await page.getByLabel('New card body').fill('Before After');await page.getByLabel('New card body').evaluate(el=>el.setSelectionRange(7,7));
 await page.getByRole('button',{name:'Add to new card',exact:true}).click();await page.getByRole('menu',{name:'Add to new card'}).getByRole('menuitem').first().press('=');await page.getByRole('button',{name:'Insert Meeting',exact:true}).click();
 assert.equal(await page.getByLabel('New card body').inputValue(),'Before AgendaAfter');await page.getByRole('button',{name:'Finish',exact:true}).click();
 await page.waitForFunction(()=>window.calls.some(c=>c.method==='importPack'));assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='create'&&c.params.folder==='Notes').length),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='write'&&c.params.path.startsWith('Notes/')).length),0);
 await page.getByRole('button',{name:'Open Keep title',exact:true}).click();await page.getByRole('button',{name:'Edit card',exact:true}).click();
 await page.getByRole('button',{name:'Add to note',exact:true}).click();await page.getByRole('menu',{name:'Add to note'}).getByRole('menuitem').first().press('=');await page.getByLabel('Find or name a text template').waitFor();
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:'/tmp/texttext-note-template-'+theme+'.png'});}
 await page.getByLabel('Find or name a text template').press('Escape');assert.equal(await page.getByRole('group',{name:'Text templates',exact:true}).count(),0);await page.getByRole('button',{name:'Add to note',exact:true}).click();await page.getByRole('menu',{name:'Add to note'}).getByRole('menuitem').first().press('=');await page.getByRole('button',{name:'Insert Meeting',exact:true}).click();await page.getByRole('button',{name:'Finish',exact:true}).click();await page.getByRole('button',{name:'Edit card',exact:true}).waitFor();
 const saved=await page.evaluate(()=>JSON.parse([...window.files.values()].find(f=>f.path.startsWith('Notes/')).documentJSON));assert.equal(saved.content.title,'Keep title');assert.equal(saved.content.body.replace('Before AgendaAfter',''),'Agenda');assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='create'&&c.params.folder==='Templates').length),1);assert.deepEqual(errors,[]);
 console.log('PASS note templates: same TextPack library save, inline/full insertion, preserved body/title, keyboard shortcut, finish/reopen, both themes.');

}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
