import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-ai-settings-'));let browser;
try {
 const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{AccountMenu}from'${root}/src/local-vault/AccountMenu';import{WebAiSettings}from'${root}/src/local-vault/WebAiSettings';import{NativeAssistant}from'${root}/src/local-vault/NativeAssistant';import{setVaultTransport}from'${root}/src/local-vault/bridge';import '${root}/src/local-vault/style.css';
window.refreshCount=0;
setVaultTransport(async(method)=>{if(method==='accountRead')return{email:'test@example.com',name:'Test',identities:['apple'],workspaceName:'Test workspace'};if(method==='agentStatus'){window.refreshCount++;const s=await fetch('/api/ai/settings?handle=owner').then(r=>r.json());return{state:s.configured?'ready':'disconnected',message:s.configured?'Ready':'Connect a provider in Settings.'};}if(method==='agentRetarget')return{};if(method==='collaborationConfig')return null;throw Error(method)});
createRoot(document.getElementById('root')).render(<div className="vault-app"><AccountMenu signedIn logOut={async()=>{}} aiSettings={<WebAiSettings handle="owner"/>}/><NativeAssistant webReadOnly open root="vault:test" path="Notes/Test.textpack" request={null} onClose={()=>{}} beforeSend={async()=>true}/></div>);
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let configured=false,received=null;const secret='test-secret-only-for-browser-fixture';
 await page.route('https://settings.test/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/ai/settings'){assert.equal(u.searchParams.get('handle'),'owner');if(route.request().method()==='POST'){received=route.request().postDataJSON();configured=received.action==='save';}return route.fulfill({json:{allowed:true,configured,provider:configured?'openai':null,model:configured?'gpt-5.6':null,connectionState:configured?'ready':'not-set-up'}});}return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});});
 await page.goto('https://settings.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 await page.getByRole('button',{name:'Set up AI in Settings'}).click();await page.getByRole('dialog',{name:'Settings',exact:true}).waitFor();await page.getByLabel('API key',{exact:true}).fill(secret);assert.equal(await page.getByLabel('API key',{exact:true}).getAttribute('type'),'password');await page.getByRole('button',{name:'Connect provider',exact:true}).click();await page.getByText('Provider connected. You can return to your conversation.',{exact:true}).waitFor();
 assert.deepEqual(received,{action:'save',provider:'openai',model:'gpt-5.6',apiKey:secret});assert.equal(await page.getByLabel('New API key',{exact:true}).inputValue(),'');assert.ok(!(await page.locator('body').innerText()).includes(secret));await page.waitForFunction(()=>window.refreshCount>=2);
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:'/tmp/texttext-ai-settings-'+theme+'.png'});}
 await page.getByRole('button',{name:'Close settings'}).click();await page.getByRole('button',{name:/test@example.com/}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('New API key',{exact:true}).waitFor();assert.equal(await page.getByLabel('New API key',{exact:true}).inputValue(),'');await page.getByRole('button',{name:'Disconnect provider'}).click();await page.getByText('Provider disconnected.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close settings'}).press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS missing provider opens Settings, saves write-only secret, refreshes assistant, reopens without secret, disconnects, keyboard dismissal, both themes.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
