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
import {openPack,packIdentity,replacePackIdentity} from '${root}/src/local-vault/pack';
import {newItemPack} from '${root}/src/local-vault/new-item-pack';
import {readDocument, writePayload} from '${root}/src/local-vault/model';
import {BUILTIN_TEMPLATES, getBuiltinTemplate} from '${root}/src/lib/presentation/templates';
import '${root}/src/local-vault/style.css';
let files=new Map();let version=0;
const template=BUILTIN_TEMPLATES.find(t=>t.id==='texttext.note');const parentDocument=emptyDocumentSnapshot({id:template.id,version:template.version});parentDocument.content.title='Native listing parent';parentDocument.content.body='Preserve parent content';
const parentFile=openPack(newItemPack(parentDocument,{template}), 'Notes/Parent.textpack', 'parent').file;parentFile.markdown=replacePackIdentity(parentFile.markdown,'parent1193');files.set(parentFile.path,parentFile);
window.calls=[];window.intent=null;window.files=files;
window.usePlainNoteLook=()=>{const file=files.get('Notes/Keep title.textpack');const template=getBuiltinTemplate('texttext.note',1);const document=readDocument(file);document.presentation.template={id:template.id,version:template.version};Object.assign(file,writePayload(file,document,{template}));return file.templateJSON;};
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='list')return{root:'vault:test',name:'Test',folders:['Notes'],items:[...files.keys()].map(path=>({path}))};if(method==='search')return {items:[...files.values()].filter(f=>readDocument(f).content.title.toLowerCase().includes(params.query.toLowerCase())).map(f=>({path:f.path,title:readDocument(f).content.title}))};if(method==='resolveItemId'){const f=[...files.values()].find(f=>packIdentity(f.markdown)===params.itemId);if(!f)throw Error('Missing item');return {path:f.path};}if(method==='folderViews')return{files:[]};if(method==='connection')return{connected:true,available:true};if(method==='collaborationConfig')return null;if(method==='importPack'){const file=openPack(Uint8Array.from(atob(params.data),c=>c.charCodeAt(0)),params.folder+'/'+params.title+'.textpack',String(++version)).file;files.set(file.path,file);return file;}if(method==='create'){const doc=emptyDocumentSnapshot();const file={path:params.folder+'/'+params.title+'.textpack',hash:String(++version),markdown:'---\\ntextTextId: '+crypto.randomUUID()+'\\n---\\n',documentJSON:JSON.stringify(doc)};files.set(file.path,file);return file;}if(method==='write'){const file={...files.get(params.path),...params,hash:String(++version)};files.set(file.path,file);return file;}if(method==='read')return files.get(params.path);if(method==='template'){const file=files.get(params.path);return{path:file.path,hash:file.hash,templateJSON:file.templateJSON}}if(method==='preview'){const file=files.get(params.path);return{path:file.path,title:JSON.parse(file.documentJSON).content.title,excerpt:JSON.parse(file.documentJSON).content.body,document:JSON.parse(file.documentJSON)}}throw Error(method);});
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
 await page.getByRole('button',{name:'Add to new card',exact:true}).click();await page.getByRole('menuitem',{name:'Parent',exact:true}).click();
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Find item');await page.getByRole('searchbox',{name:'Find item'}).fill('Native listing parent');await page.getByRole('button',{name:'Native listing parent',exact:true}).click();
 await page.getByRole('button',{name:'Done choosing parents',exact:true}).click();assert.equal(await page.getByLabel('New card body').inputValue(),'Agenda');
 await page.getByRole('button',{name:'Add to new card',exact:true}).click();await page.getByRole('menu',{name:'Add to new card'}).getByRole('menuitem').first().press('=');
 await page.getByLabel('Find or name a text template').fill('Meeting');await page.getByRole('button',{name:'Save current text as Meeting',exact:true}).click();
 await page.waitForFunction(()=>[...window.files.values()].some(f=>f.path==='Templates/Meeting.textpack'&&JSON.parse(f.documentJSON).content.body==='Agenda'));
 assert.equal(await page.getByLabel('New card body').inputValue(),'Agenda');await page.getByLabel('New card body').fill('Before After');await page.getByLabel('New card body').evaluate(el=>el.setSelectionRange(7,7));
 await page.getByRole('button',{name:'Add to new card',exact:true}).click();await page.getByRole('menu',{name:'Add to new card'}).getByRole('menuitem').first().press('=');await page.getByRole('button',{name:'Insert Meeting',exact:true}).click();
 assert.equal(await page.getByLabel('New card body').inputValue(),'Before AgendaAfter');await page.getByRole('button',{name:'Finish',exact:true}).click();
 await page.waitForFunction(()=>window.calls.some(c=>c.method==='importPack'));assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='create'&&c.params.folder==='Notes').length),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='write'&&c.params.path.startsWith('Notes/')).length),0);
 // Match a real older plain Note package: relationships do not require a
 // template field or a template/blueprint rewrite.
 const plainTemplate = await page.evaluate(() => window.usePlainNoteLook());
 await page.getByRole('button',{name:'Open Keep title',exact:true}).click();await page.getByRole('button',{name:'Edit card',exact:true}).click();
 await page.getByRole('button',{name:'Remove Native listing parent',exact:true}).click();await page.getByRole('button',{name:'Add to note',exact:true}).click();await page.getByRole('menuitem',{name:'Parent',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Find item');await page.getByRole('searchbox',{name:'Find item'}).fill('Native listing parent');await page.getByRole('button',{name:'Native listing parent',exact:true}).click();
 await page.getByRole('button',{name:'Native listing parent',exact:true}).waitFor();
 await page.getByRole('button',{name:'Add to note',exact:true}).click();await page.getByRole('menu',{name:'Add to note'}).getByRole('menuitem').first().press('=');await page.getByLabel('Find or name a text template').waitFor();
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:'/tmp/texttext-note-template-'+theme+'.png'});}
 await page.getByLabel('Find or name a text template').press('Escape');assert.equal(await page.getByRole('group',{name:'Text templates',exact:true}).count(),0);await page.getByRole('button',{name:'Add to note',exact:true}).click();await page.getByRole('menu',{name:'Add to note'}).getByRole('menuitem').first().press('=');await page.getByRole('button',{name:'Insert Meeting',exact:true}).click();await page.getByRole('button',{name:'Finish',exact:true}).click();await page.getByRole('button',{name:'Edit card',exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit card',exact:true}).click();await page.getByRole('button',{name:'Native listing parent',exact:true}).waitFor();
 const saved=await page.evaluate(()=>JSON.parse([...window.files.values()].find(f=>f.path!=='Notes/Parent.textpack'&&f.path.startsWith('Notes/')).documentJSON));assert.equal(saved.content.title,'Keep title');assert.deepEqual(saved.content.fields.parents,['parent1193']);assert.equal(saved.content.body.replace('Before AgendaAfter',''),'Agenda');assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='create'&&c.params.folder==='Templates').length),1);assert.equal(await page.evaluate(()=>[...window.files.values()].find(f=>f.path==='Notes/Keep title.textpack').templateJSON),plainTemplate);assert.deepEqual(errors,[]);
 console.log('PASS note templates: same TextPack library save, inline/full insertion, preserved body/title, keyboard shortcut, finish/reopen, both themes.');

}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
