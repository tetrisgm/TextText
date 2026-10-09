// Real child-process crashes; no production network, accounts or user data.
import { HocuspocusProvider } from '@hocuspocus/provider';
import { DisposableSocket } from './disposable-socket.mjs';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { fork, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'texttext-provider-crash-'));
const baseline = path.join(directory, 'baseline.bin');
await writeFile(baseline, execFileSync(process.execPath, ['--import', 'tsx', '-e', `const {emptyDocumentSnapshot}=require('./src/lib/documents/model.ts');const {encodeDocumentBaseline}=require('./src/lib/collab/document.ts');const d=emptyDocumentSnapshot();d.content.body='Baseline';process.stdout.write(Buffer.from(encodeDocumentBaseline(d,'crash-evaluation')));`], { cwd: root }));
let child;
const clients = [];
const body = doc => doc.getMap('document').get('body');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 10000; while (!fn()) { if (Date.now() > end) throw Error(label); await pause(20); } }
async function boot(mode, name, port = 0) {
  child = fork(fileURLToPath(new URL('crash-server.mjs', import.meta.url)), [path.join(directory, name + '.sqlite'), baseline, mode, String(port)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  // Keep diagnostics bounded; fixture credentials are never printed.
  let errorTail = ''; child.stderr.on('data', bytes => { errorTail = (errorTail + bytes).slice(-1000); });
  const ready = await Promise.race([once(child, 'message').then(([message]) => message), once(child, 'exit').then(() => { throw Error('Server exited before ready: ' + errorTail); }), pause(10000).then(() => { throw Error('Server startup timeout'); })]);
  return ready.port;
}
async function stop() { if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; } }
async function client(port, token = 'fixture-writer', update) {
  const doc = new Y.Doc(); if (update) Y.applyUpdate(doc, update);
  const socket = new DisposableSocket({ url: `ws://127.0.0.1:${port}`, WebSocketPolyfill: WebSocket, initialDelay: 10, minDelay: 50, maxDelay: 200 });
  const provider = new HocuspocusProvider({ name: 'fixture', document: doc, token, websocketProvider: socket });
  provider.attach(); const result = { doc, socket, provider }; clients.push(result);
  await until(() => provider.isSynced, 'Provider did not sync'); return result;
}
function closeClients() { for (const c of clients) { c.provider.destroy(); c.socket.destroy(); c.doc.destroy(); } clients.length = 0; }
async function send(message, reply) { const response = once(child, 'message'); child.send(message); assert.equal((await response)[0], reply); }
try {
  // Negative control proves a provider ACK alone is not a durable disk receipt.
  for (const mode of ['debounced', 'durable']) {
    let port = await boot(mode, mode);
    const a = await client(port); body(a.doc).insert(body(a.doc).length, ' [acknowledged]');
    await until(() => a.provider.unsyncedChanges === 0, 'Update was not acknowledged');
    await stop(); closeClients();
    port = await boot(mode, mode, port); const reader = await client(port, 'fixture-reader');
    assert.equal(body(reader.doc).toString().includes('[acknowledged]'), mode === 'durable');
    console.log(mode === 'durable' ? 'PASS SQLite pre-apply commit survives SIGKILL after provider ACK' : 'PASS negative control: debounced storage loses acknowledged edit on SIGKILL');
    closeClients(); await stop();
  }
  let port = await boot('durable', 'lost-ack');
  const a = await client(port); await send('kill-next', 'armed'); const died = once(child, 'exit');
  body(a.doc).insert(body(a.doc).length, ' [lost-ack]'); await died;
  const pending = Y.encodeStateAsUpdate(a.doc); closeClients();
  port = await boot('durable', 'lost-ack', port);
  const resumed = await client(port, 'fixture-writer', pending);
  await until(() => resumed.provider.unsyncedChanges === 0, 'Resumed update was not acknowledged');
  const observer = await client(port, 'fixture-reader');
  assert.equal(body(observer.doc).toString().split('[lost-ack]').length, 2);
  console.log('PASS commit-before-ACK crash replays pending binary state exactly once');
  await send('revoke', 'revoked'); body(resumed.doc).insert(body(resumed.doc).length, ' [forbidden]');
  // Hocuspocus multiplexes documents: closing one document does not close its
  // underlying socket. Observe the document's authentication/sync lifecycle.
  await until(() => !resumed.provider.isAuthenticated && !resumed.provider.isSynced, 'Revoked document remained authenticated');
  assert(resumed.provider.unsyncedChanges > 0, 'Forbidden update was acknowledged');
  assert(!body(observer.doc).toString().includes('[forbidden]'));
  assert(body(resumed.doc).toString().includes('[forbidden]'));
  closeClients(); await stop(); port = await boot('durable', 'lost-ack', port);
  const after = await client(port, 'fixture-reader'); assert(!body(after.doc).toString().includes('[forbidden]'));
  console.log('PASS revoked update stays local and never enters durable state');
} finally { closeClients(); await stop(); }
const disposed = new DisposableSocket({ url: 'ws://127.0.0.1:1', WebSocketPolyfill: WebSocket, autoConnect: false });
disposed.destroy(); await disposed.connect();
assert.equal(disposed.shouldConnect, false, 'Late connect revived a disposed socket');
console.log('PASS disposed socket rejects delayed reconnect');
