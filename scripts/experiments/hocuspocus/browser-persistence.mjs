// Isolated Chromium profile and loopback origin. No user accounts or files.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const directory = await mkdtemp(path.join(tmpdir(), 'texttext-indexeddb-crash-'));
const baseline = execFileSync(process.execPath, ['--import', 'tsx', '-e', `const {emptyDocumentSnapshot}=require('./src/lib/documents/model.ts');const {encodeDocumentBaseline}=require('./src/lib/collab/document.ts');const d=emptyDocumentSnapshot();d.content.body='Baseline';process.stdout.write(Buffer.from(encodeDocumentBaseline(d,'indexeddb-evaluation')).toString('base64'));`], { cwd: root }).toString();
const bundle = await build({ stdin: { resolveDir: here, contents: `
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
const dbName = 'texttext-test-lifecycle-1';
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
window.openFixture = async (baseline) => {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(dbName, doc);
  await persistence.whenSynced;
  if (!doc.getMap('document').has('body')) {
    if (!baseline) throw Error('Offline restart lost its document');
    Y.applyUpdate(doc, decode(baseline));
  }
  window.fixture = {doc, persistence};
};
window.fixtureBody = () => window.fixture.doc.getMap('document').get('body').toString();
window.appendFixture = value => {
  const body = window.fixture.doc.getMap('document').get('body'); body.insert(body.length, value);
};
// The provider's synced event means initial loading, not an acknowledged edit.
// A transaction spanning every store waits behind its preceding queued writes.
window.diskBarrier = async () => {
  const database = await new Promise((resolve,reject) => {
    const request = indexedDB.open(dbName); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
  try {
    await new Promise((resolve,reject) => {
      const transaction = database.transaction(Array.from(database.objectStoreNames), 'readwrite', {durability:'strict'});
      transaction.oncomplete=()=>resolve(); transaction.onabort=()=>reject(transaction.error || Error('Disk barrier aborted'));
      transaction.onerror=()=>reject(transaction.error);
    });
  } finally { database.close(); }
};
window.mergeRemoteFixture = baseline => {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, decode(baseline));
  const body = remote.getMap('document').get('body'); body.insert(body.length, ' [REMOTE]');
  const update = Y.encodeStateAsUpdate(remote);
  Y.applyUpdate(window.fixture.doc, update); Y.applyUpdate(window.fixture.doc, update);
  remote.destroy();
};
` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>TextText isolated persistence test</title><script src="/bundle.js"></script>'); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
let child, browser;
async function boot() {
  child = spawn(chromium.executablePath(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${directory}/profile`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Chromium startup timed out')), 15000);
    const exit = () => { clearTimeout(timer); reject(Error('Chromium exited during startup')); };
    child.once('exit', exit);
    child.stderr.on('data', bytes => {
      output = (output + bytes.toString()).slice(-8192);
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); child.off('exit', exit); resolve(match[1]); }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const page = await browser.contexts()[0].newPage();
  page.setDefaultTimeout(10000);
  await page.goto(url);
  await page.waitForFunction(() => typeof window.openFixture === 'function');
  return page;
}
async function crash() {
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  child = null; browser = null;
}
const checks = [];
const watchdog = setTimeout(() => { child?.kill('SIGKILL'); process.exitCode = 1; server.closeAllConnections(); server.close(); }, 90000);
try {
  let page = await boot();
  await page.evaluate(value => window.openFixture(value), baseline);
  await page.evaluate(async () => { window.appendFixture(' [OFFLINE]'); await window.diskBarrier(); });
  await crash();
  page = await boot();
  // No baseline supplied and no network provider: content must come from disk.
  await page.evaluate(() => window.openFixture(null));
  assert.equal(await page.evaluate(() => window.fixtureBody()), 'Baseline [OFFLINE]');
  checks.push('offline edit survives Chromium SIGKILL and persistent-profile restart');
  await page.evaluate(async value => { window.mergeRemoteFixture(value); await window.diskBarrier(); }, baseline);
  const expected = await page.evaluate(() => window.fixtureBody());
  assert.equal(expected.split('[OFFLINE]').length, 2); assert.equal(expected.split('[REMOTE]').length, 2);
  await crash();
  page = await boot(); await page.evaluate(() => window.openFixture(null));
  assert.equal(await page.evaluate(() => window.fixtureBody()), expected);
  checks.push('concurrent remote binary update replay converges once and survives a second crash');
  for (const check of checks) console.log(`PASS ${check}`);
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({checks, expected, limitation:'Chromium process crash after explicit IDB barrier; not power loss, Safari, native sync or six-client acceptance'}, null, 2));
  console.log(`Receipts: ${directory}`);
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
