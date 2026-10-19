// Launcher-only metadata channel. Never receives document protocol identities.
import { readFileSync, writeFileSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { runReadonlyCollector } from '../../sync/stress/measurement-host-pc.mjs';
import { validateResourceOwnership } from '../../sync/stress/resource-ownership.mjs';
import { boundedFile, observeSealedSource, fixedDriverFiles, canonicalJSON } from '../../sync/stress/identity-observation.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const hex = (v, n = 64) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
function exact(v, keys) {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype || Reflect.ownKeys(v).some(k => typeof k !== 'string') || Reflect.ownKeys(v).sort().join('|') !== [...keys].sort().join('|')) throw Error('Launch intent schema refused');
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(v, key); if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('Launch intent accessor refused'); }
  return v;
}
function safe(path) { if (typeof path !== 'string' || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw Error('Absolute launch path required'); for (let p = resolve(path);; p = dirname(p)) { try { if (lstatSync(p).isSymbolicLink()) throw Error('Launch link refused'); } catch (e) { if (e.code !== 'ENOENT') throw e; } if (p === dirname(p)) break; } return path; }
const runtime = { platform: process.platform, read: (p, max) => { safe(p); return boundedFile(p, max); },
  create: (p, b) => { safe(p); writeFileSync(p, b, { flag: 'wx', mode: 0o600 }); }, exists: p => existsSync(p),
  realpath: p => realpathSync(safe(p)), verifySeal: observeSealedSource, run: runReadonlyCollector, now: Date.now, monotonic: () => performance.now(), uuid: randomUUID };
export function measurementLaunchOptions(args = []) {
  if (!args.length) return Object.freeze({ enabled: false });
  if (args.length !== 4 || args[0] !== '--measurement-intent' || args[2] !== '--measurement-intent-sha256' || !isAbsolute(args[1]) || !hex(args[3])) throw Error('Launcher measurement options refused');
  return Object.freeze({ enabled: true, path: args[1], sha256: args[3] });
}
/** Actual call sites supply paths from their own launch variables, not replies.
 * options disabled returns before inspecting owner/dependencies or doing IO. */
export function prepareLaunchMeasurement(options, owner, d = runtime) {
  if (options && Object.getOwnPropertyDescriptor(options, 'enabled')?.value === false) { exact(options, ['enabled']); return null; }
  exact(options, ['enabled', 'path', 'sha256']);
  if (options.enabled !== true || d.platform !== 'win32' || !hex(options.sha256)) throw Error('Windows launch owner required');
  const raw = Buffer.from(d.read(options.path, 65536)); if (sha(raw) !== options.sha256) throw Error('Pinned launch intent changed');
  const intent = exact(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), ['version', 'kind', 'runId', 'role', 'sourceCommit', 'launchSourceCommit', 'sessionRoot', 'maxGenerations', 'maxMs', 'features', 'files']);
  const web = owner.role === 'pc-web';
  if (intent.version !== 1 || intent.kind !== 'pc-measurement-launch-intent-v1' || !['pc-app', 'pc-web'].includes(owner.role) || intent.role !== owner.role || typeof intent.runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(intent.runId) || !hex(intent.sourceCommit, 40) || !hex(intent.launchSourceCommit, 40) || intent.sessionRoot !== owner.sessionRoot || !Number.isInteger(intent.maxGenerations) || intent.maxGenerations < 1 || intent.maxGenerations > 999 || intent.maxMs !== owner.maxMs || intent.features !== owner.features) throw Error('Caller launch intent differs from genuine launcher');
  const recordKeys = ['powershell', 'task', 'helper', 'config', 'module', 'executable', ...(web ? ['launcherExecutable', 'child'] : [])];
  const launchKeys = ['seal', 'relay', 'launchHelper', 'inspector', 'ownership', 'observation', 'launchNode'];
  exact(intent.files, [...recordKeys, ...launchKeys]);
  const here = dirname(fileURLToPath(import.meta.url));
  const paths = { ...owner.files, seal: owner.sealPath, relay: owner.relayPath, launchHelper: fileURLToPath(import.meta.url), inspector: resolve(here, '../../sync/stress/measurement-host-pc.mjs'), ownership: resolve(here, '../../sync/stress/resource-ownership.mjs'), observation: resolve(here, '../../sync/stress/identity-observation.mjs'), launchNode: process.execPath };
  const captured = new Map(), pinned = {};
  for (const key of [...recordKeys, ...launchKeys]) {
    const f = exact(intent.files[key], ['path', 'sha256']);
    // The browser installation is caller-pinned then independently compared to
    // the actual selected OS process hash; it is never chosen from actor JSON.
    const path = key === 'executable' && web ? f.path : paths[key];
    if (f.path !== path || !hex(f.sha256)) throw Error('Launch input path/pin differs');
    const b = Buffer.from(d.read(path, key === 'config' ? 16384 : 268435456)); if (sha(b) !== f.sha256) throw Error('Launch input bytes differ');
    captured.set(key, b); pinned[key] = Object.freeze({ path, sha256: f.sha256 });
  }
  const actualConfig = JSON.parse(captured.get('config').toString('utf8'));
  if (Object.keys(actualConfig).filter(k => k.toLowerCase() === "identityreceipt").length !== 1 || (actualConfig.IdentityReceipt ?? actualConfig.identityReceipt) !== owner.sealPath) throw Error('Config sealed source differs');
  const sealFiles = web ? fixedDriverFiles('pc-web') : {
    nativeExecutable: join(dirname(owner.files.module), 'TextText.dll'), core: join(dirname(owner.files.module), 'TextText.Core.dll'), actor: owner.files.module, hostRuntime: owner.files.executable,
    ...Object.fromEntries(['app.js', 'app.css', 'index.html', 'mirror-policy.js', 'mirror-policy.json'].map(n => ['localUI/' + n, join(dirname(owner.files.module), 'Assets', n)])) };
  const source = JSON.parse(JSON.stringify(d.verifySeal(owner.sealPath, owner.role, sealFiles)));
  if (source.sourceCommit !== intent.sourceCommit) throw Error('Actual seal source differs from intent');
  const sessionRoot = intent.sessionRoot, role = intent.role, runId = intent.runId, sourceCommit = intent.sourceCommit, launchSourceCommit = intent.launchSourceCommit;
  const maxMs = intent.maxMs, features = intent.features, maxGenerations = intent.maxGenerations;
  const published = new Map();
  function recheck() {
    if (!Buffer.from(d.read(options.path, 65536)).equals(raw)) throw Error('Launch intent changed');
    for (const [key, b] of captured) if (!Buffer.from(d.read(pinned[key].path, key === 'config' ? 16384 : 268435456)).equals(b)) throw Error('Launch inputs changed');
    if (canonicalJSON(d.verifySeal(owner.sealPath, role, sealFiles)) !== canonicalJSON(source)) throw Error('Sealed launch artifacts changed');
  }
  return Object.freeze({ beforeStart: recheck, async publish({ generation, sessionPath, taskName }) {
    if (!Number.isInteger(generation) || generation < 1 || generation > maxGenerations || sessionPath !== (web ? sessionRoot : join(sessionRoot, `generation-${String(generation).padStart(3, '0')}`)) || !(web ? /^TextText-stress-browser-[a-f0-9]{32}$/ : /^TextText-stress-native-[a-f0-9]{32}-[0-9]{3}$/).test(taskName)) throw Error('Genuine launch generation differs');
    recheck();
    const scope = { runId, role, sourceCommit, generation, sessionPath, moduleSha256: pinned.module.sha256, profileScopeHash: web ? sha(Buffer.from(d.realpath(join(sessionPath, 'browser-profile')))) : null, taskName };
    const id = d.uuid(); if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('Fresh launch request refused');
    const name = `resource-ownership-launch-${id}.json`, requestPath = join(sessionPath, `measurement-launch-request-${id}.json`);
    const request = Buffer.from(JSON.stringify({ version: 1, ...scope, outputName: name })); d.create(requestPath, request);
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', pinned.task.path,
      web ? '-Driver' : '-Assembly', pinned.module.path, '-Config', pinned.config.path, '-Session', sessionPath, '-TaskName', taskName,
      ...(web ? ['-Node', pinned.launcherExecutable.path, '-MaxMs', String(maxMs), '-ExpectedFeatures', features, '-Inspect'] : ['-ExpectedConfigSha256', pinned.config.sha256, '-ExpectedModuleSha256', pinned.module.sha256, '-InspectOwnership']), '-OwnershipRequest', requestPath];
    const start = d.now(), mono = d.monotonic();
    const result = await d.run(pinned.powershell.path, args, { deadlineMs: 10000, maxBytes: 65536 });
    d.create(join(sessionPath, `measurement-launch-command-${id}.json`), Buffer.from(JSON.stringify({ code: result.code, signal: result.signal, reason: result.reason, pid: result.pid, closeObserved: result.closeObserved, terminationRequested: result.terminationRequested, output: result.parts.map(p => ({ stream: p.stream, base64: Buffer.from(p.bytes).toString('base64') })) })));
    if (result.reason || result.code !== 0 || result.signal !== null || result.closeObserved !== true) throw Error('Launch OS inspection failed; retained');
    const receiptBytes = new Uint8Array(d.read(join(sessionPath, name), 65536));
    const envelopeBytes = Buffer.from(d.read(join(sessionPath, name + '.collector.json'), 65536));
    const e = exact(JSON.parse(envelopeBytes.toString('utf8')), ['version', 'scopeClaimsVerified', 'authority', 'collectorPlatform', 'collectorNowMs', 'monotonicStart', 'monotonicEnd', 'monotonicFrequency', 'scope', 'rendererCoverage', 'receiptSha256', 'os']);
    recheck(); if (!Buffer.from(d.read(requestPath, 8192)).equals(request)) throw Error('Launch inspection request changed');
    const now = d.now(), elapsed = d.monotonic() - mono;
    if (elapsed < 0 || elapsed > 5000 || Math.abs(now - start - elapsed) > 1000 || e.version !== 1 || e.scopeClaimsVerified !== false || e.authority !== 'os-process-identity-only' || e.collectorPlatform !== 'win32' || e.scope !== 'bound-process-tree' || e.rendererCoverage !== 'unavailable' || e.receiptSha256 !== sha(receiptBytes) || !Number.isSafeInteger(e.collectorNowMs) || e.collectorNowMs < start || now - e.collectorNowMs < 0 || now - e.collectorNowMs > 5000 || ![e.monotonicStart,e.monotonicEnd,e.monotonicFrequency].every(Number.isSafeInteger) || e.monotonicFrequency <= 0 || e.monotonicEnd < e.monotonicStart || (e.monotonicEnd-e.monotonicStart)*1000/e.monotonicFrequency > elapsed+1000) throw Error('Fresh launch OS proof refused');
    const expected = { ...scope, receiptSha256: sha(receiptBytes), rootExecutableSha256: pinned.executable.sha256 };
    const proof = validateResourceOwnership({ expected, receiptBytes, os: e.os, nowMs: now });
    const record = { version: 1, kind: 'trusted-pc-launch-owner-v1', scope, root: proof.root, files: Object.fromEntries(recordKeys.map(k => [k,pinned[k]])), maxMs, features };
    const recordBytes = Buffer.from(JSON.stringify(record)), recordPath = join(sessionPath, `measurement-launch-owner-${String(generation).padStart(3,'0')}.json`);
    if (published.has(generation)) {
      if (!recordBytes.equals(published.get(generation)) || !Buffer.from(d.read(recordPath,65536)).equals(recordBytes)) throw Error('Same-generation runtime changed');
    } else {
      if (generation !== published.size + 1) throw Error('Launch generation skipped');
      d.create(recordPath, recordBytes);
      d.create(recordPath + '.manifest.json', Buffer.from(JSON.stringify({ version:1, launchIntentSha256: sha(raw), launchSourceCommit, sealedSource: source, recordSha256: sha(recordBytes), inspectionEnvelopeSha256: sha(envelopeBytes), inspectionReceiptSha256: sha(receiptBytes) })));
      published.set(generation, Buffer.from(recordBytes));
    }
    return Object.freeze({ recordPath, recordSha256: sha(recordBytes), generation });
  } });
}
/** Browser generation is owned by forwarded caller requests, never reply JSON. */
export function browserMeasurementOwner(channel, sessionPath, taskName) {
  if (!channel) return Object.freeze({ request() {}, async attest() {} });
  let generation = 1, pendingRestart = false, ready = false;
  return Object.freeze({ request(type) { if (type === 'restart') { if (!ready || pendingRestart) throw Error('Uncorrelated measurement restart'); pendingRestart = true; } },
    async attest(type) { if (type === 'restart') { if (!pendingRestart) throw Error('Unrequested measurement generation'); generation++; pendingRestart = false; } else if (type !== 'attest' || pendingRestart) throw Error('Measurement attestation order refused'); await channel.publish({ generation, sessionPath, taskName }); ready = true; } });
}
