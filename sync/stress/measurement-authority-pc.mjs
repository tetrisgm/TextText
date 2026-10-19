// Ownership callbacks only. No sampler, task start or all-six readiness.
import { inspectPcOwnership } from './measurement-host-pc.mjs';
import { validateResourceOwnership } from './resource-ownership.mjs';
const ROLES = ['pc-app', 'pc-web'];
const EXPECTED = ['runId', 'role', 'sourceCommit', 'generation', 'receiptSha256', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName', 'rootExecutableSha256'];
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(k => typeof k !== 'string') || Reflect.ownKeys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error('PC authority shape refused');
  const out = {};
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('PC authority accessor refused'); out[key] = d.value; }
  return out;
}
const same = (a, b) => EXPECTED.every(k => a[k] === b[k]);
/** Inputs are independently caller-pinned genuine launcher records. The fixed
 * production inspector owns all filesystem/OS commands and finite bounds. */
export function createPcMeasurementAuthority(config, inspector = inspectPcOwnership) {
  if (config && Object.getOwnPropertyDescriptor(config, 'enabled')?.value === false) { exact(config, ['enabled']); return Object.freeze({ enabled: false }); }
  const c = exact(config, ['enabled', 'runId', 'roles']);
  if (c.enabled !== true || typeof c.runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(c.runId) || typeof inspector !== 'function') throw Error('PC authority configuration refused');
  const runId = c.runId, roles = exact(c.roles, ROLES), pinned = new Map(), initial = new Map();
  for (const role of ROLES) {
    const p = exact(roles[role], ['launcherPath', 'launcherSha256', 'evidenceDirectory']);
    if (typeof p.launcherSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.launcherSha256) || [p.launcherPath,p.evidenceDirectory].some(v => typeof v !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(v) || /[\x00-\x1f\x7f]/.test(v))) throw Error('PC authority input pin refused');
    pinned.set(role, Object.freeze({ enabled: true, ...p }));
  }
  function supported(role) { if (!ROLES.includes(role)) throw Error('Genuine role authority unavailable'); }
  async function observe(role) {
    supported(role);
    const result = exact(await inspector(pinned.get(role)), ['expected', 'receiptBytes', 'os', 'nowMs']);
    const expected = exact(result.expected, EXPECTED);
    if (EXPECTED.some(k => !['string','number'].includes(typeof expected[k]) && expected[k] !== null) || Object.getPrototypeOf(result.receiptBytes) !== Uint8Array.prototype) throw Error('PC authority proof data refused');
    const bytes = new Uint8Array(result.receiptBytes);
    const proof = validateResourceOwnership({ expected, receiptBytes: bytes, os: result.os, nowMs: result.nowMs });
    if (proof.runId !== runId || proof.role !== role) throw Error('PC authority run/role differs');
    return { expected: Object.freeze(expected), receiptBytes: bytes, os: result.os, nowMs: result.nowMs };
  }
  function unchanged(a, b) {
    if (!same(a.expected,b.expected) || a.receiptBytes.length !== b.receiptBytes.length || a.receiptBytes.some((v,i) => v !== b.receiptBytes[i])) throw Error('PC launcher ownership drift');
  }
  return Object.freeze({ enabled: true,
    async readLauncher(role) {
      const seen = await observe(role);
      if (initial.has(role)) unchanged(initial.get(role),seen);
      else initial.set(role,{ expected:seen.expected, receiptBytes:new Uint8Array(seen.receiptBytes) });
      return { expected: { ...seen.expected }, receiptBytes: new Uint8Array(seen.receiptBytes) };
    },
    async inspect(role, requested) {
      supported(role);
      const saved = initial.get(role);
      if (!saved || !same(saved.expected,exact(requested,EXPECTED))) throw Error('Initial PC launcher proof required');
      const fresh = await observe(role); unchanged(saved,fresh);
      return { os: fresh.os, nowMs: fresh.nowMs };
    }
  });
}
