import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  const overlap = planRounds(7, 1, 'same-position')[0].edits;
  assert.deepEqual(overlap.map(edit => edit.op), ['insert-start', 'insert-start', 'append', 'insert-start', 'insert-start', 'append']);
  assert.deepEqual(planRounds(7, 1, 'overlap-replace')[0].edits.map(edit => edit.op),
    ['replace-selection', 'replace-selection', 'append', 'replace-selection', 'replace-selection', 'append']);
  assert.deepEqual(planRounds(7, 1, 'file-overlap')[0].edits.map(edit => edit.op),
    ['replace-selection', 'replace-selection', 'replace-target', 'replace-selection', 'replace-selection', 'append']);
  assert.deepEqual(planRounds(8, 1, 'file-overlap')[0].edits.map(edit => edit.op),
    ['replace-selection', 'replace-selection', 'append', 'replace-selection', 'replace-selection', 'replace-target']);
  assert.deepEqual(planRounds(8, 1, 'partial-overlap')[0].edits.map(edit => edit.op),
    ['replace-selection', 'replace-selection', 'append', 'replace-selection', 'replace-selection', 'replace-target']);
  assert.ok(planRounds(7, 1, 'unicode')[0].edits.every(edit => edit.text.includes('東京') && edit.text.includes('🧪') && edit.op === 'append'));
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
  assert.throws(() => validateConfig({ ...makeConfig(), rounds: 0 }), /expectedBaselineHash/);
  assert.doesNotThrow(() => validateConfig({ ...makeConfig(), offline: { role: 'pc-app', round: 1 } }));
  assert.throws(() => validateConfig({ ...makeConfig(), offline: { role: 'pc-cli', round: 1 } }), /offline/);
  assert.doesNotThrow(() => validateConfig({ ...makeConfig(), restart: { role: 'pc-app', round: 1 } }));
  assert.throws(() => validateConfig({ ...makeConfig(), restart: { role: 'pc-web', round: 1 } }), /restart/);
  assert.throws(() => validateConfig({ ...makeConfig(), transientInvalid: { role: 'pc-web', round: 1 } }), /transientInvalid/);
  const hash = 'a'.repeat(64);
  assert.doesNotThrow(() => validateConfig({ ...makeConfig(), expectedAssetHashes: { 'assets/photo.png': hash } }));
  assert.throws(() => validateConfig({ ...makeConfig(), expectedAssetHashes: { '../photo.png': hash } }), /expectedAssetHashes/);
  assert.throws(() => validateConfig({ ...makeConfig(), expectedAssetHashes: { 'assets/photo.png': 'bad' } }), /expectedAssetHashes/);
  const bytesBase64 = Buffer.from('new asset bytes').toString('base64');
  const replacementHash = createHash('sha256').update(Buffer.from(bytesBase64, 'base64')).digest('hex');
  assert.doesNotThrow(() => validateConfig({ ...makeConfig(), expectedAssetHashes: { 'assets/photo.png': replacementHash },
    assetReplacement: { role: 'pc-cli', round: 1, path: 'assets/photo.png', bytesBase64 } }));
  assert.throws(() => validateConfig({ ...makeConfig(), expectedAssetHashes: { 'assets/photo.png': hash },
    assetReplacement: { role: 'pc-cli', round: 1, path: 'assets/photo.png', bytesBase64 } }), /assetReplacement/);
  const otherBytesBase64 = Buffer.from('second asset').toString('base64');
  const otherHash = createHash('sha256').update(Buffer.from(otherBytesBase64, 'base64')).digest('hex');
  const paired = { ...makeConfig(), expectedAssetHashes: { 'assets/photo.png': replacementHash, 'assets/other.png': otherHash },
    assetReplacements: [
      { role: 'pc-cli', round: 1, path: 'assets/photo.png', bytesBase64 },
      { role: 'mac-cli', round: 1, path: 'assets/other.png', bytesBase64: otherBytesBase64 },
    ] };
  assert.doesNotThrow(() => validateConfig(paired));
  assert.throws(() => validateConfig({ ...paired, assetReplacements: [paired.assetReplacements[0], { ...paired.assetReplacements[1], path: 'assets/photo.png' }] }), /assetReplacement/);
  assert.throws(() => validateConfig({ ...paired, assetReplacements: [paired.assetReplacements[0], { ...paired.assetReplacements[1], role: 'pc-cli' }] }), /distinct actors/);
  assert.throws(() => validateConfig({ ...paired, assetReplacements: [paired.assetReplacements[0], { ...paired.assetReplacements[1], round: 2 }] }), /same round/);
  assert.throws(() => validateConfig({ ...paired, assetReplacement: paired.assetReplacements[0] }), /one asset replacement format/);
  const race = { ...makeConfig(), diagnosticSameEntryRace: true,
    assetReplacements: [paired.assetReplacements[0], { ...paired.assetReplacements[1], path: 'assets/photo.png' }] };
  assert.doesNotThrow(() => validateConfig(race));
  assert.throws(() => validateConfig({ ...race, diagnosticSameEntryRace: false }), /diagnosticSameEntryRace/);
  assert.throws(() => validateConfig({ ...race, expectedAssetHashes: paired.expectedAssetHashes }), /diagnosticSameEntryRace/);
  assert.throws(() => validateConfig({ ...race, assetReplacements: [race.assetReplacements[0], { ...race.assetReplacements[1], bytesBase64 }] }), /diagnosticSameEntryRace/);
  const coordinator = new Coordinator(race);
  const states = new Map([['mac-cli', { assetHashes: { 'assets/photo.png': replacementHash } }],
    ['pc-cli', { assetHashes: { 'assets/photo.png': otherHash } }]]);
  assert.equal(coordinator.checkAssets(states, 1), false);
  states.get('pc-cli').assetHashes['assets/photo.png'] = replacementHash;
  assert.equal(coordinator.checkAssets(states, 1), true);
  states.get('pc-cli').assetHashes['assets/photo.png'] = null;
  assert.equal(coordinator.checkAssets(states, 1), false);
});

test('Windows live close probe is opt-in and requires a real completed race', () => {
  const config = makeConfig({ rounds: 1, mode: 'real' });
  assert.doesNotThrow(() => validateConfig({ ...config, closeProbe: true }));
  assert.throws(() => validateConfig({ ...makeConfig({ rounds: 1 }), closeProbe: true }), /closeProbe requires a real run/);
  assert.throws(() => validateConfig({ ...config, closeProbe: false }), /closeProbe requires a real run/);
  assert.throws(() => validateConfig({ ...config, rounds: 0, closeProbe: true, expectedBaselineHash: 'a'.repeat(64) }), /closeProbe requires a real run/);
  assert.throws(() => validateConfig({ ...config, restart: { role: 'pc-app', round: 1 }, closeProbe: true }), /closeProbe requires a real run/);
  const response = new RoundLedger(1, 'close-probe', ['pc-app']);
  assert.equal(response.accept('pc-app', { type: 'close-probe', closed: true }).reason, 'stale-round');
  assert.ok(response.accept('pc-app', { type: 'close-probe', round: 1, closed: true }).ok);
});

test('asset evidence requires both physical file actors to retain the expected bytes', () => {
  const hash = 'a'.repeat(64);
  const config = makeConfig();
  config.expectedAssetHashes = { 'assets/photo.png': hash };
  const coordinator = new Coordinator(config);
  const states = new Map([['mac-cli', { assetHashes: { 'assets/photo.png': hash } }], ['pc-cli', { assetHashes: { 'assets/photo.png': hash } }]]);
  assert.equal(coordinator.checkAssets(states, 1), true);
  states.get('pc-cli').assetHashes['assets/photo.png'] = null;
  assert.equal(coordinator.checkAssets(states, 1), false);
  assert.throws(() => coordinator.checkAssets(states, 0), /asset-mismatch/);
});

test('a converged text round cannot pass without attachment evidence', async () => {
  const config = makeConfig({ rounds: 1, timeoutMs: 500 });
  config.expectedAssetHashes = { 'assets/photo.png': 'a'.repeat(64) };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failure.code, 'asset-mismatch');
});

test('invalid intermediate is repaired before six concurrent edits', async () => {
  const config = makeConfig({ rounds: 2 });
  config.transientInvalid = { role: 'pc-cli', round: 1 };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  const lines = readFileSync(join(summary.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.filter(x => x.type === 'repaired-intermediate').map(x => [x.role, x.round]), [['pc-cli', 1]]);
});

test('one browser may edit offline while the other five remain active, then reconnect', async () => {
  const config = makeConfig({ rounds: 2 });
  config.offline = { role: 'mac-web', round: 1 };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  const lines = readFileSync(join(summary.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.filter(x => x.type === 'transport').map(x => [x.role, x.round, x.online]), [
    ['mac-web', 1, false], ['mac-web', 1, true],
  ]);
  assert.equal(summary.roundsCompleted, 2);
});

test('one native app may edit offline while the other five remain active, then reconnect', async () => {
  const config = makeConfig({ rounds: 2 });
  config.offline = { role: 'pc-app', round: 1 };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  const lines = readFileSync(join(summary.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.filter(x => x.type === 'transport').map(x => [x.role, x.round, x.online]), [
    ['pc-app', 1, false], ['pc-app', 1, true],
  ]);
  assert.equal(summary.roundsCompleted, 2);
});

test('native restart occurs after all edits are visible and permits exactly one new editor session', async () => {
  const config = makeConfig({ rounds: 2 });
  config.offline = { role: 'mac-app', round: 1 };
  config.restart = { role: 'mac-app', round: 1 };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  const plan = JSON.parse(readFileSync(join(summary.outputDir, 'plan.json'), 'utf8'));
  assert.deepEqual(plan.scenario, { pattern: 'append', offline: config.offline, restart: config.restart, transientInvalid: null });
  assert.deepEqual(summary.scenario, plan.scenario);
  const lines = readFileSync(join(summary.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.find(x => x.type === 'run-start').scenario, plan.scenario);
  const events = lines.filter(x => x.round === 1 && ['transport', 'edit-barrier', 'restart'].includes(x.type));
  assert.deepEqual(events.map(x => [x.type, x.online]), [
    ['transport', false], ['edit-barrier', undefined], ['restart', undefined], ['transport', true],
  ]);
  const restarted = events.find(x => x.type === 'restart');
  assert.equal(restarted.role, 'mac-app');
  assert.equal(restarted.generation, 2);
  const initial = JSON.parse(readFileSync(join(summary.outputDir, 'adapters', 'mac-app.initial-state.json'), 'utf8'));
  const final = JSON.parse(readFileSync(join(summary.outputDir, 'adapters', 'mac-app.last-state.json'), 'utf8'));
  assert.notEqual(initial.editor.sessionId, final.editor.sessionId);
  for (const role of ['mac-web', 'pc-app', 'pc-web']) {
    const before = JSON.parse(readFileSync(join(summary.outputDir, 'adapters', `${role}.initial-state.json`), 'utf8'));
    const after = JSON.parse(readFileSync(join(summary.outputDir, 'adapters', `${role}.last-state.json`), 'utf8'));
    assert.equal(after.editor.sessionId, before.editor.sessionId, role);
  }
  assert.equal(summary.roundsCompleted, 2);
});

test('failed native relaunch stops before convergence with bounded actor evidence', async () => {
  const config = makeConfig({ faults: { 'pc-app': 'restart-fail' }, rounds: 1 });
  config.restart = { role: 'pc-app', round: 1 };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failure.code, 'actor-failed');
  assert.equal(summary.failure.detail.role, 'pc-app');
  assert.equal(summary.roundsCompleted, 0);
});

test('reopen baseline must match the prior final hash without issuing edits', async () => {
  const config = makeConfig({ rounds: 0 });
  config.expectedBaselineHash = hashText('Existing fixture text.\n');
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  assert.equal(summary.roundsCompleted, 0);
  assert.equal(summary.acceptance, 'none');
  const wrong = makeConfig({ rounds: 0 });
  wrong.expectedBaselineHash = '0'.repeat(64);
  const failure = await new Coordinator(wrong).run();
  assert.equal(failure.failure.code, 'reopen-hash-mismatch');
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

test('temporary replica divergence is re-observed before shutting down the clients', async () => {
  const { summary, lines } = await runWith({ faults: { 'pc-web': 'late-observe' }, rounds: 1 });
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  assert.equal(summary.roundsCompleted, 1);
  assert.ok(lines.some(line => line.type === 'convergence-pending' && line.round === 1));
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


test('baseline disagreement retains all six actual initial observations before any edits', async () => {
  const { summary } = await runWith({ faults: { 'pc-cli': 'different-baseline' } });
  assert.equal(summary.failure.code, 'baseline-divergence');
  assert.equal(summary.roundsCompleted, 0);
  assert.equal(Object.keys(summary.failure.detail.evidence).length, 6);
  for (const role of ROLES) {
    const state = JSON.parse(readFileSync(join(summary.outputDir, 'adapters', `${role}.initial-state.json`), 'utf8'));
    assert.equal(state.round, 0);
    assert.equal(state.text, role === 'pc-cli' ? 'Different fixture text.\n' : 'Existing fixture text.\n');
  }
});


test('successful rounds cannot hide a failed final flush or actor shutdown', async () => {
  const { summary } = await runWith({ faults: { 'pc-app': 'shutdown-fail' }, rounds: 1 });
  assert.equal(summary.roundsCompleted, 1);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.acceptance, 'none');
  assert.equal(summary.failure.code, 'shutdown-failed');
  assert.deepEqual(summary.failure.detail.actors.map(a => a.role), ['pc-app']);
});
