import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildLocalVault } from '../../../scripts/build-local-vault.mjs';
const dir = await mkdtemp(path.join(tmpdir(), 'texttext-template-versions-'));
let browser;
try {
 const root = process.cwd();
 await symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
 await writeFile(path.join(dir, 'entry.tsx'), `
import React from '${root}/node_modules/react/index.js'; import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {WorkspaceTypeLibrary} from '${root}/src/local-vault/LocalTemplateLibrary';
import {setVaultTransport} from '${root}/src/local-vault/bridge'; import {requireBuiltinTemplate} from '${root}/src/lib/presentation/templates';
import '${root}/src/local-vault/style.css';
const base=requireBuiltinTemplate('texttext.note');
const definitions=[{path:'Templates/old.textpack',template:{...base,id:'custom.a',version:1,name:'Same name'}},{path:'Templates/new.textpack',template:{...base,id:'custom.a',version:2,name:'Same name'}},{path:'Templates/other.textpack',template:{...base,id:'custom.b',version:1,name:'Same name'}}];
setVaultTransport(async(method,p)=>{if(method==='list')return{root:'fixture',name:'Fixture',folders:['Templates'],items:definitions.map(({path})=>({path}))};if(method==='template'){const look=definitions.find(v=>v.path===p.path);return{path:look.path,hash:'hash',templateJSON:JSON.stringify(look.template)};}throw Error(method);});
window.chosen=[];const app=createRoot(document.getElementById('root'));
window.render=(creation=true)=>app.render(<WorkspaceTypeLibrary currentTemplate={definitions[0].template} onApply={t=>window.chosen.push(t.version)} onClose={()=>{}} {...(creation?{onCreateFromFile:p=>window.chosen.push(p)}:{})}/>);window.render();
 `);
 await buildLocalVault({ entry: path.join(dir, 'entry.tsx'), output: dir });
 browser = await chromium.launch(); const page = await browser.newPage(); const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.route('https://templates.test/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
 await page.goto('https://templates.test/');
 await page.addStyleTag({content: await readFile(path.join(dir, 'app.css'), 'utf8')});
 await page.addScriptTag({content: await readFile(path.join(dir, 'app.js'), 'utf8')});
 const create = page.getByRole('dialog', {name: 'New from template'});
 await create.getByRole('button', {name: 'Same name', exact:true}).first().waitFor();
 assert.equal(await create.getByRole('button', {name: 'Same name', exact:true}).count(), 2);
 await create.getByRole('button', {name: 'Same name', exact:true}).first().click();
 assert.deepEqual(await page.evaluate(()=>window.chosen), ['Templates/new.textpack']);
 for (const theme of ['light','dark']) {
   await page.emulateMedia({colorScheme:theme});
   assert.equal(await create.getByRole('button', {name:'Same name',exact:true}).count(),2);
 }
 await page.evaluate(()=>window.render(false));
 const choose=page.getByRole('dialog',{name:'Choose a look'});
 await choose.getByRole('button',{name:'Same name',exact:true}).first().waitFor();
 assert.equal(await choose.getByRole('button',{name:'Same name',exact:true}).count(),3);
 await choose.getByRole('button',{name:'Same name',exact:true}).first().click();
 assert.deepEqual(await page.evaluate(()=>window.chosen),['Templates/new.textpack',1]);
 assert.deepEqual(errors,[]);
 console.log('PASS template versions: creation offers latest identity only, distinct equal names remain, explicit old look remains selectable.');
} finally { await browser?.close(); await rm(dir,{recursive:true,force:true}); }
