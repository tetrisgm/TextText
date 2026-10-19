// Explicitly invoked on the Windows host for native/browser inspect only.
// Mac/file authority, sampler and coordinator wiring are absent.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateResourceOwnership } from './resource-ownership.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const hex = (s, n = 64) => typeof s === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(s);
function exact(v, keys) {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) throw Error('Host authority schema refused');
  const names = Reflect.ownKeys(v);
  if (names.some(k => typeof k !== 'string') || names.sort().join('|') !== [...keys].sort().join('|')) throw Error('Host authority schema refused');
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('Host authority accessor refused');
  }
  return v;
}
function safe(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw Error('Absolute host path required');
  for (let p = resolve(path); ; p = dirname(p)) { if (lstatSync(p).isSymbolicLink()) throw Error('Host link refused'); if (p === dirname(p)) break; }
  return path;
}
function bytes(path, max) { safe(path); const stat = lstatSync(path); if (!stat.isFile() || stat.size > max) throw Error('Host file bound'); const b = readFileSync(path); if (b.length > max) throw Error('Host file bound'); return b; }
function json(b) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)); }
/** Terminates only its own newly spawned readonly collector handle. Actor/task
 * signals are not accepted. Partial bounded bytes survive failure. */
export function runReadonlyCollector(executable, args, { deadlineMs = 10000, maxBytes = 65536 } = {}) {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 15000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) throw Error('Collector bounds refused');
  return new Promise(resolveResult => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const parts = []; let size = 0, reason = null, finished = false;
    const stop = why => { if (!reason) { reason = why; try { child.kill(); } catch {} done(null, null); } };
    const timer = setTimeout(() => stop('deadline'), deadlineMs);
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) stream.on('data', b => {
      if (finished) return;
      const retained = b.subarray(0, Math.max(0, maxBytes - size)); size += retained.length;
      parts.push({ stream: name, bytes: Buffer.from(retained) }); if (retained.length !== b.length) stop('output-bound');
    });
    const done = (code, signal, error = false) => { if (finished) return; finished = true; clearTimeout(timer); resolveResult({ code, signal, pid: child.pid ?? null, terminationRequested: reason !== null, closeObserved: !reason && !error, reason: reason ?? (error ? 'spawn-error' : null), parts: parts.map(p => ({ stream: p.stream, bytes: Buffer.from(p.bytes) })) }); };
    child.once('error', () => done(null, null, true)); child.once('close', (code, signal) => done(code, signal));
  });
}
const runtime = { platform: process.platform, read: bytes, create: (p, b) => { safe(dirname(p)); writeFileSync(p, b, { flag: 'wx', mode: 0o600 }); },
  now: Date.now, monotonic: () => performance.now(), uuid: randomUUID, run: runReadonlyCollector };
/** read-only inspect only, not a complete six-host supervisor/sampler adapter.
 * A trusted launch owner must create the separately pinned record. No existing
 * actor/task output is automatically promoted to launch authority. */
export async function inspectPcOwnership(config, dependencies = runtime) {
  if (config && Object.getOwnPropertyDescriptor(config, 'enabled')?.value === false) return Object.freeze({ enabled: false, ready: false });
  exact(config, ['enabled', 'launcherPath', 'launcherSha256', 'evidenceDirectory']);
  if (config.enabled !== true || dependencies.platform !== 'win32' || !hex(config.launcherSha256)) throw Error('PC launch authority unavailable');
  const d = dependencies, raw = Buffer.from(d.read(config.launcherPath, 65536));
  if (sha(raw) !== config.launcherSha256) throw Error('Pinned launcher changed');
  const l = exact(json(raw), ['version', 'kind', 'scope', 'root', 'files', 'maxMs', 'features']);
  if (l.version !== 1 || l.kind !== 'trusted-pc-launch-owner-v1') throw Error('Genuine launcher sidechannel unavailable');
  const s = exact(l.scope, ['runId', 'role', 'sourceCommit', 'generation', 'sessionPath', 'moduleSha256', 'profileScopeHash', 'taskName']);
  if (!['pc-app', 'pc-web'].includes(s.role) || !hex(s.sourceCommit, 40) || !hex(s.moduleSha256) || !Number.isInteger(s.generation) || s.generation < 1 || s.generation > 999 || !/^[A-Za-z0-9_-]{1,100}$/.test(s.runId)) throw Error('PC role scope refused');
  const web = s.role === 'pc-web';
  if (!(web ? /^TextText-stress-browser-[a-f0-9]{32}$/ : /^TextText-stress-native-[a-f0-9]{32}-[0-9]{3}$/).test(s.taskName) || (web ? !hex(s.profileScopeHash) : s.profileScopeHash !== null)) throw Error('PC task/profile refused');
  const files = exact(l.files, ['powershell', 'task', 'helper', 'config', 'module', 'executable', ...(web ? ['launcherExecutable', 'child'] : [])]);
  const captured = new Map();
  for (const [name, f] of Object.entries(files)) {
    exact(f, ['path', 'sha256']); if (!hex(f.sha256)) throw Error('Host source pin refused');
    const b = Buffer.from(d.read(f.path, name === 'config' ? 16384 : 268435456)); if (sha(b) !== f.sha256) throw Error('Host input changed'); captured.set(name, b);
  }
  if (files.module.sha256 !== s.moduleSha256 || files.executable.sha256 !== l.root.executableSha256 || dirname(files.task.path) !== dirname(files.helper.path) || !files.helper.path.endsWith('resource-ownership-task.ps1') || !files.task.path.endsWith(web ? 'stress-browser-task.ps1' : 'stress-native-task.ps1')) throw Error('Host task source mismatch');
  if (web ? !Number.isInteger(l.maxMs) || l.maxMs < 1000 || l.maxMs > 7200000 || typeof l.features !== 'string' || !/^[A-Za-z0-9_,.-]{1,2048}$/.test(l.features) || dirname(files.child.path) !== dirname(files.task.path) || !files.child.path.endsWith('stress-browser-child.mjs') : l.maxMs !== null || l.features !== null) throw Error('Task parameters refused');
  const preReceipt = new Uint8Array(Buffer.from(JSON.stringify({ version: 1, kind: 'owned-role-runtime-v1', ...s, root: l.root })));
  const preNow = d.now();
  validateResourceOwnership({ expected: { ...s, receiptSha256: sha(preReceipt), rootExecutableSha256: files.executable.sha256 }, receiptBytes: preReceipt,
    os: { version: 1, observedUtc: new Date(preNow).toISOString(), receiptSha256: sha(preReceipt), sessionPath: s.sessionPath, moduleSha256: s.moduleSha256, profileScopeHash: s.profileScopeHash, taskName: s.taskName, processKind: web ? 'headed-browser' : 'native-actor', identity: l.root }, nowMs: preNow });
  // Above validates trusted-record shape only; actual authority still requires
  // the fresh task/OS command and exact runtime comparison below.
  const id = d.uuid(); if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Fresh request identity refused');
  const outputName = `resource-ownership-${id}.json`, requestPath = join(s.sessionPath, `measurement-request-${id}.json`);
  const request = Buffer.from(JSON.stringify({ version: 1, ...s, outputName }));
  d.create(requestPath, request);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', files.task.path,
    web ? '-Driver' : '-Assembly', files.module.path, '-Config', files.config.path, '-Session', s.sessionPath, '-TaskName', s.taskName,
    ...(web ? ['-Node', files.launcherExecutable.path, '-MaxMs', String(l.maxMs), '-ExpectedFeatures', l.features, '-Inspect'] : ['-ExpectedConfigSha256', files.config.sha256, '-ExpectedModuleSha256', s.moduleSha256, '-InspectOwnership']), '-OwnershipRequest', requestPath];
  const wall = d.now(), mono = d.monotonic();
  const result = await d.run(files.powershell.path, args, { deadlineMs: 10000, maxBytes: 65536 });
  // Bounded raw collector output may contain diagnostics; keep private, never log.
  d.create(join(config.evidenceDirectory, `collector-${id}.json`), Buffer.from(JSON.stringify({ version: 1, code: result.code, signal: result.signal, pid: result.pid, reason: result.reason, terminationRequested: result.terminationRequested ?? false, closeObserved: result.closeObserved ?? false,
    output: result.parts.map(p => ({ stream: p.stream, base64: Buffer.from(p.bytes).toString('base64') })) })));
  if (result.reason || result.code !== 0 || result.signal !== null) throw Error('Readonly collector failed; evidence retained');
  const now = d.now(), elapsed = d.monotonic() - mono;
  if (elapsed < 0 || elapsed > 5000 || Math.abs(now - wall - elapsed) > 1000) throw Error('Host inspection clock/latency refused');
  if (!Buffer.from(d.read(config.launcherPath, 65536)).equals(raw) || !Buffer.from(d.read(requestPath, 8192)).equals(request)) throw Error('Launch/request changed during inspection');
  for (const [name, f] of Object.entries(files)) if (!Buffer.from(d.read(f.path, name === 'config' ? 16384 : 268435456)).equals(captured.get(name))) throw Error('Host input changed during inspection');
  const receiptBytes = new Uint8Array(d.read(join(s.sessionPath, outputName), 65536));
  const envelopeBytes = Buffer.from(d.read(join(s.sessionPath, outputName + '.collector.json'), 65536));
  d.create(join(config.evidenceDirectory, `collector-envelope-${id}.json`), envelopeBytes);
  d.create(join(config.evidenceDirectory, `collector-receipt-${id}.json`), receiptBytes);
  const envelope = json(envelopeBytes);
  exact(envelope, ['version', 'scopeClaimsVerified', 'authority', 'collectorPlatform', 'collectorNowMs', 'monotonicStart', 'monotonicEnd', 'monotonicFrequency', 'scope', 'rendererCoverage', 'receiptSha256', 'os']);
  const e = envelope;
  if (e.version !== 1 || e.scopeClaimsVerified !== false || e.authority !== 'os-process-identity-only' || e.collectorPlatform !== 'win32' || e.scope !== 'bound-process-tree' || e.rendererCoverage !== 'unavailable' || e.receiptSha256 !== sha(receiptBytes) || !Number.isSafeInteger(e.collectorNowMs) || now - e.collectorNowMs < 0 || now - e.collectorNowMs > 5000 || e.collectorNowMs < wall || ![e.monotonicStart, e.monotonicEnd, e.monotonicFrequency].every(Number.isSafeInteger) || e.monotonicFrequency <= 0 || e.monotonicEnd < e.monotonicStart || (e.monotonicEnd - e.monotonicStart) * 1000 / e.monotonicFrequency > elapsed + 1000) throw Error('Fresh same-host collector proof refused');
  const expected = { ...s, receiptSha256: sha(receiptBytes), rootExecutableSha256: files.executable.sha256 };
  const proof = validateResourceOwnership({ expected, receiptBytes, os: e.os, nowMs: now });
  if (Object.keys(proof.root).length !== Object.keys(l.root).length || !Object.keys(proof.root).every(k => proof.root[k] === l.root[k])) throw Error('Trusted launcher runtime changed');
  return { expected, receiptBytes, os: e.os, nowMs: now };
}
