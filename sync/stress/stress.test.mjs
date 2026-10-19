import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  const expectedIdentities = Object.fromEntries(ROLES.map(role => [role, {
    schemaVersion: 1, role, platform: role.startsWith('mac-') ? 'darwin' : 'win32',
    artifactKind: role.endsWith('-cli') ? 'direct-file-driver' : role.endsWith('-web') ? 'browser' : 'private-acceptance',
    principalKind: role.endsWith('-cli') ? 'workspace-owner-binding' : 'authenticated-account', principalScopeHash: 'a'.repeat(64),
    runtimeName: 'test-runtime', runtimeVersion: 'test-version', artifacts: { driver: 'b'.repeat(64) },
    sourceCommit: 'c'.repeat(40), sourceReceiptSha256: 'd'.repeat(64),
    ...(role.endsWith('-web') ? { deploymentId: 'test-build', browserVersion: 'test-browser-version', driverSourceCommit: 'c'.repeat(40) } : {}),
  }]));
  return { ...(mode === 'real' ? { expectedIdentities } : {}), mode, seed: 42, rounds, timeoutMs, fixture: { workspaceId: 'ws-fixture', itemId: 'item-fixture' }, roles, outputDir: join(base, 'out') };
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
  assert.doesNotThrow(() => validateConfig({ ...makeConfig(), restart: { role: 'pc-web', round: 1 } }));
  assert.throws(() => validateConfig({ ...makeConfig(), restart: { role: 'pc-cli', round: 1 } }), /restart/);
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
  assert.deepEqual(plan.scenario, { requiredConvergenceSamples: 3, pattern: 'append', offline: config.offline, restart: config.restart, transientInvalid: null });
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
  assert.equal((await runWith({
    faults: {
      'pc-cli': 'wrong-fixture'
    }
  })).summary.failure.code, 'fixture-mismatch');
  assert.equal((await runWith({
    faults: {
      'mac-web': 'claim-real'
    }
  })).summary.failure.code, 'mode-mismatch');
  // A real-mode run cannot accept a simulated adapter.
  assert.equal((await runWith({
    mode: 'real'
  })).summary.failure.code, 'mode-mismatch');
  assert.equal((await runWith({
    mode: 'real',
    faults: Object.fromEntries(ROLES.map(role => [role, 'claim-real']))
  })).summary.failure.code, 'mode-mismatch');
  const env = Object.fromEntries(ROLES.map(r => [r, {
    STRESS_FAKE_MACHINE: 'same-box'
  }]));
  assert.equal((await runWith({
    env
  })).summary.failure.code, 'machine-shared');
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


test('convergence requires three consecutive all-six samples and resets after drift', async () => {
  const { summary, lines } = await runWith({ faults: { 'pc-web': 'sample-drift' }, rounds: 1 });
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  const samples = lines.filter(line => line.type === 'convergence-sample');
  assert.deepEqual(samples.map(line => line.stableSamples), [1, 1, 2, 3]);
  assert.equal(lines.find(line => line.type === 'round').stableSamples, 3);
  assert.equal(lines.find(line => line.type === 'round').samples, 5);
  assert.ok(samples.every(line => line.roles.length === 6 && line.editCount === 6));
  assert.equal(summary.acceptance, 'none');
});

test('later matching snapshots cannot hide missing, duplicate or wrong actor operation evidence', async () => {
  for (const fault of ['sample-missing-ids', 'sample-duplicate-id']) {
    const { summary } = await runWith({ faults: { 'pc-cli': fault }, rounds: 1 });
    assert.equal(summary.failure.code, 'edit-id-mismatch');
    assert.equal(summary.failure.detail.role, 'pc-cli');
    assert.equal(summary.roundsCompleted, 0);
  }
  const coordinator = new Coordinator(makeConfig({ rounds: 1 }));
  coordinator.baseline = 'Existing fixture text.\n';
  const edits = planRounds(42, 1)[0].edits;
  const ids = edits.map(edit => edit.id).sort();
  const states = new Map(ROLES.map(role => [role, { text: coordinator.baseline + edits.map(edit => edit.text).join(''), editIds: ids }]));
  states.get('pc-app').editIds = ids.map(id => id === 'r1-pc-app' ? 'r1-mac-app' : id);
  assert.throws(() => coordinator.checkRoundContent(states, 1, ids), error => error.code === 'edit-id-mismatch' && error.detail.role === 'pc-app');
  states.delete('pc-app');
  assert.throws(() => coordinator.checkRoundContent(states, 1, ids), error => error.code === 'state-invalid' && error.detail.role === 'pc-app');
});

test('missing actor or reloaded editor after first convergence prevents acceptance', async () => {
  const missing = await runWith({ faults: { 'pc-web': 'sample-missing' }, rounds: 1, timeoutMs: 1500 });
  assert.equal(missing.summary.failure.code, 'timeout');
  assert.deepEqual(missing.summary.failure.detail.missing, ['pc-web']);
  const reload = await runWith({ faults: { 'mac-app': 'sample-reload' }, rounds: 1 });
  assert.equal(reload.summary.failure.code, 'editor-discontinuity');
  assert.equal(reload.summary.failure.detail.role, 'mac-app');
});

test('durable reopen rejects a later sample that drifts or reloads', async () => {
  for (const [fault, code] of [['sample-drift', 'reopen-hash-mismatch'], ['sample-reload', 'editor-discontinuity']]) {
    const config = makeConfig({ faults: { 'pc-web': fault }, rounds: 0 });
    config.expectedBaselineHash = hashText('Existing fixture text.\n');
    const summary = await new Coordinator(config).run();
    assert.equal(summary.failure.code, code);
    assert.equal(summary.acceptance, 'none');
  }
});

test('sustained input has one logical operation and complete ordinal progress from every editor', async () => {
  const config = makeConfig({ rounds: 1 });
  config.sustainedTyping = { chunks: 4, intervalMs: 25 };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.status, 'passed', JSON.stringify(summary.failure));
  assert.equal(summary.acceptance, 'none');
  const lines = readFileSync(join(summary.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const progress = lines.filter(line => line.type === 'input-progress');
  assert.deepEqual(progress.map(line => line.role), ['mac-app', 'mac-web', 'pc-app', 'pc-web']);
  assert.ok(progress.every(line => line.chunks.length === 4));
  const plan = JSON.parse(readFileSync(join(summary.outputDir, 'plan.json'), 'utf8'));
  assert.deepEqual(plan.scenario.sustainedTyping, config.sustainedTyping);
  assert.equal(plan.rounds[0].edits.filter(edit => edit.inputSequence).length, 4);
  assert.throws(() => validateConfig({ ...config, pattern: 'same-position' }), /sustainedTyping/);
  assert.throws(() => validateConfig({ ...config, sustainedTyping: { chunks: 65, intervalMs: 25 } }), /sustainedTyping/);
});

test('sustained input rejects wrong actor, skipped ordinal, nonmonotonic time and early final acknowledgment', async () => {
  for (const fault of ['input-wrong-role', 'input-skip', 'input-clock', 'input-early-final']) {
    const config = makeConfig({ rounds: 1, faults: { 'pc-app': fault } });
    config.sustainedTyping = { chunks: 4, intervalMs: 25 };
    const summary = await new Coordinator(config).run();
    assert.equal(summary.failure.code, 'input-progress-invalid', fault);
    assert.equal(summary.failure.detail.role, 'pc-app');
    assert.equal(summary.roundsCompleted, 0);
  }
});

test('partial sequence failure preserves confirmed input prefix in failure receipt', async () => {
  const config = makeConfig({ rounds: 1, faults: { 'mac-web': 'input-prefix-fail' } });
  config.sustainedTyping = { chunks: 4, intervalMs: 25 };
  const summary = await new Coordinator(config).run();
  assert.equal(summary.failure.code, 'actor-failed');
  assert.equal(summary.failure.detail.inputProgress.chunks.length, 2);
  const lines = readFileSync(join(summary.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const prefix = lines.find(line => line.type === 'input-prefix-failure');
  assert.equal(prefix.role, 'mac-web');
  assert.equal(prefix.valid, true);
  assert.equal(prefix.inputProgress.acceptedPrefix, planRounds(42, 1, 'append', config.sustainedTyping)[0].edits[1].inputSequence.chunks.slice(0, 2).join(''));
});

test('interleaved sustained chunks are accounted without requiring one arbitrary CRDT ordering', () => {
  const config = makeConfig({ rounds: 1 }); config.sustainedTyping = { chunks: 4, intervalMs: 25 };
  const coordinator = new Coordinator(config); coordinator.baseline = 'Existing fixture text.\n';
  const edits = planRounds(42, 1, 'append', config.sustainedTyping)[0].edits;
  const chunks = edits.map(edit => edit.inputSequence?.chunks ?? [edit.text]);
  const interleaved = Array.from({ length: 4 }, (_, index) => chunks.map(values => values[index] ?? '').join('')).join('');
  const ids = edits.map(edit => edit.id).sort();
  const states = new Map(ROLES.map(role => [role, { text: coordinator.baseline + interleaved, editIds: ids }]));
  assert.doesNotThrow(() => coordinator.checkRoundContent(states, 1, ids));
  states.get('pc-cli').text = states.get('pc-cli').text.replace(chunks[0][0], '');
  assert.throws(() => coordinator.checkRoundContent(states, 1, ids), error => error.code === 'content-mismatch');
});

test('real configuration rejects missing artifact pins before starting any actor', () => {
  const config=makeConfig({mode:'real',rounds:1});delete config.expectedIdentities;
  assert.throws(()=>new Coordinator(config),/all six expectedIdentities/);
});

test('structured attestation strips unknown fields and rejects missing identity before physical readiness', () => {
  const config=makeConfig({mode:'real',rounds:1}),coordinator=new Coordinator(config);coordinator.openOutput();
  const values=new Map(ROLES.map(role=>{
    const observed=structuredClone(config.expectedIdentities[role]);if(role.endsWith('-web'))delete observed.sourceCommit;
    return [role,{type:'attest',round:0,mode:'real',adapter:'schema-unit-fixture',machineId:role.startsWith('mac-')?'fixture-mac':'fixture-pc',workspaceId:config.fixture.workspaceId,itemId:config.fixture.itemId,
      identity:{...observed,token:'never-persist'},initialPack:{packSha256:'a'.repeat(64),bodySha256:'a'.repeat(64),documentSha256:'a'.repeat(64),assetHashes:{},password:'never-persist'}}];
  }));
  coordinator.checkAttestations(values);
  assert.equal(JSON.stringify(coordinator.attestations).includes('never-persist'),false);
  values.get('pc-app').identity=undefined;
  assert.throws(()=>coordinator.checkAttestations(values),error=>error.code==='identity-mismatch'&&error.detail.role==='pc-app');
});

test('coordinator restart verifies fresh observed source and exact attested editor session', async () => {
  const config=makeConfig({mode:'real',rounds:1}),coordinator=new Coordinator(config);coordinator.openOutput();
  const role='pc-app',identity=structuredClone(config.expectedIdentities[role]);
  coordinator.editorBaseline[role]={sessionId:'old-session',reloads:0};coordinator.attestations[role]={machineId:'actual-pc'};
  const attestation={type:'attest',round:0,mode:'real',adapter:'schema-unit-fixture',machineId:'actual-pc',workspaceId:config.fixture.workspaceId,itemId:config.fixture.itemId,generation:2,sessionId:'new-session',identity};
  coordinator.adapters.set(role,{send(){}});coordinator.collect=async()=>new Map([[role,{type:'restart',round:1,generation:2,attestation}]]);
  await coordinator.restartActor(1,role);
  assert.throws(()=>coordinator.checkEditor(1,role,{sessionId:'unattested-session',reloads:0}),error=>error.code==='editor-discontinuity');
  coordinator.checkEditor(1,role,{sessionId:'new-session',reloads:0});
  identity.sourceCommit='e'.repeat(40);
  await assert.rejects(coordinator.restartActor(1,role),error=>error.code==='restart-identity-mismatch');
});

test('undo redo plan requires ordered evidence from all four editors and one final operation each', async()=>{
  const config=makeConfig({rounds:1});config.undoRedo=true;
  const summary=await new Coordinator(config).run();assert.equal(summary.status,'passed');assert.equal(summary.acceptance,'none');
  assert.equal(planRounds(42,1,'append',undefined,true)[0].edits.filter(e=>e.undoRedo).length,4);
  assert.throws(()=>validateConfig({...config,sustainedTyping:{chunks:2,intervalMs:25}}),/undoRedo/);
  assert.throws(()=>validateConfig({...config,pattern:'unicode'}),/undoRedo/);
});
test('undo redo rejects absent wrong actor skipped and content loss evidence', async()=>{
  for(const fault of ['history-missing','history-wrong-role','history-skip','history-loss']){
    const config=makeConfig({rounds:1,faults:{'pc-web':fault}});config.undoRedo=true;
    const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,'history-progress-invalid',fault);assert.equal(summary.roundsCompleted,0);
  }
});
test('failed history retains valid confirmed prefix and uncertain attempted action',async()=>{
  const config=makeConfig({rounds:1,faults:{'mac-app':'history-prefix-fail'}});config.undoRedo=true;
  const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,'actor-failed');
  const lines=readFileSync(join(summary.outputDir,'results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const prefix=lines.find(l=>l.type==='history-prefix-failure');assert.equal(prefix.valid,true);assert.equal(prefix.historyProgress.stages.length,1);assert.equal(prefix.historyProgress.attemptedStage,'undo');
});

test('multi-field source protocol requires all six full snapshots and twelve role bound field operations',async()=>{
 const config=makeConfig({rounds:1});config.multiField=true;
 const coordinator=new Coordinator(config),summary=await coordinator.run();assert.equal(summary.status,'passed');assert.equal(summary.acceptance,'none');assert.match(summary.finalDocumentHash,/^[a-f0-9]{64}$/);assert.equal(coordinator.roundResults[0].fieldEditCount,12);
 for(const role of ROLES)assert.equal(createHash('sha256').update(readFileSync(join(summary.outputDir,'adapters',role+'.last-document.json'))).digest('hex'),summary.finalDocumentHash);
 assert.throws(()=>validateConfig({...config,undoRedo:true}),/multiField/);
 assert.throws(()=>validateConfig({...config,rounds:0,expectedBaselineHash:'a'.repeat(64)}),/expectedDocumentHash/);
});
test('multi-field refuses absent full snapshot, UI snapshot mismatch and wrong or missing input actor evidence',async()=>{
 for(const [fault,code] of [['field-missing-document','document-state-invalid'],['field-body-mismatch','document-state-invalid'],['field-wrong-role','field-progress-invalid'],['field-missing-progress','field-progress-invalid']]){
  const config=makeConfig({rounds:1,faults:{'pc-web':fault}});config.multiField=true;
  const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,code,fault);assert.equal(summary.roundsCompleted,0);
 }
});
test('multi-field failure retains first field prefix and second uncertain field action',async()=>{
 const config=makeConfig({rounds:1,faults:{'mac-app':'field-prefix-fail'}});config.multiField=true;
 const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,'actor-failed');assert.equal(summary.failure.detail.fieldProgress.fields.length,1);assert.equal(summary.failure.detail.fieldProgress.attemptedField,'r1-mac-app-subtitle');
});

test('browser crash restart reattests fresh generation and explicitly reconnects held offline input',async()=>{
 const config=makeConfig({rounds:2});config.restart={role:'mac-web',round:1};config.offline={role:'mac-web',round:1};
 const summary=await new Coordinator(config).run();assert.equal(summary.status,'passed');assert.equal(summary.acceptance,'none');
 const lines=readFileSync(join(summary.outputDir,'results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);const restart=lines.find(line=>line.type==='restart');assert.equal(restart.role,'mac-web');assert.equal(restart.crash.method,'SIGKILL');assert.equal(restart.reconnectByRestart,true);
});
test('browser restart refuses graceful close and false offline continuity evidence',async()=>{
 for(const fault of ['browser-graceful','browser-offline-lie']){const config=makeConfig({rounds:1,faults:{'pc-web':fault}});config.restart={role:'pc-web',round:1};const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,'restart-crash-evidence-invalid',fault);assert.equal(summary.roundsCompleted,0);}
});
test('browser restart rechecks actual source principal assets and fresh attested session',async()=>{
 const config=makeConfig({mode:'real',rounds:1}),coordinator=new Coordinator(config);coordinator.openOutput();const role='mac-web';config.restart={role,round:1};
 const identity=structuredClone(config.expectedIdentities[role]);delete identity.sourceCommit;
 coordinator.editorBaseline[role]={sessionId:'old-browser-session',reloads:0};coordinator.attestations[role]={machineId:'actual-mac'};coordinator.adapters.set(role,{send(){}});
 const reply={type:'restart',round:1,generation:2,online:true,reconnectByRestart:false,crash:{pid:345678,method:'SIGKILL',exited:true,profileScopeHash:'a'.repeat(64),unapprovedField:'never-retain'},attestation:{type:'attest',round:0,mode:'real',adapter:'browser-source-unit',machineId:'actual-mac',workspaceId:config.fixture.workspaceId,itemId:config.fixture.itemId,generation:2,sessionId:'new-browser-session',identity}};
 coordinator.collect=async()=>new Map([[role,reply]]);await coordinator.restartActor(1,role);assert.equal(JSON.stringify(coordinator.restartEvidence[role]).includes('never-retain'),false);assert.throws(()=>coordinator.checkEditor(1,role,{sessionId:'wrong-browser-session',reloads:0}),error=>error.code==='editor-discontinuity');
 for(const change of [{principalScopeHash:'c'.repeat(64)},{driverSourceCommit:'d'.repeat(40)},{artifacts:{driver:'e'.repeat(64)}},{browserVersion:'unexpected-version'},{deploymentId:'unexpected-build'}]){reply.attestation.identity={...identity,...change};await assert.rejects(coordinator.restartActor(1,role),error=>error.code==='restart-identity-mismatch');}
});

test('ordinary file in-place and rapid atomic modes account every chunk and all six full documents',async()=>{
 for(const mode of ['in-place','atomic']){const config=makeConfig({rounds:1});config.fileWrites={role:'mac-cli',mode,writes:3,intervalMs:10};const coordinator=new Coordinator(config),summary=await coordinator.run();assert.equal(summary.status,'passed');assert.equal(summary.acceptance,'none');assert.match(summary.finalDocumentHash,/^[a-f0-9]{64}$/);assert.equal(coordinator.roundResults[0].writeSuboperationCount,8);}
});
test('ordinary file sequence rejects wrong actor skipped ordinal wrong readback and wrong inode proof',async()=>{
 for(const fault of ['write-wrong-role','write-skipped','write-readback','write-inode']){const config=makeConfig({rounds:1,faults:{'mac-cli':fault}});config.fileWrites={role:'mac-cli',mode:'in-place',writes:3,intervalMs:10};const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,'write-progress-invalid',fault);assert.equal(summary.roundsCompleted,0);}
});
test('uncertain file write retains confirmed suboperations and attempted incomplete write',async()=>{
 const config=makeConfig({rounds:1,faults:{'mac-cli':'write-prefix-fail'}});config.fileWrites={role:'mac-cli',mode:'in-place',writes:3,intervalMs:10};const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,'actor-failed');assert.equal(summary.failure.detail.writeProgress.writes.length,1);assert.equal(summary.failure.detail.writeProgress.attemptedWrite.phase,'writing');
 assert.throws(()=>validateConfig({...config,fileWrites:{...config.fileWrites,writes:9}}),/fileWrites/);assert.throws(()=>validateConfig({...config,fileWrites:{...config.fileWrites,role:'mac-app'}}),/fileWrites/);assert.throws(()=>validateConfig({...config,multiField:true}),/fileWrites/);
});
test('interleaved file write chunks preserve baseline without requiring concatenated arbitrary CRDT order',()=>{
 const config=makeConfig({rounds:1});config.fileWrites={role:'mac-cli',mode:'atomic',writes:3,intervalMs:10};const coordinator=new Coordinator(config);coordinator.baseline='Existing fixture text.\n';const edits=planRounds(42,1,'append',undefined,undefined,undefined,config.fileWrites)[0].edits;
 const chunks=edits.map(edit=>edit.fileWriteSequence?.chunks??[edit.text]);const text=coordinator.baseline+Array.from({length:3},(_,index)=>chunks.map(values=>values[index]??'').join('')).join('');const ids=edits.map(edit=>edit.id).sort();assert.doesNotThrow(()=>coordinator.checkRoundContent(new Map(ROLES.map(role=>[role,{text,editIds:ids}])),1,ids));
});

test('malformed repair runs held peer probes without accepted fault edits',async()=>{for(const kind of ['truncated-zip','invalid-document-json']){const config=makeConfig({rounds:2});config.malformedRepair={role:'mac-cli',kind,holdMs:100};const coordinator=new Coordinator(config),summary=await coordinator.run();assert.equal(summary.status,'passed',JSON.stringify(summary.failure));assert.equal(summary.acceptance,'none');assert.match(summary.finalDocumentHash,/^[a-f0-9]{64}$/);assert.equal(coordinator.roundResults[1].editCount,12);assert.equal(coordinator.roundResults[1].faultCount,2);}});
test('malformed missing source and wrong actor fail and retain cleanup evidence',async()=>{for(const fault of ['malformed-missing','malformed-wrong-role','malformed-repair-fail']){const config=makeConfig({rounds:1,faults:{'mac-cli':fault}});config.malformedRepair={role:'mac-cli',kind:'truncated-zip',holdMs:100};const summary=await new Coordinator(config).run();assert.equal(summary.status,'failed',fault);assert.equal(summary.roundsCompleted,0);const events=readFileSync(join(summary.outputDir,'results.jsonl'),'utf8');assert.match(events,/malformed-cleanup/);}});
test('malformed strict config rejects unsupported combinations and reopen without full hash',()=>{for(const patch of [{holdMs:99},{role:'mac-app'},{kind:'pretend'},{extra:true}])assert.throws(()=>validateConfig({...makeConfig({rounds:1}),malformedRepair:{role:'mac-cli',kind:'truncated-zip',holdMs:100,...patch}}),/malformedRepair/);assert.throws(()=>validateConfig({...makeConfig({rounds:0}),malformedRepair:{role:'pc-cli',kind:'truncated-zip',holdMs:100}}),/expectedDocumentHash/);assert.throws(()=>validateConfig({...makeConfig({rounds:1}),undoRedo:true,malformedRepair:{role:'pc-cli',kind:'truncated-zip',holdMs:100}}),/malformedRepair/);});

test('malformed held peer semantic/lifetime/operation loss fails before ordinary edits',async()=>{for(const fault of ['malformed-peer-loss','malformed-peer-reload','malformed-peer-id']){const config=makeConfig({rounds:1,faults:{'pc-web':fault}});config.malformedRepair={role:'mac-cli',kind:'invalid-document-json',holdMs:100};const summary=await new Coordinator(config).run();assert.equal(summary.status,'failed',fault);assert.equal(summary.roundsCompleted,0);assert.match(readFileSync(join(summary.outputDir,'results.jsonl'),'utf8'),/malformed-cleanup/);}});
test('malformed repair receipt cannot claim wrong repaired bytes',async()=>{const config=makeConfig({rounds:1,faults:{'pc-cli':'malformed-repair-hash'}});config.malformedRepair={role:'pc-cli',kind:'truncated-zip',holdMs:100};const summary=await new Coordinator(config).run();assert.equal(summary.failure.code,'malformed-repair-proof');assert.equal(summary.roundsCompleted,0);});

test('normal pc-app close observes real protocol traffic and gracefully reopens all6',async()=>{const config=makeConfig({rounds:1});config.closeDuringTraffic={role:'pc-app',trafficRole:'mac-web',chunks:5,intervalMs:100};const coordinator=new Coordinator(config),summary=await coordinator.run();assert.equal(summary.status,'passed',JSON.stringify(summary.failure));assert.equal(summary.acceptance,'none');assert.equal(coordinator.roundResults[0].editCount,6);assert.match(summary.finalDocumentHash,/^[a-f0-9]{64}$/);assert.match(readFileSync(join(summary.outputDir,'results.jsonl'),'utf8'),/observedChunksDuringClose/);});
test('normal close refuses insufficient overlap missing/wrong progress refusal and wrong reopen lifecycle',async()=>{for(const [role,fault]of [['pc-app','close-fast'],['pc-app','close-refuse'],['pc-app','close-reopen-wrong-lifecycle'],['mac-web','close-no-progress'],['mac-web','close-wrong-progress'],['mac-web','close-missing-last']]){const config=makeConfig({rounds:1,faults:{[role]:fault}});config.closeDuringTraffic={role:'pc-app',trafficRole:'mac-web',chunks:4,intervalMs:100};const summary=await new Coordinator(config).run();assert.equal(summary.status,'failed',fault);assert.equal(summary.roundsCompleted,0,fault);}});
test('close traffic strict combinations and full-document reopen pins are mandatory',()=>{for(const patch of [{role:'mac-web'},{trafficRole:'mac-cli'},{chunks:3},{intervalMs:99},{extra:true}])assert.throws(()=>validateConfig({...makeConfig({rounds:1}),closeDuringTraffic:{role:'pc-app',trafficRole:'pc-web',chunks:4,intervalMs:100,...patch}}),/closeDuringTraffic/);assert.throws(()=>validateConfig({...makeConfig({rounds:0}),closeDuringTraffic:{role:'pc-app',trafficRole:'pc-web',chunks:4,intervalMs:100}}),/expectedDocumentHash/);});

test('close traffic preserves uncertain peer input prefix when normal close has already begun',async()=>{const config=makeConfig({rounds:1,faults:{'mac-web':'input-prefix-fail'}});config.closeDuringTraffic={role:'pc-app',trafficRole:'mac-web',chunks:4,intervalMs:100};const summary=await new Coordinator(config).run();assert.equal(summary.status,'failed');assert.equal(summary.failure.code,'actor-failed');assert.equal(summary.failure.detail.inputProgress.chunks.length,2);assert.equal(summary.roundsCompleted,0);});

test('Mac normal close retains actual session/process generation while reopening window cycle2',async()=>{const config=makeConfig({rounds:1});config.closeDuringTraffic={role:'mac-app',trafficRole:'pc-web',chunks:5,intervalMs:100};const summary=await new Coordinator(config).run();assert.equal(summary.status,'passed',JSON.stringify(summary.failure));assert.equal(summary.acceptance,'none');const events=readFileSync(join(summary.outputDir,'results.jsonl'),'utf8');assert.match(events,/mac-normal-window-close/);assert.match(events,/retained-window-reopen/);assert.doesNotMatch(events,/"lifecycle":"normal-close-reopen"/);});
test('Mac window close rejects missing real close event/own intent/durability and changed retained lifetime',async()=>{for(const fault of ['mac-close-no-event','mac-close-own-missing','mac-close-idle','mac-window-process-restart','mac-window-remount','mac-window-reload']){const config=makeConfig({rounds:1,faults:{'mac-app':fault}});config.closeDuringTraffic={role:'mac-app',trafficRole:'mac-web',chunks:4,intervalMs:100};const summary=await new Coordinator(config).run();assert.equal(summary.status,'failed',fault);assert.equal(summary.roundsCompleted,0,fault);}});

test('browser normal close is isolated, recorded, and keeps six-client edit accounting',async()=>{
 const config=makeConfig({rounds:1});config.browserClose={role:'mac-web',round:1};
 const summary=await new Coordinator(config).run();assert.equal(summary.status,'passed');assert.equal(summary.acceptance,'none');assert.equal(summary.roundsCompleted,1);assert.deepEqual(summary.scenario.browserClose,config.browserClose);
 const lines=readFileSync(join(summary.outputDir,'results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);const restart=lines.find(line=>line.type==='restart');assert.equal(restart.lifecycle,'normal-close-reopen');assert.equal(restart.normalClose.method,'normal-close');assert.equal(restart.crash,undefined);assert.equal(lines.filter(line=>line.type==='round')[0].editCount,6);
 for(const extra of [{offline:{role:'mac-web',round:1}},{restart:{role:'mac-web',round:1}},{undoRedo:true},{multiField:true},{rounds:2},{browserClose:{role:'pc-app',round:1}},{browserClose:{role:'pc-web',round:2}},{browserClose:{role:'pc-web',round:1,force:true}}])assert.throws(()=>validateConfig({...config,...extra}),/browserClose/);
});
test('browser normal close refuses crash or missing actual page-close proof',async()=>{
 for(const fault of ['browser-normal-crash','browser-page-not-closed','close-reopen-wrong-lifecycle']){const config=makeConfig({rounds:1,faults:{'pc-web':fault}});config.browserClose={role:'pc-web',round:1};const result=await new Coordinator(config).run();assert.equal(result.status,'failed',fault);assert.equal(result.roundsCompleted,0,fault);assert.equal(result.acceptance,'none');}
});

test('real configured guarded browser is retained without shutdown or signals',async()=>{
 const {EventEmitter}=await import('node:events');const config=makeConfig({rounds:1,mode:'real'});config.browserClose={role:'mac-web',round:1};
 const coordinator=new Coordinator(config),actor=new EventEmitter();let retains=0,stops=0;actor.role='mac-web';actor.retainForReview=()=>{retains++;return{driverHostPid:345679};};actor.stop=async()=>{stops++;return{code:0};};coordinator.adapters.set('mac-web',actor);coordinator.openOutput();
 const wait=coordinator.collect(1,'restart',['mac-web']);actor.emit('message',{type:'error',round:1,message:'production guard retained',retained:{schemaVersion:1,driverPid:345679,browserPid:345678,profileScopeHash:'a'.repeat(64),pageRetained:true,contextRetained:true}});
 await assert.rejects(wait,error=>error.code==='actor-failed');await coordinator.stopAdapters();assert.equal(retains,1);assert.equal(stops,0);assert.equal(coordinator.retainedActors['mac-web'].browserPid,345678);
});

test('unknown real normal-close outcome retains known child instead of escalating cleanup',async()=>{
 const {EventEmitter}=await import('node:events');const config=makeConfig({rounds:1,mode:'real',timeoutMs:100});config.browserClose={role:'pc-web',round:1};
 const coordinator=new Coordinator(config),actor=new EventEmitter();let retains=0,stops=0;actor.role='pc-web';actor.send=()=>true;actor.retainForReview=()=>{retains++;return{driverHostPid:345679};};actor.stop=async()=>{stops++;};coordinator.adapters.set('pc-web',actor);coordinator.openOutput();
 await assert.rejects(coordinator.restartActor(1,'pc-web',true),error=>error.code==='timeout');await coordinator.stopAdapters();assert.equal(retains,1);assert.equal(stops,0);assert.equal(coordinator.retainedActors['pc-web'].driverHostPid,345679);assert.equal(coordinator.retainedActors['pc-web'].browserOwnershipUnverified,true);assert.equal(coordinator.retainedActors['pc-web'].browserPid,undefined);
});

const folderScenario={role:'mac-cli',round:1,source:'Six-client acceptance folder 12345678-1234-1234-1234-123456789abc',destination:'six-client acceptance folder 12345678-1234-1234-1234-123456789abc',emptyDescendants:['Empty','Empty/Nested']};
test('folder case scenario accounts six edits plus one ordinary directory move without claiming physical acceptance',async()=>{
 const config={...makeConfig({rounds:1}),folderCaseMove:folderScenario};
 const result=await new Coordinator(config).run();
 assert.equal(result.status,'passed',JSON.stringify(result.failure));assert.equal(result.acceptance,'none');const events=readFileSync(join(result.outputDir,'results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(result.roundsCompleted,1);assert.equal(events.filter(e=>e.type==='folder-case-move').length,1);assert.equal(result.folderCaseEvidence.stableSamples,3);
});
test('folder case scenario refuses lost bytes, directory identity, empty descendants and recovery dialogs',async()=>{
 for(const fault of ['folder-bytes','folder-identity','folder-empty','folder-dialog']){
  const config={...makeConfig({rounds:1,faults:{'mac-app':fault}}),folderCaseMove:folderScenario};
  const result=await new Coordinator(config).run();assert.equal(result.status,'failed',fault);assert.equal(result.acceptance,'none');
 }
});

const leafScenario={role:'mac-cli',round:1,source:'Six-client acceptance folder 12345678-1234-1234-1234-123456789abc/Six-client acceptance simulated fixture.textpack',destination:'Six-client acceptance folder 12345678-1234-1234-1234-123456789abc/Six-client acceptance simulated fixture moved.textpack'};
test('leaf scenario moves before six normal edits, accounts separate move and final paths without physical claim',async()=>{
 const result=await new Coordinator({...makeConfig({rounds:1}),leafMove:leafScenario}).run();assert.equal(result.status,'passed',JSON.stringify(result.failure));assert.equal(result.acceptance,'none');assert.equal(result.roundsCompleted,1);assert.equal(result.leafMoveEvidence.stableSamples,3);const events=readFileSync(join(result.outputDir,'results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.type==='leaf-move').length,1);assert.equal(events.filter(e=>e.type==='leaf-move-final').length,1);assert.ok(events.findIndex(e=>e.type==='leaf-move')<events.findIndex(e=>e.type==='convergence-sample'));assert.equal(Object.keys(result.leafMoveEvidence.final).length,6);
});
test('leaf scenario refuses changed snapshot, identity, stale live path and review dialog',async()=>{for(const fault of ['leaf-bytes','leaf-identity','leaf-path','leaf-dialog']){const result=await new Coordinator({...makeConfig({rounds:1,faults:{'mac-app':fault}}),leafMove:leafScenario}).run();assert.equal(result.status,'failed',fault);assert.equal(result.acceptance,'none');}});
test('leaf scenario never combines faults or broadens independent reopen evidence',()=>{for(const patch of [{rounds:2},{folderCaseMove:folderScenario},{browserClose:{role:'mac-web',round:1}},{multiField:true},{rounds:0}])assert.throws(()=>validateConfig({...makeConfig({rounds:1}),leafMove:leafScenario,...patch}));});

test('lost ACK scenario refuses combined faults, simulated claims and incomplete fixture pins',()=>{
 const base={...makeConfig({mode:'real',rounds:1}),lostAck:{role:'mac-web',round:1},expectedAssetHashes:{'assets/a.bin':'a'.repeat(64)}};
 assert.doesNotThrow(()=>validateConfig(base));
 for(const patch of [{mode:'simulated'},{rounds:2},{leafMove:leafScenario},{folderCaseMove:folderScenario},{multiField:true},{offline:{role:'pc-web',round:1}},{browserClose:{role:'mac-web',round:1}},{expectedAssetHashes:{}},{rounds:0}])assert.throws(()=>validateConfig({...base,...patch}));
});

test('lost ACK scheduler keeps six semantic edits separate and observes all six after replay (simulated only)',async()=>{
 const {ProcessAdapter}=await import('./adapter.mjs');const assets={'assets/data.bin':'a'.repeat(64)};let faultId,editId;
 const coordinator=new Coordinator(makeConfig({rounds:1}),{adapterFactory:(role,c)=>{
  const actor=new ProcessAdapter(role,c.command,{cwd:c.cwd,env:c.env});const send=actor.send.bind(actor),emit=actor.emit.bind(actor);
  actor.emit=(type,m,...rest)=>{if(type==='message'&&m.type==='state')m.assetHashes=assets;return emit(type,m,...rest);};
  actor.send=m=>{if(m.type==='armLostAck'){faultId=m.faultId;editId=m.edit.id;queueMicrotask(()=>emit('message',{type:'lost-ack-armed',round:1,proof:{version:1,faultId,editId,phase:'armed',operationId:null,epoch:null,requestSha256:null,responseSha256:null,responseStatus:null,serverArchiveSha256:null,serverRevision:null,serverDocumentSha256:null,serverAssetHashes:null,dropped:0,retries:0,serverCommitted:false,exactRetry:false}}));return;}
   if(m.type==='observeLostAck'){queueMicrotask(()=>emit('message',{type:'lost-ack-state',round:1,proof:{version:1,faultId,editId,phase:'replayed',operationId:'unit-only',epoch:1,requestSha256:'b'.repeat(64),responseSha256:'c'.repeat(64),responseStatus:200,serverArchiveSha256:'f'.repeat(64),serverRevision:'d'.repeat(64),serverDocumentSha256:'e'.repeat(64),serverAssetHashes:assets,dropped:1,retries:1,serverCommitted:true,exactRetry:true}}));return;}return send(m);};return actor;
 }});
 // Injection exercises scheduling only. Public validation correctly refuses this
 // scenario in simulated mode; fake actors never qualify physical acceptance.
 coordinator.config.lostAck={role:'mac-web',round:1};coordinator.config.expectedAssetHashes=assets;
 const result=await coordinator.run();assert.equal(result.status,'passed',JSON.stringify(result.failure));assert.equal(result.acceptance,'none');assert.equal(coordinator.roundResults[0].editCount,6);assert.equal(result.lostAckEvidence.faultCount,1);assert.equal(result.lostAckEvidence.postRetrySamples,3);
 const events=readFileSync(join(result.outputDir,'results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.type==='lost-ack-post-retry-sample').length,3);assert.ok(events.findIndex(e=>e.type==='lost-ack-armed')<events.findIndex(e=>e.type==='convergence-sample'));
});

const mixedSpec={version:1,rounds:['plain','cli-writes','typing','fields','history'].map(kind=>({kind}))};
test('compatible mixed schedule executes an immutable five-kind prefix with one mounted cohort (simulated only)', async () => {
  const coordinator = new Coordinator({
    ...makeConfig({
      rounds: 5
    }),
    mixedSchedule: mixedSpec
  });
  const result = await coordinator.run();
  assert.equal(result.status, 'passed', JSON.stringify(result.failure));
  assert.equal(result.acceptance, 'none');
  assert.equal(result.roundsCompleted, 5);
  assert.deepEqual(coordinator.roundResults.map(r => r.scheduleKind), mixedSpec.rounds.map(r => r.kind));
  assert.equal(result.mixedScheduleEvidence.totals.semanticAdditions, 49);
  assert.equal(result.mixedScheduleEvidence.totals.driverActions, 57);
  assert.equal(result.mixedScheduleEvidence.totals.cliPackWrites, 11);
  const plan = JSON.parse(readFileSync(join(result.outputDir, 'plan.json'), 'utf8'));
  assert.equal(plan.mixedScheduleEvidence.sha256, result.mixedScheduleEvidence.sha256);
  assert.equal(plan.rounds.length, 5);
  const lines = readFileSync(join(result.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.filter(e => e.type === 'mixed-schedule-preflight').length, 1);
  assert.equal(lines.filter(e => e.type === 'round').length, 5);
});
test('mixed schedule refuses combined flags, descriptor/round drift and unbounded input before launch', () => {
  const base = {
    ...makeConfig({
      rounds: 5
    }),
    mixedSchedule: mixedSpec
  };
  assert.doesNotThrow(() => validateConfig(base));
  for (const patch of [{
    rounds: 4
  }, {
    fileWrites: {
      role: 'mac-cli',
      mode: 'atomic',
      writes: 2,
      intervalMs: 25
    }
  }, {
    lostAck: {
      role: 'mac-web',
      round: 1
    }
  }, {
    multiField: true
  }, {
    pattern: 'same-position'
  }, {
    offline: {
      role: 'mac-web',
      round: 1
    }
  }, {
    mixedSchedule: {
      version: 1,
      rounds: Array(100).fill({
        kind: 'typing'
      })
    }
  }]) assert.throws(() => validateConfig({
    ...base,
    ...patch
  }));
});

test('mixed preflight refuses projected JSONL overflow before first prepare or edit (simulated only)', async () => {
  const {
    ProcessAdapter
  } = await import('./adapter.mjs');
  let mutations = 0;
  const coordinator = new Coordinator({
    ...makeConfig({
      rounds: 1
    }),
    mixedSchedule: {
      version: 1,
      rounds: [{
        kind: 'plain'
      }]
    }
  }, {
    adapterFactory: (role, c) => {
      const actor = new ProcessAdapter(role, c.command, {
          cwd: c.cwd,
          env: c.env
        }),
        emit = actor.emit.bind(actor),
        send = actor.send.bind(actor);
      actor.emit = (type, m, ...args) => {
        if (type === 'message' && m.type === 'state') {
          m.text = 'x'.repeat(40000);
          m.documentSnapshot.content.body = m.text;
          m.documentSnapshot.content.fields = {
            blob: 'x'.repeat(200000)
          };
        }
        return emit(type, m, ...args);
      };
      actor.send = m => {
        if (['prepare', 'edit'].includes(m.type)) mutations++;
        return send(m);
      };
      return actor;
    }
  });
  const result = await coordinator.run();
  assert.equal(result.status, 'failed');
  assert.match(result.failure.detail.message, /JSONL line/);
  assert.equal(result.roundsCompleted, 0);
  assert.equal(mutations, 0);
  assert.equal(result.acceptance, 'none');
});
test('mixed independent reopen recomputes exact immutable plan hash before any actor starts', async () => {
  const {
    createMixedSchedule
  } = await import('./mixed-schedule.mjs');
  const base = makeConfig({
    mode: 'real',
    rounds: 0
  });
  const plan = createMixedSchedule(mixedSpec, base.seed, planRounds(base.seed, 5));
  const evidence = {
    version: 1,
    seed: base.seed,
    sha256: plan.sha256,
    roundCount: 5,
    totals: plan.totals
  };
  const config = {
    ...base,
    mixedSchedule: mixedSpec,
    expectedBaselineHash: 'a'.repeat(64),
    expectedDocumentHash: 'd'.repeat(64),
    expectedAssetHashes: {
      'assets/data.bin': 'b'.repeat(64)
    }
  };
  const receipt = {
    mode: 'real',
    status: 'passed',
    acceptance: 'six-client-compatible-mixed-schedule',
    roundsCompleted: 5,
    fixture: base.fixture,
    finalHash: config.expectedBaselineHash,
    finalDocumentHash: config.expectedDocumentHash,
    expectedAssetHashes: config.expectedAssetHashes,
    scenario: {
      mixedSchedule: mixedSpec
    },
    mixedScheduleEvidence: evidence,
    attestations: Object.fromEntries(ROLES.map(role => [role, {
      identity: base.expectedIdentities[role]
    }]))
  };
  const directory = mkdtempSync(join(tmpdir(), 'texttext-mixed-reopen-'));
  config.reopenReceipt = join(directory, 'prior.json');
  writeFileSync(config.reopenReceipt, JSON.stringify(receipt));
  assert.doesNotThrow(() => new Coordinator(config));
  for (const changed of [{
    ...receipt,
    mixedScheduleEvidence: {
      ...evidence,
      sha256: 'f'.repeat(64)
    }
  }, {
    ...receipt,
    roundsCompleted: 4
  }, {
    ...receipt,
    mixedScheduleEvidence: {
      ...evidence,
      totals: {
        ...plan.totals,
        semanticAdditions: 1
      }
    }
  }]) {
    writeFileSync(config.reopenReceipt, JSON.stringify(changed));
    assert.throws(() => new Coordinator(config), /immutable plan/);
  }
});

test('mixed later-round failures retain actual scheduled prefixes instead of recomputing plain history', async () => {
  for (const [kind, role, fault, event] of [['typing', 'mac-web', 'input-prefix-fail', 'input-prefix-failure'], ['fields', 'mac-app', 'field-prefix-fail', 'field-prefix-failure'], ['history', 'mac-app', 'history-prefix-fail', 'history-prefix-failure'], ['cli-writes', 'mac-cli', 'write-prefix-fail', 'write-prefix-failure']]) {
    const config = {
      ...makeConfig({
        rounds: 2,
        faults: {
          [role]: fault
        }
      }),
      mixedSchedule: {
        version: 1,
        rounds: [{
          kind: 'plain'
        }, {
          kind
        }]
      }
    };
    const result = await new Coordinator(config).run();
    assert.equal(result.status, 'failed', kind);
    assert.equal(result.acceptance, 'none');
    assert.equal(result.failure.code, 'actor-failed', JSON.stringify(result.failure));
    assert.equal(result.roundsCompleted, 1);
    const events = readFileSync(join(result.outputDir, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const prefix = events.find(e => e.type === event);
    assert.equal(prefix.valid, true, kind);
    assert.equal(prefix.round, 2);
  }
});
test('mixed complete snapshot cannot hide missing typed suboperation evidence', async () => {
  const config = {
    ...makeConfig({
      rounds: 2,
      faults: {
        'mac-web': 'input-early-final'
      }
    }),
    mixedSchedule: {
      version: 1,
      rounds: [{
        kind: 'plain'
      }, {
        kind: 'typing'
      }]
    }
  };
  const result = await new Coordinator(config).run();
  assert.equal(result.status, 'failed');
  assert.equal(result.failure.code, 'input-progress-invalid');
  assert.equal(result.roundsCompleted, 1);
  assert.equal(result.acceptance, 'none');
});

test('mixed reused future subtitle marker refuses before first prepare/edit (simulated only)', async () => {
  const {
    ProcessAdapter
  } = await import('./adapter.mjs');
  let mutations = 0;
  const coordinator = new Coordinator({
    ...makeConfig({
      rounds: 2
    }),
    mixedSchedule: {
      version: 1,
      rounds: [{
        kind: 'plain'
      }, {
        kind: 'fields'
      }]
    }
  }, {
    adapterFactory: (role, c) => {
      const actor = new ProcessAdapter(role, c.command, {
          cwd: c.cwd,
          env: c.env
        }),
        emit = actor.emit.bind(actor),
        send = actor.send.bind(actor);
      actor.emit = (type, m, ...args) => {
        if (type === 'message' && m.type === 'state') m.documentSnapshot.content.subtitle += '⟦mac-app:r2:subtitle⟧';
        return emit(type, m, ...args);
      };
      actor.send = m => {
        if (['prepare', 'edit'].includes(m.type)) mutations++;
        return send(m);
      };
      return actor;
    }
  });
  const result = await coordinator.run();
  assert.equal(result.status, 'failed');
  assert.match(result.failure.detail.message, /already|ambiguous/i);
  assert.equal(result.roundsCompleted, 0);
  assert.equal(mutations, 0);
  assert.equal(result.acceptance, 'none');
});

for (const driftSample of [2, 3]) test(`mixed later reopen sample ${driftSample} rejects subtitle/full-document drift despite stable body (simulated runtime path only)`, async () => {
  const {
      ProcessAdapter
    } = await import('./adapter.mjs'),
    {
      documentObservation
    } = await import('./multi-field.mjs');
  const snapshot = {
    schemaVersion: 1,
    content: {
      title: 'Six-client acceptance simulated fixture',
      subtitle: 'Existing subtitle.',
      body: 'Existing fixture text.\n',
      fields: {
        fixture: 'simulated-only'
      },
      tags: [],
      assets: []
    },
    presentation: {
      template: {
        id: 'texttext.article',
        version: 1
      },
      theme: {}
    }
  };
  const coordinator = new Coordinator({
    ...makeConfig({
      rounds: 2
    }),
    mixedSchedule: {
      version: 1,
      rounds: [{
        kind: 'plain'
      }, {
        kind: 'fields'
      }]
    }
  }, {
    adapterFactory: (role, c) => {
      const actor = new ProcessAdapter(role, c.command, {
          cwd: c.cwd,
          env: c.env
        }),
        emit = actor.emit.bind(actor);
      let observed = 0;
      actor.emit = (type, m, ...args) => {
        if (type === 'message' && m.type === 'state' && role === 'mac-web' && ++observed === driftSample) m.documentSnapshot.content.subtitle += ' stale subtitle';
        return emit(type, m, ...args);
      };
      return actor;
    }
  });
  // Only exercise the zero-round observation loop here. Separate constructor /
  // identity tests cover genuine prior physical receipt and plan attestation.
  coordinator.config.rounds = 0;
  coordinator.config.expectedBaselineHash = hashText(snapshot.content.body);
  coordinator.config.expectedDocumentHash = documentObservation(snapshot).hash;
  const result = await coordinator.run();
  assert.equal(result.status, 'failed', `sample${driftSample}`);
  assert.equal(result.acceptance, 'none');
  assert.equal(result.roundsCompleted, 0);
  assert.match(result.failure.detail.message ?? result.failure.code, /baseline|document|semantic/i);
});


const soakSpec = {version:1,durationMs:3600000,cadenceMs:30000};
test('finite dwell refuses nonmixed or shorter real prerequisite before actor startup', () => {
  assert.throws(()=>validateConfig({...makeConfig(),soak:soakSpec}),/mixedSchedule/);
  const config={...makeConfig({mode:'real',rounds:2}),soak:soakSpec,mixedSchedule:{version:1,rounds:[{kind:'plain'},{kind:'fields'}]}};
  assert.throws(()=>validateConfig(config),/100 real rounds/);
});
for (const fault of [null,'missing-id','old-id','duplicate','content','session','asset','last-content','capability']) test(`finite dwell correlated virtual-clock integration ${fault??'complete'} (no physical acceptance)`,async()=>{
  const {ProcessAdapter}=await import('./adapter.mjs');let now=100,soakRequests=0,mutations=0;
  const config={...makeConfig({rounds:2}),soak:soakSpec,mixedSchedule:{version:1,rounds:[{kind:'plain'},{kind:'fields'}]}};
  const coordinator=new Coordinator(config,{soakClock:()=>now,soakSleep:async ms=>{now+=ms;},adapterFactory:(role,c)=>{
    const actor=new ProcessAdapter(role,c.command,{env:c.env}),emit=actor.emit.bind(actor),send=actor.send.bind(actor);
    actor.send=m=>{if(m.soakSample)soakRequests++;if(['prepare','edit'].includes(m.type))mutations++;return send(m);};
    actor.emit=(type,m,...args)=>{
      if(type==='message'&&role==='mac-app'&&m.type==='attest'&&fault==='capability')delete m.finiteSoakCorrelation;
      if(type==='message'&&m.type==='state'&&m.soakSample&&role==='mac-app'){
        if(fault==='missing-id')delete m.soakSample;
        if(fault==='old-id')m.soakSample.id='previous:soak:0';
        if(fault==='content'||(fault==='last-content'&&m.soakSample?.id.endsWith(':120')))m.documentSnapshot.content.subtitle+='drift';
        if(fault==='session')m.editor.sessionId+='changed';
        if(fault==='asset')m.documentSnapshot.content.assets=[{path:'unknown.bin'}];
        if(fault==='duplicate'){emit(type,m,...args);return emit(type,m,...args);}
      }
      return emit(type,m,...args);
    };return actor;
  }});
  const result=await coordinator.run();
  assert.equal(result.acceptance,'none');
  if(fault){assert.equal(result.status,'failed');assert.equal(result.soakEvidence,undefined);if(fault==='capability')assert.equal(mutations,0);}
  else{assert.equal(result.status,'passed',JSON.stringify(result.failure));assert.equal(result.soakEvidence.samples,121);assert.equal(result.soakEvidence.acceptance,'partial-not-full-T24');assert.equal(result.soakEvidence.nativeIdleMutations,null);assert.equal(soakRequests,726);}
});

test('staged asset proof refuses before mutation even with claimed capabilities', async () => {
  for (const claimed of [false, true]) {
    const config = makeConfig({rounds:1});
    config.assetProof = {version:1};
    config.expectedAssetHashes = {'assets/photo.jpg':'a'.repeat(64)};
    let mutations=0;
    const {ProcessAdapter} = await import('./adapter.mjs');
    const coordinator = new Coordinator(config, {adapterFactory(role,c) {
      const actor=new ProcessAdapter(role,c.command,{env:c.env}), emit=actor.emit.bind(actor), send=actor.send.bind(actor);
      actor.send=message=>{if(['prepare','edit'].includes(message.type)) mutations++;return send(message);};
      actor.emit=(type,message,...args)=>{
        if(type==='message' && message.type==='attest' && claimed) message.binaryAssetObservation=1;
        return emit(type,message,...args);
      };
      return actor;
    }});
    const result=await coordinator.run();
    assert.equal(result.status,'failed');
    assert.match(JSON.stringify(result.failure), new RegExp(claimed ? 'asset-proof-adapters-unavailable' : 'asset-proof-capability-missing'));
    assert.equal(mutations,0);
  }
});
