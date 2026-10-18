import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle=await build({stdin:{contents:`
import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{FolderPresentation}from'./src/local-vault/FolderPresentation';import{setVaultTransport}from'./src/local-vault/bridge';import{emptyDocumentSnapshot}from'./src/lib/documents/model';
const root=createRoot(document.getElementById('root'));window.calls=[];window.created=[];window.revoked=[];window.rows=[];window.held=false;window.heldRequests=0;window.release=()=>{};
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);window.created.push(url);return url;};URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url);};
window.image=color=>{const c=document.createElement('canvas');c.width=c.height=2;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,2,2);return c.toDataURL('image/png').split(',')[1];};
setVaultTransport(async(method,params)=>{window.calls.push({method,params});if(method==='folderViews')return{files:[]};if(method==='preview'){
 const row=structuredClone(window.rows.find(row=>row.path===params.path));if(window.held){window.heldRequests++;await new Promise(resolve=>window.release=resolve);}if(!row)throw Error('Missing');
 const d=emptyDocumentSnapshot();d.presentation.template={id:'texttext.note',version:1};d.content.title=row.title;d.content.body=row.body;d.content.tags=['fixture'];return{title:row.title,excerpt:row.body,cardBody:row.body,document:d,image:{data:row.image,contentType:'image/png'}};
}throw Error('Unexpected mutation '+method);});
window.mount=(rows,scope='fixture-root')=>{window.rows=rows;const listing={root:scope,items:rows.map(row=>({path:row.path,title:row.title})),fullAccess:true};flushSync(()=>root.render(<FolderPresentation listing={listing} folder="Notes" busy={false} editable={false} onOpen={path=>window.opened=path}/>));};window.clear=()=>flushSync(()=>root.render(null));
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'/private/tmp/texttext-grid-fixture.js',loader:{'.css':'empty'},format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.route('https://grid.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://grid.test/');await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 const row=(path,title,body,image)=>({path,title,body,image});const images=await page.evaluate(()=>[window.image('red'),window.image('blue')]);
 const original=row('Notes/one.textpack','Original','Before body',images[0]);
 await page.evaluate(rows=>window.mount(rows),[original]);await page.getByRole('article',{name:'Original card',exact:true}).waitFor();await page.getByText('Before body',{exact:true}).waitFor();
 const image=page.locator('.vault-note-card-image');await image.waitFor();const oldURL=await image.getAttribute('src');
 const changed={...original,title:'Changed',body:'After body',image:images[1]};await page.evaluate(rows=>window.mount(rows),[changed]);
 await page.getByRole('article',{name:'Changed card',exact:true}).waitFor();await page.getByText('After body',{exact:true}).waitFor();
 await page.waitForFunction(old=>document.querySelector('.vault-note-card-image')?.getAttribute('src')!==old,oldURL);
 assert.ok(await page.evaluate(url=>window.revoked.includes(url),oldURL),'old thumbnail URL revoked after asset replacement');
 const changedURL=await image.getAttribute('src');
 const moved={...changed,path:'Notes/moved.textpack'};await page.evaluate(rows=>window.mount(rows),[moved]);await page.getByRole('article',{name:'Changed card',exact:true}).click();assert.equal(await page.evaluate(()=>window.opened),'Notes/moved.textpack');
 await page.evaluate(()=>window.mount([]));await page.waitForFunction(()=>document.querySelectorAll('.vault-note-card').length===0);assert.ok(await page.evaluate(url=>window.revoked.includes(url),changedURL));
 await page.evaluate(rows=>window.mount(rows),[{...moved,title:'Restored'}]);await page.getByRole('article',{name:'Restored card',exact:true}).waitFor();await image.waitFor();
 // Actual old provider preview result must not overwrite a newer listing.
 await page.evaluate(rows=>{window.held=true;window.mount(rows);},[{...moved,title:'Stale held',body:'Stale body'}]);
 await page.waitForFunction(()=>window.heldRequests>0);
 await page.evaluate(rows=>{window.held=false;window.mount(rows);window.release();},[{...moved,title:'Newest',body:'Newest body',image:images[0]}]);
 await page.getByRole('article',{name:'Newest card',exact:true}).waitFor();await page.getByText('Newest body',{exact:true}).waitFor();assert.equal(await page.getByText('Stale body',{exact:true}).count(),0);
 // Root/session replacement also unmounts the prior grid and discards its held provider result.
 await page.evaluate(rows=>{window.held=true;window.mount(rows);},[{...moved,title:'Old workspace',body:'Private old body'}]);
 await page.waitForFunction(()=>window.heldRequests>1);
 await page.evaluate(rows=>{window.held=false;window.mount(rows,'new-workspace');window.release();},[{...moved,title:'New workspace',body:'Public new body'}]);
 await page.getByRole('article',{name:'New workspace card',exact:true}).waitFor();await page.getByText('Public new body',{exact:true}).waitFor();assert.equal(await page.getByText('Private old body',{exact:true}).count(),0);
 const idle=await page.evaluate(()=>window.calls.length);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.calls.length),idle,'no idle echo reads/writes');
 await page.evaluate(()=>window.clear());await page.waitForFunction(()=>window.created.every(url=>window.revoked.includes(url)));
 assert.deepEqual(await page.evaluate(()=>[...new Set(window.calls.map(call=>call.method))].sort()),['folderViews','preview']);
 console.log('PASS actual FolderPresentation/Grid: fresh listing text/title/asset, moved/deleted/restored paths, held preview refusal, object URL replacement/unmount revocation, idle read-only; controlled provider fixture, not physical acceptance.');
}finally{await browser.close();}
