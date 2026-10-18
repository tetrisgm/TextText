import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const bundle = await build({stdin:{contents:`
import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{FolderSyncMoveRecovery}from'./src/local-vault/FolderSyncMoveRecovery';import{RecoveryDialog}from'./src/local-vault/RecoveryDialog';import{setVaultTransport}from'./src/local-vault/bridge';
const root=createRoot(document.getElementById('root'));
const command={operationId:'case-one',source:'Notes',destination:'notes',baseManifestRevision:'a'.repeat(64),folders:['Notes','Notes/Empty'],items:[{itemId:'one',relativePath:'Notes/one.textpack',revision:'b'.repeat(64)}]};
const row={id:'case-one',command,state:'review',requestHash:'c'.repeat(64),expectedIdentity:'original',from:{present:false,identity:null},to:{present:true,identity:'original'},localInspection:'d'.repeat(64),inspection:'e'.repeat(64),manifestRevision:'f'.repeat(64),folders:command.folders,items:command.items,result:null,resolutionBlocked:null};
const moved={operationId:command.operationId,status:'moved',source:command.source,destination:command.destination,folders:['notes','notes/Empty'],items:[{...command.items[0],relativePath:'notes/one.textpack'}],manifestRevision:'f'.repeat(64)};
window.calls=[];window.mode='normal';window.release=()=>{};window.resolved=0;
const state=()=>window.mode==='unavailable'?{...row,state:'unavailable',requestHash:null,inspection:null,manifestRevision:null,folders:null,items:null,resolutionBlocked:'The server is unavailable.'}:window.mode==='completed'?{...row,state:'completed',inspection:null,manifestRevision:null,folders:null,items:null,result:moved}:window.mode==='cancelled'?{...row,state:'cancelled',folders:null,items:null}:window.mode==='foreign'?{...row,command:{...command,operationId:'other'},id:'other'}:window.mode==='future'?{...row,future:true}:row;
window.mount=(scope='one')=>{setVaultTransport(async(method,params)=>{
 window.calls.push({scope,method,params});
 if(method==='folderSyncMoveRead'){if(window.mode==='held')await new Promise(resolve=>window.release=resolve);return state();}
 if(method==='resolveFolderSyncMove'){if(window.mode==='reject')throw Error('Folder inspection changed. Inspect again.');return{resolved:true};}
 throw Error(method);
});flushSync(()=>root.render(<FolderSyncMoveRecovery key={scope} entries={[row]} workspaceRoot={scope} disabled={false} onResolved={()=>window.resolved++}/>));};
window.replaceTransport=()=>setVaultTransport(async(method,params)=>{window.calls.push({scope:'foreign-transport',method,params});throw Error('Wrong transport');});
window.mountDialog=()=>{let finished=false;setVaultTransport(async(method,params)=>{
 window.calls.push({scope:'dialog',method,params});
 if(method==='recoveryList')return{entries:finished?[{id:'old',path:'notes/one.textpack',kind:'revision',hash:'h',savedAt:'2026-10-18'}]:[],truncated:false,folderSyncMoves:finished?[]:[row]};
 if(method==='folderSyncMoveRead')return row;
 if(method==='resolveFolderSyncMove'){finished=true;return{resolved:true};}
 if(method==='trashList'){if(!finished)throw Error('Folder change needs review.');return{items:[{itemId:'deleted',relativePath:'notes/deleted.textpack',revision:'r'}],truncated:false};}
 throw Error(method);
});flushSync(()=>root.render(<RecoveryDialog key="dialog" workspaceRoot="dialog" onClose={()=>{}} onRestore={async()=>{throw Error('Unexpectedrestore');}} onRestoreDeleted={async()=>{throw Error('Unexpectedrestore');}}/>));};window.mount();
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.route('https://folder-command.test/**',route=>route.fulfill({contentType:'text/html',body:'<div></div>'}));
 await page.goto('https://folder-command.test/');await page.setContent('<div class="vault-app" style="display:block;padding:24px;max-width:900px" id="root"></div>');
 await page.addStyleTag({content:await readFile('src/local-vault/style.css','utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const inspect=()=>page.getByRole('button',{name:'Notes → notes',exact:true}).click();
 const cancel=()=>page.getByRole('button',{name:'Cancel pending folder change',exact:true}).click();
 await inspect();await page.getByText('Current server catalog: 2 folders and 1 file.',{exact:true}).waitFor();
 for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:'/private/tmp/texttext-folder-command-recovery-'+colorScheme+'.png',fullPage:true});}
 await page.evaluate(()=>window.replaceTransport());await cancel();await page.getByText('Folder recovery finished.',{exact:false}).waitFor();
 const resolution=(await page.evaluate(()=>window.calls.filter(c=>c.method==='resolveFolderSyncMove')))[0];
 assert.equal(resolution.scope,'one');assert.deepEqual(resolution.params,{workspaceRoot:'one',id:'case-one',requestHash:'c'.repeat(64),inspection:'e'.repeat(64),localInspection:'d'.repeat(64),consent:true});
 for(const mode of ['completed','cancelled','unavailable','future','foreign','reject']){
  await page.evaluate(mode=>{window.mode=mode;window.mount(mode);},mode);await inspect();
  if(mode==='completed'){await page.getByRole('button',{name:'Finish saved folder change',exact:true}).click();await page.getByText('Folder recovery finished.',{exact:false}).waitFor();}
  else if(mode==='cancelled'){await page.getByRole('button',{name:'Keep cancellation receipt',exact:true}).click();await page.getByText('Folder recovery finished.',{exact:false}).waitFor();}
  else if(mode==='unavailable'){await page.getByText('The server is unavailable.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Cancel pending folder change',exact:true}).count(),0);}
  else if(mode==='reject'){await cancel();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Cancel pending folder change',exact:true}).count(),0);}
  else{await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Cancel pending folder change',exact:true}).count(),0);}
 }
 await page.evaluate(()=>{window.mode='held';window.mount('old-account');});await inspect();
 await page.evaluate(()=>{window.mode='normal';window.mount('new-account');window.release();});
 assert.equal(await page.getByRole('button',{name:'Cancel pending folder change',exact:true}).count(),0);
 await page.evaluate(()=>{window.mode='normal';window.mountDialog();});await page.getByText('Trash is unavailable.',{exact:false}).waitFor();await inspect();await cancel();
 await page.getByText('Saved revision',{exact:false}).waitFor();await page.getByRole('button',{name:'notes/deleted.textpack Deleted item',exact:false}).waitFor();assert.equal(await page.getByText('Trash is unavailable.',{exact:false}).count(),0);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.scope==='foreign-transport').length),0);
 const methods=await page.evaluate(()=>[...new Set(window.calls.map(c=>c.method))].sort());assert.deepEqual(methods,['folderSyncMoveRead','recoveryList','resolveFolderSyncMove','trashList'].sort());
 console.log('PASS saved folder command review: explicit scoped consent, completed/cancelled/unavailable, strict metadata, stale-account isolation, refused consent/reinspection, dialog and Trash refresh, light/dark; no file mutation calls.');
}finally{await browser.close();}
