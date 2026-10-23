import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {chromium} from 'playwright';

// Real shared editor/session/reader; only the remote workspace transport is a fixture.
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import{createRoot}from'react-dom/client';import * as Y from 'yjs';
import{CollaborativeVaultEditor}from'./src/local-vault/CollaborativeVaultEditor';
import{setVaultTransport}from'./src/local-vault/bridge';
import{emptyDocumentSnapshot}from'./src/lib/documents/model';
import{applyDocumentSnapshot}from'./src/lib/collab/document';
const doc=emptyDocumentSnapshot({id:"texttext.note",version:1});doc.content.title='Shared target';doc.content.body='[Other card](<#texttext-card=other>)';
const seed=new Y.Doc();applyDocumentSnapshot(seed,doc,'seed');const update=btoa(String.fromCharCode(...Y.encodeStateAsUpdate(seed)));seed.destroy();
const file={path:'Notes/Target.textpack',hash:'a'.repeat(64),markdown:'---\\ntextTextId: target\\n---\\n'+doc.content.body,documentJSON:JSON.stringify(doc)};
const source=emptyDocumentSnapshot({id:"texttext.note",version:1});source.content.title='Source card';source.content.body='See [Target](<#texttext-card=target>)';
window.opened=[];window.calls=[];window.addEventListener('texttext:vault-open',e=>window.opened.push(e.detail.path));
setVaultTransport(async(method,params,signal)=>{
 window.calls.push({method,params});
 if(method==='collaborationRead'){
  if(params.waitMs)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  return{epoch:1,seq:0,revision:file.hash,relativePath:file.path,update,canEditContent:true,canComment:true};
 }
 if(method==='search')return{items:[{path:'Notes/Source.textpack',title:'Source card'}]};
 if(method==='read')return{...file,path:'Notes/Source.textpack',markdown:source.content.body,documentJSON:JSON.stringify(source)};
 if(method==='resolveItemId')return{path:'Notes/Other.textpack'};
 if(method.startsWith('presence'))return{peers:[]};
 throw Error(method);
});
createRoot(document.getElementById('root')).render(<CollaborativeVaultEditor initial={file} root='fixture' config={{namespace:'https://backlinks.test',workspaceId:'workspace',itemId:'target',accountId:'owner'}} onChanged={()=>{}} onRemoved={()=>{}} registerFlush={()=>{}}/>);
`},plugins:[{name:'local-components',setup(builder){for(const[name,file]of[['ParticipantsRow','LocalParticipants.tsx'],['WorkspaceTypeLibrary','LocalTemplateLibrary.tsx'],['CommandLayer','LocalKeyboard.ts']])builder.onResolve({filter:new RegExp('(?:^|/)'+name+'$')},()=>({path:path.resolve('src/local-vault',file)}));}}],bundle:true,write:false,outdir:'/tmp/texttext-shared-backlinks-fixture',jsx:'automatic',loader:{'.css':'empty','.jpg':'dataurl','.png':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://backlinks.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('https://backlinks.test');await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 await page.getByText('Shared target',{exact:true}).waitFor();
 await page.getByRole('button',{name:'↶ Linked from',exact:true}).click({timeout:5000});
 await page.getByRole('region',{name:'Cards linking here'}).getByRole('button',{name:/Source card/}).click();
 assert.deepEqual(await page.evaluate(()=>window.opened),['Notes/Source.textpack']);
 assert.ok(await page.evaluate(()=>window.calls.some(call=>call.method==='search'&&call.params.query==='texttext-card=target')));
 await page.getByRole('link',{name:'Other card',exact:true}).click();
 await page.waitForFunction(()=>window.opened.length===2);
 assert.deepEqual(await page.evaluate(()=>window.opened),['Notes/Source.textpack','Notes/Other.textpack']);
 assert.ok(await page.evaluate(()=>window.calls.some(call=>call.method==='resolveItemId'&&call.params.itemId==='other')));
 assert.deepEqual(errors,[]);console.log('PASS actual shared note reader exposes backlinks and navigates source/identity links.');
}finally{await browser.close();}
