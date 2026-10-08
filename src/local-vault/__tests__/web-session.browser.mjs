import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const stubs={
 './VaultApp':`import React,{useEffect,useState}from'react';import{vaultRequest}from'${process.cwd()}/src/local-vault/bridge.ts';export function VaultApp(){const[draft,setDraft]=useState(''),[label,setLabel]=useState('');useEffect(()=>{window.texttextFlushForSignOut=()=>window.flush();window.late=()=>vaultRequest('write',{draft:'old editor'});const refresh=()=>vaultRequest('list',{}).then(value=>setLabel(value.name));refresh();window.addEventListener('texttext:vault-changed',refresh);return()=>{delete window.texttextFlushForSignOut;window.removeEventListener('texttext:vault-changed',refresh)}},[]);return <><input aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/><p>{label}</p></>}`,
 './WebAccount':`export function WebAccount(){return null}`,
 './web-watch':`export function watchWebWorkspace(){return{visibilityChanged(){},dispose(){}}}`,
 './web-transport':`export function createWebVaultTransport(id,name){window.created.push(id);return{request:async(method,params)=>{window.calls.push({id,method,params});return{name}},wait:async()=>false,refresh:async()=>false,destroy:()=>window.destroyed.push(id)}}`,
};
const result=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{WebVault}from'./src/local-vault/WebVault';window.created=[];window.calls=[];window.destroyed=[];window.flush=async()=>false;let root=createRoot(document.getElementById('root'));window.remountSession=(id,name)=>{window.oldLate=window.late;root.unmount();root=createRoot(document.getElementById('root'));window.renderSession(id,name)};window.renderSession=(workspaceId,name)=>root.render(<WebVault workspaceId={workspaceId} name={name} accountEmail="user@example.test" accountName="User"/>);window.renderSession('A','First');`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'session-fixture',setup(b){b.onResolve({filter:/^\.\/(VaultApp|WebAccount|web-watch|web-transport)$/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.route('https://texttext.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><p>Document '+new URL(route.request().url()).pathname+'</p>'}));
 await page.goto('https://texttext.test/vault/A');await page.addScriptTag({content:result.outputFiles[0].text});
 await page.getByLabel('Draft').fill('unsaved text');await page.evaluate(()=>window.renderSession('A','Renamed'));
 await page.getByText('Renamed',{exact:true}).waitFor();assert.equal(await page.getByLabel('Draft').inputValue(),'unsaved text');assert.deepEqual(await page.evaluate(()=>window.destroyed),[]);
 await page.evaluate(()=>window.renderSession('B','Other'));await page.getByRole('status').waitFor();assert.equal(await page.getByLabel('Draft').inputValue(),'unsaved text');
 await page.evaluate(()=>window.late());assert.deepEqual(await page.evaluate(()=>window.created),['A']);assert.equal(await page.evaluate(()=>window.calls.at(-1).id),'A');
 await page.evaluate(()=>{window.flush=()=>new Promise(resolve=>window.finish=resolve);window.renderSession('C','Third')});await page.waitForFunction(()=>typeof window.finish==='function');await page.evaluate(()=>window.late());assert.equal(await page.evaluate(()=>window.calls.at(-1).id),'A');
 await Promise.all([page.waitForURL('**/vault/C'),page.evaluate(()=>window.finish(true))]);assert.equal(await page.evaluate(()=>window.created),undefined);
 await page.goto('https://texttext.test/vault/A');await page.addScriptTag({content:result.outputFiles[0].text});await page.getByLabel('Draft').fill('retained only in prior editor');
 await page.evaluate(()=>window.remountSession('B','Other'));await page.getByRole('link',{name:'Open workspace',exact:true}).waitFor();assert.equal(await page.getByLabel('Draft').count(),0);assert.deepEqual(await page.evaluate(()=>window.created),['A']);
 assert.equal(await page.evaluate(()=>window.oldLate().then(()=>false,()=>true)),true);assert.equal(new URL(page.url()).pathname,'/vault/A');
 await Promise.all([page.waitForURL('**/vault/B'),page.getByRole('link',{name:'Open workspace',exact:true}).click()]);
 console.log('PASS web session: rename retains unsaved draft/transport; failed flush preserves A; late writes stay A; successful switch replaces document realm.');
}finally{await browser.close();}
