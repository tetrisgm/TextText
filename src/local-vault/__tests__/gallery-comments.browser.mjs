import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const result = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{VaultGalleryLightbox}from'./src/local-vault/VaultGalleryLightbox';import{VaultComments}from'./src/local-vault/VaultComments';
import{setVaultTransport}from'./src/local-vault/bridge';import{emptyDocumentSnapshot}from'./src/lib/documents/model';
import{mutateVaultItemCommentsInPack,readVaultItemCommentsFromPack}from'./src/lib/vault/item-comments';import{strToU8,zipSync}from'fflate';
const item=crypto.randomUUID(),path='Gallery/Photos.textpack',doc=emptyDocumentSnapshot();doc.content.title='Photos';doc.content.assets=[{id:'image-a',kind:'image',src:'assets/a.png',title:'Image A'},{id:'image-b',kind:'image',src:'assets/b.png',title:'Image B'}];
const markdown='---\\ntextTextId: '+item+'\\n---\\n';const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let bytes=zipSync({'document.json':strToU8(JSON.stringify(doc)),'text.md':strToU8(markdown)}),revision=1;
const actor={userId:crypto.randomUUID(),name:'Reviewer',type:'human' as const};
bytes=mutateVaultItemCommentsInPack(bytes,item,crypto.randomUUID(),{kind:'create',body:'Historical file comment'},actor).bytes;
window.__calls=[];setVaultTransport(async(method,params)=>{window.__calls.push({method,params});if(method==='read')return{path,hash:'file',markdown,documentJSON:JSON.stringify(doc),assets:['a.png','b.png'].map(filename=>({filename,contentType:'image/png',data:png}))};if(method==='commentsRead')return{...readVaultItemCommentsFromPack(bytes,item,100),revision:String(revision)};if(method==='commentsAdd'){const result=mutateVaultItemCommentsInPack(bytes,item,params.operationId,{kind:'create',body:params.body,parentId:params.parentId,imageAssetId:params.imageAssetId},actor);bytes=result.bytes;revision++;window.__rows=readVaultItemCommentsFromPack(bytes,item).comments;return{status:'written',itemId:item,commentId:result.commentId};}throw Error(method);});
function Test(){const[gallery,setGallery]=useState(true);return gallery?<VaultGalleryLightbox entries={[{path,index:0},{path,index:1}]} initialSelection={0} onClose={()=>setGallery(false)} onEdit={()=>{}} commentsAccess={()=>({canComment:true,canResolve:true})}/>:<VaultComments itemId={item} path={path} canComment canResolve onClose={()=>{}}/>;}createRoot(document.getElementById('root')).render(<Test/>);
`},bundle:true,write:false,outdir:'/tmp/texttext-gallery-comments',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // A secure origin is required for the same UUID API used by the product.
 await page.route('https://gallery.test/**',r=>r.fulfill({body:'<div id="root" class="vault-app"></div>',contentType:'text/html'}));await page.goto('https://gallery.test');
 await page.addStyleTag({content:await readFile('src/local-vault/style.css','utf8')});await page.addStyleTag({content:result.outputFiles.find(f=>f.path.endsWith('.css')).text});await page.addScriptTag({content:result.outputFiles.find(f=>f.path.endsWith('.js')).text});
 await page.getByRole('button',{name:'Add a comment to this image'}).click();
 const panel=page.getByRole('complementary',{name:'Image comments'});
 await panel.getByLabel('Add a comment').fill('Thread on image A');await panel.getByRole('button',{name:'Post comment',exact:true}).click();await panel.getByText('Thread on image A',{exact:true}).waitFor();
 await panel.getByLabel('Add a comment').fill('Unsent draft for A');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert.equal(await page.getByRole('group',{name:'Image viewer',exact:true}).getAttribute('data-zoomed'),'true');
 await page.getByRole('button',{name:'Next image',exact:true}).click();await panel.getByText('No open comments on this image.').waitFor();assert.equal(await panel.getByLabel('Add a comment').inputValue(),'');assert.equal(await panel.getByText('Thread on image A',{exact:true}).count(),0);assert.equal(await page.getByRole('group',{name:'Image viewer',exact:true}).getAttribute('data-zoomed'),'false');
 await page.getByRole('button',{name:'Previous image',exact:true}).click();await panel.getByText('Thread on image A',{exact:true}).waitFor();await panel.getByRole('button',{name:'Reply',exact:true}).click();await panel.getByLabel('Reply',{exact:true}).fill('Reply on A');await panel.getByRole('button',{name:'Post reply',exact:true}).click();await panel.getByText('Reply on A',{exact:true}).waitFor();
 const rows=await page.evaluate(()=>window.__rows);assert.equal(rows.find(r=>r.body==='Reply on A').imageAssetId,'image-a');assert.equal(rows.find(r=>r.body==='Reply on A').parentId,rows.find(r=>r.body==='Thread on image A').id);
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:'/tmp/texttext-gallery-comments-'+theme+'.png'});}
 await page.getByRole('button',{name:'Close image',exact:true}).click();await page.getByText('Historical file comment',{exact:true}).waitFor();await page.getByText('Thread on image A',{exact:true}).waitFor();await page.getByText('Reply on A',{exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS integrated gallery: image-scoped threads, draft isolation, inherited replies, historical file comments, zoom and asset reset.');
}finally{await browser.close();}
