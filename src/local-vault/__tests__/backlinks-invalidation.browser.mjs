import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{VaultCardBacklinks}from'./src/local-vault/VaultCardBacklinks';import{setVaultTransport}from'./src/local-vault/bridge';
const root=createRoot(document.getElementById('root'));window.calls=[];window.rows=[];window.held=false;window.release=()=>{};
window.mount=(scope='one',itemId='target')=>{setVaultTransport(async(method,params)=>{
 window.calls.push({scope,method,params});const rows=structuredClone(window.rows);
 if(method==='search'){if(window.held)await new Promise(resolve=>window.release=resolve);return{items:rows.map(row=>({path:row.path,title:row.title}))};}
 if(method==='read'){const row=rows.find(row=>row.path===params.path);if(!row)throw Error('Missing');return{path:row.path,markdown:row.body,documentJSON:JSON.stringify({content:{title:row.title}})};}
 throw Error('Unexpected mutation '+method);
});flushSync(()=>root.render(<VaultCardBacklinks key={scope} itemId={itemId} onOpen={path=>window.opened=path}/>));};
window.change=(rows)=>{window.rows=rows;window.dispatchEvent(new Event('texttext:vault-changed'));};
window.replaceTransport=()=>setVaultTransport(async(method)=>{window.calls.push({scope:'replacement',method});throw Error('Changed workspace');});window.mount();
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await chromium.launch();
try {
 const page=await browser.newPage();page.setDefaultTimeout(3000);
 await page.route('https://backlinks.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://backlinks.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const row=(path,title,body='Links [target](<#texttext-card=target>)')=>({path,title,body});
 await page.evaluate(rows=>window.change(rows),[row('Notes/one.textpack','Original')]);
 assert.equal(await page.evaluate(()=>window.calls.length),0,'closed panel does no reads');
 await page.getByRole('button',{name:/Linked from$/}).click();await page.getByText('Original',{exact:true}).waitFor();
 const beforeChange=await page.evaluate(()=>window.calls.length);
 await page.evaluate(rows=>window.change(rows),[row('Notes/moved.textpack','Changed title','New [target](<#texttext-card=target>)')]);
 await page.getByText('Changed title',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),beforeChange+2,'one event performs one search and one source read');assert.equal(await page.getByText('Original',{exact:true}).count(),0);
 await page.getByRole('button',{name:/Changed title.*New target/}).click();assert.equal(await page.evaluate(()=>window.opened),'Notes/moved.textpack');
 await page.evaluate(()=>window.change([]));await page.getByText('No cards link here yet.',{exact:true}).waitFor();
 await page.evaluate(rows=>window.change(rows),[row('Notes/restored.textpack','Restored')]);await page.getByText('Restored',{exact:true}).waitFor();
 const idleCalls=await page.evaluate(()=>window.calls.length);await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.calls.length),idleCalls,'no idle echo reads/writes');
 // Closing while a read is outstanding must discard its result and stop refreshes.
 await page.evaluate(()=>{window.held=true;window.dispatchEvent(new Event('texttext:vault-changed'));});
 await page.getByText('Finding linked cards…',{exact:true}).waitFor();await page.getByRole('button',{name:/Hide links$/}).click();
 await page.evaluate(()=>{window.held=false;window.release();});assert.equal(await page.getByRole('region').count(),0);
 const closedCalls=await page.evaluate(()=>window.calls.length);await page.evaluate(()=>window.dispatchEvent(new Event('texttext:vault-changed')));
 await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.calls.length),closedCalls);
 // A mounted panel captures its workspace transport; replacement must not redirect reads.
 await page.evaluate(()=>window.replaceTransport());await page.getByRole('button',{name:/Linked from$/}).click();await page.getByText('Restored',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.scope==='replacement').length),0);
 // Account remount invalidates an old held response.
 await page.evaluate(()=>{window.held=true;window.mount('old');});await page.getByRole('button',{name:/Linked from$/}).click();
 await page.evaluate(()=>{window.held=false;window.rows=[];window.mount('new');window.release();});
 assert.equal(await page.getByRole('region').count(),0);await page.getByRole('button',{name:/Linked from$/}).click();await page.getByText('No cards link here yet.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>[...new Set(window.calls.map(call=>call.method))].sort()),['read','search']);
 console.log('PASS actual backlinks component: committed change refresh, move/title/body/delete/restore, closed idle, stale result and captured workspace refusal; read-only fixture, not physical provider acceptance.');
}finally{await browser.close();}
