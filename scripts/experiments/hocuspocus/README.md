# Standard Yjs provider evaluation

Run on the Mac with Node 22 and the root dependencies installed:

```sh
npm ci --prefix scripts/experiments/hocuspocus --ignore-scripts
npm test --prefix scripts/experiments/hocuspocus
npm run test:crash --prefix scripts/experiments/hocuspocus
```

This isolated MIT-library evaluation uses Hocuspocus 4.7.0 and the real TextText
DocumentSnapshot binary baseline. It starts a bounded loopback-only server and
two standard providers, then verifies disconnected concurrent edits, a server
file-projection transaction, and binary persistence across orderly server restart.
It closes all providers and the server. Temporary fixture persistence is retained
under the system temporary directory. It never reads accounts or user files.

Passing this proves basic compatibility, not production readiness. No production
transport or dependency has been replaced. Still required before adoption:

- Production durable acknowledgement integrated with authorization and audit.
- Existing authorization, scoped capabilities, revocation and audit semantics.
- Native checkpoint durability and iCloud/direct-file imports in the same Y.Doc.
- Browser persistent offline state and interrupted browser restart.
- Delete/restore lifecycle isolation without invalidating ordinary edits.
- Actual six-client acceptance, latency and idle-resource measurements.

A disconnection is awaited before reconnecting in this test. An initial draft
reconnected while the old socket was still closing and timed out; the successful
run is not evidence that arbitrary reconnect races need no testing.

## Proposed simplification

Use one persistent binary Y.Doc per document lifecycle. Evaluate the standard
Hocuspocus provider/server for WebSocket reconnect, synchronization and awareness,
with Oracle-hosted binary persistence. Evaluate y-indexeddb for browser offline
persistence. Keep a narrow TextPack import/export adapter: an external file edit
becomes a transaction on the existing document; it must not reseed its identity.
Native OS file coordination remains necessary for iCloud and filesystem edits.

The current production custom HTTP client, durable journal and native checkpoints
cannot simply be deleted: the replacement must pass the durable-ACK and permission
checks above first. Keep the shared editor and document schema; replace the
transport behind that boundary, rather than build separate clients per platform.

Primary references reviewed October 8:

- https://tiptap.dev/docs/hocuspocus/guides/persistence
- https://tiptap.dev/docs/hocuspocus/server/hooks
- https://tiptap.dev/docs/hocuspocus/provider/configuration
- https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb

Recorded Mac result: all three checks passed with Node 22.19.0 in
`/tmp/texttext-provider-repro.log`. This is an orderly restart test, not a
crash-durability or six-device test.

## Crash probe

`crash-evaluate.mjs` runs a separate server process and kills it with SIGKILL.
The negative control demonstrates that debounced storage can lose an update
already acknowledged by the provider. The durable variant uses `beforeSync` to
validate a complete Yjs update and commit it to SQLite WAL (`synchronous=FULL`)
before application, broadcast and acknowledgement. It passes both a kill after
acknowledgement and a kill between commit and acknowledgement, with exactly-once
content after binary replay. Revocation rejects an existing writer's next update;
the update remains local, unacknowledged and absent after server restart.

The permission test observes the logical document connection. Hocuspocus can
close that connection while keeping its multiplexed WebSocket open.

The crash run also reproduced a disposal race: a delayed `connect()` scheduled
by 4.7.0 can run after `destroy()` and revive its retry loop. The evaluation's
`DisposableSocket` guards that public lifecycle boundary; it does not patch
library internals. A fifth assertion checks that late reconnect stays disabled,
and the process must exit naturally after cleanup.

Recorded result: five checks passed on Node 22.19.0 in
`/tmp/texttext-provider-crash.log`. This is an isolated storage-ordering probe,
not production persistence. It does not yet validate the complete TextText
schema, audit writes, browser disk journals, or native imports. Direct server
transactions also need their own commit-before-broadcast boundary: they do not
pass through the incoming client's `beforeSync` hook.

## Browser disk persistence probe

`npm run test:browser-crash --prefix scripts/experiments/hocuspocus` evaluates
pinned `y-indexeddb` 9.0.12 using an isolated Chromium persistent profile and a
loopback-only origin. It seeds the real DocumentSnapshot baseline, edits offline,
waits for an IndexedDB transaction barrier, kills the browser process with
SIGKILL, and restores without supplying the baseline. It then merges a concurrent
remote binary update twice, crashes again, and checks both markers appear once.
All browser processes and the bounded server are closed; fixture receipts and
profile are retained in the system temporary directory.

Both checks passed in `/tmp/texttext-indexeddb-crash.log`; receipt directory:
`/var/folders/tq/_6yt1vp555qcj2jwgxmz060w0000gn/T/texttext-indexeddb-crash-dUfd7o`.
The provider's `synced` event reports initial loading, not per-edit persistence.
The probe's separate transaction spans the database stores and requests strict
durability after preceding queued writes. This tests process crashes after that
barrier, not power loss, eviction, Safari, quota failure or native persistence.
No production client uses this adapter yet.

The isolated `ws` dependency was updated from 8.18.3 to 8.22.0 after npm audit
reported memory disclosure/exhaustion advisories. The isolated package audit is
now clean. All three provider compatibility checks and five server crash/disposal
checks passed again in `/tmp/texttext-provider-updated-ws.log` and
`/tmp/texttext-provider-updated-ws-crash.log`. Root production dependencies were
not changed by this experiment.
