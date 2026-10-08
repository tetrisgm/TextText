import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-open-item-move-'));
let browser;
try {
 const root=process.cwd();
 await symlink(path.join(root,"node_modules"),path.join(dir,"node_modules"));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import {openPack,packIdentity,replacePackIdentity} from '${root}/src/local-vault/pack';
import {newItemPack} from '${root}/src/local-vault/new-item-pack';
import {readDocument} from '${root}/src/local-vault/model';
import {BUILTIN_TEMPLATES} from '${root}/src/lib/presentation/templates';
import '${root}/src/local-vault/style.css';
let files=new Map();let version=0;
const template=BUILTIN_TEMPLATES.find(t=>t.id==='texttext.note');const parentDocument=emptyDocumentSnapshot({id:template.id,version:template.version});parentDocument.content.title='Native listing parent';parentDocument.content.body='Preserve parent content';
const parentFile=openPack(newItemPack(parentDocument,{template}), 'Notes/Parent.textpack', 'parent').file;parentFile.markdown=replacePackIdentity(parentFile.markdown,'parent1193');files.set(parentFile.path,parentFile);
window.calls=[];window.intent=null;window.files=files;
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='list')return{root:'vault:test',name:'Test',folders:window.moved?['Archive']:['Notes'],items:[...files.values()].map(f=>({path:f.path,itemId:packIdentity(f.markdown),canEditContent:true})),fullAccess:true,canCreateContent:true};if(method==='search')return {items:[...files.values()].filter(f=>readDocument(f).content.title.toLowerCase().includes(params.query.toLowerCase())).map(f=>({path:f.path,title:readDocument(f).content.title}))};if(method==='resolveItemId'){const f=[...files.values()].find(f=>packIdentity(f.markdown)===params.itemId);if(!f)throw Error('Missing item');return {path:f.path};}if(method==='folderViews')return{files:[]};if(method==='connection')return{connected:true,available:true};if(method==='collaborationConfig')return null;if(method==='importPack'){const file=openPack(Uint8Array.from(atob(params.data),c=>c.charCodeAt(0)),params.folder+'/'+params.title+'.textpack',String(++version)).file;files.set(file.path,file);return file;}if(method==='create'){const doc=emptyDocumentSnapshot();const file={path:params.folder+'/'+params.title+'.textpack',hash:String(++version),markdown:'---\\ntextTextId: '+crypto.randomUUID()+'\\n---\\n',documentJSON:JSON.stringify(doc)};files.set(file.path,file);return file;}if(method==='write'){const file={...files.get(params.path),...params,hash:String(++version)};files.set(file.path,file);return file;}if(method==='read'){const f=files.get(params.path);if(!f)throw Error('Missing file');return f;}if(method==='template'){const file=files.get(params.path);return{path:file.path,hash:file.hash,templateJSON:file.templateJSON}}if(method==='preview'){const file=files.get(params.path);return{path:file.path,title:JSON.parse(file.documentJSON).content.title,excerpt:JSON.parse(file.documentJSON).content.body,document:JSON.parse(file.documentJSON)}}throw Error(method);});
const app=createRoot(document.getElementById('root'));window.render=()=>app.render(<VaultApp allowFolderPicker={false} templateIntent={window.intent}/>);window.render();
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let permit;const permission=new Promise(resolve=>permit=resolve);
 await page.route('https://template.test/**',async route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/access')){await permission;return route.fulfill({json:{fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]}});}if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});return route.fulfill({status:404});});
 await page.goto('https://template.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});

 permit();await page.getByText('Notes',{exact:true}).first().click();
 await page.getByRole('button',{name:'Open Native listing parent',exact:true}).click();
 await page.getByRole('button',{name:'Edit card',exact:true}).click();
 const body=page.getByLabel('Document body');await body.waitFor();
 await body.fill('Unsaved writing survives the move');
 await page.evaluate(()=>{const old=window.files.get('Notes/Parent.textpack');window.files.delete(old.path);window.files.set('Archive/Parent.textpack',{...old,path:'Archive/Parent.textpack'});window.moved=true;window.dispatchEvent(new Event('texttext:vault-changed'));});
 await page.waitForFunction(()=>window.calls.some(c=>c.method==='collaborationConfig'&&c.params.path==='Archive/Parent.textpack'),null,{timeout:5000}).catch(async e=>{console.log(await page.evaluate(()=>({calls:window.calls.slice(-12),text:document.body.innerText.slice(-1400)})));throw e;});
 assert.equal(await body.innerText(),'Unsaved writing survives the move');
 await page.getByRole('button',{name:'Finish',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(window.files.get('Archive/Parent.textpack').documentJSON).content.body==='Unsaved writing survives the move');
 assert.equal(await page.evaluate(()=>window.files.has('Notes/Parent.textpack')),false);
 assert.deepEqual(errors,[]);
 console.log('PASS open item relocation: pending local typing survives stable-identity folder move and saves at its new path.');

}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
