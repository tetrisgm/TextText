import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createLostAckFault, validateLostAckScenario } from './lost-ack.mjs';
const sha = x => createHash('sha256').update(x).digest('hex');
const payload = JSON.stringify({
  operationId: 'fixed-operation',
  epoch: 1,
  updates: ['fixed-update']
});
const result = {
  status: 'written',
  itemId: 'owned',
  relativePath: 'Owned/item.textpack',
  revision: 'a'.repeat(64)
};
class CDP extends EventEmitter {
  calls = [];
  async send(method, args) {
    this.calls.push([method, args]);
    if (method === 'Page.getFrameTree') return {
      frameTree: {
        frame: {
          id: 'owned-main-frame'
        }
      }
    };
    if (method === 'Fetch.getResponseBody') return {
      body: JSON.stringify(result),
      base64Encoded: false
    };
  }
}
const event = (body = payload) => ({
  requestId: 'original',
  frameId: 'owned-main-frame',
  request: {
    url: 'https://texttext.app/api/vault/ws/items/owned/collaboration',
    method: 'POST',
    postData: body
  },
  responseStatusCode: 200
});
async function setup(extra = {}) {
  const cdp = new CDP();
  const f = await createLostAckFault({
    cdp,
    url: event().request.url,
    itemId: 'owned',
    faultId: 'la-' + 'a'.repeat(32),
    editId: 'r1-mac-web',
    verifyRequest: async () => true,
    proveCommit: async () => ({
      archiveSha256: 'f'.repeat(64),
      documentSha256: 'b'.repeat(64),
      assetHashes: {
        'assets/a.png': 'c'.repeat(64)
      }
    }),
    ...extra
  });
  return {
    cdp,
    f
  };
}
async function paused(cdp, e) {
  cdp.emit('Fetch.requestPaused', e);
  await new Promise(r => setImmediate(r));
}
test('strict bounded lost ACK scenario', () => {
  assert.deepEqual(validateLostAckScenario({
    role: 'mac-web',
    round: 1
  }), {
    role: 'mac-web',
    round: 1
  });
  for (const x of [{
    role: 'mac-app',
    round: 1
  }, {
    role: 'pc-web',
    round: 2
  }, {
    role: 'pc-web',
    round: 1,
    extra: true
  }]) assert.throws(() => validateLostAckScenario(x));
});
test('drop original only after actual committed proof; continue exact original retry', async () => {
  const {
    cdp,
    f
  } = await setup();
  await paused(cdp, event());
  assert.equal(f.proof().phase, 'dropped');
  assert.equal(f.proof().requestSha256, sha(payload));
  assert.equal(cdp.calls.filter(x => x[0] === 'Fetch.failRequest').length, 1);
  await paused(cdp, event());
  assert.equal(f.proof().phase, 'replayed');
  assert.equal(f.proof().exactRetry, true);
  assert.equal(cdp.calls.filter(x => x[0] === 'Fetch.continueRequest').length, 1);
  await f.close();
});
test('no commit proof means no acceptance and abort rather than fake ACK', async () => {
  const {
    cdp,
    f
  } = await setup({
    proveCommit: async () => {
      throw Error('not committed');
    }
  });
  await paused(cdp, event());
  assert.throws(() => f.proof(), /lost ACK/);
  assert.equal(cdp.calls.some(x => x[0] === 'Fetch.continueRequest'), false);
  await f.close();
});
test('changed same-operation retry refuses; no second drop claimed', async () => {
  const {
    cdp,
    f
  } = await setup();
  await paused(cdp, event());
  await paused(cdp, event(payload.replace('fixed-update', 'changed-update')));
  assert.throws(() => f.proof(), /lost ACK/);
  await f.close();
});
test('unbound request and conflict response refuse without accepting fault', async () => {
  for (const change of [e => {
    e.request.url += '?other=1';
  }, e => {
    e.responseStatusCode = 409;
  }, e => {
    e.request.method = 'GET';
  }]) {
    const {
      cdp,
      f
    } = await setup();
    const e = event();
    change(e);
    await paused(cdp, e);
    assert.throws(() => f.proof(), /lost ACK/);
    await f.close();
  }
});
test('actual durable journal must agree before delivery failure', async () => {
  const {
    cdp,
    f
  } = await setup({
    verifyRequest: async () => false
  });
  await paused(cdp, event());
  assert.throws(() => f.proof(), /lost ACK/);
  await f.close();
});
test('partial typing batches are delivered unchanged; loss only after complete marker proof', async () => {
  let eligible = false;
  const {
    cdp,
    f
  } = await setup({
    proveCommit: async () => eligible ? {
      archiveSha256: 'f'.repeat(64),
      documentSha256: 'b'.repeat(64),
      assetHashes: {
        'assets/a.png': 'c'.repeat(64)
      }
    } : {
      eligible: false
    }
  });
  await paused(cdp, event());
  assert.equal(f.proof().phase, 'armed');
  assert.equal(cdp.calls.filter(x => x[0] === 'Fetch.continueRequest').length, 1);
  eligible = true;
  await paused(cdp, event());
  assert.equal(f.proof().phase, 'dropped');
  await f.close();
});
test('wire proof rejects partial/forged/future evidence and missing exact assets', async () => {
  const {
    f,
    cdp
  } = await setup();
  const scope = {
    faultId: 'la-' + 'a'.repeat(32),
    editId: 'r1-mac-web',
    phase: 'armed'
  };
  const {
    validateLostAckProof
  } = await import('./lost-ack.mjs');
  assert.doesNotThrow(() => validateLostAckProof(f.proof(), scope));
  for (const change of [{
    extra: 1
  }, {
    operationId: 'unproven'
  }, {
    serverCommitted: true
  }, {
    dropped: 1
  }, {
    epoch: 1
  }, {
    version: 2
  }]) assert.throws(() => validateLostAckProof({
    ...f.proof(),
    ...change
  }, scope));
  await paused(cdp, event());
  await paused(cdp, event());
  const p = f.proof(),
    ready = {
      ...scope,
      phase: 'replayed',
      assetHashes: {
        'assets/a.png': 'c'.repeat(64)
      }
    };
  assert.doesNotThrow(() => validateLostAckProof(p, ready));
  for (const change of [{
    requestSha256: null
  }, {
    retries: 0
  }, {
    exactRetry: false
  }, {
    serverAssetHashes: {}
  }, {
    serverCommitted: false
  }, {
    dropped: 2
  }, {
    faultId: 'la-' + 'b'.repeat(32)
  }]) assert.throws(() => validateLostAckProof({
    ...p,
    ...change
  }, ready));
  await f.close();
});
test('journal proof reads only existing exact-account owner record and never repairs storage', async () => {
  const {
    readLostAckJournal
  } = await import('./lost-ack.mjs');
  const scope = {
    origin: 'https://texttext.app',
    accountId: 'account',
    workspaceId: 'workspace',
    itemId: 'item'
  };
  const ns = 'texttext:file-collaboration:v2:' + JSON.stringify(Object.values(scope)),
    key = ns + ':owner:owned';
  const journal = {
    version: 1,
    accountId: 'account',
    epoch: 1,
    pending: [],
    batch: null
  };
  let opens = 0,
    mode;
  const old = Object.fromEntries(['location', 'sessionStorage', 'indexedDB'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  globalThis.location = {
    origin: scope.origin
  };
  globalThis.sessionStorage = {
    getItem: k => k === ns + ':owner' ? key : null
  };
  globalThis.indexedDB = {
    databases: async () => [{
      name: 'texttext-file-collaboration',
      version: 1
    }],
    open() {
      opens++;
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: {
            contains: x => x === 'journals'
          },
          transaction(name, m) {
            mode = m;
            return {
              objectStore: () => ({
                get(requested) {
                  assert.equal(requested, key);
                  const r = {};
                  queueMicrotask(() => {
                    r.result = {
                      schemaVersion: 1,
                      key,
                      postId: key,
                      raw: JSON.stringify(journal)
                    };
                    r.onsuccess();
                  });
                  return r;
                }
              })
            };
          },
          close() {}
        };
        request.onsuccess();
      });
      return request;
    }
  };
  try {
    assert.equal(await readLostAckJournal(scope), true);
    assert.equal(mode, 'readonly');
    journal.batch = {
      operationId: 'fixed-operation',
      updates: ['fixed-update']
    };
    assert.equal(await readLostAckJournal(scope), false);
    assert.equal(await readLostAckJournal({
      ...scope,
      body: JSON.parse(payload)
    }), true);
    journal.batch.acknowledged = true;
    assert.equal(await readLostAckJournal({
      ...scope,
      body: JSON.parse(payload)
    }), false);
    journal.accountId = 'foreign';
    assert.equal(await readLostAckJournal({
      ...scope,
      body: JSON.parse(payload)
    }), false);
    const before = opens;
    globalThis.indexedDB.databases = async () => [];
    assert.equal(await readLostAckJournal(scope), false);
    assert.equal(opens, before);
  } finally {
    for (const [k, d] of Object.entries(old)) {
      if (d) Object.defineProperty(globalThis, k, d);else delete globalThis[k];
    }
  }
});
test('wrong frame refuses the response fault', async () => {
  const {
    cdp,
    f
  } = await setup();
  const e = event();
  e.frameId = 'other-frame';
  await paused(cdp, e);
  assert.throws(() => f.proof(), /lost ACK/);
  await f.close();
});
test('overlapping paused responses cannot qualify a drop or replay', async () => {
  let release;
  const hold = new Promise(resolve => {
    release = resolve;
  });
  const {
    cdp,
    f
  } = await setup({
    proveCommit: async () => {
      await hold;
      return {
        archiveSha256: 'f'.repeat(64),
        documentSha256: 'b'.repeat(64),
        assetHashes: {
          'assets/a.png': 'c'.repeat(64)
        }
      };
    }
  });
  cdp.emit('Fetch.requestPaused', event());
  await new Promise(r => setImmediate(r));
  await paused(cdp, {
    ...event(),
    requestId: 'overlap'
  });
  try {
    await assert.rejects(f.close(), /still paused/);
  } finally { release(); }
  await new Promise(r => setImmediate(r));
  assert.throws(() => f.proof(), /lost ACK/);
  assert.equal(cdp.calls.some(([method, args]) => method === 'Fetch.failRequest' && args.errorReason === 'Failed'), false);
  await f.close();
});
test('armed or merely dropped proof never qualifies completed fault evidence', async () => {
  const {
    validateLostAckProof
  } = await import('./lost-ack.mjs');
  const {
      cdp,
      f
    } = await setup(),
    scope = {
      faultId: 'la-' + 'a'.repeat(32),
      editId: 'r1-mac-web',
      phase: 'replayed',
      assetHashes: {
        'assets/a.png': 'c'.repeat(64)
      }
    };
  assert.throws(() => validateLostAckProof(f.proof(), scope));
  await paused(cdp, event());
  assert.throws(() => validateLostAckProof(f.proof(), scope));
  await f.close();
});
