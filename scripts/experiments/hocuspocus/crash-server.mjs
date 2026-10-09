// Disposable loopback child used only by crash-evaluate.mjs.
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [database, baseline, mode, port] = process.argv.slice(2);
const db = new DatabaseSync(database);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS updates (digest TEXT PRIMARY KEY, bytes BLOB NOT NULL)');
const insert = db.prepare('INSERT OR IGNORE INTO updates (digest, bytes) VALUES (?, ?)');
const persist = bytes => insert.run(createHash('sha256').update(bytes).digest('hex'), bytes);
persist(await readFile(baseline));
let revoked = false;
let killNext = false;
const server = new Server({ address: '127.0.0.1', port: Number(port), quiet: true, debounce: 60000, maxDebounce: 60000,
  async onAuthenticate({ token, connectionConfig }) {
    if (!['fixture-writer', 'fixture-reader'].includes(token) || (revoked && token === 'fixture-writer')) throw Error('Denied');
    connectionConfig.readOnly = token === 'fixture-reader';
    return { writer: token === 'fixture-writer' };
  },
  async onLoadDocument({ document }) {
    for (const row of db.prepare('SELECT bytes FROM updates ORDER BY rowid').all()) Y.applyUpdate(document, row.bytes);
  },
  async beforeSync({ type, payload, context, document }) {
    if (type === 0 || !context.writer) return;
    if (revoked) throw Error('Fixture access revoked');
    // Exercise the supported pre-apply hook: validate on a temporary document,
    // commit to SQLite, then let the provider apply/broadcast/ack the update.
    const probe = new Y.Doc();
    try { Y.applyUpdate(probe, Y.encodeStateAsUpdate(document)); Y.applyUpdate(probe, payload);
      if (probe.store.pendingStructs || probe.store.pendingDs) throw Error('Incomplete update');
    } finally { probe.destroy(); }
    if (mode === 'durable') persist(payload);
    if (killNext) process.kill(process.pid, 'SIGKILL');
  },
  async onStoreDocument({ document }) { persist(Y.encodeStateAsUpdate(document)); },
});
process.on('message', message => {
  if (message === 'revoke') { revoked = true; process.send?.('revoked'); }
  if (message === 'kill-next') { killNext = true; process.send?.('armed'); }
});
await server.listen();
process.send?.({ port: server.address.port });
