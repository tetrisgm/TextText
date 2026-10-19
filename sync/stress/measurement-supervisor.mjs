// External, default-off preapply measurement boundary. Host authority functions
// must be implemented by genuine pinned launchers/OS collectors, never protocol
// replies or JSON supplied by a document actor. No production host is wired yet.
import { createHash } from 'node:crypto';
import { validateResourceOwnership } from './resource-ownership.mjs';
import { binding, createSeriesValidator, LIMITS } from './resource-telemetry.mjs';
export const MEASUREMENT_ROLES = Object.freeze(['mac-app', 'mac-web', 'mac-cli', 'pc-app', 'pc-web', 'pc-cli']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function data(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string') ||
      Reflect.ownKeys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error('Measurement shape refused');
  const result = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw Error('Measurement accessor refused');
    result[key] = d.value;
  }
  return result;
}
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
// Capture only plain enumerable data; never retain callback-owned references.
function capture(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw Error('Nonserializable measurement evidence');
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw Error('Nonplain measurement evidence');
  seen.add(value);
  const out = array ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('Measurement evidence accessor');
    Object.defineProperty(out, key, {value: capture(d.value, seen), enumerable: true});
  }
  if (array && (Object.keys(out).length !== value.length || !Array.from({length: value.length}, (_, i) => Object.hasOwn(out, i)).every(Boolean))) throw Error('Sparse measurement evidence');
  seen.delete(value);
  return Object.freeze(out);
}
async function settledAll(items, fn) {
  const results = await Promise.allSettled(items.map(async item => fn(item)));
  const failure = results.find(r => r.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map(r => r.value);
}
/** Trusted executable host capabilities, never actor JSON. No production host
 * integration is wired. inspect supplies fresh OS facts AND same-host nowMs.
 * All callbacks settle before failure preservation; no process-signal API.
 * Trusted host adapters MUST enforce real command deadlines. allSettled cannot
 * bound a never-resolving callback; this module is not an end-to-end finite
 * supervisor or production-ready collector integration. */
export async function measurementPreapply(config, authority) {
  const c = data(config, ['enabled', 'runId', 'durationMs', 'cadenceMs']);
  if (c.enabled === false) return Object.freeze({ enabled: false, ready: false, reason: 'disabled' });
  if (c.enabled !== true || typeof c.runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(c.runId) ||
      !Number.isSafeInteger(c.durationMs) || c.durationMs < 1000 || c.durationMs > LIMITS.maxMs ||
      !Number.isSafeInteger(c.cadenceMs) || c.cadenceMs < 1000 || c.cadenceMs > 60000 ||
      Math.floor(c.durationMs / c.cadenceMs) + 1 > LIMITS.maxSamples) throw Error('Finite measurement bounds refused');
  const a = data(authority, ['readLauncher', 'inspect', 'startSampler', 'preserve']);
  if (Object.values(a).some(fn => typeof fn !== 'function')) throw Error('Genuine measurement authority unavailable');
  const samplers = [], requestedRoles = [];
  try {
    const prepared = await settledAll(MEASUREMENT_ROLES, async role => {
      const returned = data(await a.readLauncher(role), ['expected', 'receiptBytes']);
      const expected = capture(data(returned.expected, ['runId', 'role', 'sourceCommit', 'generation', 'receiptSha256', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName', 'rootExecutableSha256']));
      if (Object.getPrototypeOf(returned.receiptBytes) !== Uint8Array.prototype) throw Error('Strict receipt bytes required');
      const receiptBytes = new Uint8Array(returned.receiptBytes);
      const observed = capture(data(await a.inspect(role, expected), ['os', 'nowMs']));
      const ownership = validateResourceOwnership({expected, receiptBytes, ...observed});
      if (ownership.role !== role || ownership.runId !== c.runId) throw Error('Launcher role/run mismatch');
      const scope = capture(binding({version: 1, runId: c.runId, role, sourceCommit: ownership.sourceCommit,
        ownershipEvidenceSha256: ownership.ownershipEvidenceSha256, root: ownership.root}));
      return {role, expected, receiptBytes, scope};
    });
    // Every ownership result passed before any sampler can start.
    requestedRoles.push(...MEASUREMENT_ROLES);
    await settledAll(prepared, async p => {
      const started = capture(data(await a.startSampler(p.role, capture({scope: p.scope, durationMs: c.durationMs, cadenceMs: c.cadenceMs})),
        ['firstSample', 'configSha256', 'outputPath']));
      if (typeof started.configSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(started.configSha256) ||
          typeof started.outputPath !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(started.outputPath) || /[\x00-\x1f]/.test(started.outputPath)) throw Error('Sampler output binding refused');
      const series = createSeriesValidator(p.scope); series.push(started.firstSample);
      if (started.firstSample.index !== 0 || started.firstSample.complete !== true) throw Error('Initial sample incomplete');
      samplers.push(capture({role: p.role, ...started, firstSampleSha256: hash(canonical(started.firstSample))}));
    });
    if (new Set(samplers.map(s => s.outputPath)).size !== MEASUREMENT_ROLES.length) throw Error('Duplicate sampler output');
    await settledAll(prepared, async p => {
      const observed = capture(data(await a.inspect(p.role, p.expected), ['os', 'nowMs']));
      validateResourceOwnership({expected: p.expected, receiptBytes: new Uint8Array(p.receiptBytes), ...observed});
      const captured = Date.parse(samplers.find(s => s.role === p.role).firstSample.raw.observedUtc);
      if (captured > observed.nowMs || observed.nowMs - captured > 5000) throw Error('Initial sample no longer fresh');
    });
    const manifest = capture({version: 1, runId: c.runId, phase: 'preapply', ready: true,
      scope: 'bound-process-tree', rendererCoverage: 'unavailable', logicalCounters: null,
      httpRequests: null, durableCommits: null, durationMs: c.durationMs, cadenceMs: c.cadenceMs,
      maxBytesPerRole: LIMITS.maxBytes, roles: MEASUREMENT_ROLES.map(role => samplers.find(s => s.role === role))});
    return Object.freeze({enabled: true, ready: true, manifest, manifestSha256: hash(canonical(manifest)), coverageComplete: false});
  } catch (error) {
    await a.preserve(capture({version: 1, runId: c.runId, phase: 'preapply', ready: false,
      requestedSamplerRoles: [...requestedRoles], validatedSamplerRoles: samplers.map(s => s.role),
      stopPolicy: 'finite-owned-samplers-no-signals', reason: 'measurement-preapply-refused'}));
    throw error;
  }
}
