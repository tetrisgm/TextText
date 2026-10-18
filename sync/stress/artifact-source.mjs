// Human-invoked private build provenance. No installs, releases, jobs, keys or
// arbitrary command arrays. Fixed actor artifact paths cannot be redirected by
// a receipt to a different executable, Core library or UI bundle.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync, readlinkSync, realpathSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, join, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedFile, canonicalJSON, sha256 } from './identity-observation.mjs';
export function command(program, args, cwd, { capture = false, env = process.env, timeout = 20 * 60 * 1000 } = {}) {
  const result = spawnSync(program, args, { cwd, env, timeout, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Private build command failed: ${program.split(/[\\/]/).at(-1)}`);
  return result.stdout?.trim() ?? '';
}
export function sourceEntries(repository, commit) {
  requireOrdinaryGitEnvironment();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected a resolved source commit');
  if (command('git', ['rev-parse', '--show-object-format'], repository, { capture: true }) !== 'sha1') throw new Error('Unsupported source object format');
  return command('git', ['ls-tree', '-rz', '--full-tree', commit], repository, { capture: true }).split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40})\t([^\x00\r\n]+)$/.exec(line);
    if (!match || match[3].startsWith('/') || match[3].split('/').some(part => !part || part === '..')) throw new Error('Unsupported source entry');
    return { mode: match[1], blob: match[2], path: match[3] };
  });
}
const gitPathEnvironment = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS'];
function requireOrdinaryGitEnvironment() {
  if (gitPathEnvironment.some(key => process.env[key])) throw new Error('Private source cannot inherit Git path overrides');
}
export function verifyPrivateGitMetadata(sourceRoot, commit) {
  requireOrdinaryGitEnvironment();
  const root = realpathSync(sourceRoot), metadata = join(root, '.git');
  const info = lstatSync(metadata);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(metadata) !== metadata) throw new Error('Private Git metadata must stay inside the archive');
  let count = 0;
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (++count > 50000) throw new Error('Private Git metadata exceeds bound');
      const file = join(path, entry.name), stat = lstatSync(file);
      if (stat.isSymbolicLink() || realpathSync(file) !== file || (!stat.isDirectory() && (!stat.isFile() || stat.nlink > 1))) throw new Error('Private Git metadata links are forbidden');
      if (stat.isDirectory()) visit(file);
    }
  };
  visit(metadata);
  for (const name of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates'])
    if (existsSync(join(metadata, name))) throw new Error('Private Git shared object/common directory is forbidden');
  const git = args => command('git', args, root, { capture: true });
  if (realpathSync(git(['rev-parse', '--absolute-git-dir'])) !== metadata
      || realpathSync(resolve(root, git(['rev-parse', '--git-common-dir']))) !== metadata
      || realpathSync(git(['rev-parse', '--show-toplevel'])) !== root
      || git(['rev-parse', 'HEAD']) !== commit || git(['remote']) !== ''
      || git(['config', '--local', '--get', 'push.default']) !== 'nothing'
      || git(['config', '--local', '--get', 'core.fsmonitor']) !== 'false') throw new Error('Private Git identity or isolation changed');
  const hooks = join(metadata, 'disabled-hooks');
  if (git(['config', '--local', '--get', 'core.hooksPath']) !== hooks || readdirSync(hooks).length) throw new Error('Private Git hooks must remain empty');
  const config = git(['config', '--local', '--name-only', '--list']).split('\n');
  const permitted = new Set(['core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode', 'core.symlinks', 'core.hookspath', 'core.fsmonitor', 'push.default']);
  if (config.some(key => !permitted.has(key.toLowerCase()))) throw new Error('Unexpected private Git configuration');
  const expected = sourceEntries(root, commit).map(entry => `${entry.mode} ${entry.blob} 0\t${entry.path}`).sort();
  const indexed = git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean).sort();
  if (canonicalJSON(expected) !== canonicalJSON(indexed)) throw new Error('Private Git index differs from committed archive');
}
function initializePrivateGit(repository, commit, sourceRoot) {
  requireOrdinaryGitEnvironment();
  sourceRoot = realpathSync(sourceRoot);
  command('git', ['init', '--quiet', '--initial-branch=main'], sourceRoot, { capture: true });
  const git = args => command('git', args, sourceRoot, { capture: true });
  const hooks = join(sourceRoot, '.git/disabled-hooks'); mkdirSync(hooks);
  git(['config', '--local', 'core.hooksPath', hooks]);
  git(['config', '--local', 'core.fsmonitor', 'false']);
  git(['config', '--local', 'push.default', 'nothing']);
  // Local fetch copies objects; no shared object store, remote, linked checkout,
  // reset, or original-repository metadata is used by subsequent build tools.
  git(['fetch', '--quiet', '--depth=1', '--no-tags', '--no-write-fetch-head', realpathSync(repository), commit]);
  git(['update-ref', 'refs/heads/main', commit]);
  git(['read-tree', commit]);
  writeFileSync(join(sourceRoot, '.git/info/exclude'), '/.env.local\n');
  writeFileSync(join(sourceRoot, '.env.local'), '', { flag: 'wx', mode: 0o600 });
  verifyPrivateGitMetadata(sourceRoot, commit);
}
export function verifySourceTree(repository, commit, sourceRoot) {
  const entries = sourceEntries(repository, commit);
  if (!entries.length || entries.length > 30000) throw new Error('Source inventory outside bounds');
  const actualRoot = realpathSync(sourceRoot), hashes = [];
  verifyPrivateGitMetadata(actualRoot, commit);
  for (const entry of entries) {
    const file = join(actualRoot, entry.path), info = lstatSync(file);
    let bytes;
    if (entry.mode === '120000') {
      if (!info.isSymbolicLink()) throw new Error('Tracked symlink type changed');
      const target = readlinkSync(file), child = relative(actualRoot, resolve(dirname(file), target));
      if (isAbsolute(target) || child.startsWith('..') || isAbsolute(child)) throw new Error('Tracked symlink leaves pristine source');
      bytes = Buffer.from(target);
    } else {
      if (!info.isFile() || info.isSymbolicLink() || (process.platform !== 'win32' && Boolean(info.mode & 0o111) !== (entry.mode === '100755'))) throw new Error('Tracked source type or executable mode changed');
      // A tracked source path may not traverse an untracked replacement link.
      if (realpathSync(file) !== file) throw new Error('Tracked source traverses a changed link');
      bytes = boundedFile(file, 64 * 1024 * 1024);
    }
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (blob !== entry.blob) throw new Error('Build source differs from the pristine commit');
    hashes.push([entry.path, entry.mode, sha256(bytes)]);
  }
  // Extra compilation inputs must not disappear from the proof merely
  // because they were absent from git ls-tree. Only fixed build outputs,
  // dependency caches and existing signing profiles are excluded.
  const tracked = new Set(entries.map(entry => entry.path));
  const generated = name => /^(?:node_modules|\.next|\.texttext)(?:\/|$)/.test(name)
    || /^mac\/(?:build|\.build|\.swiftpm)(?:\/|$)/.test(name)
    || /^mac\/profiles\/[^/]+\.provisionprofile$/.test(name)
    || /^windows\/(?:build|[^/]+\/(?:bin|obj|Assets|Runtime))(?:\/|$)/.test(name);
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (name === '.git') continue; // Validated isolated metadata above.
      if (name === '.env.local' && !tracked.has(name)) {
        const file = join(directory, entry.name), info = lstatSync(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== 0 || realpathSync(file) !== file) throw new Error('Private local environment must remain an empty regular file');
        continue;
      }
      if (generated(name)) continue;
      if (entry.isDirectory()) visit(join(directory, entry.name), name);
      else if (!tracked.has(name)) throw new Error('Untracked source input appeared during build');
    }
  };
  visit(actualRoot);
  return { sourceCommit: commit, sourceInputSha256: sha256(canonicalJSON(hashes)), files: entries.length, gitMetadata: 'isolated-private-index-v1',
    executableModeEvidence: process.platform === 'win32' ? 'git-archive-manifest' : 'filesystem-and-git-manifest' };
}
export function fixedArtifactPaths(role, sourceRoot) {
  const root = resolve(sourceRoot);
  if (!/^(mac|pc)-(app|web|cli)$/.test(role)) throw new Error('Unknown physical actor role');
  if (role.endsWith('-app')) {
    const base = role === 'mac-app' ? join(root, 'mac/build/TextText.app/Contents') : join(root, 'windows/build/stress-actor');
    const ui = role === 'mac-app' ? join(base, 'Resources/LocalVault') : join(base, 'Assets');
    const files = role === 'mac-app' ? { nativeExecutable: join(base, 'MacOS/TextText') }
      : { nativeExecutable: join(base, 'TextText.dll'), core: join(base, 'TextText.Core.dll'), actor: join(base, 'TextText.LiveAcceptance.dll'), hostRuntime: join(homedir(), 'AppData/Local/TextTextBuild/dotnet/dotnet.exe') };
    for (const name of ['app.js', 'app.css', 'index.html', 'mirror-policy.js', 'mirror-policy.json']) files['localUI/' + name] = join(ui, name);
    return files;
  }
  const base = join(root, 'sync/stress');
  const files = { driver: join(base, role.endsWith('-cli') ? 'file-adapter.mjs' : 'browser-adapter.mjs'), folderCase: join(base, 'folder-case.mjs'), leafMove:join(base,'leaf-move.mjs'),
    fields: join(base, 'multi-field.mjs'), fieldInput: join(base, 'multi-field-input.mjs'), history: join(base, 'undo-redo.mjs'), identity: join(base, 'identity.mjs'), observation: join(base, 'identity-observation.mjs'), fflate:join(root,'node_modules/fflate/esm/index.mjs'), node: realpathSync(process.execPath) };
  if (role.endsWith('-cli')) { files.leafMoveOS=join(base,'leaf-move-os.py'); files.leafMoveWindows=join(base,'leaf-move-os.ps1'); files.fileWrites = join(base, 'file-write-sequence.mjs'); files.malformedRepair = join(base, 'malformed-repair.mjs'); files.fieldPack = join(base, 'multi-field-pack.mjs'); }
  else Object.assign(files, { lifecycle: join(base, 'browser-lifecycle.mjs'), fieldPage: join(base, 'multi-field-page.mjs'), session: join(base, 'browser-session.mjs'), input: join(base, 'input-sequence.mjs'), history: join(base, 'undo-redo.mjs'), readiness: join(root, 'windows/scripts/live-browser-ready.mjs') });
  return files;
}
export function artifactHashes(role, sourceRoot) {
  return Object.fromEntries(Object.entries(fixedArtifactPaths(role, sourceRoot)).map(([key, file]) => [key, sha256(boundedFile(realpathSync(file), 256 * 1024 * 1024))]));
}
export function createOnlyJSON(path, value) {
  if (!isAbsolute(path)) throw new Error('Receipt destination must be absolute');
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export function requiredBuildSteps(role) {
  if (role === 'mac-app') return ['locked-npm', 'fresh-signed-app', 'private-native-actor', 'sign-private-executable', 'sign-private-app', 'verify-private-app'];
  if (role === 'pc-app') return ['locked-npm', 'shared-ui', 'private-native-actor'];
  if (/^(mac|pc)-(web|cli)$/.test(role)) return ['locked-npm', 'pristine-locked-driver'];
  throw new Error('Unknown physical role');
}
export function verifyBuildSteps(role, steps) {
  const required = requiredBuildSteps(role), optional = role === 'mac-app' ? ['private-framework-rpath'] : [];
  if (!Array.isArray(steps) || steps.some(step => !step || step.status !== 'passed' || ![...required, ...optional].includes(step.id))
    || new Set(steps.map(step => step.id)).size !== steps.length
    || JSON.stringify(steps.filter(step => required.includes(step.id)).map(step => step.id)) !== JSON.stringify(required)
    || (steps.some(step => optional.includes(step.id)) && steps.findIndex(step => optional.includes(step.id)) !== 3)) throw new Error('Private build receipt has wrong, duplicate or missing required steps');
}
export function wrapperHashes(sourceRoot) {
  const base = dirname(fileURLToPath(import.meta.url));
  const names = ['build-private-actor.mjs', 'seal-artifacts.mjs', 'artifact-source.mjs', 'identity-observation.mjs', 'identity.mjs'];
  return Object.fromEntries(names.map(name => {
    const current = sha256(boundedFile(join(base, name)));
    if (sha256(boundedFile(join(sourceRoot, 'sync/stress', name))) !== current) throw new Error('Human build wrapper does not match the pristine source commit');
    return [name, current];
  }));
}
export function sealArtifacts({ repository, sourceRoot, buildReceipt, sidecar }) {
  const bytes = boundedFile(buildReceipt, 1024 * 1024), receipt = JSON.parse(bytes);
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'private-actor-build-source' || receipt.status !== 'passed'
    || receipt.sourceRoot !== realpathSync(sourceRoot) || receipt.platform !== process.platform
    || receipt.role?.startsWith(process.platform === 'darwin' ? 'mac-' : 'pc-') !== true) throw new Error('Coherent native/driver build receipt required');
  verifyBuildSteps(receipt.role, receipt.steps);
  const wrappers = wrapperHashes(sourceRoot);
  if (canonicalJSON(wrappers) !== canonicalJSON(receipt.wrapperHashes) || receipt.provenance !== 'trusted-local-private-build-v1') throw new Error('Human build wrapper provenance invalid');
  if (sha256(boundedFile(join(dirname(sourceRoot), 'source.tar'), 256 * 1024 * 1024)) !== receipt.sourceArchiveSha256) throw new Error('Pristine source archive differs from build receipt');
  const proof = verifySourceTree(repository, receipt.sourceCommit, sourceRoot);
  if (proof.sourceInputSha256 !== receipt.before?.sourceInputSha256 || proof.sourceInputSha256 !== receipt.after?.sourceInputSha256) throw new Error('Build source receipt does not match pristine source');
  const artifacts = artifactHashes(receipt.role, sourceRoot);
  if (canonicalJSON(artifacts) !== canonicalJSON(receipt.artifacts)) throw new Error('Build artifacts changed after private build');
  const app = join(sourceRoot, 'mac/build/TextText.app');
  if (!isAbsolute(sidecar)) throw new Error('Sidecar must be an explicit absolute path');
  // Resolve the existing parent too: a symlink cannot place a sidecar inside a signed bundle.
  const actualSidecar = join(realpathSync(dirname(sidecar)), basename(sidecar));
  if (receipt.role === 'mac-app') {
    const inside = relative(realpathSync(app), actualSidecar);
    if (!inside || (!inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && inside !== '..' && !isAbsolute(inside))) throw new Error('Sidecar must remain outside the signed app');
  }
  const value = { schemaVersion: 1, role: receipt.role, sourceCommit: proof.sourceCommit,
    sourceInputSha256: proof.sourceInputSha256, sourceReceiptSha256: sha256(bytes), artifacts,
    provenance: 'trusted-local-private-build-v1', wrapperHashes: wrappers };
  createOnlyJSON(sidecar, value); return value;
}
export function preparePristineSource(repository, ref, destination) {
  requireOrdinaryGitEnvironment();
  const commit = command('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], repository, { capture: true });
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Source ref did not resolve to a commit');
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const archive = join(destination, 'source.tar'), sourceRoot = join(destination, 'source');
  command('git', ['archive', '--format=tar', '--output', archive, commit], repository);
  mkdirSync(sourceRoot, { mode: 0o700 });
  command('tar', ['-xf', archive, '-C', sourceRoot], repository);
  initializePrivateGit(repository, commit, sourceRoot);
  return { sourceRoot: realpathSync(sourceRoot), proof: verifySourceTree(repository, commit, sourceRoot), sourceArchiveSha256: sha256(boundedFile(archive, 256 * 1024 * 1024)) };
}
