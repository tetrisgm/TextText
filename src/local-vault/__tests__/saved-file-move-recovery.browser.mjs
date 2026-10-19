import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const bundle = await build({stdin:{contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{SavedFileMoveRecovery}from'./src/local-vault/SavedFileMoveRecovery';import{RecoveryDialog}from'./src/local-vault/RecoveryDialog';import{setVaultTransport}from'./src/local-vault/bridge';
const root=createRoot(document.getElementById('root'));
const row={id:'11111111-1111-4111-8111-111111111111',itemId:'22222222-2222-4222-8222-222222222222',sourcePath:'Notes/First.textpack',destinationPath:'Notes/Second.textpack',requestHash:'a'.repeat(64),state:'pending',localPath:'Notes/Second.textpack',remotePath:'Notes/First.textpack',inspection:'b'.repeat(64),retryAllowed:true,keepNamesAllowed:false,blockedReason:null};
window.mode='pending';window.calls=[];window.resolved=0;window.release=()=>{};
const current=()=>window.mode==='terminal'?{...row,state:'terminal-rejected',retryAllowed:false,keepNamesAllowed:true}:window.mode==='ambiguous'?{...row,state:'review',retryAllowed:false,blockedReason:'ambiguous'}:window.mode==='stopped'?{...row,state:'stopped',retryAllowed:false}:window.mode==='foreign'?{...row,itemId:'33333333-3333-4333-8333-333333333333'}:row;
window.mount=(scope='one')=>{setVaultTransport(async(method,params)=>{window.calls.push({scope,method,params});if(method==='savedFileMoveRead'){const value=current();if(window.mode==='held')await new Promise(resolve=>window.release=resolve);return value;}if(['retrySavedFileMove','keepSavedFileMoveNames'].includes(method)){if(window.mode==='reject')throw Error('private raw native details');if(window.mode==='held-action')await new Promise(resolve=>window.release=resolve);return{resolved:true};}throw Error(method);});flushSync(()=>root.render(<SavedFileMoveRecovery key={scope} entries={[row]} workspaceRoot={scope} disabled={false} onResolved={()=>window.resolved++}/>));};
window.replaceTransport=()=>setVaultTransport(async()=>{throw Error('wrong transport');});
window.mountDialog=()=>{let done=false;setVaultTransport(async(method)=>{window.calls.push({scope:'dialog',method});if(method==='trashList')return{items:[],truncated:false};if(method==='recoveryList')return{entries:[],truncated:false,savedFileMoves:done?[]:[row]};if(method==='savedFileMoveRead')return row;if(method==='retrySavedFileMove'){done=true;return{resolved:true};}throw Error(method);});flushSync(()=>root.render(<RecoveryDialog key='dialog' workspaceRoot='dialog' onClose={()=>{}} onRestore={async()=>{throw Error('unexpected');}} onRestoreDeleted={async()=>{throw Error('unexpected');}}/>));};window.mount();
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch();
try {
 const page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.route('https://saved-file.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root" class="vault-app" style="display:block;padding:24px;max-width:900px"></div>'}));
 await page.goto('https://saved-file.test/');await page.addStyleTag({content:await readFile('src/local-vault/style.css','utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const inspect=()=>page.getByRole('button',{name:'Notes/First.textpack → Notes/Second.textpack',exact:true}).click();
 const retry=()=>page.getByRole('button',{name:'Retry saved move',exact:true}).click();
 await inspect();await page.getByRole('button',{name:'Retry saved move',exact:true}).waitFor();
 for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:'/private/tmp/texttext-saved-file-move-'+colorScheme+'.png',fullPage:true});}
 await page.evaluate(()=>window.replaceTransport());await retry();await page.getByText('Recovery updated.',{exact:false}).waitFor();
 assert.deepEqual((await page.evaluate(()=>window.calls.find(c=>c.method==='retrySavedFileMove'))).params,{workspaceRoot:'one',id:'11111111-1111-4111-8111-111111111111',requestHash:'a'.repeat(64),inspection:'b'.repeat(64),consent:true});
 for(const mode of ['terminal','ambiguous','stopped','foreign','reject']){
  await page.evaluate(mode=>{window.mode=mode;window.mount(mode);},mode);await inspect();
  if(mode==='terminal'){await page.getByRole('button',{name:'Keep current names',exact:true}).click();await page.getByText('Recovery updated.',{exact:false}).waitFor();}
  else if(mode==='reject'){await retry();await page.getByRole('alert').waitFor();assert.equal(await page.getByText('private raw native details',{exact:false}).count(),0);}
  else if(mode==='foreign')await page.getByRole('alert').waitFor();
  else await page.getByText(mode==='ambiguous'?'The outcome of this move is not yet confirmed.':'Automatic retries of this saved move have stopped.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Retry saved move',exact:true}).count(),0);
 }
 await page.evaluate(()=>{window.mode='held';window.mount('old');});await inspect();
 await page.evaluate(()=>{window.mode='pending';window.mount('new');window.release();});await page.waitForTimeout(50);
 assert.equal(await page.getByRole('button',{name:'Retry saved move',exact:true}).count(),0);
 await inspect();await page.evaluate(()=>window.mode='held-action');await retry();const before=await page.evaluate(()=>window.resolved);
 await page.evaluate(()=>{window.mode='pending';window.mount('newer');window.release();});await page.waitForTimeout(50);
 assert.equal(await page.evaluate(()=>window.resolved),before);
 await page.evaluate(()=>window.mountDialog());await inspect();await retry();await page.getByText('No retained deleted files or conflict copies.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Saved file moves',exact:true}).count(),0);
 console.log('PASS saved file move UI: exact scoped consent, terminal-only keep, ambiguous/stopped refusal, changed item rejection, captured transport, stale read/action isolation, redacted errors, dialog refresh, light/dark screenshots.');
} finally {await browser.close();}
