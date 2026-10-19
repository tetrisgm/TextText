import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { binding, identity, rawSnapshot, sample, telemetry, validateSeries, createSeriesValidator } from './resource-telemetry.mjs';
import { run } from './resource-sampler.mjs';
const id = { pid: 12, parentPid: 1, startKey: 'stable-start', session: '1', executableSha256: 'a'.repeat(64) };
const scope = { version: 1, runId: 'owned-test', role: 'pc-cli', sourceCommit: 'b'.repeat(40), ownershipEvidenceSha256: 'c'.repeat(64), root: id };
const raw = (cpu = 1, extra = []) => ({ observedUtc: '2026-10-19T00:00:00.000Z', processes: [{ identity: structuredClone(id), cpuSeconds: cpu, rssBytes: 1000, privateBytes: null }, ...extra], error: null });
const at = (n, r = raw(n + 1), previous = null) => sample({ scope, index: n, monotonicMs: n * 5000, dueMs: n * 5000, raw: r, previous, cadenceMs: 5000 });
test('strict versioned binding rejects absent/unknown/foreign/unsafe identities', () => { assert.deepEqual(binding(scope), scope); for (const v of [{ ...scope, version: 2 }, { ...scope, extra: 1 }, { ...scope, role: 'other' }, { ...scope, sourceCommit: 'b'.repeat(40) + '\n' }, { ...scope, ownershipEvidenceSha256: null }])
    assert.throws(() => binding(v)); for (const v of [{ ...id, pid: 0 }, { ...id, session: 'x' }, { ...id, startKey: '' }, { ...id, executableSha256: 'a'.repeat(64) + '\n' }, { ...id, parentPid: -1 }])
    assert.throws(() => identity(v)); });
test('strict process metrics refuse malformed, duplicate, unbounded or unknown data', () => { for (const patch of [{ cpuSeconds: NaN }, { cpuSeconds: -1 }, { rssBytes: -1 }, { rssBytes: 1.5 }, { privateBytes: Infinity }, { extra: 1 }]) {
    const r = raw();
    Object.assign(r.processes[0], patch);
    assert.throws(() => rawSnapshot(r));
} const duplicate = raw(); duplicate.processes.push(duplicate.processes[0]); assert.throws(() => rawSnapshot(duplicate)); assert.throws(() => rawSnapshot({ ...raw(), extra: 1 })); assert.throws(() => rawSnapshot({ ...raw(), processes: Array(257).fill(raw().processes[0]) })); });
test('actual CPU delta is normalized by elapsed monotonic seconds and first remains null', () => { const first = at(0), next = at(1, raw(3), first); assert.equal(first.metrics.cpuCores, null); assert.equal(next.metrics.cpuDeltaSeconds, 2); assert.equal(next.metrics.cpuCores, .4); assert.equal(next.metrics.rssBytes, 1000); assert.equal(next.metrics.privateBytes, null); assert.throws(() => telemetry(next, scope), /series/); assert.deepEqual(validateSeries([first, next], scope), [first, next]); });
test('PID start/hash/session/parent reuse invalidates complete sample', () => { for (const patch of [{ startKey: 'reused' }, { executableSha256: 'd'.repeat(64) }, { session: '2' }, { parentPid: 2 }]) {
    const r = raw();
    Object.assign(r.processes[0].identity, patch);
    const x = at(0, r);
    assert.equal(x.reason, 'identity-changed');
    assert.ok(Object.values(x.metrics).every(v => v === null));
} });
test('missing or denied tree is incomplete with nulls, never invented zero', () => { for (const r of [{ ...raw(), processes: [] }, { ...raw(), error: 'unavailable' }]) {
    const v = at(0, r);
    assert.equal(v.complete, false);
    assert.ok(Object.values(v.metrics).every(n => n === null));
} });
test('membership changes invalidate aggregate CPU until stable pair exists', () => { const prior = at(0); const child = { identity: { ...id, pid: 13, parentPid: 12 }, cpuSeconds: 0, rssBytes: 12, privateBytes: 3 }; const changed = at(1, raw(2, [child]), prior); assert.equal(changed.reason, 'tree-membership-changed'); assert.equal(changed.metrics.cpuCores, null); const next = at(2, raw(3, [child]), changed); assert.equal(next.complete, true); assert.equal(next.metrics.cpuCores, null); });
test('counter regression, clock regression and cadence gaps refuse meaningful rate', () => { assert.equal(at(1, raw(.5), at(0)).reason, 'counter-regressed'); assert.throws(() => at(0, raw(), at(0))); const v = sample({ scope, index: 1, monotonicMs: 7000, dueMs: 5000, raw: raw(), previous: at(0), cadenceMs: 5000 }); assert.equal(v.reason, 'cadence-gap'); });
test('telemetry exact envelope scope and correlated ordinal enforced', () => { const v = at(0); for (const patch of [{ version: 2 }, { extra: 1 }, { sampleId: 'owned-test:resources:00' }, { role: 'mac-cli' }, { sourceCommit: 'd'.repeat(40) }, { ownershipEvidenceSha256: 'f'.repeat(64) }, { index: -1 }, { monotonicMs: NaN }, { reason: 'unknown' }, { complete: false }])
    assert.throws(() => telemetry({ ...v, ...patch }, scope)); });
test('forged complete/partial metric values refuse', () => { const v = at(0); for (const metrics of [{ ...v.metrics, rssBytes: null }, { ...v.metrics, cpuCores: Infinity }, { ...v.metrics, extra: 1 }, { ...v.metrics, rssBytes: -1 }])
    assert.throws(() => telemetry({ ...v, metrics }, scope)); const incomplete = at(0, { ...raw(), error: 'unavailable' }); assert.throws(() => telemetry({ ...incomplete, metrics: { ...incomplete.metrics, rssBytes: 0 } }, scope)); });
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'texttext-sampler-unit-')), ownershipEvidenceFile = join(dir, 'owned.json'), bytes = JSON.stringify({ runId: scope.runId, role: scope.role, sourceCommit: scope.sourceCommit, root: id }); writeFileSync(ownershipEvidenceFile, bytes); return { scope: { ...scope, ownershipEvidenceSha256: createHash('sha256').update(bytes).digest('hex') }, ownershipEvidenceFile, output: join(dir, 'samples.jsonl') }; }
test('finite sampler create-only output, exact samples and no signals', async () => { const f = fixture(); let t = 0; const x = await run({ ...f, durationMs: 1000, cadenceMs: 1000, read: () => raw(), clock: () => t, sleep: async (ms) => { t += ms; } }); assert.equal(x.samples, 2); assert.equal(x.status, 'complete'); assert.equal(x.noProcessSignals, true); const rows = readFileSync(f.output, 'utf8').trim().split('\n').map(JSON.parse); assert.equal(rows.length, 2); await assert.rejects(run({ ...f, durationMs: 1000 }), /EEXIST/); });
test('finite sampler bad duration/cadence/evidence refuse before output', async () => { for (const args of [{ durationMs: 7200001 }, { durationMs: 0 }, { durationMs: 7200000, cadenceMs: 1000 }, { durationMs: 1000, cadenceMs: 0 }]) {
    const f = fixture();
    await assert.rejects(run({ ...f, ...args }));
    assert.equal(existsSync(f.output), false);
} const f = fixture(); writeFileSync(f.ownershipEvidenceFile, '{}'); await assert.rejects(run({ ...f, durationMs: 1000 }), /evidence/); assert.equal(existsSync(f.output), false); });
test('incomplete actual read retained as explicit incomplete finite result', async () => { const f = fixture(); let t = 0; const x = await run({ ...f, durationMs: 1000, cadenceMs: 1000, read: () => ({ observedUtc: new Date().toISOString(), processes: [], error: 'unavailable' }), clock: () => t, sleep: async (ms) => { t += ms; } }); assert.equal(x.status, 'incomplete'); assert.equal(x.incomplete, 2); });
test('source never reads command lines, emits tokens, signals or persists jobs', () => { const js = readFileSync(new URL('./resource-sampler.mjs', import.meta.url), 'utf8'), mac = readFileSync(new URL('./resource-snapshot-mac.py', import.meta.url), 'utf8'), pc = readFileSync(new URL('./resource-snapshot-pc.ps1', import.meta.url), 'utf8'); for (const s of [js, mac, pc])
    assert.doesNotMatch(s, /CommandLine|commandline|kill\(|Stop-Process|Register-ScheduledTask|taskkill/); assert.match(mac, /proc_pidpath/); });
test('read duration is explicit and does not masquerade as late dispatch', async () => { const f = fixture(); let t = 0; const x = await run({ ...f, durationMs: 1000, cadenceMs: 1000, read: () => { t += 250; return raw(); }, clock: () => t, sleep: async (ms) => { t += ms; } }); assert.equal(x.status, 'complete'); const rows = readFileSync(f.output, 'utf8').trim().split('\n').map(JSON.parse); assert.ok(rows.every(r => r.monotonicMs === r.dueMs && r.captureDurationMs === 250)); const over = sample({ scope, index: 0, monotonicMs: 0, dueMs: 0, captureDurationMs: 1001, raw: raw(), cadenceMs: 1000 }); assert.equal(over.reason, 'capture-overrun'); assert.equal(over.metrics.rssBytes, null); });
test('private bytes recomputed exactly, missing availability stays null', () => { const r = raw(); r.processes[0].privateBytes = 40; const v = at(0, r); assert.equal(telemetry(v, scope).metrics.privateBytes, 40); for (const privateBytes of [null, 0, 41])
    assert.throws(() => telemetry({ ...v, metrics: { ...v.metrics, privateBytes } }, scope)); const missing = at(0); assert.throws(() => telemetry({ ...missing, metrics: { ...missing.metrics, privateBytes: 0 } }, scope)); });
test('orphan foreign-root and cyclic trees cannot be complete', () => { for (const process of [{ ...id, pid: 13, parentPid: 99 }, { ...id, pid: 13, parentPid: 13 }]) {
    const r = raw(1, [{ identity: process, cpuSeconds: 0, rssBytes: 10, privateBytes: null }]);
    const v = at(0, r);
    assert.equal(v.complete, false);
    assert.equal(v.reason, 'tree-unavailable');
    assert.throws(() => telemetry({ ...v, reason: null, complete: true, metrics: { rssBytes: 1010, privateBytes: null, cpuDeltaSeconds: null, cpuCores: null } }, scope));
} const child = { identity: { ...id, pid: 13, parentPid: 12 }, cpuSeconds: 0, rssBytes: 10, privateBytes: 10 }; assert.equal(at(0, raw(1, [child])).complete, true); });
test('series rejects forged CPU, skipped ordinals, due drift and counter regression claims', () => { const a = at(0), b = at(1, raw(2), a); for (const metrics of [{ ...b.metrics, cpuDeltaSeconds: 9 }, { ...b.metrics, cpuCores: 9 }, { ...b.metrics, cpuDeltaSeconds: null, cpuCores: null }])
    assert.throws(() => validateSeries([a, { ...b, metrics }], scope)); assert.throws(() => validateSeries([b], scope)); assert.throws(() => validateSeries([a, { ...b, dueMs: 5001 }], scope)); assert.throws(() => validateSeries([a, { ...b, index: 2, sampleId: scope.runId + ':resources:2' }], scope)); const regressed = at(1, raw(.5), a); assert.equal(validateSeries([a, regressed], scope)[1].metrics.cpuCores, null); const stream = createSeriesValidator(scope); stream.push(a); assert.throws(() => stream.push(a)); });
test('plain own data only; accessors never invoked, symbols/prototypes/array traps refuse', () => { let called = 0; const getter = { ...scope }; Object.defineProperty(getter, 'root', { enumerable: true, get() { called++; return id; } }); assert.throws(() => binding(getter)); assert.equal(called, 0); const symbol = { ...scope, [Symbol('hidden')]: true }; assert.throws(() => binding(symbol)); assert.throws(() => binding(Object.assign(Object.create({}), scope))); const r = raw(); Object.defineProperty(r.processes, 0, { get() { called++; return r; }, enumerable: true }); assert.throws(() => rawSnapshot(r)); assert.equal(called, 0); assert.throws(() => rawSnapshot({ ...raw(), processes: [...raw().processes, ...Array(1)] })); const throwing = new Proxy(scope, { ownKeys() { throw Error('trap'); } }); assert.throws(() => binding(throwing)); });

test('manual and Windows gates register sampler; recursive sync input includes source', () => {
    const base = new URL('../../', import.meta.url);
    for (const path of ['scripts/test-sync.sh', 'windows/scripts/build.ps1'])
        assert.match(readFileSync(new URL(path, base), 'utf8'), /sync\/stress\/resource-sampler\.test\.mjs/);
    assert.match(readFileSync(new URL('sync/verify.mjs', base), 'utf8'), /'src', 'sync'/);
});

test('early timer wakes are re-waited; caller mutation cannot rotate series scope', async () => {
    const f = fixture(); let t = 0, sleeps = 0;
    const result = await run({ ...f, durationMs: 1000, cadenceMs: 1000, read: () => raw(), clock: () => t,
        sleep: async ms => { sleeps++; t += sleeps === 1 ? ms - 0.5 : ms; } });
    assert.equal(result.status, 'complete'); assert.equal(sleeps, 2);
    const mutable = structuredClone(scope), validator = createSeriesValidator(mutable);
    mutable.role = 'mac-app'; mutable.root.pid = 999;
    assert.deepEqual(validator.push(at(0)), at(0));
});
