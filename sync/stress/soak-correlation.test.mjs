import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSoakSample, readSoakObservation } from './soak-correlation.mjs';
const runId = 'stress-owned-42';
test('strict current-run sample descriptor accepts only canonical0..120 and freezes a copy', () => {
  for (const ordinal of [0, 1, 99, 100, 119, 120]) {
    const value = {
        version: 1,
        id: `${runId}:soak:${ordinal}`
      },
      result = validateSoakSample(value, runId);
    assert.deepEqual(result, value);
    assert.notEqual(result, value);
    assert.equal(Object.isFrozen(result), true);
  }
  assert.equal(validateSoakSample(undefined, null), undefined);
  for (const value of [null, {}, [], {
    version: 2,
    id: runId + ':soak:0'
  }, {
    version: 1,
    id: 'other:soak:0'
  }, {
    version: 1,
    id: runId + ':soak:01'
  }, {
    version: 1,
    id: runId + ':soak:121'
  }, {
    version: 1,
    id: runId + ':soak:-1'
  }, {
    version: 1,
    id: runId + ':soak:1.0'
  }, {
    version: 1,
    id: runId + ':soak:0',
    future: true
  }]) assert.throws(() => validateSoakSample(value, runId));
});
test('echo appears only after actual readonly callback; ordinary state never inherits prior ticket', async () => {
  let release,
    reads = 0;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let settled = false;
  const request = {
      version: 1,
      id: runId + ':soak:0'
    },
    promise = readSoakObservation(request, runId, async () => {
      reads++;
      await gate;
      return {
        type: 'state',
        round: 100,
        text: 'actual observed body',
        documentSnapshot: {
          observed: true
        },
        assetHashes: {
          exact: 'hash'
        }
      };
    }).then(value => {
      settled = true;
      return value;
    });
  request.id = runId + ':soak:1';
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(settled, false);
  release();
  const result = await promise;
  assert.equal(result.soakSample.id, runId + ':soak:0');
  assert.equal(result.text, 'actual observed body');
  assert.deepEqual(result.assetHashes, {
    exact: 'hash'
  });
  const ordinary = await readSoakObservation(undefined, runId, async () => result);
  assert.equal(Object.hasOwn(ordinary, 'soakSample'), false);
  assert.equal(ordinary.text, result.text);
});
test('invalid descriptor never invokes reader; failed/non-state readers never emit a correlated state', async () => {
  let reads = 0;
  await assert.rejects(readSoakObservation({
    version: 1,
    id: 'wrong:soak:0'
  }, runId, async () => {
    reads++;
    return {
      type: 'state'
    };
  }));
  assert.equal(reads, 0);
  await assert.rejects(readSoakObservation({
    version: 1,
    id: runId + ':soak:0'
  }, runId, async () => {
    throw Error('read refused');
  }));
  await assert.rejects(readSoakObservation({
    version: 1,
    id: runId + ':soak:0'
  }, runId, async () => ({
    type: 'error'
  })));
});
test('sample field on every non-observe command refuses even when null or undefined', async () => {
  const {
    assertSoakObserveOnly
  } = await import('./soak-correlation.mjs');
  for (const type of ['hello', 'prepare', 'edit', 'restart', 'shutdown']) for (const soakSample of [undefined, null, {
    version: 1,
    id: runId + ':soak:0'
  }]) assert.throws(() => assertSoakObserveOnly({
    type,
    soakSample
  }), /only on observe/);
  assert.doesNotThrow(() => assertSoakObserveOnly({
    type: 'edit'
  }));
  assert.doesNotThrow(() => assertSoakObserveOnly({
    type: 'observe',
    soakSample: {
      version: 1,
      id: runId + ':soak:0'
    }
  }));
});
test('source-qualified browser and CLI inventories pin actual imported correlation helper', async () => {
  const {
      fileURLToPath
    } = await import('node:url'),
    {
      resolve
    } = await import('node:path'),
    {
      fixedDriverFiles
    } = await import('./identity-observation.mjs'),
    {
      fixedArtifactPaths
    } = await import('./artifact-source.mjs');
  const expected = fileURLToPath(new URL('./soak-correlation.mjs', import.meta.url)),
    root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  for (const role of ['mac-web', 'pc-web', 'mac-cli', 'pc-cli']) {
    assert.equal(fixedDriverFiles(role).soakCorrelation, expected);
    assert.equal(fixedArtifactPaths(role, root).soakCorrelation, expected);
  }
  for (const role of ['mac-app', 'pc-app']) assert.equal(fixedArtifactPaths(role, root).soakCorrelation, undefined);
});

test('sample IDs and run IDs reject trailing line terminators', () => {
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    assert.throws(() => validateSoakSample({ version: 1, id: runId + ':soak:0' + suffix }, runId));
    const invalidRun = runId + suffix;
    assert.throws(() => validateSoakSample({ version: 1, id: invalidRun + ':soak:0' }, invalidRun));
  }
});
