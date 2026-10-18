import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessAdapter } from './adapter.mjs';
test('simulated actor advertises correlation and echoes only the current readonly sample', async () => {
  const actor = new ProcessAdapter('mac-web', [process.execPath, fileURLToPath(new URL('./fake-adapter.mjs', import.meta.url))], {
    env: {
      STRESS_FAKE_SHARED: mkdtempSync(join(tmpdir(), 'texttext-fake-soak-'))
    }
  });
  const request = message => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      actor.off('message', listener);
      reject(Error('fake sample response timed out'));
    }, 3000);
    const listener = result => {
      clearTimeout(timeout);
      actor.off('message', listener);
      resolve(result);
    };
    actor.on('message', listener);
    actor.send(message);
  });
  actor.start();
  try {
    const hello = await request({
      type: 'hello',
      role: 'mac-web',
      runId: 'fake-owned',
      fixture: {
        workspaceId: 'workspace',
        itemId: 'item'
      }
    });
    assert.equal(hello.mode, 'simulated');
    assert.equal(hello.finiteSoakCorrelation, 1);
    const sample = {
        version: 1,
        id: 'fake-owned:soak:0'
      },
      observed = await request({
        type: 'observe',
        round: 2,
        documentSnapshot: true,
        soakSample: sample
      });
    assert.equal(observed.type, 'state');
    assert.deepEqual(observed.soakSample, sample);
    assert.equal(observed.text, 'Existing fixture text.\n');
    assert.ok(observed.documentSnapshot);
    const ordinary = await request({
      type: 'observe',
      round: 2,
      documentSnapshot: true
    });
    assert.equal(ordinary.type, 'state');
    assert.equal(Object.hasOwn(ordinary, 'soakSample'), false);
    assert.deepEqual(ordinary.documentSnapshot, observed.documentSnapshot);
    for (const soakSample of [{
      version: 1,
      id: 'other:soak:0'
    }, {
      version: 1,
      id: 'fake-owned:soak:121'
    }, {
      version: 1,
      id: 'fake-owned:soak:00'
    }, {
      version: 1,
      id: 'fake-owned:soak:0',
      future: true
    }]) assert.equal((await request({
      type: 'observe',
      round: 2,
      soakSample
    })).type, 'error');
    const wrong = await request({
      type: 'edit',
      round: 3,
      soakSample: sample,
      edit: {
        id: 'r3-mac-web',
        op: 'append',
        text: '[mac-web r3 alpha1]'
      }
    });
    assert.equal(wrong.type, 'error');
    const final = await request({
      type: 'observe',
      round: 3
    });
    assert.equal(final.text, ordinary.text);
    assert.equal(Object.hasOwn(final, 'soakSample'), false);
  } finally {
    assert.equal((await actor.stop()).code, 0);
  }
});
