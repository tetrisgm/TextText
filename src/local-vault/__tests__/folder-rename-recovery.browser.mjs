import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{FolderRenameRecovery}from'./src/local-vault/FolderRenameRecovery';import{RecoveryDialog}from'./src/local-vault/RecoveryDialog';import{setVaultTransport}from'./src/local-vault/bridge';
const root=createRoot(document.getElementById('root'));
const entry={id:'folder-operation',fromPath:'Notes',toPath:'notes',expectedIdentity:'original-folder',from:{present:false,identity:null},to:{present:true,identity:'foreign-folder'},inspection:'a'.repeat(64),summary:'notes: 2 entries\\none.textpack\\nphoto.png',resolutionBlocked:null,resolved:false};
window.calls=[];window.mode='normal';window.folderDialogClosedCount=0;window.folderResolvedCount=0;window.release=()=>{};
window.mount=(scope='one')=>{setVaultTransport(async(method,params)=>{
 window.calls.push({scope,method,params});
 if(method==='folderRenameRead'){
  if(window.mode==='held')await new Promise(resolve=>window.release=resolve);
  if(window.mode==='bad')return{...entry,inspection:'bad'};
  if(window.mode==='moved')return{...entry,fromPath:'Other'};
  return{...entry,...(window.mode==='unsafe'?{to:{present:true,identity:null}}:{}),resolutionBlocked:['blocked','unsafe'].includes(window.mode)?'Some entries could not be inspected.':null};
 }
 if(method==='resolveFolderRename'){if(window.mode==='reject')throw Error('Folder paths changed. Inspect again.');return{resolved:true};}
 throw Error(method);
});flushSync(()=>root.render(<FolderRenameRecovery key={scope} workspaceRoot={scope} entries={[{...entry,...(window.mode==='future'?{future:true}:{})}]} disabled={false} onResolved={()=>window.folderResolvedCount++}/>));};
window.replaceTransport=()=>setVaultTransport(async(method,params)=>{window.calls.push({scope:'replaced',method,params});throw Error('Wrong transport');});
window.mountDialog=()=>{let reads=0;setVaultTransport(async(method,params)=>{
 window.calls.push({scope:'dialog',method,params});
 if(method==='recoveryList')return++reads===1?{entries:[],truncated:false,folderRenames:[entry]}:{entries:[{id:'revision',path:'notes/one.textpack',kind:'revision',hash:'h',savedAt:'2026-10-18T00:00:00Z'}],truncated:false,folderRenames:[]};
 if(method==='folderRenameRead')return entry;
 if(method==='resolveFolderRename')return{resolved:true};
 throw Error(method);
});flushSync(()=>root.render(<RecoveryDialog key="dialog" path="notes/one.textpack" workspaceRoot="dialog-root" onClose={()=>window.folderDialogClosedCount++} onRestore={async()=>{throw Error('No restore')}} onRestoreDeleted={async()=>{throw Error('No restore')}}/>));};window.mount();
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await chromium.launch();
try {
 const page = await browser.newPage(); page.setDefaultTimeout(5000);
 await page.route('https://folder-recovery.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div></div>' }));
 await page.goto('https://folder-recovery.test/'); await page.setContent('<div class="vault-app" style="display:block;padding:24px;max-width:900px" id="root"></div>');
 await page.addStyleTag({ content: await readFile('src/local-vault/style.css', 'utf8') }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
 const select = async () => page.getByRole('button', { name: 'Notes → notes', exact: true }).click();
 await select(); await page.getByText('notes: A different item is here.', { exact: true }).waitFor();
 await page.getByText('Notes: No item at this path.', { exact: true }).waitFor();
 for (const colorScheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme }); await page.screenshot({ path: '/private/tmp/texttext-folder-rename-recovery-' + colorScheme + '.png', fullPage: true }); }
 // A captured transport cannot be replaced between inspection and consent.
 await page.evaluate(() => { window.mode='normal';window.mount('other-transport'); }); await select();
 await page.evaluate(() => { window.replaceTransport();window.mode='reject'; });
 await page.getByRole('button', { name: 'Keep current folder paths', exact: true }).click(); await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('button', { name: 'Keep current folder paths', exact: true }).count(), 0);
 await page.evaluate(() => window.mode='normal'); await select(); await page.getByRole('button', { name: 'Keep current folder paths', exact: true }).click();
 await page.getByText('Folder recovery finished.', { exact: false }).waitFor();
 const writes = await page.evaluate(() => window.calls.filter(call => call.method === 'resolveFolderRename'));
 assert.equal(writes.length, 2); assert.deepEqual(writes[0].params, writes[1].params); assert.equal(writes[1].params.inspection, 'a'.repeat(64)); assert.equal(writes[1].params.workspaceRoot, 'other-transport');
 for (const mode of ['bad', 'moved', 'future', 'blocked', 'unsafe']) {
  await page.evaluate(mode => { window.mode=mode;window.mount(mode); }, mode);
  if (mode !== 'future') await select();
  if (mode === 'blocked' || mode === 'unsafe') { if(mode==='unsafe')await page.getByText('notes: This path could not be verified.',{exact:true}).waitFor(); await page.getByText('Some entries could not be inspected.', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Keep current folder paths', exact: true }).isDisabled(), true); }
  else { await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('button', { name: 'Keep current folder paths', exact: true }).count(), 0); }
 }
 await page.evaluate(() => { window.mode='held';window.mount('old-account'); }); await select();
 await page.evaluate(() => { window.mode='normal';window.mount('replacement-account');window.release(); });
 await page.getByRole('button', { name: 'Notes → notes', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Keep current folder paths', exact: true }).count(), 0);
 await page.evaluate(() => window.mountDialog()); await select(); await page.getByRole('button', { name: 'Keep current folder paths', exact: true }).click();
 await page.getByText('Saved revision', { exact: false }).waitFor(); assert.equal(await page.getByRole('dialog').isVisible(), true); assert.equal(await page.evaluate(() => window.folderDialogClosedCount), 0);
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.scope==='replaced').length),0);
 const methods = await page.evaluate(() => [...new Set(window.calls.map(call => call.method))]); assert.deepEqual(methods.sort(), ['folderRenameRead','recoveryList','resolveFolderRename'].sort());
 console.log('PASS folder recovery: exact scoped metadata consent, refusal/reinspection, future/changed/blocked records, stale account isolation, light/dark and dialog refresh; no file mutation commands.');
} finally { await browser.close(); }
