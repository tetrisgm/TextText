// Real Web Locks and IndexedDB, separate pages, production client and file relay.
// Page destruction bypasses application release; it is not an OS process kill.
// Run: node --import tsx src/local-vault/__tests__/session-takeover.browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildTextpack } from '../../lib/github/textpack';
import { emptyDocumentSnapshot } from '../../lib/documents/model';
import { documentText } from '../../lib/collab/document';
import { readVaultCollaboration, pushVaultCollaboration, writeVaultTextpack, readVaultTextpack } from '../../sync/engine/store';
const Y = createRequire(import.meta.url)('yjs');
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
import {acquireVaultDocument} from './src/local-vault/document-session';
import {setVaultTransport,VaultError} from './src/local-vault/bridge';
import {documentText} from './src/lib/collab/document';
setVaultTransport(async(method,params)=>{
 const result=await window.relay(method,params);
 if(result?.error)throw new VaultError(result.error.message,result.error.code);
 return result;
});
window.openOwner=async(initial)=>{
 window.handle=acquireVaultDocument({namespace:location.origin,accountId:'account-a',workspaceId:'workspace',itemId:'item'},initial);
 await window.handle.ready;await window.handle.session.client.retry();
};
window.state=()=>({key:window.handle.session.client.journalKey,body:documentText(window.handle.session.client.doc,'body').toString(),pending:window.handle.session.client.hasPendingChanges,editable:window.handle.session.client.canEdit});
window.edit=async(text)=>{const c=window.handle.session.client;c.setActive(false,'offline');c.mutate(doc=>documentText(doc,'body').insert(documentText(doc,'body').length,text));return c.flushLocal()};
window.resume=()=>window.handle.session.client.retry();
window.releaseOwner=()=>window.handle.release();
` }, bundle: true, write: false, format: 'iife', platform: 'browser', target: ['safari17'] });

function gate() { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; }
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(done => setTimeout(done, 30)); }
  throw Error('Timed out: ' + label);
}
const browser = await chromium.launch();
try {
  for (const boundary of ['before-commit', 'after-commit']) {
    const root = await mkdtemp(path.join(tmpdir(), 'texttext-tab-takeover-'));
    const context = await browser.newContext();
    const hold = gate(), seen = gate(), completed = gate();
    const calls = [], errors = [], online = new Set(); let held = false;
    const location = { root, workspaceId: 'workspace', itemId: 'item', onReceipt: async () => {} };
    const audit = { actorUserId: 'account-a', actorType: 'human' };
    const document = emptyDocumentSnapshot({ id: 'texttext.note', version: 1 });
    document.content.title = 'Takeover'; document.content.body = 'Original';
    const markdown = '---\ntextTextId: item\n---\nOriginal';
    try {
      await writeVaultTextpack({ ...location, relativePath: 'Takeover.textpack', operationId: 'seed', baseRevision: null,
        bytes: buildTextpack('Takeover', { document, markdown }) });
      const initial = { path: 'Takeover.textpack', hash: (await readVaultTextpack(location)).revision, markdown, documentJSON: JSON.stringify(document) };
      const body = async () => { const state = await readVaultCollaboration(location), doc = new Y.Doc();
        try { Y.applyUpdate(doc, Buffer.from(state.update, 'base64')); return documentText(doc, 'body').toString(); } finally { doc.destroy(); } };
      async function open(role) {
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.exposeFunction('relay', async (method, params) => {
          if (method === 'collaborationRead') {
            if (params.waitMs) await new Promise(done => setTimeout(done, 75));
            return { ...await readVaultCollaboration(location), canEditContent: true, canComment: true };
          }
          if (method === 'collaborationPush') {
            if (!online.has(role)) return { error: { code: '503', message: 'Offline test actor' } };
            const call = { role, operationId: params.operationId }; calls.push(call);
            const commit = () => pushVaultCollaboration({ ...location, audit, operationId: params.operationId, epoch: params.epoch, updates: params.updates });
            if (role === 'A' && !held) {
              held = true;
              let result;
              if (boundary === 'after-commit') result = await commit();
              seen.resolve(); await hold.promise;
              try { result ??= await commit(); call.completed = true; return result; }
              finally { completed.resolve(); }
            }
            const result = await commit(); call.completed = true; return result;
          }
          if (method === 'read') return initial;
          if (method.startsWith('presence')) return { error: { code: '503', message: 'No presence in isolated fixture' } };
          throw Error(method);
        });
        await page.route('https://takeover.test/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Isolated takeover fixture</p>' }));
        await page.goto('https://takeover.test'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.evaluate(initial => window.openOwner(initial), initial);
        await page.waitForFunction(() => window.state().editable);
        return page;
      }
      const a = await open('A'), b = await open('B');
      const keyA = (await a.evaluate(() => window.state())).key, keyB = (await b.evaluate(() => window.state())).key;
      assert.notEqual(keyA, keyB, 'Live tabs must own separate journal locks');
      assert.equal(await a.evaluate(() => window.edit(' [A durable]')), true);
      assert.equal(await b.evaluate(() => window.edit(' [B durable]')), true);
      online.add('A'); await a.evaluate(() => window.resume());
      await Promise.race([seen.promise, new Promise((_, reject) => setTimeout(() => reject(Error('No held upload')), 15000))]);
      const operationId = calls.find(call => call.role === 'A').operationId;
      await a.close({ runBeforeUnload: false }); // no handle release/flush
      online.add('C'); const c = await open('C');
      assert.equal((await c.evaluate(() => window.state())).key, keyA, 'Replacement takes the orphan journal');
      assert.equal((await b.evaluate(() => window.state())).key, keyB, 'Replacement cannot take the live journal');
      await until(() => calls.some(call => call.role === 'C' && call.operationId === operationId && call.completed), 'same operation replay');
      const seq = (await readVaultCollaboration(location)).seq;
      hold.resolve(); await completed.promise;
      assert.equal((await readVaultCollaboration(location)).seq, seq, 'Late old request must not mutate twice');
      online.add('B'); await b.evaluate(() => window.resume()); await c.evaluate(() => window.resume());
      await until(async () => { const value = await body(); return value.includes('[A durable]') && value.includes('[B durable]'); }, 'both actors converge');
      const expected = await body();
      assert.equal(expected.split('[A durable]').length - 1, 1); assert.equal(expected.split('[B durable]').length - 1, 1);
      await until(async () => { const states = await Promise.all([b,c].map(page => page.evaluate(() => window.state()))); return states.every(state => state.body === expected && !state.pending); }, 'live views and journals converge');
      await b.evaluate(() => window.releaseOwner()); await c.evaluate(() => window.releaseOwner());
      assert.deepEqual(errors, []);
      console.log('PASS ' + boundary + ': separate live locks; abrupt tab loss; orphan takeover; same operation replay; late request deduplicated; exact two-actor convergence.');
    } finally { hold.resolve(); await context.close(); await rm(root, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
