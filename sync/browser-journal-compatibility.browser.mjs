// Isolated real-browser storage verification. No hosted service or user profile.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const engine = process.argv[2] ?? 'chromium';
if (!['chromium', 'webkit'].includes(engine) || process.argv.length > 3) throw Error('Choose chromium or webkit');

const bundle = await build({ stdin: { contents: `
import {FileCollaborationClient,fileCollaborationJournalKey} from './src/sync/client';
import fixture from './sync/fixtures/v1-pending-journal.json';
const options={server:'https://journal-compatibility.test',workspaceId:'compatibility',itemId:'compatibility-item'};
window.fixture=fixture;window.key=fileCollaborationJournalKey(options);
window.openClient=async()=>{
 window.requests=0;window.detail='';
 const client=new FileCollaborationClient({...options,active:false,onStatus:(_status,detail)=>{window.detail=detail??'';},request:async()=>{window.requests++;throw Error('Offline fixture');}});
 window.client=client;await client.start();
 return {status:client.status,unreadable:client.hasUnreadableJournal,body:client.doc.share.get('document')?.get('body')?.toString()??'',pending:client.hasPendingChanges,result:await client.flushLocalResult(),requests:window.requests,detail:window.detail};
};
window.row=()=>new Promise((resolve,reject)=>{
 const request=indexedDB.open('texttext-file-collaboration',1);
 request.onerror=()=>reject(request.error);
 request.onsuccess=()=>{const db=request.result;const tx=db.transaction('journals');const read=tx.objectStore('journals').get(window.key);read.onsuccess=()=>resolve(read.result??null);tx.oncomplete=()=>db.close();};
});
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await ({ chromium, webkit })[engine].launch();
try {
  const context = await browser.newContext();
  await context.route('https://journal-compatibility.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Journal compatibility fixture</title>' }));
  const page = await context.newPage();
  const load = async () => { await page.goto('https://journal-compatibility.test/'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); };
  await load();
  const original = await page.evaluate(() => {
    const raw=JSON.stringify(window.fixture.journal);localStorage.setItem(window.key,raw);return raw;
  });
  // Abort the actual migration transaction after its put succeeds but before commit.
  await page.evaluate(() => {
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){
      const tx=transaction.apply(this,args);
      if(args[1]==='readwrite'){
        IDBDatabase.prototype.transaction=transaction;
        const store=tx.objectStore('journals'),put=store.put.bind(store);
        store.put=(...values)=>{const request=put(...values);request.addEventListener('success',()=>tx.abort());return request;};
        tx.objectStore=()=>store;
      }
      return tx;
    };
  });
  const failed = await page.evaluate(() => window.openClient());
  assert.equal(failed.unreadable, true);
  assert.equal(failed.result.outcome, 'storage-unavailable');
  assert.equal(failed.requests, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem(window.key)), original);
  assert.equal(await page.evaluate(() => window.row()), null);
  // A fresh page/module must recover only from persisted bytes.
  await load();
  const recovered = await page.evaluate(() => window.openClient());
  assert.equal(recovered.body, await page.evaluate(() => window.fixture.expectedBody));
  assert.equal(recovered.pending, true);
  assert.equal(recovered.result.outcome, 'durable');
  assert.equal(recovered.requests, 0);
  const row = await page.evaluate(() => window.row());
  assert.equal(row.schemaVersion, 1);
  assert.equal(JSON.parse(row.raw).batch.operationId, JSON.parse(original).batch.operationId);
  await load();
  const reopened = await page.evaluate(() => window.openClient());
  assert.equal(reopened.body, recovered.body);
  assert.equal(reopened.pending, true);
  assert.equal(reopened.result.outcome, 'durable');
  assert.equal(reopened.requests, 0);
  // End the current producer before simulating state written by a newer app.
  await load();
  const future = await page.evaluate(async () => {
    const row=await window.row();
    const future={...row,schemaVersion:99,raw:'retained future journal bytes'};
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('texttext-file-collaboration',1);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result;const tx=db.transaction('journals','readwrite');tx.objectStore('journals').put(future);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};
    });
    return future;
  });
  await load();
  const refused=await page.evaluate(()=>window.openClient());
  assert.equal(refused.status,'error');
  assert.match(refused.detail,/unsupported or invalid row/);
  assert.notEqual(refused.result.outcome,'durable');
  assert.equal(refused.requests,0);
  assert.deepEqual(await page.evaluate(()=>window.row()),future);
  await context.close();
  console.log(`PASS real ${engine}: aborted legacy journal migration preserves exact fallback and no committed row; fresh pages recover pending body and original operation ID durably without network requests; future IDB schema refuses without rewriting.`);
} finally { await browser.close(); }
