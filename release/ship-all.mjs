import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { withCommittedPin } from './committed-pin.mjs';
import { assertReleaseCheckpoint, runReleaseStage } from './stage-checkpoint.mjs';
import { withParallelStage } from './parallel-stage.mjs';
import { signingPreflight } from './signing-preflight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let checkpoint = () => {};
function run(command, args, env = {}, onSuccess, stage = `${command} ${args[0] ?? ''}`.trim()) {
  try {
    runReleaseStage(checkpoint, command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }, onSuccess);
  } catch (error) {
    throw new Error(`${stage} failed: ${error.message}`, { cause: error });
  }
}
function output(command, args) { return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim(); }
const git = (...args) => output('git', args);
export function windowsArgs(mode, commit, runId, powerShell7Path = process.env.TEXTTEXT_WINDOWS_POWERSHELL7) {
  if (powerShell7Path && !/^[A-Za-z]:[\\/]/.test(powerShell7Path)) throw new Error('TEXTTEXT_WINDOWS_POWERSHELL7 must be an absolute Windows path.');
  const runtimeArgument = powerShell7Path ? ` -PowerShell7Path '${powerShell7Path.replaceAll("'", "''")}'` : '';
  const command = `& "$env:USERPROFILE/dev/texttext/windows/scripts/ship-all.ps1" -Mode ${mode} -Commit ${commit} -RunId ${runId}${runtimeArgument}`;
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'pc', 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
}
function windows(mode, commit, runId, onSuccess) {
  run('ssh', windowsArgs(mode, commit, runId), {}, onSuccess, `Windows ${mode}`);
}
function plist(path, key) { return output('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path]); }

export function preserveBuildCandidate(candidate, evidence) {
  if (!lstatSync(candidate, { throwIfNoEntry: false })) return;
  const retained = join(evidence, 'previous-mac-candidate.app');
  if (lstatSync(retained, { throwIfNoEntry: false })) throw new Error(`Retained candidate already exists: ${retained}`);
  renameSync(candidate, retained);
  console.log(`Previous Mac build candidate retained: ${retained}`);
}

export function deployVerifiedWeb(runStage, onSuccess) {
  // This invocation already ran the full release and sync suites. Validate their
  // exact-source receipts again; --skip-tests avoids rerunning those same gates.
  runStage('npx', ['tsx', 'scripts/verify-release.ts', '--check']);
  runStage('npm', ['run', 'test:sync:check']);
  runStage('npm', ['run', 'deploy:web', '--', '--skip-tests'], {}, onSuccess);
}

async function main() {
  process.chdir(root);
  if (process.argv.includes('--help')) {
    console.log('Usage: bash release/ship-all.sh\nBuild and deliver the same main commit to Oracle, this Mac and the existing pc SSH profile. Preserves the owner lockfile. Publishes no public Mac release.');
    return;
  }
  if (process.argv.length !== 2 || process.platform !== 'darwin') throw new Error('Run ship-all.sh without arguments on the Mac.');
  if (git('branch', '--show-current') !== 'main') throw new Error('Release requires main.');
  run('git', ['pull', '--ff-only']);
  const commit = git('rev-parse', 'HEAD');
  const runId = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${commit.slice(0, 8)}`;
  const evidence = join(root, '.texttext', 'ship-all', runId);
  mkdirSync(evidence, { recursive: true });
  const lock = join(root, '.texttext', 'ship-all.lock');
  writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' });
  const delivered = [];
  try {
    await withCommittedPin(root, evidence, async () => {
      const cancelFile = join(evidence, 'CANCEL');
      checkpoint = () => assertReleaseCheckpoint(root, commit, cancelFile);
      console.log(`To cancel safely after the current stage, create: ${cancelFile}`);
      checkpoint();
      process.env.TEXTTEXT_SIGN_ID = signingPreflight(evidence, process.env.TEXTTEXT_SIGN_ID);
      checkpoint();
      run('node', ['--test', 'release/committed-pin.test.mjs', 'release/stage-checkpoint.test.mjs', 'release/parallel-stage.test.mjs', 'release/signing-preflight.test.mjs', 'scripts/verify-sync.test.mjs', 'release/oracle/storage-preflight.test.mjs', 'windows/scripts/check-checkout.test.mjs']);
      run('python3', ['release/test_stopped_backup.py']);
      windows('Preflight', commit, runId);
      const installed = '/Applications/TextText.app';
      const version = plist('mac/Info.plist', 'CFBundleShortVersionString');
      const build = String(Math.max(Number(plist('mac/Info.plist', 'CFBundleVersion')), Number(plist(`${installed}/Contents/Info.plist`, 'CFBundleVersion'))) + 1);
      if (!/^[1-9][0-9]*$/.test(build)) throw new Error('Cannot allocate a fresh Mac build number.');
      run('codesign', ['--verify', '--strict', installed]);
      // Prepare both native candidates before changing any installed surface.
      const bundle = join(evidence, 'mirror-policy');
      mkdirSync(bundle);
      Object.assign(process.env, {
        TEXTTEXT_MIRROR_POLICY_BUNDLE: bundle,
        TEXTTEXT_RELEASE_GATE_RECEIPT: join(root, '.texttext/release-gate-receipt.json'),
        TEXTTEXT_WORKFLOW_CAPABILITY_RECEIPT: join(evidence, 'workflow-capability.json'),
        TEXTTEXT_BUILD_ATTESTATION: join(evidence, 'AppHealthBuildAttestation.json'),
        // The in-app agent is optional. A prior install's helper must not
        // become a prerequisite or silently enter the next product build.
        TEXTTEXT_EMBEDDED_CODEX_RUNTIME: '',
        TEXTTEXT_EMBEDDED_CODEX_VERSION: '',
        TEXTTEXT_STORE_LOCAL: '1', APP_VERSION: version, APP_BUILD_NUMBER: build,
        NEXT_DEPLOYMENT_ID: `texttext-all-${runId}`,
      });
      // Fail fast on the fixtures that previously stopped releases after a
      // Windows candidate had already been built. Full gates still run below.
      run('npx', ['tsc', '--noEmit'], {}, undefined, 'TypeScript preflight');
      run('npx', ['vitest', 'run', 'src/local-vault/windows-recovery-transport.test.ts'], {}, undefined, 'Windows recovery transport preflight');
      run('node', ['src/local-vault/__tests__/verify-web-browser.mjs'], {}, undefined, 'Web workspace browser preflight');
      run('node', ['src/local-vault/__tests__/mirror-policy.browser.mjs'], {}, undefined, 'Mirror policy producer');
      run('node', ['scripts/with-local-database.mjs', 'npx', 'tsx', 'scripts/verify-release.ts'], {}, undefined, 'Mac full release gate');
      run('npm', ['run', 'test:sync'], {}, undefined, 'Mac full sync gate');
      // Build both native candidates only after the full gates pass. Join the
      // Windows child before pin restoration or delivery if either build fails.
      await withParallelStage(checkpoint, 'ssh', windowsArgs('Build', commit, runId), { cwd: root, env: { ...process.env } }, () => {
        run('bash', ['mac/scripts/verify-workflow-capabilities.sh', process.env.TEXTTEXT_WORKFLOW_CAPABILITY_RECEIPT]);
        run('bash', ['mac/scripts/texttext-build-attestation.sh', process.env.TEXTTEXT_BUILD_ATTESTATION, version, build]);
        checkpoint();
        preserveBuildCandidate(join(root, 'mac/build/TextText.app'), evidence);
        run('bash', ['mac/scripts/build-store.sh'], {}, undefined, 'Mac candidate build');
        run('bash', ['mac/scripts/verify-app-health.sh', 'mac/build/TextText.app', version, build]);
      }, 'Windows candidate build');
      // Build a fresh archive after revalidating the genuine gate receipts.
      process.env.TEXTTEXT_ORACLE_ARTIFACT = '';
      deployVerifiedWeb(run, () => delivered.push({ surface: 'web', commit, buildId: process.env.NEXT_DEPLOYMENT_ID }));
      const running = spawnSync('pgrep', ['-x', 'TextText']);
      if (running.status === 0) run('osascript', ['-e', 'tell application id "app.texttext.mac" to quit']);
      else if (running.status !== 1) throw new Error('Could not inspect Mac app process.');
      for (let attempt = 0; attempt < 120; attempt++) {
        checkpoint();
        const stopped = spawnSync('pgrep', ['-x', 'TextText']);
        if (stopped.status === 1) break;
        if (stopped.status !== 0 || attempt === 119) throw new Error('Mac app did not quit normally; installation refused.');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const backup = join(homedir(), 'Library/Application Support/TextText/PreinstallBackups', `ship-all-${runId}`);
      run('python3', ['release/stopped-backup.py', backup]);
      run('bash', ['mac/scripts/install-local.sh'], {
        TEXTTEXT_EXPECTED_VERSION: version, TEXTTEXT_EXPECTED_BUILD: build,
        TEXTTEXT_PRESERVE_INSTALL_ARTIFACTS: '1', TEXTTEXT_TRASH_DIR: join(backup, 'previous-apps'),
      }, () => delivered.push({ surface: 'mac', commit, version, build, backup }));
      windows('Install', commit, runId, () => delivered.push({ surface: 'windows', commit }));
      console.log(JSON.stringify({ status: 'delivered', commit, delivered, acceptance: 'Real open/edit/save/normal-quit/reopen checks still required.' }, null, 2));
    });
  } finally {
    writeFileSync(join(evidence, 'delivery.json'), JSON.stringify({ commit, delivered }, null, 2));
    unlinkSync(lock);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
