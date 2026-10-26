import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertReleaseCheckpoint, runReleaseStage } from './stage-checkpoint.mjs';
import { withCommittedPin } from './committed-pin.mjs';
import { deployVerifiedWeb } from './ship-all.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'texttext-stage-checkpoint-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(root, 'mac'));
  writeFileSync(join(root, 'mac/Package.resolved'), 'committed');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  const cancelFile = join(root, 'CANCEL');
  const checkpoint = () => assertReleaseCheckpoint(root, commit, cancelFile);
  const run = (code, onSuccess) => runReleaseStage(checkpoint, process.execPath, ['-e', code], { cwd: root, stdio: 'pipe' }, onSuccess);
  return { root, cancelFile, run };
}

test('cancellation prevents the next child from starting', () => {
  const { root, cancelFile, run } = fixture();
  writeFileSync(cancelFile, '');
  assert.throws(() => run("require('fs').writeFileSync('started', '')"), /cancelled/);
  assert.equal(existsSync(join(root, 'started')), false);
});

test('cancellation lets the active child finish and records delivery before stopping', () => {
  const { root, run } = fixture();
  let delivered = false;
  assert.throws(() => run("const fs=require('fs'); fs.writeFileSync('CANCEL',''); setTimeout(()=>fs.writeFileSync('finished','yes'), 30)", () => { delivered = true; }), /cancelled/);
  assert.equal(readFileSync(join(root, 'finished'), 'utf8'), 'yes');
  assert.equal(delivered, true);
});

test('source edits during a child stop the release at that stage boundary', () => {
  const { run } = fixture();
  assert.throws(() => run("require('fs').writeFileSync('mac/Package.resolved','changed')"), /Source changed/);
});

test('child failure remains visible even when it also requests cancellation', () => {
  const { run } = fixture();
  assert.throws(() => run("require('fs').writeFileSync('CANCEL',''); process.exit(3)"), /failed \(3\)/);
});

test('cancellation unwinds committed pin preservation', async () => {
  const { root, run } = fixture();
  const pin = join(root, 'mac/Package.resolved');
  writeFileSync(pin, 'owner');
  await assert.rejects(withCommittedPin(root, join(root, 'evidence'), async () => {
    run("require('fs').writeFileSync('CANCEL','')");
  }), /cancelled/);
  assert.equal(readFileSync(pin, 'utf8'), 'owner');
});

test('web deployment refuses a failed release or sync receipt check', () => {
  for (const failedGate of ['scripts/verify-release.ts', 'test:sync:check']) {
    const calls = [];
    assert.throws(() => deployVerifiedWeb((command, args) => {
      calls.push(args);
      if (args.includes(failedGate)) throw new Error('Stale receipt');
    }), /Stale receipt/);
    assert.equal(calls.some(args => args.includes('deploy:web')), false);
  }
});

test('web deployment reuses gates only after both receipt checks pass', () => {
  const calls = [];
  let delivered = false;
  deployVerifiedWeb((command, args, env, onSuccess) => {
    calls.push([command, ...args]);
    onSuccess?.();
  }, () => { delivered = true; });
  assert.deepEqual(calls, [
    ['npx', 'tsx', 'scripts/verify-release.ts', '--check'],
    ['npm', 'run', 'test:sync:check'],
    ['npm', 'run', 'deploy:web', '--', '--skip-tests'],
  ]);
  assert.equal(delivered, true);
});

test('deterministic fixtures and full gates finish before native candidate builds', () => {
  const source = readFileSync(new URL('./ship-all.mjs', import.meta.url), 'utf8');
  const stages = [
    "['tsc', '--noEmit']",
    "['vitest', 'run', 'src/local-vault/windows-recovery-transport.test.ts']",
    "['src/local-vault/__tests__/verify-web-browser.mjs']",
    "['scripts/with-local-database.mjs', 'npx', 'tsx', 'scripts/verify-release.ts']",
    "['run', 'test:sync']",
    "withParallelStage(checkpoint, 'ssh', windowsArgs('Build'",
    "deployVerifiedWeb(run,",
  ];
  const positions = stages.map(stage => source.indexOf(stage, source.indexOf('async function main')));
  assert.ok(positions.every(position => position >= 0), 'every required stage remains present');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'no candidate build or deployment starts before the gates');
});

test('unified release does not require or inherit an embedded agent executable', () => {
  const source = readFileSync(new URL('./ship-all.mjs', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../mac/scripts/build-store.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /codesign.*runtime|test-embedded-codex-version\.sh|TextTextEmbeddedAgentVersion/);
  assert.match(source, /TEXTTEXT_EMBEDDED_CODEX_RUNTIME: ''/);
  assert.match(source, /TEXTTEXT_EMBEDDED_CODEX_VERSION: ''/);
  assert.doesNotMatch(store, /Refusing local Store build: set TEXTTEXT_EMBEDDED_CODEX_RUNTIME/);
});
