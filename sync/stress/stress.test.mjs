import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Coordinator, RoundLedger, ROLES, planRounds, hashText, validateConfig } from './coordinator.mjs';
import { redact } from './adapter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fake-adapter.mjs');

// faults: { role: 'fault-name' }
function makeConfig({ faults = {}, rounds = 3, timeoutMs = 3000, mode = 'simulated', env = {} } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'stress-'));
  const shared = join(base, 'shared');
  const roles = Object.fromEntries(ROLES.map((role) => [role, {
    command: [process.execPath, FAKE],
    env: { STRESS_FAKE_SHARED: shared, ...(faults[role] ? { STRESS_FAKE_FAULT: faults[role] } : {}), ...(env[role] ?? {}) },
  }]));
  return { mode, seed: 42, rounds, timeoutMs, fixture: { workspaceId: 'ws-fixture', itemId: 'item-fixture' }, roles, outputDir: join(base, 'out') };
}

async function runWith(opts) {
  const config = makeConfig(opts);
  const summary = await new Coordinator(config).run();
  const lines = readFileSync(join(summary.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { summary, lines, dashboard: readFileSync(join(summary.outputDir, 'dashboard.html'), 'utf8') };
}

test('plan is deterministic for a seed and differs across seeds', () => {
  assert.deepEqual(planRounds(7, 3), planRounds(7, 3));
  assert.notDeepEqual(planRounds(7, 3), planRounds(8, 3));
  assert.equal(planRounds(7, 2)[1].edits.length, 6);
});

test('hash normalizes CRLF but preserves whitespace and Unicode', () => {
  assert.equal(hashText('a\r\nb\r\n'), hashText('a\nb\n'));
  assert.notEqual(hashText('a '), hashText('a'));
  assert.notEqual(hashText('a\n'), hashText('a'));
  assert.notEqual(hashText('é'), hashText('e\u0301'));
  assert.notEqual(hashText('a\nb'), hashText('a\nc'));
});

test('missing roles are rejected before any process starts', () => {
  const config = makeConfig();
  delete config.roles['pc-cli'];
  assert.throws(() => validateConfig(config), /missing roles: pc-cli/);
  config.roles['pc-cli'] = { command: 'node fake.mjs' };
  assert.throws(() => validateConfig(config), /command must be a non-empty string array/);
  assert.throws(() => validateConfig({ ...makeConfig(), fixture: {} }), /fixture/);
});

test('ledger rejects stale rounds, duplicates and unexpected types', () => {
  const ledger = new RoundLedger(2, 'ready');
  assert.equal(ledger.accept('mac-app', { type: 'ready', round: 1 }).reason, 'stale-round');
  assert.equal(ledger.accept('mac-app', { type: 'state', round: 2 }).reason, 'unexpected-type');
  assert.ok(ledger.accept('mac-app', { type: 'ready', round: 2 }).ok);
  assert.equal(ledger.accept('mac-app', { type: 'ready', round: 2 }).reason, 'duplicate');
  assert.equal(ledger.missing.length, 5);
});

test('successful simulated run converges, records evidence, and never claims real acceptance', async () => {
  const { summary, lines, dashboard } = await runWith({ faults: { 'mac-web': 'stale-ready', 'pc-app': 'dup-ready' } });
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  assert.equal(summary.roundsCompleted, 3);
  assert.equal(summary.acceptance, 'none');
  const rejected = lines.filter((l) => l.type === 'rejected').map((l) => l.reason);
  assert.ok(rejected.includes('stale-round') && rejected.includes('duplicate'), JSON.stringify(rejected));
  assert.equal(lines.filter((l) => l.type === 'round').length, 3);
  assert.equal(lines.filter((l) => l.type === 'adapter-stopped').length, 6);
  assert.match(dashboard, /passed/);
  assert.match(dashboard, /Simulated evidence/);
  assert.doesNotMatch(dashboard, /http-equiv="refresh"/);
  assert.ok(existsSync(join(summary.outputDir, 'summary.json')));
});

test('failed actor stops the run at the first failure with evidence and redacted message', async () => {
  const { summary, lines } = await runWith({ faults: { 'pc-web': 'fail-round:2' } });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failure.code, 'actor-failed');
  assert.equal(summary.failure.detail.round, 2);
  assert.equal(summary.roundsCompleted, 1);
  const failure = lines.find((l) => l.type === 'failure');
  assert.match(JSON.stringify(failure), /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(failure), /abc123/);
});

test('hash divergence and edit ID mismatch fail with per-role evidence', async () => {
  const div = await runWith({ faults: { 'mac-cli': 'private-edit' }, rounds: 1 });
  assert.equal(div.summary.failure.code, 'hash-divergence');
  assert.equal(Object.keys(div.summary.failure.detail.evidence).length, 6);
  const drop = await runWith({ faults: { 'pc-cli': 'drop-edit' }, rounds: 1 });
  assert.equal(drop.summary.failure.code, 'edit-id-mismatch');
  assert.ok(drop.summary.failure.detail.expected.includes('r1-pc-cli'));
});

test('timeout names the missing roles and still stops every adapter', async () => {
  const { summary, lines } = await runWith({ faults: { 'mac-app': 'hang' }, timeoutMs: 500, rounds: 1 });
  assert.equal(summary.failure.code, 'timeout');
  assert.deepEqual(summary.failure.detail.missing, ['mac-app']);
  assert.equal(lines.filter((l) => l.type === 'adapter-stopped').length, 6);
});

test('editor continuity is enforced for app/web roles', async () => {
  const { summary } = await runWith({ faults: { 'mac-app': 'reload' }, rounds: 2 });
  assert.equal(summary.failure.code, 'editor-discontinuity');
  assert.equal(summary.failure.detail.role, 'mac-app');
});

test('attestation rejects wrong fixture, mixed modes, and shared machine identity', async () => {
  assert.equal((await runWith({ faults: { 'pc-cli': 'wrong-fixture' } })).summary.failure.code, 'fixture-mismatch');
  assert.equal((await runWith({ faults: { 'mac-web': 'claim-real' } })).summary.failure.code, 'mode-mismatch');
  // A real-mode run cannot accept a simulated adapter.
  assert.equal((await runWith({ mode: 'real' })).summary.failure.code, 'mode-mismatch');
  assert.equal((await runWith({ mode: 'real', faults: Object.fromEntries(ROLES.map(role => [role, 'claim-real'])) })).summary.failure.code, 'mode-mismatch');
  const env = Object.fromEntries(ROLES.map((r) => [r, { STRESS_FAKE_MACHINE: 'same-box' }]));
  assert.equal((await runWith({ env })).summary.failure.code, 'machine-shared');
});

test('redact strips credentials from logged lines', () => {
  assert.equal(redact('Authorization: Bearer xyz token=abc'), 'Authorization=[redacted] token=[redacted]');
});

test('agreement and claimed edit IDs cannot hide lost document content', async () => {
  for (const [fault, code] of [['lie-content', 'content-mismatch'], ['baseline-lost', 'baseline-lost']]) {
    const faults = Object.fromEntries(ROLES.map(role => [role, fault]));
    const {summary} = await runWith({faults, rounds:1});
    assert.equal(summary.status, 'failed');
    assert.equal(summary.failure.code, code);
  }
});

test('failed process launch terminates the run and records failure', async () => {
  const config = makeConfig({rounds:1, timeoutMs:500});
  config.roles['mac-app'].command = ['/definitely-missing-texttext-test-executable'];
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'failed');
  assert.match(summary.failure.code, /actor-exited|adapter-error/);
});
