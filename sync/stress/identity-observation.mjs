import { createHash } from 'node:crypto';
import { openSync, closeSync, readFileSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute, basename } from 'node:path';
import { digestMap } from './identity.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonicalJSON = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonicalJSON(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonicalJSON(value[key]))])) : value);
export function boundedFile(path, limit = 1024 * 1024) {
  let fd;
  try {
    if (!isAbsolute(path) || lstatSync(path).isSymbolicLink()) throw new Error();
    fd = openSync(path, 'r'); const before = fstatSync(fd);
    if (!before.isFile() || before.size > limit) throw new Error();
    const bytes = readFileSync(fd), after = fstatSync(fd);
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error();
    return bytes;
  } catch { throw new Error('identity evidence file missing, changed or outside bounds'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function fixedDriverFiles(role) {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = { driver: join(here, role.endsWith('-cli') ? 'file-adapter.mjs' : 'browser-adapter.mjs'),
    soakCorrelation:join(here,'soak-correlation.mjs'), folderCase: join(here, 'folder-case.mjs'), leafMove:join(here,'leaf-move.mjs'), fields: join(here, 'multi-field.mjs'), fieldInput: join(here, 'multi-field-input.mjs'), history: join(here, 'undo-redo.mjs'), identity: join(here, 'identity.mjs'), observation: fileURLToPath(import.meta.url),
    fflate:fileURLToPath(import.meta.resolve('fflate')), node: realpathSync(process.execPath) };
  if (role.endsWith('-cli')) { files.leafMoveOS=join(here,'leaf-move-os.py'); files.leafMoveWindows=join(here,'leaf-move-os.ps1'); files.fileWrites = join(here, 'file-write-sequence.mjs'); files.malformedRepair = join(here, 'malformed-repair.mjs'); files.fieldPack = join(here, 'multi-field-pack.mjs'); }
  else Object.assign(files, { lostAck: join(here,'lost-ack.mjs'), lifecycle: join(here, 'browser-lifecycle.mjs'), fieldPage: join(here, 'multi-field-page.mjs'), session: join(here, 'browser-session.mjs'), input: join(here, 'input-sequence.mjs'), history: join(here, 'undo-redo.mjs'),
    readiness: resolve(here, '../../windows/scripts/live-browser-ready.mjs') });
  return files;
}
export function observeSealedSource(path, role, files) {
  const bytes = boundedFile(path, 64 * 1024);
  let receipt;
  try { receipt = JSON.parse(bytes); } catch { throw new Error('sealed identity receipt is not valid JSON'); }
  if (receipt.schemaVersion !== 1 || receipt.role !== role || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit ?? '')
    || !/^[a-f0-9]{64}$/.test(receipt.sourceReceiptSha256 ?? '') || !/^[a-f0-9]{64}$/.test(receipt.sourceInputSha256 ?? '')) throw new Error('sealed source identity receipt invalid');
  const artifacts = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, sha256(boundedFile(realpathSync(file), 256 * 1024 * 1024))]));
  if (canonicalJSON(digestMap(receipt.artifacts)) !== canonicalJSON(digestMap(artifacts))) throw new Error('loaded artifacts do not match sealed source receipt');
  return { sourceCommit: receipt.sourceCommit, sourceReceiptSha256: receipt.sourceReceiptSha256, artifacts };
}
export function accountScopeHash(origin, accountId) {
  if (typeof accountId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(accountId)) throw new Error('verified account identity unavailable');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('account origin invalid');
  return sha256(`texttext-account-v1\0${url.origin.toLowerCase()}\0${accountId}`);
}
export function ownerBindingScope(config) {
  if (!config.workspaceRoot || !config.ownerBindingPath || !isAbsolute(config.workspaceRoot) || !isAbsolute(config.ownerBindingPath)
    || !config.ownerBindingPath.endsWith('account-owner.json')) throw new Error('explicit workspace ownership evidence required for direct-file actor');
  const root = resolve(config.workspaceRoot), file = realpathSync(config.file), actualRoot = realpathSync(root);
  const child = relative(actualRoot, file);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('file is outside observed workspace root');
  let owner;
  try { owner = JSON.parse(boundedFile(config.ownerBindingPath, 16 * 1024)); } catch { throw new Error('workspace owner binding unavailable'); }
  const version = owner.version ?? owner.Version;
  const workspaceId = owner.binding?.workspaceId ?? owner.WorkspaceId;
  const origin = owner.binding?.origin ?? owner.Origin;
  const accountId = owner.accountId ?? owner.AccountId;
  const rootHash = owner.rootHash ?? owner.RootHash;
  // Swift owns canonical symlink-resolved root URLs; Windows TextPackStore
  // owns Path.GetFullPath spelling. Follow each existing native convention.
  const nativeRoot = config.role === 'pc-cli' ? root : actualRoot;
  const marker = resolve(config.ownerBindingPath), parent = dirname(marker);
  const namedDeviceState = basename(parent) === rootHash
    && (config.role === 'pc-cli' ? basename(dirname(parent)) === 'Sync' && basename(dirname(dirname(parent))) === 'TextText'
      : basename(dirname(parent)) === 'VaultDeviceState');
  const legacyMacState = config.role !== 'pc-cli' && realpathSync(parent) === join(actualRoot, '.texttext');
  if (![1, 2].includes(version) || workspaceId !== config.workspaceId || rootHash !== sha256(nativeRoot)
    || (!namedDeviceState && !legacyMacState)) throw new Error('workspace owner binding does not match file actor scope');
  const account = accountScopeHash(origin, accountId);
  return sha256(`texttext-workspace-owner-v1\0${workspaceId}\0${account}`);
}
export function createWebAssetObserver(page, origin) {
  const hashes = new Map(), pending = []; let failure;
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== origin || !url.pathname.startsWith('/_next/static/') || response.request().resourceType() !== 'script') return;
    if (pending.length >= 48) { failure = 'loaded script count exceeds bound'; return; }
    pending.push((async () => {
      if (!response.ok()) throw new Error('loaded script response failed');
      const bytes = await response.body();
      if (bytes.length > 16 * 1024 * 1024) throw new Error('loaded script exceeds bound');
      const key = 'web' + url.pathname, hash = sha256(bytes);
      if (hashes.has(key) && hashes.get(key) !== hash) throw new Error('loaded script changed during readiness');
      hashes.set(key, hash);
    })().catch(() => { failure = 'loaded script identity unavailable or changed'; }));
  });
  return async () => {
    const paths = await page.evaluate(() => [...new Set([...document.scripts].filter(script => script.src).map(script => new URL(script.src)).filter(url => url.origin === location.origin && url.pathname.startsWith('/_next/static/')).map(url => 'web' + url.pathname))]);
    await Promise.all(pending);
    if (failure || !paths.length || paths.some(path => !hashes.has(path))) throw new Error(failure ?? 'loaded script evidence incomplete');
    return digestMap(Object.fromEntries(hashes));
  };
}

export function captureOwnerBindingGuard(config) {
  const expected = ownerBindingScope(config);
  return () => { if (ownerBindingScope(config) !== expected) throw new Error('workspace owner binding changed'); return expected; };
}
