import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-workspace-chooser-'));
const current='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222';
let browser;
try {
 const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{AccountMenu}from'${root}/src/local-vault/AccountMenu';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{createWebVaultTransport}from'${root}/src/local-vault/web-transport';import{openWebWorkspace}from'${root}/src/local-vault/web-workspace-open';import '${root}/src/local-vault/style.css';
window.saved=false;window.stopped=0;window.flushes=0;window.texttextFlushForSignOut=async()=>{window.flushes++;return window.saved;};
const transport=createWebVaultTransport('${current}','Personal');const lifetime=new AbortController();
setVaultTransport((method,params,signal)=>method==='workspaceOpen'?openWebWorkspace(params,{currentId:'${current}',signal:lifetime.signal,flush:window.texttextFlushForSignOut,stopAgent:()=>window.stopped++,navigate:path=>location.assign(path)}):transport.request(method,params,signal));
createRoot(document.getElementById('root')).render(<div className="vault-app"><aside className="vault-sidebar"><AccountMenu signedIn logOut={async()=>{}}/></aside><main><h1>Personal workspace</h1></main></div>);
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage();let denied=false,lists=0,accesses=0;
 await page.route('https://chooser.test/**',route=>{const p=new URL(route.request().url()).pathname;
 if(p==='/api/vault/workspaces'){lists++;return route.fulfill({json:{workspaces:[{id:current,name:'Personal',access:'owner'},{id:next,name:'Team',access:'workspace'}]}});}
 if(p.endsWith('/account'))return route.fulfill({json:{email:'test@example.com',name:'Test',identities:[],workspaceName:'Personal'}});
 if(p.endsWith('/access')){accesses++;return route.fulfill({status:denied?403:200,json:{fullAccess:true}});}
 return route.fulfill({contentType:'text/html',body:p===`/vault/${next}`?'<h1>Team workspace</h1>':'<div id="root"></div>'});});
 await page.goto(`https://chooser.test/vault/${current}`);await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.getByRole('button',{name:/test@example.com/}).click();await page.getByRole('button',{name:'Team',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:/Personal/}).isDisabled());
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:`/tmp/texttext-workspace-chooser-${theme}.png`});}
 await page.getByRole('button',{name:'Team',exact:true}).click();await page.getByRole('alert').filter({hasText:'Finish saving'}).waitFor();assert.equal(accesses,0);assert.equal(await page.evaluate(()=>window.stopped),0);assert.equal(new URL(page.url()).pathname,`/vault/${current}`);
 await page.evaluate(()=>window.saved=true);denied=true;await page.getByRole('button',{name:'Team',exact:true}).click();await page.getByRole('alert').filter({hasText:'no longer available'}).waitFor();assert.equal(await page.evaluate(()=>window.stopped),0);assert.equal(new URL(page.url()).pathname,`/vault/${current}`);
 denied=false;await page.getByRole('button',{name:'Team',exact:true}).click();await page.waitForURL(`https://chooser.test/vault/${next}`);await page.getByRole('heading',{name:'Team workspace'}).waitFor();assert.equal(accesses,2);assert.equal(lists,3);
 console.log('PASS workspace chooser: discovery/current identity, unsaved guard, fresh denied access retains editor/agent, successful full-page navigation.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
