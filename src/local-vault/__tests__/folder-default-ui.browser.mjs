import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const root=process.cwd().replaceAll('\\','/'), dir=await mkdtemp(path.join(tmpdir(),'texttext-folder-default-'));
let browser;
try {
 await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{FolderPresentation}from'${root}/src/local-vault/FolderPresentation';import{setVaultTransport}from'${root}/src/local-vault/bridge';
import{createFolderViewPack,readFolderView,readFolderItemDefault}from'${root}/src/local-vault/folder-view';import{openPack}from'${root}/src/local-vault/pack';import{requireBuiltinTemplate}from'${root}/src/lib/presentation/templates';
import '${root}/src/local-vault/style.css';
let file=openPack(createFolderViewPack('Notes',requireBuiltinTemplate('texttext.note')).bytes,'Notes/Folder view.textpack','first').file;
window.calls=[];window.saved=()=>({defaultId:readFolderItemDefault(readFolderView(file))?.template.id,designId:readFolderView(file)?.template.id,hash:file.hash});
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='folderViews')return{files:[file]};if(method==='read')return file;if(method==='write'){if(params.hash!==file.hash)throw Error('changed');file={...file,...params,hash:'second'};return file;}throw Error(method)});
const app=createRoot(document.getElementById('root'));const listing={root:'vault:fixture',items:[{path:file.path}],fullAccess:true};window.mount=()=>app.render(<FolderPresentation listing={listing} folder='Notes' busy={false} designOpen editable onOpen={()=>{}}/>);window.mount();
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});
 browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://folder-default.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('https://folder-default.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 const selector=page.getByRole('combobox',{name:'Default for new items'});await selector.waitFor();
 await selector.selectOption('texttext.article@1');await page.getByRole('button',{name:'Keep default'}).click();
 await page.waitForFunction(()=>window.saved().hash==='second');
 assert.deepEqual(await page.evaluate(()=>window.saved()),{defaultId:'texttext.article',designId:'texttext.note',hash:'second'});
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.method==='write').length),1);
 assert.deepEqual(errors,[]);
 console.log('PASS actual folder default control: one guarded file write pins future article items while preserving the folder collection design.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
