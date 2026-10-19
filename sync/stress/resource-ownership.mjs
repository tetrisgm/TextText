import { createHash } from 'node:crypto';

const fail = () => { throw Error('Resource ownership evidence refused'); };
const hex = (v, n) => typeof v === 'string' && v.length === n && /^[a-f0-9]+$/.test(v);
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v);
function data(value, keys) {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
    const names = Reflect.ownKeys(value);
    if (names.some(k => typeof k !== 'string') || names.sort().join('|') !== [...keys].sort().join('|')) fail();
    const out = Object.create(null);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail();
      out[key] = d.value;
    }
    return out;
  } catch { return fail(); }
}
function identity(value) {
  const v = data(value, ['pid', 'parentPid', 'startKey', 'session', 'executableSha256']);
  if (!Number.isSafeInteger(v.pid) || v.pid <= 1 || !Number.isSafeInteger(v.parentPid) || v.parentPid < 0 ||
      !text(v.startKey) || v.startKey.length > 100 || typeof v.session !== 'string' || !/^[0-9]+$/.test(v.session) || !hex(v.executableSha256, 64)) fail();
  return v;
}
const same = (a, b) => Object.keys(a).every(k => a[k] === b[k]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Pure validation only. The caller must independently pin genuine launcher
 * evidence and supply fresh OS inspection; this function performs neither. */
export function validateResourceOwnership(input) {
  const { expected, receiptBytes, os, nowMs } = data(input, ['expected', 'receiptBytes', 'os', 'nowMs']);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail();
  const e = data(expected, ['runId', 'role', 'sourceCommit', 'generation', 'receiptSha256', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName', 'rootExecutableSha256']);
  if (typeof e.runId !== 'string' || e.runId.length < 1 || e.runId.length > 100 || !/^[A-Za-z0-9_-]{1,100}$/.test(e.runId) || typeof e.role !== 'string' || e.role.length > 10 || !/^(mac|pc)-(app|web|cli)$/.test(e.role) || !hex(e.sourceCommit, 40) ||
      !Number.isSafeInteger(e.generation) || e.generation < 1 || !hex(e.receiptSha256, 64) || !hex(e.moduleSha256, 64) ||
      !hex(e.rootExecutableSha256, 64) || !text(e.sessionPath)) fail();
  const web = e.role.endsWith('-web'), pc = e.role.startsWith('pc-');
  if (web ? !hex(e.profileScopeHash, 64) : e.profileScopeHash !== null) fail();
  if (pc && !e.role.endsWith('-cli') ? typeof e.taskName !== 'string' || !/^TextText-[A-Za-z0-9_-]{1,140}$/.test(e.taskName) : e.taskName !== null) fail();
  if (Object.getPrototypeOf(receiptBytes) !== Uint8Array.prototype || receiptBytes.byteLength < 1 || receiptBytes.byteLength > 65536 || sha(receiptBytes) !== e.receiptSha256) fail();
  let receipt;
  try { receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receiptBytes)); } catch { fail(); }
  const r = data(receipt, ['version', 'kind', 'runId', 'role', 'sourceCommit', 'generation', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName', 'root']);
  if (r.version !== 1 || r.kind !== 'owned-role-runtime-v1' || !['runId', 'role', 'sourceCommit', 'generation', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName'].every(k => r[k] === e[k])) fail();
  const root = identity(r.root);
  if (root.executableSha256 !== e.rootExecutableSha256) fail();
  const o = data(os, ['version', 'observedUtc', 'receiptSha256', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName', 'processKind', 'identity']);
  if (o.version !== 1 || typeof o.observedUtc !== 'string' || !Number.isFinite(Date.parse(o.observedUtc)) || Date.parse(o.observedUtc) > nowMs || nowMs - Date.parse(o.observedUtc) > 5000 ||
      !['receiptSha256', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName'].every(k => o[k] === e[k]) ||
      o.processKind !== (web ? 'headed-browser' : e.role.endsWith('-app') ? 'native-actor' : 'file-driver') || !same(root, identity(o.identity))) fail();
  if (pc && !e.role.endsWith('-cli') && root.session === '0') fail();
  return Object.freeze({ version: 1, scope: 'bound-process-tree', rendererCoverage: 'unavailable',
    runId: e.runId, role: e.role, sourceCommit: e.sourceCommit, generation: e.generation,
    ownershipEvidenceSha256: e.receiptSha256, observedUtc: o.observedUtc, root: Object.freeze({ ...root }) });
}
