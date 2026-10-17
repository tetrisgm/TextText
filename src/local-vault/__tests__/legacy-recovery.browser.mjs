import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const html=await readFile('src/local-vault/legacy-recovery.html','utf8');
const app=await build({entryPoints:['src/local-vault/legacy-recovery-main.ts'],bundle:true,write:false,platform:'browser',format:'iife',target:['safari17']});
const fixture=await build({stdin:{contents:`import*as Y from'yjs';import{applyDocumentSnapshot}from'./src/lib/collab/document';import{emptyDocumentSnapshot}from'./src/lib/documents/model';window.fixture=()=>{const document=emptyDocumentSnapshot();document.content.title='Retained draft';document.content.body='Offline writing <img src="https://unexpected.test/leak">';const doc=new Y.Doc();applyDocumentSnapshot(doc,document,'fixture');const update=btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc)));doc.destroy();return{document,journal:{version:1,epoch:1,seq:0,revision:'a'.repeat(64),relativePath:'Notes/Retained.textpack',journalGeneration:3,update,pending:[update],batch:{operationId:'retained-operation',updates:[update]}}}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const browser=await chromium.launch();
try {
 const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();const unexpected=[];
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='https://texttext.test'){unexpected.push(url.origin);return route.abort();}
  if(url.pathname==='/legacy-recovery.js')return route.fulfill({contentType:'text/javascript',body:app.outputFiles[0].text});
  return route.fulfill({contentType:'text/html',body:url.pathname==='/legacy-recovery.html'?html:'<p>Isolated profile fixture</p>'});
 });
 await page.goto('https://texttext.test/seed');await page.addScriptTag({content:fixture.outputFiles[0].text});
 const seeded=await page.evaluate(async()=>{
  const f=window.fixture(),key='texttext:file-collaboration:v1:'+JSON.stringify(['https://texttext.test','workspace','item']);
  const fallback=JSON.stringify({...f.journal,journalGeneration:4,retired:'Retained fallback'}),committed=JSON.stringify(f.journal);
  localStorage.setItem(key,fallback);localStorage.setItem('texttext:vault-item-draft:'+JSON.stringify(['old-root','item']),JSON.stringify({base:f.document,document:f.document}));
  localStorage.setItem('texttext:vault-draft:old-root:future',JSON.stringify({version:999,original:'future-format-kept'}));
  localStorage.setItem('not-a-draft-token','isolated-secret-must-not-export');
  async function seed(name,version,store,keyPath,key,value){await new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>r.result.createObjectStore(store,keyPath?{keyPath}:undefined);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction(store,'readwrite');if(keyPath)t.objectStore(store).put(value);else t.objectStore(store).put(value,key);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>reject(t.error)}})}
  await seed('texttext-file-collaboration',1,'journals','postId',key,{key,postId:key,schemaVersion:1,generation:3,raw:committed});
  await seed('texttext-workspace-pool',2,'drafts',null,'workspace:item',{blogId:'workspace',postId:'item',draft:{title:'Earlier editor',body:'Retained pool draft'},key:'workspace:item',persistedAt:'2026-10-17'});
  return{key,fallback,committed,local:Object.fromEntries(Object.entries(localStorage))};
 });
 async function durable(){return page.evaluate(async()=>{const result={};for(const[name,store]of[['texttext-file-collaboration','journals'],['texttext-workspace-pool','drafts']])result[name]=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction(store,'readonly'),q=t.objectStore(store).getAll();q.onsuccess=()=>resolve({version:db.version,records:q.result});q.onerror=()=>reject(q.error);t.oncomplete=()=>db.close()}});return result})}
 const before=await durable();await page.goto('https://texttext.test/legacy-recovery.html');
 await page.getByRole('status').filter({hasText:'5 saved records'}).waitFor();
 assert.equal(await page.getByText('Retained draft',{exact:true}).count(),3);assert.equal(await page.locator('img').count(),0);
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download recovery'}).click()]);
 const exported=JSON.parse(await readFile(await download.path(),'utf8'));
 assert.equal(exported.version,1);assert.equal(exported.records.length,5);
 assert.equal(exported.records.find(r=>r.storage==='localStorage'&&r.key===seeded.key).raw,seeded.fallback);
 assert.equal(JSON.parse(exported.records.find(r=>r.database==='texttext-file-collaboration').raw).raw,seeded.committed);
 assert.ok(JSON.stringify(exported).includes('retained-operation'));assert.ok(JSON.stringify(exported).includes('future-format-kept'));assert.ok(!JSON.stringify(exported).includes('isolated-secret-must-not-export'));
 await page.getByRole('button',{name:'Read again'}).click();await page.getByRole('status').filter({hasText:'5 saved records'}).waitFor();
 assert.deepEqual(await durable(),before);assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),seeded.local);assert.deepEqual(unexpected,[]);
 for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:'/private/tmp/texttext-legacy-recovery-'+colorScheme+'.png',fullPage:true});}
 await page.evaluate(async()=>await new Promise((resolve,reject)=>{const r=indexedDB.open('texttext-workspace-pool');r.onsuccess=()=>{const db=r.result,t=db.transaction('drafts','readwrite');t.objectStore('drafts').put({future:new Uint8Array([1,2,3])},'future-record');t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>reject(t.error)}}));
 await page.getByRole('button',{name:'Read again'}).click();await page.getByRole('status').filter({hasText:'unsupported format'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Download recovery'}).isDisabled(),true);
 assert.equal(await page.evaluate(async()=>await new Promise(resolve=>{const r=indexedDB.open('texttext-workspace-pool');r.onsuccess=()=>{const db=r.result,t=db.transaction('drafts','readonly'),q=t.objectStore('drafts').get('future-record');q.onsuccess=()=>resolve(q.result.future instanceof Uint8Array&&q.result.future[2]===3);t.oncomplete=()=>db.close()}})),true);
 await context.close();
 const empty=await browser.newPage();await empty.route('https://empty.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?app.outputFiles[0].text:html}));
 await empty.goto('https://empty.test/legacy-recovery.html');await empty.getByRole('status').filter({hasText:'No older drafts'}).waitFor();
 assert.deepEqual(await empty.evaluate(async()=>await indexedDB.databases()),[]);
 await empty.evaluate(async()=>await new Promise(resolve=>{const r=indexedDB.open('texttext-workspace-pool',1);r.onupgradeneeded=()=>r.result.createObjectStore('bodies');r.onsuccess=()=>{r.result.close();resolve()}}));
 await empty.getByRole('button',{name:'Read again'}).click();await empty.getByRole('status').filter({hasText:'No older drafts'}).waitFor();
 await empty.evaluate(async()=>await new Promise(resolve=>{const r=indexedDB.open('texttext-workspace-pool',99);r.onupgradeneeded=()=>r.result.createObjectStore('future-drafts');r.onsuccess=()=>{r.result.close();resolve()}}));
 await empty.getByRole('button',{name:'Read again'}).click();await empty.getByRole('status').filter({hasText:'unfamiliar storage layout'}).waitFor();
 assert.equal((await empty.evaluate(async()=>await indexedDB.databases()))[0].version,99);
 console.log('PASS older-profile recovery: exact divergent copies and operation IDs exported; text preview is inert; all source bytes and DB versions unchanged; absent databases are not created; no network submission.');
}finally{await browser.close();}
