import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({stdin:{contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{PathCollisionRecovery}from'./src/local-vault/PathCollisionRecovery';import{setVaultTransport}from'./src/local-vault/bridge';
const root=createRoot(document.getElementById('root'));
const row={localItemId:'11111111-1111-4111-8111-111111111111',remoteItemId:'22222222-2222-4222-8222-222222222222',sourcePath:'Notes/Untitled 31.textpack',localOperationId:'33333333-3333-4333-8333-333333333333',remoteOperationId:'44444444-4444-4444-8444-444444444444',state:'review',resolutionId:null};
const review={...row,inspection:'a'.repeat(64),destinationPath:'Notes/Untitled 31 (11111111).textpack',localHash:'b'.repeat(64),remoteRevision:'c'.repeat(64)};
window.calls=[];window.mode='good';window.done=0;
window.mount=(scope='C:/Vault',savedId=null)=>{setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='pathCollisionInspect')return window.mode==='changed'?{...review,remoteItemId:'55555555-5555-4555-8555-555555555555'}:review;if(method==='pathCollisionKeepBoth'){if(window.mode==='reject')throw Error('private native path and stack');return{operationId:params.operationId,state:'completed',localItemId:row.localItemId,remoteItemId:row.remoteItemId,localPath:review.destinationPath,remotePath:row.sourcePath};}throw Error(method);});flushSync(()=>root.render(<PathCollisionRecovery key={scope} entries={[{...row,state:savedId?'prepared':'review',resolutionId:savedId}]} workspaceRoot={scope} disabled={false} onResolved={()=>window.done++}/>));};window.mount();
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch();
try {
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.route('https://collision.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('https://collision.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  assert.equal(await page.getByRole('button',{name:'Keep both notes'}).count(),0);
  await page.getByRole('button',{name:'Notes/Untitled 31.textpack'}).click();
  await page.getByText('Notes/Untitled 31 (11111111).textpack').waitFor();
  await page.evaluate(()=>window.mode='reject');await page.getByRole('button',{name:'Keep both notes'}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('private native path and stack').count(),0);
  const first=await page.evaluate(()=>window.calls.filter(call=>call.method==='pathCollisionKeepBoth'));
  assert.equal(first.length,1);assert.equal(first[0].params.consent,true);assert.equal(first[0].params.workspaceRoot,'C:/Vault');
  await page.evaluate(()=>window.mode='good');await page.getByRole('button',{name:'Keep both notes'}).click();
  await page.getByText('The local recovery was saved.').waitFor();
  const second=await page.evaluate(()=>window.calls.filter(call=>call.method==='pathCollisionKeepBoth'));
  assert.equal(second.length,2);assert.equal(second[0].params.operationId,second[1].params.operationId);
  assert.equal(await page.evaluate(()=>window.done),1);
  const saved='66666666-6666-4666-8666-666666666666';
  await page.evaluate(id=>window.mount('reopened',id),saved);
  await page.getByRole('button',{name:'Notes/Untitled 31.textpack'}).click();
  await page.getByRole('button',{name:'Keep both notes'}).click();
  await page.getByText('The local recovery was saved.').waitFor();
  assert.equal((await page.evaluate(()=>window.calls.filter(call=>call.method==='pathCollisionKeepBoth'))).at(-1).params.operationId,saved);
  await page.evaluate(()=>{window.mode='changed';window.mount('D:/Other');});
  await page.getByRole('button',{name:'Notes/Untitled 31.textpack'}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button',{name:'Keep both notes'}).count(),0);
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.method==='pathCollisionKeepBoth').length),3);
  console.log('PASS path collision UI: inspect before consent, exact pair/scope, stable retry/restart identity, redacted native errors, changed-pair refusal.');
} finally {await browser.close();}
