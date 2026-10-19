import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateResourceOwnership } from './resource-ownership.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
function fixture(role = 'pc-web') {
  const root = { pid: 1234, parentPid: 900, startKey: 'actual-start-1', session: '1', executableSha256: 'e'.repeat(64) };
  const receipt = { version: 1, kind: 'owned-role-runtime-v1', runId: 'run-1', role, sourceCommit: 'a'.repeat(40), generation: 1,
    sessionPath: 'C:/owned/run-1/generation-001', moduleSha256: 'b'.repeat(64), profileScopeHash: role.endsWith('-web') ? 'c'.repeat(64) : null,
    taskName: role.startsWith('pc-') && !role.endsWith('-cli') ? 'TextText-owned-123' : null, root };
  const receiptBytes = new TextEncoder().encode(JSON.stringify(receipt));
  const expected = { ...receipt, receiptSha256: hash(receiptBytes), rootExecutableSha256: root.executableSha256 };
  delete expected.version; delete expected.kind; delete expected.root;
  const os = { version: 1, observedUtc: '2026-10-19T15:00:00.000Z', receiptSha256: hash(receiptBytes),
    sessionPath: receipt.sessionPath, moduleSha256: receipt.moduleSha256, profileScopeHash: receipt.profileScopeHash, taskName: receipt.taskName,
    processKind: role.endsWith('-web') ? 'headed-browser' : role.endsWith('-app') ? 'native-actor' : 'file-driver', identity: { ...root } };
  return { expected, receiptBytes, os, nowMs: Date.parse(os.observedUtc) + 100 };
}
for (const role of ['pc-app', 'pc-web', 'pc-cli', 'mac-app', 'mac-web', 'mac-cli']) test(`${role}: validates independently pinned receipt and exact fresh OS identity`, () => {
  const f = fixture(role), proof = validateResourceOwnership(f);
  assert.equal(proof.root.pid, 1234); assert.equal(proof.scope, 'bound-process-tree'); assert.equal(proof.rendererCoverage, 'unavailable');
  assert.ok(Object.isFrozen(proof)); assert.ok(Object.isFrozen(proof.root));
  f.os.identity.pid = 999; assert.equal(proof.root.pid, 1234);
});
for (const key of ['pid', 'parentPid', 'startKey', 'session', 'executableSha256']) test(`rejects changed/reused OS ${key}`, () => {
  const f = fixture(); f.os.identity[key] = typeof f.os.identity[key] === 'number' ? 999 : 'changed'; assert.throws(() => validateResourceOwnership(f));
});
for (const key of ['receiptSha256', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName', 'processKind']) test(`rejects mismatched OS ownership fact ${key}`, () => {
  const f = fixture(); f.os[key] = 'wrong'; assert.throws(() => validateResourceOwnership(f));
});
test('rejects supervisor/current-PID evidence without required task/profile/module proof', () => {
  const f = fixture(); f.os.processKind = 'ssh-supervisor'; assert.throws(() => validateResourceOwnership(f));
  delete f.os.taskName; assert.throws(() => validateResourceOwnership(f));
  assert.throws(() => validateResourceOwnership({ expected: f.expected, receiptBytes: f.receiptBytes, os: { identity: f.os.identity }, nowMs: f.nowMs }));
});
test('rejects stale/future observation and noninteractive scheduler actor', () => {
  for (const age of [5001, -1]) { const f = fixture(); f.nowMs = Date.parse(f.os.observedUtc) + age; assert.throws(() => validateResourceOwnership(f)); }
  const f = fixture('pc-app'); f.os.identity.session = '0'; assert.throws(() => validateResourceOwnership(f));
});
test('strict epoch/profile scope prevents silently reusing prior generation', () => {
  const f = fixture(); f.expected.generation++; assert.throws(() => validateResourceOwnership(f));
});
test('rejects raw receipt tampering, malformed UTF8 and wrong executable pin', () => {
  const f = fixture(); f.receiptBytes[0] ^= 1; assert.throws(() => validateResourceOwnership(f));
  const bad = fixture(); bad.receiptBytes = Uint8Array.of(0xff); bad.expected.receiptSha256 = hash(bad.receiptBytes); assert.throws(() => validateResourceOwnership(bad));
  const wrong = fixture(); wrong.expected.rootExecutableSha256 = 'f'.repeat(64); assert.throws(() => validateResourceOwnership(wrong));
});
test('rejects getters/symbols/unknowns without invoking getters', () => {
  const f = fixture(); let calls = 0; Object.defineProperty(f.os, 'identity', { enumerable: true, get() { calls++; throw Error(); } });
  assert.throws(() => validateResourceOwnership(f)); assert.equal(calls, 0);
  const outer = fixture(); Object.defineProperty(outer, 'os', { enumerable: true, get() { calls++; throw Error(); } });
  assert.throws(() => validateResourceOwnership(outer)); assert.equal(calls, 0);
  for (const key of [Symbol('private'), 'unknown']) { const v = fixture(); v.os[key] = true; assert.throws(() => validateResourceOwnership(v)); }
});

test('real readFileSync Buffer must be explicitly copied to the strict byte DTO', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'texttext-ownership-byte-test-'));
  try {
    const f = fixture(), path = join(dir, 'receipt.json'); writeFileSync(path, f.receiptBytes, { flag: 'wx' });
    const raw = readFileSync(path); assert.ok(Buffer.isBuffer(raw));
    assert.throws(() => validateResourceOwnership({ ...f, receiptBytes: raw }));
    const copied = new Uint8Array(raw); assert.equal(Object.getPrototypeOf(copied), Uint8Array.prototype);
    assert.equal(validateResourceOwnership({ ...f, receiptBytes: copied }).root.pid, 1234);
    raw.fill(0); assert.equal(validateResourceOwnership({ ...f, receiptBytes: copied }).root.pid, 1234);
  } finally { rmSync(dir, { recursive: true }); }
});

test('runId and role reject object coercion without invoking nested toString', () => {
  for (const key of ['runId', 'role']) {
    let coercions = 0;
    const f = fixture(); f.expected[key] = { toString() { coercions++; return key === 'role' ? 'pc-web' : 'run-1'; } };
    assert.throws(() => validateResourceOwnership(f)); assert.equal(coercions, 0);
    for (const value of [null, true, false, 1, [], 'x'.repeat(101)]) {
      const invalid = fixture(); invalid.expected[key] = value; assert.throws(() => validateResourceOwnership(invalid));
    }
  }
});

test('manual and Windows gates register ownership tests; default discovery and fingerprint include actual sources', async () => {
  const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { stressTestPaths, fingerprint, inputs } = await import('../verify.mjs');
  for (const name of ['../../scripts/test-sync.sh', '../../windows/scripts/build.ps1'])
    assert.match(readFileSync(new URL(name, import.meta.url), 'utf8'), /sync\/stress\/resource-ownership\.test\.mjs/);
  assert.ok(inputs.includes('sync'));
  assert.ok((await stressTestPaths()).includes('sync/stress/resource-ownership.test.mjs'));
  const root = mkdtempSync(join(tmpdir(), 'texttext-ownership-fingerprint-'));
  try {
    mkdirSync(join(root, 'sync/stress'), { recursive: true });
    for (const file of ['resource-ownership.mjs', 'resource-ownership.test.mjs']) writeFileSync(join(root, 'sync/stress', file), readFileSync(new URL(file, import.meta.url)));
    const first = await fingerprint(root, ['sync']);
    writeFileSync(join(root, 'sync/stress/resource-ownership.mjs'), 'changed owned fixture');
    assert.notEqual(await fingerprint(root, ['sync']), first);
  } finally { rmSync(root, { recursive: true }); }
});
