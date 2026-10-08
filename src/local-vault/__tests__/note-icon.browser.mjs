import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-note-icon-'));
let browser;
try {
 const root=process.cwd();
 await symlink(path.join(root,"node_modules"),path.join(dir,"node_modules"));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import {openPack} from '${root}/src/local-vault/pack';
import '${root}/src/local-vault/style.css';
let file;window.calls=[];window.intent=null;
setVaultTransport(async(method,params)=>{window.calls.push({method,params});window.file=file;if(method==='list')return{root:'vault:test',name:'Test',folders:['Notes'],items:file?[{path:file.path}]:[]};if(method==='folderViews')return{files:[]};if(method==='connection')return{connected:true,available:true};if(method==='collaborationConfig')return null;if(method==='importPack'){file=openPack(Uint8Array.from(atob(params.data),c=>c.charCodeAt(0)),params.folder+'/'+params.title+'.textpack','1').file;window.file=file;return file;}if(method==='create'){const doc=emptyDocumentSnapshot();file={path:'Notes/Untitled.textpack',hash:'1',markdown:'---\\ntextTextId: 4c417b9d-f935-40c4-a537-7cb70658f898\\n---\\n',documentJSON:JSON.stringify(doc)};return file;}if(method==='write'){file={...file,...params,hash:String(Number(file.hash)+1)};window.file=file;return file;}if(method==='read')return file;if(method==='preview')return{path:file.path,title:JSON.parse(file.documentJSON).content.title,excerpt:JSON.parse(file.documentJSON).content.body,document:JSON.parse(file.documentJSON)};throw Error(method);});
const app=createRoot(document.getElementById('root'));window.render=()=>app.render(<VaultApp allowFolderPicker={false} templateIntent={window.intent}/>);window.render();
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let permit;const permission=new Promise(resolve=>permit=resolve);
 await page.route('https://template.test/**',async route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/access')){await permission;return route.fulfill({json:{fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]}});}if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});return route.fulfill({status:404});});
 await page.goto('https://template.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});

 permit();await page.getByText('Notes',{exact:true}).first().click();
 await page.getByRole('button',{name:'Start typing to create a new card'}).click();
 await page.getByLabel('New card title').fill('Icon test');await page.getByLabel('New card body').fill('Body stays unchanged.');
 await page.getByRole('button',{name:'Add card icon',exact:true}).click();await page.getByRole('button',{name:'Insert 💡',exact:true}).click();
 await page.getByRole('button',{name:'Finish',exact:true}).click();
 await page.waitForFunction(()=>window.file&&JSON.parse(window.file.documentJSON).content.fields.texttextNoteIcon==='💡');
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='importPack').length),1);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='create'||c.method==='write').length),0);
 await page.getByRole('img',{name:'Card icon 💡'}).waitFor();await page.getByRole('button',{name:'Open Icon test',exact:true}).click();await page.getByRole('img',{name:'Card icon 💡'}).waitFor();
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:'/tmp/texttext-note-icon-'+theme+'.png'});}
 await page.getByRole('button',{name:'Edit card',exact:true}).click();await page.getByRole('button',{name:'Change card icon'}).click();await page.getByRole('button',{name:'Insert 📌',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(window.file.documentJSON).content.fields.texttextNoteIcon==='📌');
 await page.getByRole('button',{name:'Change card icon'}).click();await page.getByRole('button',{name:'Remove icon',exact:true}).focus();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Change card icon'}).evaluate(el=>el===document.activeElement),true);assert.equal(await page.getByRole('group',{name:'Card icon',exact:true}).count(),0);await page.getByRole('button',{name:'Change card icon'}).click();await page.getByRole('button',{name:'Remove icon',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(window.file.documentJSON).content.fields.texttextNoteIcon==='');
 assert.equal(await page.evaluate(()=>JSON.parse(window.file.documentJSON).content.body),'Body stays unchanged.');assert.equal(await page.evaluate(()=>JSON.parse(window.file.documentJSON).content.title),'Icon test');await page.getByRole('button',{name:'Finish',exact:true}).click();await page.getByRole('button',{name:'Edit card',exact:true}).waitFor();assert.equal(await page.getByRole('img',{name:/Card icon/}).count(),0);await page.getByRole('button',{name:'Edit card',exact:true}).click();await page.getByRole('button',{name:'Add card icon'}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS note icon: inline creation, file roundtrip, reader, full editor change/removal, unchanged title/body, both themes.');

}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
