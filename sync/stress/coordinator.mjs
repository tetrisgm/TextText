import {setTimeout as finiteDelay} from 'node:timers/promises';
import {FiniteSoak, validateSoak, SOAK_LIMITS} from './finite-soak.mjs';
import {validateSoakSample} from './soak-correlation.mjs';
import {validateMixedSchedule,createMixedSchedule,fieldOperations,preflightMixedDocument,MIXED_LIMITS} from './mixed-schedule.mjs';
import {validateLostAckScenario,validateLostAckProof} from './lost-ack.mjs';
import {validateLeafMove,validateLeafProof,compareLeafProof} from './leaf-move.mjs';
import {validateFolderCase,validateFolderProof,compareFolderProof} from './folder-case.mjs';
import { checkFaultProof } from './malformed-repair.mjs';
import { checkWriteProgress } from './file-write-sequence.mjs';
import { documentObservation, checkMultiFieldAccounting } from './multi-field.mjs';
import { checkFieldProgress } from './multi-field-input.mjs';
import { checkUndoRedoProgress } from './undo-redo.mjs';
import { boundedFile, canonicalJSON, sha256 } from './identity-observation.mjs';
import { normalizeIdentity, checkIdentity, checkRetainedWindowAttestation, checkMacWindowCloseProof, normalizeInitialPack, verifyReopenIdentity, checkRestartAttestation } from './identity.mjs';
// Bounded six-client stress coordinator. Finite seeded rounds, all-ready barrier, concurrent dispatch,
// exact convergence, first-failure stop with preserved evidence. No background service.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkInputProgress } from './input-sequence.mjs';
import { ProcessAdapter, redact } from './adapter.mjs';

export const ROLES = ['mac-app', 'mac-web', 'mac-cli', 'pc-app', 'pc-web', 'pc-cli'];
export const EDITOR_ROLES = ROLES.filter((r) => !r.endsWith('-cli'));
const MODES = new Set(['real', 'simulated']);
const MAX_TEXT = 64 * 1024;
export const REQUIRED_CONVERGENCE_SAMPLES = 3;
const WORDS = ['alpha', 'bravo', 'delta', 'echo', 'kilo', 'lima', 'oscar', 'tango', 'yankee', 'zulu'];
export const REPLACE_TARGET = 'Existing fixture text.';
export const PARTIAL_REPLACE_TARGET = 'fixture text.';

export const machineOf = (role) => role.split('-')[0];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const normalizeText = (text) =>
  String(text).replace(/\r\n/g, '\n');
export const hashText = (text) => createHash('sha256').update(normalizeText(text)).digest('hex');
const assetReplacementsOf = (config) => config.assetReplacements ?? (config.assetReplacement ? [config.assetReplacement] : []);
const assetPathsOf = (config) => [...new Set([...Object.keys(config.expectedAssetHashes ?? {}),
  ...assetReplacementsOf(config).map(a => a.path)])];
const replacementDigest = a => createHash('sha256').update(Buffer.from(a.bytesBase64, 'base64')).digest('hex');

// Deterministic per-round edit plan from the seed.
export function planRounds(seed, rounds, pattern = 'append', sustainedTyping, undoRedo, multiField, fileWrites, closeDuringTraffic) {
  const rand = mulberry32(seed);
  const plan = [];
  for (let round = 1; round <= rounds; round += 1) {
    const edits = ROLES.map((role) => {
      const word = WORDS[Math.floor(rand() * WORDS.length)];
      const n = Math.floor(rand() * 1000);
      const marker = `[${role} r${round} ${word}${n}]`;
      const fileReplaceRole = seed % 2 ? 'mac-cli' : 'pc-cli';
      const op = ['file-overlap', 'partial-overlap'].includes(pattern) && role === fileReplaceRole ? 'replace-target'
        : EDITOR_ROLES.includes(role) && ['overlap-replace', 'file-overlap', 'partial-overlap'].includes(pattern) ? 'replace-selection'
        : pattern === 'same-position' && EDITOR_ROLES.includes(role) ? 'insert-start' : 'append';
      const text = pattern === 'unicode' ? `🌿 café 東京 ${marker} 🧪` : marker;
      const fileChunks = fileWrites?.role === role ? [...Array.from({ length: fileWrites.writes - 1 }, (_, i) => `⟦${role}:r${round}:write${i + 1}⟧`), marker] : null;
      const typing = closeDuringTraffic?.trafficRole === role ? closeDuringTraffic : sustainedTyping && EDITOR_ROLES.includes(role) ? sustainedTyping : null;
      const chunks = typing ? [...Array.from({ length: typing.chunks - 1 }, (_, i) => `⟦${role}:${round}:${i + 1}:café🌿⟧`), marker] : null;
      const fieldEdits = multiField ? ['body','subtitle'].map(field => ({ role, id: `r${round}-${role}-${field}`, op: 'append', field, text: field === 'body' ? text : `⟦${role}:r${round}:subtitle:${word}${n}⟧` })) : null;
      return { role, ...(fileChunks ? { fileWriteSequence: { mode: fileWrites.mode, chunks: fileChunks, intervalMs: fileWrites.intervalMs } } : {}), ...(fieldEdits ? { fieldEdits } : {}), ...(undoRedo && EDITOR_ROLES.includes(role) ? { undoRedo: true } : {}), ...(chunks ? { inputSequence: { chunks, intervalMs: typing.intervalMs } } : {}), id: `r${round}-${role}`, op, text: fileChunks ? fileChunks.join('') : chunks ? chunks.join('') : text };
    });
    plan.push({ round, edits });
  }
  return plan;
}

export function validateConfig(config) {
  const fail = (m) => { throw new Error(`config: ${m}`); };
  if (!config || typeof config !== 'object') fail('must be an object');
  if (!MODES.has(config.mode)) fail('mode must be "real" or "simulated"');
  if (!Number.isInteger(config.seed)) fail('seed must be an integer');
  if (!Number.isInteger(config.rounds) || config.rounds < 0 || config.rounds > 10_000) fail('rounds must be 0..10000');
  if (config.pattern !== undefined && !['append', 'same-position', 'unicode', 'overlap-replace', 'file-overlap', 'partial-overlap'].includes(config.pattern)) fail('unknown pattern');
  if (['overlap-replace', 'file-overlap', 'partial-overlap'].includes(config.pattern) && config.rounds > 1) fail('overlap patterns allow one round or a zero-round reopen');
  if (config.closeDuringTraffic !== undefined) {
    const c = config.closeDuringTraffic;
    if (!c || Object.keys(c).some(key=>!['role','trafficRole','chunks','intervalMs'].includes(key)) || !['mac-app','pc-app'].includes(c.role) || !['mac-web','pc-web'].includes(c.trafficRole) || !Number.isInteger(c.chunks) || c.chunks < 4 || c.chunks > 16 || !Number.isInteger(c.intervalMs) || c.intervalMs < 100 || c.intervalMs > 250 || config.rounds > 1 || config.fileWrites || config.multiField || config.sustainedTyping || config.undoRedo || config.assetReplacement || config.assetReplacements || config.transientInvalid || config.malformedRepair || config.offline || config.restart || config.closeProbe || (config.pattern ?? 'append') !== 'append') fail('closeDuringTraffic requires mac-app/pc-app, one browser peer, chunks4..16, intervalMs100..250 and one isolated append round or reopen');
    config.closeDuringTraffic = {role:c.role,trafficRole:c.trafficRole,chunks:c.chunks,intervalMs:c.intervalMs};
    if (config.rounds === 0 && !/^[a-f0-9]{64}$/.test(config.expectedDocumentHash ?? '')) fail('closeDuringTraffic reopen requires expectedDocumentHash');
  }
  if (config.malformedRepair !== undefined) {
    const f = config.malformedRepair;
    if (!f || Object.keys(f).some(key => !['role','kind','holdMs'].includes(key)) || !['mac-cli','pc-cli'].includes(f.role) || !['truncated-zip','invalid-document-json'].includes(f.kind) || !Number.isInteger(f.holdMs) || f.holdMs < 100 || f.holdMs > 1000 || config.rounds > 20 || config.fileWrites || config.multiField || config.sustainedTyping || config.undoRedo || config.assetReplacement || config.assetReplacements || config.transientInvalid || config.offline || config.restart || config.closeProbe || (config.pattern ?? 'append') !== 'append') fail('malformedRepair requires one CLI, bounded kind/holdMs100..1000, at most20rounds and isolated plain append');
    config.malformedRepair = { role: f.role, kind: f.kind, holdMs: f.holdMs };
    if (config.rounds === 0 && !/^[a-f0-9]{64}$/.test(config.expectedDocumentHash ?? '')) fail('malformedRepair reopen requires expectedDocumentHash');
  }
  if (config.fileWrites !== undefined) {
    const writes = config.fileWrites;
    if (!writes || !['mac-cli','pc-cli'].includes(writes.role) || !['atomic','in-place'].includes(writes.mode) || !Number.isInteger(writes.writes) || writes.writes < 1 || writes.writes > 8 || !Number.isInteger(writes.intervalMs) || writes.intervalMs < 10 || writes.intervalMs > 250 || config.rounds * (writes.writes + 5) > 600 || config.multiField || config.sustainedTyping || config.undoRedo || config.assetReplacement || config.assetReplacements || config.transientInvalid || (config.pattern ?? 'append') !== 'append') fail('fileWrites requires one CLI, atomic/in-place, 1..8 writes, intervalMs10..250, at most600suboperations and plain append');
    config.fileWrites = { role: writes.role, mode: writes.mode, writes: writes.writes, intervalMs: writes.intervalMs };
  }
  if (config.fileWrites && config.rounds === 0 && !/^[a-f0-9]{64}$/.test(config.expectedDocumentHash ?? '')) fail('file-write reopen requires expectedDocumentHash');
  if (config.multiField !== undefined && (config.multiField !== true || config.sustainedTyping || config.undoRedo || config.assetReplacement || config.assetReplacements || config.diagnosticSameEntryRace || (config.pattern ?? 'append') !== 'append')) fail('multiField requires plain append and excludes other input/asset scenarios');
  if (config.multiField && config.rounds === 0 && !/^[a-f0-9]{64}$/.test(config.expectedDocumentHash ?? '')) fail('multi-field reopen requires expectedDocumentHash');
  if (config.undoRedo !== undefined && (config.undoRedo !== true || config.sustainedTyping || (config.pattern ?? 'append') !== 'append')) fail('undoRedo requires append and excludes sustainedTyping');
  if (config.sustainedTyping !== undefined && (!config.sustainedTyping || (config.pattern ?? 'append') !== 'append'
    || !Number.isInteger(config.sustainedTyping.chunks) || config.sustainedTyping.chunks < 2 || config.sustainedTyping.chunks > 16
    || !Number.isInteger(config.sustainedTyping.intervalMs) || config.sustainedTyping.intervalMs < 10 || config.sustainedTyping.intervalMs > 250)) fail('sustainedTyping requires append, 2..16 chunks and intervalMs 10..250');
  if (config.rounds === 0 && !/^[a-f0-9]{64}$/.test(config.expectedBaselineHash ?? '')) fail('a zero-round reopen requires expectedBaselineHash');
  if (config.expectedAssetHashes !== undefined) {
    const assets = config.expectedAssetHashes;
    if (!assets || typeof assets !== 'object' || Array.isArray(assets) || Object.keys(assets).length > 32
      || Object.entries(assets).some(([path, hash]) => !path.startsWith('assets/')
        || path.split('/').some(part => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))
        || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) fail('expectedAssetHashes must contain up to 32 safe asset paths and SHA-256 hashes');
  }
  if (config.assetReplacement !== undefined && config.assetReplacements !== undefined) fail('use one asset replacement format');
  if (config.assetReplacements !== undefined && (!Array.isArray(config.assetReplacements) || config.assetReplacements.length !== 2))
    fail('assetReplacements must contain one edit for each CLI actor');
  if (config.diagnosticSameEntryRace !== undefined && config.diagnosticSameEntryRace !== true) fail('diagnosticSameEntryRace must be true');
  if (config.diagnosticSameEntryRace && !config.assetReplacements) fail('diagnosticSameEntryRace requires two assetReplacements');
  const replacementKeys = new Set(), replacementPaths = new Set();
  for (const a of assetReplacementsOf(config)) {
    if (!a || !['mac-cli', 'pc-cli'].includes(a.role) || !Number.isInteger(a.round) || a.round < 1 || a.round > config.rounds
      || typeof a.path !== 'string' || !a.path.startsWith('assets/')
      || a.path.split('/').some(part => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))
      || typeof a.bytesBase64 !== 'string' || a.bytesBase64.length > 96 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.bytesBase64)
      || !a.bytesBase64.length || (!config.diagnosticSameEntryRace && (!config.expectedAssetHashes
      || config.expectedAssetHashes[a.path] !== replacementDigest(a)))) {
      fail('assetReplacement must be a bounded CLI asset edit matching expectedAssetHashes');
    }
    const key = `${a.role}:${a.round}`;
    if (replacementKeys.has(key) || (!config.diagnosticSameEntryRace && replacementPaths.has(a.path))) fail('assetReplacements must use distinct actors and paths');
    replacementKeys.add(key); replacementPaths.add(a.path);
  }
  if (config.assetReplacements && new Set(config.assetReplacements.map(a => a.role)).size !== 2)
    fail('assetReplacements must use both CLI actors');
  if (config.assetReplacements && config.assetReplacements[0].round !== config.assetReplacements[1].round)
    fail('assetReplacements must run in the same round');
  if (config.diagnosticSameEntryRace && (replacementPaths.size !== 1 ||
    replacementDigest(config.assetReplacements[0]) === replacementDigest(config.assetReplacements[1]) ||
    config.expectedAssetHashes !== undefined)) fail('diagnosticSameEntryRace requires two distinct byte values for one path and no expectedAssetHashes');
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 120000) fail('timeoutMs must be 100..120000');
  if (config.soak !== undefined) {
    validateSoak(config.soak);
    if (!Number.isSafeInteger(config.seed)) fail('soak requires a safe integer seed');
    if (!config.mixedSchedule || (config.mode === 'real' && config.rounds !== 0 && config.rounds !== 100)) fail('soak requires mixedSchedule and100 real rounds before dwell');
  }
  if (config.mixedSchedule !== undefined) {
    config.mixedSchedule = validateMixedSchedule(config.mixedSchedule);
    if (config.rounds !== 0 && config.rounds !== config.mixedSchedule.rounds.length || (config.pattern ?? 'append') !== 'append' || config.lostAck || config.leafMove || config.folderCaseMove || config.offline || config.restart || config.closeProbe || config.browserClose || config.closeDuringTraffic || config.malformedRepair || config.transientInvalid || config.fileWrites || config.multiField || config.undoRedo || config.sustainedTyping || config.assetReplacement || config.assetReplacements || config.diagnosticSameEntryRace) fail('mixedSchedule requires exact descriptor count and isolated compatible append kinds');
    createMixedSchedule(config.mixedSchedule, config.seed, planRounds(config.seed, config.mixedSchedule.rounds.length));
    if (config.mode === 'real' && new Set(config.mixedSchedule.rounds.map(round => round.kind)).size < 2) fail('real mixedSchedule requires at least two compatible kinds');
    if (config.mode === 'real' && (!config.expectedAssetHashes || !Object.keys(config.expectedAssetHashes).length)) fail('mixedSchedule requires complete binary asset pins');
    if (config.rounds === 0 && !/^[a-f0-9]{64}$/.test(config.expectedDocumentHash ?? '')) fail('mixedSchedule reopen requires expectedDocumentHash');
  }
  if (config.lostAck !== undefined) {
    config.lostAck = validateLostAckScenario(config.lostAck);
    if (config.mode !== 'real' ||
        config.rounds > 1 ||
        config.leafMove ||
        config.folderCaseMove ||
        config.offline ||
        config.restart ||
        config.closeProbe ||
        config.browserClose ||
        config.closeDuringTraffic ||
        config.malformedRepair ||
        config.transientInvalid ||
        config.fileWrites ||
        config.multiField ||
        config.undoRedo ||
        config.sustainedTyping ||
        config.assetReplacement ||
        config.assetReplacements ||
        config.diagnosticSameEntryRace ||
        (config.pattern ?? 'append') !== 'append') fail('lostAck requires one real isolated append round or independent reopen');
    if (!config.expectedAssetHashes || !Object.keys(config.expectedAssetHashes).length) fail('lostAck requires complete binary asset hash pins');
    if (config.rounds === 0 && !/^[a-f0-9]{64}$/.test(config.expectedDocumentHash ?? '')) fail('lostAck reopen requires expectedDocumentHash');
  }
  if(config.leafMove!==undefined){
    config.leafMove=validateLeafMove(config.leafMove);
    if(config.folderCaseMove||config.rounds>1||config.offline||config.restart||config.closeProbe||config.browserClose||config.closeDuringTraffic||config.malformedRepair||config.transientInvalid||config.fileWrites||config.multiField||config.undoRedo||config.sustainedTyping||config.assetReplacement||config.assetReplacements||(config.pattern??'append')!=='append')fail('leafMove requires one isolated append round or independent reopen');
    if(config.rounds===0&&!/^[a-f0-9]{64}$/.test(config.expectedDocumentHash??''))fail('leafMove reopen requires expectedDocumentHash');
    if(config.mode==='real'&&(!config.expectedAssetHashes||!Object.keys(config.expectedAssetHashes).length))fail('leafMove requires explicit complete binary asset hash pins');
  }
  if(config.folderCaseMove!==undefined){
    config.folderCaseMove=validateFolderCase(config.folderCaseMove);
    if(config.rounds>1||config.offline||config.restart||config.closeProbe||config.browserClose||config.closeDuringTraffic||config.malformedRepair||config.transientInvalid||config.fileWrites||config.multiField||config.undoRedo||config.sustainedTyping||config.assetReplacement||config.assetReplacements||(config.pattern??'append')!=='append')fail('folderCaseMove requires one isolated append round or independent reopen');
    if(config.rounds===0&&!/^[a-f0-9]{64}$/.test(config.expectedDocumentHash??''))fail('folderCaseMove reopen requires expectedDocumentHash');
  }
  if (config.browserClose !== undefined) {
    const close=config.browserClose;
    if (!close || Object.keys(close).some(key=>!['role','round'].includes(key)) || !['mac-web','pc-web'].includes(close.role) || close.round!==1 || config.rounds>1 || config.offline || config.restart || config.closeProbe || config.closeDuringTraffic || config.malformedRepair || config.transientInvalid || config.fileWrites || config.multiField || config.undoRedo || config.sustainedTyping || config.assetReplacement || config.assetReplacements || (config.pattern??'append')!=='append') fail('browserClose requires one browser, round1 and an isolated plain append round or reopen');
    config.browserClose={role:close.role,round:1};
  }
  if (config.offline !== undefined) {
    if (!config.offline || !EDITOR_ROLES.includes(config.offline.role)
      || !Number.isInteger(config.offline.round) || config.offline.round < 1 || config.offline.round > config.rounds) {
      fail('offline must name an app or web editor and an existing round');
    }
  }
  if (config.restart !== undefined) {
    if (!config.restart || !EDITOR_ROLES.includes(config.restart.role)
      || !Number.isInteger(config.restart.round) || config.restart.round < 1 || config.restart.round > config.rounds) {
      fail('restart must name an app or browser editor and an existing round');
    }
  }
  if (config.transientInvalid !== undefined) {
    if (!config.transientInvalid || !['mac-cli', 'pc-cli'].includes(config.transientInvalid.role)
      || !Number.isInteger(config.transientInvalid.round) || config.transientInvalid.round < 1 || config.transientInvalid.round > config.rounds) {
      fail('transientInvalid must name mac-cli or pc-cli and an existing round');
    }
  }
  if (config.closeProbe !== undefined && (config.closeProbe !== true || config.mode !== 'real'
    || config.rounds < 1 || config.restart?.role === 'pc-app')) {
    fail('closeProbe requires a real run with at least one round and no pc-app restart');
  }
  if (config.mode === 'real') {
    if (!config.expectedIdentities || typeof config.expectedIdentities !== 'object'
      || Object.keys(config.expectedIdentities).length !== ROLES.length) fail('real runs require all six expectedIdentities pins');
    for (const role of ROLES) {
      try { normalizeIdentity(config.expectedIdentities[role], role, { expected: true }); }
      catch (error) { fail(`expectedIdentities.${role}: ${error.message}`); }
    }
  }
  const f = config.fixture;
  if (!f || typeof f.workspaceId !== 'string' || !f.workspaceId || typeof f.itemId !== 'string' || !f.itemId) fail('fixture.workspaceId and fixture.itemId are required');
  if (config.mode === 'real' && config.rounds === 0) {
    try { verifyReopenIdentity(JSON.parse(boundedFile(config.reopenReceipt, 1024 * 1024)), config); }
    catch (error) { fail(`reopenReceipt: ${error.message}`); }
  }
  if (!config.roles || typeof config.roles !== 'object') fail('roles object is required');
  const missing = ROLES.filter((r) => !config.roles[r]);
  if (missing.length) fail(`missing roles: ${missing.join(', ')}`);
  const extra = Object.keys(config.roles).filter((r) => !ROLES.includes(r));
  if (extra.length) fail(`unknown roles: ${extra.join(', ')}`);
  for (const role of ROLES) {
    const c = config.roles[role].command;
    if (!Array.isArray(c) || !c.length || c.some((x) => typeof x !== 'string')) fail(`roles.${role}.command must be a non-empty string array`);
  }
  if (typeof config.outputDir !== 'string' || !config.outputDir) fail('outputDir is required');
  return config;
}

// Per-round inbox: rejects stale-round and duplicate events, resolves when every role has reported.
export class RoundLedger {
  constructor(round, type, roles = ROLES) { this.round = round; this.type = type; this.roles = roles; this.got = new Map(); }
  accept(role, message) {
    if (message.type !== this.type) return { ok: false, reason: 'unexpected-type' };
    if (message.round !== this.round) return { ok: false, reason: 'stale-round' };
    if (!this.roles.includes(role)) return { ok: false, reason: 'unknown-role' };
    if (this.got.has(role)) return { ok: false, reason: 'duplicate' };
    this.got.set(role, message);
    return { ok: true };
  }
  get complete() { return this.got.size === this.roles.length; }
  get missing() { return this.roles.filter((r) => !this.got.has(r)); }
}

export class StressFailure extends Error {
  constructor(code, detail) { super(`${code}: ${JSON.stringify(detail)}`); this.code = code; this.detail = detail; }
}

export class Coordinator {
  constructor(config, { adapterFactory, soakClock, soakSleep } = {}) {
    if (config.mode === "real" && (soakClock || soakSleep)) throw Error("Real soak cannot replace monotonic clock or sleep");
    this.soakClock = soakClock ?? (() => performance.now());
    this.soakSleep = soakSleep ?? ((ms, signal) => finiteDelay(ms, undefined, {signal}));
    this.config = validateConfig(config);
    this.mixedPlan=this.config.mixedSchedule?createMixedSchedule(this.config.mixedSchedule,this.config.seed,planRounds(this.config.seed,this.config.mixedSchedule.rounds.length)):null;
    if (this.mixedPlan && this.config.rounds === 0) {
      const prior = JSON.parse(boundedFile(this.config.reopenReceipt, 1024 * 1024));
      verifyReopenIdentity(prior, this.config);
      if (this.config.soak) { this.soakEvidence=prior.soakEvidence; this.soakReopenOf=prior.runId; }
      if (prior.mixedScheduleEvidence?.sha256 !== this.mixedPlan.sha256 || prior.roundsCompleted !== this.mixedPlan.rounds.length || canonicalJSON(prior.mixedScheduleEvidence) !== canonicalJSON(this.scheduleEvidence())) throw Error('Mixed reopen requires identical complete immutable plan');
    }
    this.makeAdapter = adapterFactory ?? ((role, c) => new ProcessAdapter(role, c.command, { cwd: c.cwd, env: c.env }));
    this.adapters = new Map();
    this.rejected = [];
    this.roundResults = [];
    this.attestations = {};
    this.editorBaseline = {};
    this.restartEvidence = {};
    this.retainedActors = {};
    this.normalCloseInFlight = {};
    this.actorStatus = Object.fromEntries(ROLES.map(role => [role, 'starting']));
    this.runId = `stress-${new Date().toISOString().replace(/[:.]/g, '-')}-${config.seed}`;
    if (this.config.lostAck && this.config.rounds === 0) {
      const prior = JSON.parse(boundedFile(this.config.reopenReceipt, 1024 * 1024));
      verifyReopenIdentity(prior, this.config);
      const e = prior.lostAckEvidence;
      if (e?.role !== this.config.lostAck.role ||
          e.round !== 1 ||
          e.faultCount !== 1 ||
          e.postRetrySamples !== REQUIRED_CONVERGENCE_SAMPLES) throw Error('Lost ACK reopen requires prior completed physical fault evidence');
      validateLostAckProof(e.proof, {
        faultId: e.proof?.faultId,
        editId: `r1-${e.role}`,
        phase: 'replayed',
        assetHashes: this.config.expectedAssetHashes
      });
      this.lostAckEvidence = e;
    }
    if(this.config.leafMove){
      this.leafOperationId='lm-'+sha256(this.runId+'\0'+canonicalJSON(this.config.leafMove)).slice(0,32);
      if(this.config.mode==='real'&&this.config.rounds===0){
        const prior=JSON.parse(boundedFile(this.config.reopenReceipt,1024*1024));verifyReopenIdentity(prior,this.config);
        if(!/^lm-[a-f0-9]{32}$/.test(prior.leafMoveEvidence?.operationId??'')||ROLES.some(role=>!prior.leafMoveEvidence.final?.[role]))throw Error('Leaf reopen requires prior six-role physical path evidence');
        this.leafOperationId=prior.leafMoveEvidence.operationId;this.leafMoveEvidence=prior.leafMoveEvidence;
      }
    }
    if(this.config.folderCaseMove){
      this.folderOperationId='fc-'+sha256(this.runId+'\0'+canonicalJSON(this.config.folderCaseMove)).slice(0,32);
      if(this.config.mode==='real'&&this.config.rounds===0){
        const prior=JSON.parse(boundedFile(this.config.reopenReceipt,1024*1024));verifyReopenIdentity(prior,this.config);
        if(!/^fc-[a-f0-9]{32}$/.test(prior.folderCaseEvidence?.operationId??'')||ROLES.some(role=>!prior.folderCaseEvidence.final?.[role]))throw Error('Folder reopen requires prior complete physical path evidence');
        this.folderOperationId=prior.folderCaseEvidence.operationId;this.folderCaseEvidence=prior.folderCaseEvidence;
      }
    }
  }

  plannedRounds(round = this.config.rounds) {
    return this.mixedPlan ? this.mixedPlan.rounds.slice(0, round) : planRounds(this.config.seed, round, this.config.pattern, this.config.sustainedTyping, this.config.undoRedo, this.config.multiField, this.config.fileWrites, this.config.closeDuringTraffic);
  }

  scheduleEvidence() {
    return this.mixedPlan ? {
      version: 1,
      seed: this.mixedPlan.seed,
      sha256: this.mixedPlan.sha256,
      roundCount: this.mixedPlan.rounds.length,
      totals: this.mixedPlan.totals
    } : null;
  }

  accountingOptions() {
    return this.mixedPlan ? {
      maxEdits: MIXED_LIMITS.semanticAdditions
    } : undefined;
  }

  // Fresh output directory; never overwrites an earlier run's evidence.
  openOutput() {
    const dir = join(this.config.outputDir, this.runId);
    if (existsSync(dir)) throw new StressFailure('output-exists', { dir });
    mkdirSync(this.config.outputDir, { recursive: true });
    mkdirSync(dir, { mode: 0o700 });
    mkdirSync(join(dir, 'adapters'));
    this.dir = dir;
    this.resultsPath = join(dir, 'results.jsonl');
    writeFileSync(this.resultsPath, '');
    const scenario = { ...(this.config.soak?{soak:this.config.soak}:{}), ...(this.config.mixedSchedule?{mixedSchedule:this.config.mixedSchedule}:{}), ...(this.config.lostAck?{lostAck:this.config.lostAck}:{}), ...(this.config.leafMove?{leafMove:this.config.leafMove}:{}), ...(this.config.folderCaseMove?{folderCaseMove:this.config.folderCaseMove}:{}), ...(this.config.browserClose ? { browserClose: this.config.browserClose } : {}), ...(this.config.closeDuringTraffic ? { closeDuringTraffic: this.config.closeDuringTraffic } : {}), ...(this.config.malformedRepair ? { malformedRepair: this.config.malformedRepair } : {}), ...(this.config.fileWrites ? { fileWrites: this.config.fileWrites } : {}), ...(this.config.multiField ? { multiField: true } : {}), ...(this.config.undoRedo ? { undoRedo: true } : {}), ...(this.config.sustainedTyping ? { sustainedTyping: this.config.sustainedTyping } : {}), requiredConvergenceSamples: REQUIRED_CONVERGENCE_SAMPLES, pattern: this.config.pattern ?? 'append', offline: this.config.offline ?? null,
      restart: this.config.restart ?? null, transientInvalid: this.config.transientInvalid ?? null,
      ...(this.config.closeProbe ? { closeProbe: true } : {}) };
    if (assetReplacementsOf(this.config).length) scenario.assetReplacements = assetReplacementsOf(this.config).map(a => ({
      role: a.role, round: a.round, path: a.path, sha256: replacementDigest(a) }));
    if (this.config.diagnosticSameEntryRace) scenario.diagnosticSameEntryRace = true;
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({
      seed: this.config.seed,
      fixture: this.config.fixture,
      scenario,
      ...(this.config.soak ? {soak:this.config.soak}:{}),
      ...(this.config.mode === 'real' ? {
        expectedIdentities: Object.fromEntries(ROLES.map(role => [role, normalizeIdentity(this.config.expectedIdentities[role], role, {
          expected: true
        })]))
      } : {}),
      ...(this.mixedPlan ? {
        mixedScheduleEvidence: this.scheduleEvidence()
      } : {}),
      rounds: this.mixedPlan?.rounds ?? this.plannedRounds()
    }, null, 2), {
      flag: 'wx',
      mode: 0o600
    });
    this.record('run-start', { runId: this.runId, seed: this.config.seed, rounds: this.config.rounds, mode: this.config.mode, fixture: this.config.fixture, scenario, ...(this.mixedPlan?{mixedScheduleEvidence:this.scheduleEvidence()}:{}) });
    this.writeDashboard('running');
  }

  record(type, detail) {
    const at = new Date().toISOString();
    let line = JSON.stringify({ at, ...detail, type });
    if (line.length > 16384) line = JSON.stringify({ at, type, truncated: true, preview: line.slice(0, 4096) });
    appendFileSync(this.resultsPath, `${redact(line)}\n`);
  }

  async run() {
    this.openOutput();
    let status = 'passed'; let failure = null;
    try {
      await this.startAdapters();
      const initial = this.collect(0, 'state');
      this.broadcast({ type: 'observe', round: 0, ...(this.config.folderCaseMove&&this.config.rounds===0?{folderCase:this.folderRequest('after')}:{}), ...(this.config.leafMove&&this.config.rounds===0?{leafMove:this.leafRequest('after')}:{}), expectedEditIds: [], expectedAssetPaths: assetPathsOf(this.config), ...((this.config.multiField || this.config.fileWrites || this.config.malformedRepair || this.config.closeDuringTraffic || this.config.folderCaseMove || this.config.leafMove || this.config.lostAck || this.config.mixedSchedule) ? { documentSnapshot: true } : {}) });
      const baseline = await initial;
      const texts = ROLES.map(role => baseline.get(role).text);
      const evidence = {};
      for (const role of ROLES) {
        const state = baseline.get(role);
        const valid = typeof state.text === 'string' && state.text.length <= MAX_TEXT;
        evidence[role] = { hash: valid ? hashText(state.text) : null };
        if (valid) writeFileSync(join(this.dir, 'adapters', `${role}.initial-state.json`), JSON.stringify(state));
      }
      if (texts.some(text => typeof text !== 'string' || text.length > MAX_TEXT) || new Set(texts.map(normalizeText)).size !== 1) throw new StressFailure('baseline-divergence', { evidence });
      this.baseline = normalizeText(texts[0]);
      if (this.config.multiField ||
          this.config.fileWrites ||
          this.config.malformedRepair ||
          this.config.closeDuringTraffic ||
          this.config.folderCaseMove ||
          this.config.leafMove ||
          this.config.lostAck ||
          this.config.mixedSchedule) {
        const documents = this.documentStates(baseline);
        this.documentBaseline = documentObservation(documents.get('mac-app')).snapshot;
        this.finalDocumentHash = checkMultiFieldAccounting(this.documentBaseline, documents, [], this.accountingOptions());
        if (this.config.expectedDocumentHash && this.finalDocumentHash !== this.config.expectedDocumentHash) throw new StressFailure('reopen-document-mismatch', {});
      }
      if (this.mixedPlan && this.config.rounds > 0) {
        this.mixedPreflight = preflightMixedDocument(this.mixedPlan, this.documentBaseline, {
          assetHashes: this.config.expectedAssetHashes ?? {}
        });
        this.record('mixed-schedule-preflight', {
          sha256: this.mixedPlan.sha256,
          ...this.mixedPreflight
        });
      }
      if (this.config.mode === 'real') {
        if ((this.config.malformedRepair ||
            this.config.closeDuringTraffic ||
            this.config.folderCaseMove ||
            this.config.leafMove ||
            this.config.lostAck ||
            this.config.mixedSchedule) &&
            canonicalJSON(this.config.expectedAssetHashes ?? {}) !== canonicalJSON(this.attestations['mac-cli'].initialPack.assetHashes)) throw new StressFailure('scenario-all-assets-required', {});
        const files = ['mac-cli', 'pc-cli'].map(role => ({ role, ...this.attestations[role].initialPack }));
        if (files.some(file => file.bodySha256 !== hashText(this.baseline)) || files[0].documentSha256 !== files[1].documentSha256
          || JSON.stringify(files[0].assetHashes) !== JSON.stringify(files[1].assetHashes))
          throw new StressFailure('fixture-semantic-mismatch', { files });
      }
      if (['overlap-replace', 'file-overlap', 'partial-overlap'].includes(this.config.pattern) && this.config.rounds > 0 && this.baseline.split(REPLACE_TARGET).length !== 2) {
        throw new StressFailure('replacement-fixture-invalid', { target: REPLACE_TARGET, count: this.baseline.split(REPLACE_TARGET).length - 1 });
      }
      if (this.config.expectedBaselineHash && hashText(this.baseline) !== this.config.expectedBaselineHash) {
        throw new StressFailure('reopen-hash-mismatch', { expected: this.config.expectedBaselineHash, evidence });
      }
      if (this.config.rounds === 0) {this.checkAssets(baseline, 0);if(this.config.folderCaseMove)this.checkFolderReopen(baseline);if(this.config.leafMove)this.checkLeafReopen(baseline);}
      for (const role of EDITOR_ROLES) this.checkEditor(0, role, baseline.get(role).editor);
      if (this.config.rounds === 0) {
        this.record('reopen-sample', { sample: 1, hash: this.config.expectedBaselineHash, roles: ROLES });
        for (let sample = 2; sample <= REQUIRED_CONVERGENCE_SAMPLES; sample++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const pending = this.collect(0, 'state');
          this.broadcast({ type: 'observe', round: 0, ...(this.config.folderCaseMove&&this.config.rounds===0?{folderCase:this.folderRequest('after')}:{}), ...(this.config.leafMove&&this.config.rounds===0?{leafMove:this.leafRequest('after')}:{}), expectedEditIds: [], expectedAssetPaths: assetPathsOf(this.config), ...((this.config.multiField || this.config.fileWrites || this.config.malformedRepair || this.config.closeDuringTraffic || this.config.folderCaseMove || this.config.leafMove || this.config.lostAck || this.config.mixedSchedule) ? { documentSnapshot: true } : {}) });
          const states = await pending;
          for (const role of ROLES) {
            const state = states.get(role);
            if (!state || typeof state.text !== 'string' || state.text.length > MAX_TEXT
              || hashText(state.text) !== this.config.expectedBaselineHash)
              throw new StressFailure('reopen-hash-mismatch', { role, sample, expected: this.config.expectedBaselineHash });
          }
          if ((this.config.multiField ||
              this.config.fileWrites ||
              this.config.malformedRepair ||
              this.config.closeDuringTraffic ||
              this.config.folderCaseMove ||
              this.config.leafMove ||
              this.config.lostAck ||
              this.config.mixedSchedule) &&
              checkMultiFieldAccounting(this.documentBaseline, this.documentStates(states), [], this.accountingOptions()) !== this.config.expectedDocumentHash) throw new StressFailure('reopen-document-mismatch', { sample });
          this.checkAssets(states, 0);if(this.config.folderCaseMove)this.checkFolderReopen(states);if(this.config.leafMove)this.checkLeafReopen(states);
          for (const role of EDITOR_ROLES) this.checkEditor(0, role, states.get(role).editor);
          this.record('reopen-sample', { sample, hash: this.config.expectedBaselineHash, roles: ROLES });
        }
      }
      for (const plan of this.plannedRounds()) await this.runRound(plan);
      if (this.config.soak && this.config.rounds > 0) await this.runSoak();
      if (this.config.closeProbe) await this.closeProbe();
    } catch (error) {
      status = 'failed';
      failure = error instanceof StressFailure ? { code: error.code, detail: error.detail } : { code: 'unexpected', detail: { message: String(error?.message ?? error) } };
      this.record('failure', failure);
    } finally {
      const stopped = await this.stopAdapters();
      const failed = stopped.filter(({ exit }) => exit?.code !== 0 || exit?.signal);
      if (status === 'passed' && failed.length) {
        status = 'failed';
        failure = { code: 'shutdown-failed', detail: { actors: failed } };
        this.record('failure', failure);
      }
    }
    const summary = {
      runId: this.runId, status, failure, mode: this.config.mode, fixture: { workspaceId: this.config.fixture.workspaceId, itemId: this.config.fixture.itemId },
      finalHash: this.roundResults.at(-1)?.hash ?? (status === 'passed' ? this.config.expectedBaselineHash ?? (this.baseline ? hashText(this.baseline) : null) : null),
      ...((this.config.multiField || this.config.fileWrites || this.config.malformedRepair || this.config.closeDuringTraffic || this.config.folderCaseMove || this.config.leafMove || this.config.lostAck || this.config.mixedSchedule) ? { finalDocumentHash: this.finalDocumentHash ?? null } : {}),
      expectedAssetHashes: this.config.expectedAssetHashes ?? {},
      // Simulated runs never count as real acceptance, whatever their status.
      acceptance: status === 'passed' && this.config.mode === 'real' && !this.config.diagnosticSameEntryRace
        ? (this.config.soak ? 'six-client-finite-dwell-partial-not-full-T24' : this.config.closeProbe ? 'six-client-windows-close-probe' : this.config.rounds === 0 ? 'six-client-reopen' : this.config.mixedSchedule ? 'six-client-compatible-mixed-schedule' : this.config.lostAck ? 'six-client-browser-lost-ack' : this.config.leafMove ? 'six-client-external-leaf-move' : this.config.folderCaseMove ? 'six-client-folder-case-move' : this.config.browserClose ? 'six-client-browser-normal-close' : this.config.closeDuringTraffic ? 'six-client-close-during-traffic' : this.config.malformedRepair ? 'six-client-malformed-repair' : this.config.fileWrites ? 'six-client-file-writes' : this.config.multiField ? 'six-client-multi-field' : this.config.undoRedo ? 'six-client-undo-redo' : this.config.sustainedTyping ? 'six-client-sustained-typing' : this.config.pattern === 'same-position' ? 'six-client-same-position' : this.config.pattern === 'unicode' ? 'six-client-unicode' : this.config.pattern === 'overlap-replace' ? 'six-client-overlap-replace' : this.config.pattern === 'file-overlap' ? 'six-client-file-overlap' : this.config.pattern === 'partial-overlap' ? 'six-client-partial-overlap' : 'six-client-append-only') : 'none',
      scenario: { ...(this.config.soak?{soak:this.config.soak}:{}), ...(this.config.mixedSchedule?{mixedSchedule:this.config.mixedSchedule}:{}), ...(this.config.lostAck?{lostAck:this.config.lostAck}:{}), ...(this.config.leafMove?{leafMove:this.config.leafMove}:{}), ...(this.config.folderCaseMove?{folderCaseMove:this.config.folderCaseMove}:{}), ...(this.config.browserClose ? { browserClose: this.config.browserClose } : {}), ...(this.config.closeDuringTraffic ? { closeDuringTraffic: this.config.closeDuringTraffic } : {}), ...(this.config.malformedRepair ? { malformedRepair: this.config.malformedRepair } : {}), ...(this.config.fileWrites ? { fileWrites: this.config.fileWrites } : {}), ...(this.config.multiField ? { multiField: true } : {}), ...(this.config.undoRedo ? { undoRedo: true } : {}), ...(this.config.sustainedTyping ? { sustainedTyping: this.config.sustainedTyping } : {}), requiredConvergenceSamples: REQUIRED_CONVERGENCE_SAMPLES, pattern: this.config.pattern ?? 'append', offline: this.config.offline ?? null,
        restart: this.config.restart ?? null, transientInvalid: this.config.transientInvalid ?? null,
        ...(this.config.closeProbe ? { closeProbe: true } : {}),
        ...(assetReplacementsOf(this.config).length ? { assetReplacements: assetReplacementsOf(this.config).map(a => ({
          role: a.role, round: a.round, path: a.path, sha256: replacementDigest(a) })) } : {}),
        ...(this.config.diagnosticSameEntryRace ? { diagnosticSameEntryRace: true } : {}) },
      roundsCompleted: this.roundResults.length, roundsPlanned: this.config.rounds, rejected: this.rejected.length,
      ...(this.soakEvidence?{soakEvidence:this.soakEvidence,...(this.soakReopenOf?{soakReopenOf:this.soakReopenOf}:{})}:{}), ...(this.mixedPlan?{mixedScheduleEvidence:this.scheduleEvidence(),mixedPreflight:this.mixedPreflight??null}:{}), ...(this.lostAckEvidence?{lostAckEvidence:this.lostAckEvidence}:{}), ...(this.leafMoveEvidence?{leafMoveEvidence:this.leafMoveEvidence}:{}), ...(this.folderCaseEvidence?{folderCaseEvidence:this.folderCaseEvidence}:{}), attestations: this.attestations, retainedActors:this.retainedActors, outputDir: this.dir,
    };
    writeFileSync(join(this.dir, 'summary.json'), JSON.stringify(summary, null, 2));
    this.record('run-end', summary);
    this.writeDashboard(status, failure);
    return summary;
  }

  async runSoak() {
    const round = this.config.rounds, expectedEditIds = this.plannedRounds().flatMap(p => p.edits.map(e => e.id)).sort();
    const clock = this.soakClock, start = clock(), states = new Map();
    const bindings = Object.fromEntries(ROLES.map(role => [role, sha256(canonicalJSON({attestation:this.attestations[role], editor:this.editorBaseline[role]??null}))]));
    const soak = new FiniteSoak({spec:this.config.soak, runId:this.runId, startMs:start, identities:bindings,
      oracle:(role,state) => {
        if (EDITOR_ROLES.includes(role)) this.checkEditor(round,role,state.editor);
        const observed = documentObservation(state.documentSnapshot);
        return observed.hash === this.finalDocumentHash && observed.snapshot.content.body === state.text;
      }});
    let current, resolveSample, rejectSample, fatal;
    const listeners = [], abort = new AbortController();
    const fail = error => { fatal ??= error; rejectSample?.(fatal); abort.abort(); };
    for (const [role,adapter] of this.adapters) {
      const message = state => {
        if (state.type !== 'state') { if (state.type === 'error') fail(new Error('Soak actor failed')); return; }
        try {
          const sample = validateSoakSample(state.soakSample,this.runId);
          if (!sample || !current || state.round !== round) throw Error('Missing or stale soak correlation');
          states.set(role,state);
          const complete = soak.receive({sampleId:sample.id,role,identity:sha256(canonicalJSON({attestation:this.attestations[role],editor:EDITOR_ROLES.includes(role)?state.editor:null})),observation:state,evidenceBytes:Buffer.byteLength(JSON.stringify({sampleId:sample.id,role,hash:documentObservation(state.documentSnapshot).hash,editor:state.editor??null}))},clock());
          if (complete) {
            this.checkRoundContent(states,round,expectedEditIds);
            if (!this.checkAssets(states,round) || checkMultiFieldAccounting(this.documentBaseline,this.documentStates(states),fieldOperations(this.plannedRounds()),this.accountingOptions()) !== this.finalDocumentHash) throw Error('Soak full oracle mismatch');
            resolveSample();
          }
        } catch(error) { fail(new StressFailure('soak-sample-failed',{role,sampleId:current?.sampleId??null,reason:String(error.message).slice(0,200)})); }
      };
      const exit = () => fail(new StressFailure('soak-actor-exited',{role,sampleId:current?.sampleId??null}));
      const error = () => fail(new StressFailure('soak-adapter-error',{role,sampleId:current?.sampleId??null}));
      adapter.on('message',message);adapter.on('exit',exit);adapter.on('error',error);
      listeners.push(()=>{adapter.off('message',message);adapter.off('exit',exit);adapter.off('error',error);});
    }
    try {
      for(let index=0;index<SOAK_LIMITS.samples;index++) {
        const due=start+index*SOAK_LIMITS.cadenceMs;
        while(clock()<due) { if(fatal) throw fatal; await this.soakSleep(Math.max(1,due-clock()),abort.signal); }
        if(fatal) throw fatal;
        states.clear();current=soak.begin(clock());
        let timer;
        const pending=new Promise((resolve,reject)=>{resolveSample=resolve;rejectSample=reject;timer=setTimeout(()=>reject(new StressFailure('soak-response-timeout',{sampleId:current.sampleId,missing:ROLES.filter(role=>!states.has(role))})),Math.max(1,current.deadlineMs-clock()));});
        this.broadcast({type:'observe',round,soakSample:{version:1,id:current.sampleId},expectedEditIds,expectedAssetPaths:assetPathsOf(this.config),documentSnapshot:true});
        try {await pending;} finally {clearTimeout(timer);resolveSample=rejectSample=null;}
        if(fatal)throw fatal;
        this.record('soak-sample',{sampleId:current.sampleId,index,elapsedMs:clock()-start,documentHash:this.finalDocumentHash,roles:ROLES});
      }
      this.soakEvidence=soak.result(clock());
    } finally {abort.abort();listeners.forEach(remove=>remove());}
  }

  async startAdapters() {
    for (const role of ROLES) {
      const adapter = this.makeAdapter(role, this.config.roles[role]);
      adapter.on('reject', (r) => this.reject(r));
      adapter.on('error', (error) => this.record('adapter-error', { role, message: String(error?.message ?? error) }));
      this.adapters.set(role, adapter);
    }
    const pending = this.collect(0, 'attest');
    for (const [role, adapter] of this.adapters) {
      adapter.start();
      adapter.send({ type: 'hello', runId: this.runId, role, mode: this.config.mode, ...(this.config.mode === 'real' ? { identitySchema: 1 } : {}), fixture: this.config.fixture });
    }
    const attest = await pending;
    this.checkAttestations(attest);
    if (this.config.soak && ROLES.some(role => attest.get(role)?.finiteSoakCorrelation !== 1)) throw new StressFailure('soak-correlation-capability-missing', {});
  }

  checkAttestations(attest) {
    const byMachine = {};
    for (const role of ROLES) {
      const a = attest.get(role);
      const f = this.config.fixture;
      if (!MODES.has(a.mode)) throw new StressFailure('attest-mode', { role, mode: a.mode });
      if (a.adapter === 'fake-adapter' && a.mode === 'real') throw new StressFailure('mode-mismatch', { role, reason: 'test adapter cannot provide physical evidence' });
      if (a.mode !== this.config.mode) throw new StressFailure('mode-mismatch', { role, expected: this.config.mode, actual: a.mode });
      if (a.workspaceId !== f.workspaceId || a.itemId !== f.itemId) throw new StressFailure('fixture-mismatch', { role, expected: f, actual: { workspaceId: a.workspaceId, itemId: a.itemId } });
      if (typeof a.machineId !== 'string' || !a.machineId || a.machineId.length > 160 || /[\x00-\x1f]/.test(a.machineId)) throw new StressFailure('machine-missing', { role });
      const m = machineOf(role);
      if (byMachine[m] && byMachine[m] !== a.machineId) throw new StressFailure('machine-mismatch', { machine: m, role, expected: byMachine[m], actual: a.machineId });
      byMachine[m] = a.machineId;
      let identity, initialPack;
      if (this.config.mode === 'real') {
        try {
          identity = checkIdentity(a.identity, this.config.expectedIdentities[role], role);
          if (role.endsWith('-cli')) initialPack = normalizeInitialPack(a.initialPack);
        } catch (error) { throw new StressFailure('identity-mismatch', { role, reason: String(error.message).slice(0, 240) }); }
      }
      this.attestations[role] = { mode: a.mode, machineId: a.machineId.slice(0, 160), adapter: String(a.adapter ?? 'unknown').slice(0, 80),
        ...(identity ? { identity } : {}), ...(initialPack ? { initialPack } : {}),
        ...(a.finiteSoakCorrelation === 1 ? {finiteSoakCorrelation:1} : {}),
        ...(typeof a.sessionId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(a.sessionId) ? { sessionId: a.sessionId } : {}),
        ...(Number.isInteger(a.generation) && a.generation >= 1 && a.generation <= 10000 ? { generation: a.generation } : {}) };
    }
    if (byMachine.mac === byMachine.pc) throw new StressFailure('machine-shared', { machineId: byMachine.mac });
    this.record('attested', { attestations: this.attestations });
  }

  // Wait until every role sends `type` for `round`, within the bounded timeout. Stale/duplicate events are rejected.
  collect(round, type, roles = ROLES) {
    const ledger = new RoundLedger(round, type, roles);
    return new Promise((resolve, reject) => {
      const listeners = new Map();
      const done = (fn) => { clearTimeout(timer); for (const [role, l] of listeners) { this.adapters.get(role).off('message', l.m); this.adapters.get(role).off('exit', l.e); this.adapters.get(role).off('error', l.err); } fn(); };
      const timer = setTimeout(() => done(() => reject(new StressFailure('timeout', { round, phase: type, missing: ledger.missing, timeoutMs: this.config.timeoutMs }))), this.config.timeoutMs);
      for (const role of roles) {
        const adapter = this.adapters.get(role);
        const l = {
          err: () => done(() => reject(new StressFailure('adapter-error', { round, role }))),
          m: (message) => {
            if (type === 'applied' && message.type === 'traffic-progress' && this.config.closeDuringTraffic?.trafficRole === role) return;
            if (message.type === 'error') {
              if (this.config.mode === 'real' && this.config.browserClose?.role === role && this.config.browserClose.round === round && message.round === round && type === 'restart' && message.retained) {
                const r=message.retained;
                if (r.schemaVersion===1 && r.pageRetained===true && r.contextRetained===true && Number.isSafeInteger(r.driverPid) && r.driverPid>1 && Number.isSafeInteger(r.browserPid) && r.browserPid>1 && /^[a-f0-9]{64}$/.test(r.profileScopeHash??'')) {
                  const ownership=adapter.retainForReview();
                  this.retainedActors[role]={schemaVersion:1,driverPid:r.driverPid,browserPid:r.browserPid,profileScopeHash:r.profileScopeHash,pageRetained:true,contextRetained:true,round,reason:'normal-close-refused',driverHostPid:ownership.driverHostPid};
                  this.record('actor-retained-for-review',{role,...this.retainedActors[role]});
                }
              }
              const edit = this.plannedRounds(round).at(-1)?.edits.find(edit => edit.role === role);
              const progress = message.inputProgress;
              const writes = message.writeProgress;
              const writesValid = writes === undefined || (edit && checkWriteProgress(edit, role, writes, false));
              if (writes) this.record('write-prefix-failure', { round, role, valid: writesValid, ...(writesValid ? { writeProgress: writes } : {}) });
              const fields = message.fieldProgress;
              const fieldsValid = fields === undefined || (edit?.fieldEdits && checkFieldProgress(edit.fieldEdits, role, fields, false));
              if (fields) this.record('field-prefix-failure', { round, role, valid: fieldsValid, ...(fieldsValid ? { fieldProgress: fields } : {}) });
              const history = message.historyProgress;
              const historyValid = history === undefined || (edit && checkUndoRedoProgress(edit, history, false));
              if (history) this.record('history-prefix-failure', { round, role, valid: historyValid, ...(historyValid ? { historyProgress: history } : {}) });
              const valid = writesValid && fieldsValid && historyValid && (progress === undefined || (edit && checkInputProgress(edit, progress, false)));
              if (progress) this.record('input-prefix-failure', { round, role, valid, inputProgress: progress });
              return done(() => reject(new StressFailure(!writesValid ? 'write-progress-invalid' : !fieldsValid ? 'field-progress-invalid' : !historyValid ? 'history-progress-invalid' : valid ? 'actor-failed' : 'input-progress-invalid', { round, role, ...(writes && writesValid ? { writeProgress: writes } : {}), ...(fields && fieldsValid ? { fieldProgress: fields } : {}), ...(history && historyValid ? { historyProgress: history } : {}), message: redact(String(message.message ?? '')).slice(0, 500), ...(progress ? { inputProgress: progress } : {}) })));
            }
            const r = ledger.accept(role, message);
            if (!r.ok) return this.reject({ role, reason: r.reason, event: { round: message.round, type: message.type }, expected: { round, type } });
            this.actorStatus[role] = `round ${round}: ${type}`;
            this.writeDashboard('running');
            if (ledger.complete) done(() => resolve(ledger.got));
          },
          e: (exit) => done(() => reject(new StressFailure('actor-exited', { round, role, ...exit, stderr: adapter.stderr.slice(-2000) }))),
        };
        if (adapter.exit) return done(() => reject(new StressFailure('actor-exited', { round, role, ...adapter.exit })));
        adapter.on('message', l.m); adapter.on('exit', l.e); adapter.on('error', l.err); listeners.set(role, l);
      }
    });
  }

  reject(detail) {
    if (this.rejected.length < 1000) { this.rejected.push(detail); this.record('rejected', detail); }
  }
  broadcast(message) { for (const a of this.adapters.values()) a.send(message); }

  checkAssets(states, round) {
    if (this.config.diagnosticSameEntryRace) {
      const path = this.config.assetReplacements[0].path;
      // Both physical files must agree on the final bytes. Different valid
      // hashes are a failed race, never a passing diagnostic.
      const hashes = ['mac-cli', 'pc-cli'].map(role => states.get(role)?.assetHashes?.[path]);
      return hashes.every(hash => /^[a-f0-9]{64}$/.test(hash ?? '')) && hashes[0] === hashes[1];
    }
    const expected = this.config.expectedAssetHashes;
    if (!expected) return true;
    for (const role of ['mac-cli', 'pc-cli']) {
      const actual = states.get(role)?.assetHashes;
      if (!actual || Object.keys(expected).some(path => actual[path] !== expected[path])) {
        if (round === 0) throw new StressFailure('asset-mismatch', { round, role, expected, actual });
        return false;
      }
    }
    return true;
  }

  sendEdit(round, edit, reportTraffic = false) {
    this.adapters.get(edit.role).send({ type: 'edit', round, edit: { ...(reportTraffic ? {reportTraffic:true} : {}), id: edit.id, op: edit.op, text: edit.text, ...(edit.fileWriteSequence ? { fileWriteSequence: edit.fileWriteSequence } : {}), ...(edit.fieldEdits ? { fieldEdits: edit.fieldEdits } : {}), ...(edit.undoRedo ? { undoRedo: true } : {}), ...(edit.inputSequence ? { inputSequence: edit.inputSequence } : {}),
      target: edit.op === 'replace-target' ? this.config.pattern === 'partial-overlap' ? PARTIAL_REPLACE_TARGET : REPLACE_TARGET : undefined,
      assetReplacement: assetReplacementsOf(this.config).filter(a => a.role === edit.role && a.round === round)
        .map(a => ({ path: a.path, bytesBase64: a.bytesBase64 }))[0] } }); // concurrent dispatch
  }

  async applyCloseTraffic(round, edits) {
    const {role,trafficRole} = this.config.closeDuringTraffic;
    const own = edits.find(edit=>edit.role===role), traffic = edits.find(edit=>edit.role===trafficRole);
    const ownPending = this.collect(round,'applied',[role]); this.sendEdit(round,own);
    const applied = await ownPending;
    if(applied.get(role).editId!==own.id) throw new StressFailure('close-own-edit-mismatch',{round,role});
    const adapter = this.adapters.get(trafficRole), start = performance.now();
    let previous=0, lastProgress, during=0, closing=false, completed=false, closePromise, closeError, closeRequestedMs, closeCompletedMs;
    const onProgress = message => {
      if(message.type!=='traffic-progress')return;
      const progress=message.progress;
      if(message.round!==round || !checkInputProgress(traffic,progress,false) || progress.chunks.length!==previous+1) { closeError=new StressFailure('close-traffic-progress-invalid',{round,role:trafficRole});return; }
      previous=progress.chunks.length;lastProgress=progress;
      const elapsedMs=performance.now()-start;
      this.record('close-traffic-progress',{round,role:trafficRole,elapsedMs,progress});
      if(closing&&!completed)during++;
      if(!closing){
        closing=true;closeRequestedMs=elapsedMs;
        const pending=this.collect(round,'close-probe',[role]);this.adapters.get(role).send({type:'close-probe',round,...(role==='mac-app'?{ownEditId:own.id}:{})});
        closePromise=pending.then(results=>{completed=true;closeCompletedMs=performance.now()-start;const result=results.get(role);if(result.closed!==true||result.keepEditingDialog!==false||result.flushed!==true || (role==='mac-app'&&!checkMacWindowCloseProof(result,{fixture:this.config.fixture,ownEditId:own.id,sessionId:this.editorBaseline[role].sessionId,generation:this.attestations[role].generation??1})))throw new StressFailure('close-traffic-normal-close-failed',{round,role,result});if(role==='mac-app')this.record('mac-normal-window-close',{round,role,...result});return result;});
        closePromise.catch(error=>{closeError=error;});
      }
    };
    adapter.on('message',onProgress);
    try {
      const peers=ROLES.filter(peer=>peer!==role),pending=this.collect(round,'applied',peers);
      for(const edit of edits.filter(edit=>edit.role!==role))this.sendEdit(round,edit,edit.role===trafficRole);
      for(const [peer,result]of await pending)applied.set(peer,result);
      if(!closePromise)throw closeError??new StressFailure('close-traffic-progress-missing',{round,role:trafficRole});
      await closePromise;
      if (previous!==traffic.inputSequence.chunks.length || canonicalJSON(lastProgress)!==canonicalJSON(applied.get(trafficRole).inputProgress)) throw new StressFailure('close-traffic-final-prefix-mismatch',{round,role:trafficRole});
      if(closeError)throw closeError;
      if(during<1)throw new StressFailure('close-traffic-insufficient-overlap',{round,role,trafficRole,during,closeRequestedMs,closeCompletedMs});
      this.record('close-during-traffic',{round,role,trafficRole,ownEditId:own.id,observedChunksDuringClose:during,closeRequestedMs,closeCompletedMs,closed:true,flushed:true});
      if(role==='mac-app')await this.reopenRetainedWindow(round);
      else await this.restartActor(round,role,true);
      return applied;
    } finally { adapter.off('message',onProgress); }
  }

  async runMalformed(round) {
    const { role, kind, holdMs } = this.config.malformedRepair;
    const request = async (type, response, extra = {}) => {
      const pending = this.collect(round, response, [role]);
      this.adapters.get(role).send({ type, round, ...extra });
      return (await pending).get(role).proof;
    };
    let installed;
    try {
      installed = await request('installMalformed', 'malformed-installed', { kind });
      if (!checkFaultProof(installed, {role,round,kind})) throw new StressFailure('malformed-install-proof', {role,round});
      this.record('malformed-installed', installed);
      await new Promise(resolve => setTimeout(resolve, holdMs));
      const peers = ROLES.filter(peer => peer !== role);
      const pending = this.collect(round, 'state', peers);
      const expectedEditIds = planRounds(this.config.seed, round - 1).flatMap(plan => plan.edits.map(edit => edit.id)).sort();
      for (const peer of peers) this.adapters.get(peer).send({type:'observe',round,expectedEditIds,expectedAssetPaths:assetPathsOf(this.config),documentSnapshot:true});
      const states = await pending;
      for (const peer of peers) {
        const state = states.get(peer);
        if (EDITOR_ROLES.includes(peer)) this.checkEditor(round, peer, state.editor);
        const doc = documentObservation(state.documentSnapshot);
        if (doc.snapshot.content.body !== state.text || doc.hash !== this.finalDocumentHash || JSON.stringify([...state.editIds].sort()) !== JSON.stringify(expectedEditIds)) throw new StressFailure('malformed-peer-state', {round,role:peer});
        this.record('malformed-peer-state', {round,role:peer,documentHash:doc.hash,editIds:state.editIds,assetHashes:state.assetHashes});
        if (peer.endsWith('-cli') && this.config.expectedAssetHashes && Object.entries(this.config.expectedAssetHashes).some(([path,hash])=>state.assetHashes?.[path]!==hash)) throw new StressFailure('malformed-peer-assets',{round,role:peer});
      }
      const presence = await request('observeMalformed','malformed-present');
      if (!checkFaultProof(presence,{role,round,kind}) || ['originalSha256','faultSha256','fileIdentity'].some(key=>presence[key]!==installed[key]) || !Number.isFinite(presence.heldMs) || presence.heldMs < holdMs) throw new StressFailure('malformed-presence-proof',{round,role});
      this.record('malformed-present',presence);
      const repaired = await request('repairMalformed','malformed-repaired');
      if (!checkFaultProof(repaired,{role,round,kind}) || repaired.repaired!==true || repaired.cleanup!==false || repaired.repairSha256!==installed.originalSha256 || !/^[a-f0-9]{64}$/.test(repaired.repairFileIdentity ?? '') || repaired.repairFileIdentity===installed.fileIdentity || !Number.isFinite(repaired.heldMs) || repaired.heldMs<presence.heldMs || ['originalSha256','faultSha256','fileIdentity'].some(key=>repaired[key]!==installed[key])) throw new StressFailure('malformed-repair-proof',{round,role});
      this.record('malformed-repaired',repaired);
    } catch (error) {
      // Failed observation is still a failed run, even if owned-fault cleanup succeeds.
      try { const cleanup=await request('repairMalformed','malformed-repaired',{cleanup:true});this.record('malformed-cleanup',cleanup); }
      catch (cleanupError) { this.record('malformed-cleanup-refused',{round,role,message:String(cleanupError?.message??cleanupError)}); }
      throw error;
    }
  }

  async runRound({ round, edits }) {
    if(this.config.leafMove)await this.moveLeaf(round,[]);
    const started = Date.now();
    const ready = this.collect(round, 'ready');
    this.broadcast({ type: 'prepare', round, select: ['overlap-replace', 'file-overlap', 'partial-overlap'].includes(this.config.pattern) ? REPLACE_TARGET : undefined });
    await ready;
    if (this.config.lostAck) {
      const role = this.config.lostAck.role,
        edit = edits.find(e => e.role === role);
      this.lostAckId = 'la-' + sha256(this.runId + '\0' + role).slice(0, 32);
      const armed = this.collect(round, 'lost-ack-armed', [role]);
      this.adapters.get(role).send({
        type: 'armLostAck',
        round,
        faultId: this.lostAckId,
        edit
      });
      validateLostAckProof((await armed).get(role).proof, {
        faultId: this.lostAckId,
        editId: edit.id,
        phase: 'armed'
      });
      this.record('lost-ack-armed', {
        round,
        role,
        faultId: this.lostAckId,
        editId: edit.id
      });
    }
    if (this.config.malformedRepair) await this.runMalformed(round);
    const invalidRole = this.config.transientInvalid?.round === round ? this.config.transientInvalid.role : null;
    if (invalidRole) {
      const pendingRepair = this.collect(round, 'perturb', [invalidRole]);
      this.adapters.get(invalidRole).send({ type: 'perturb', round });
      const result = (await pendingRepair).get(invalidRole);
      if (result.repaired !== true) throw new StressFailure('repair-failed', { round, role: invalidRole });
      this.record('repaired-intermediate', { round, role: invalidRole });
    }
    const offlineRole = this.config.offline?.round === round ? this.config.offline.role : null;
    if (offlineRole) await this.setTransport(round, offlineRole, false);
    let applied;
    if (this.config.closeDuringTraffic) applied = await this.applyCloseTraffic(round, edits);
    else { const pending = this.collect(round, 'applied'); for (const edit of edits) this.sendEdit(round, edit); applied = await pending; }
    for (const edit of edits) if (applied.get(edit.role).editId !== edit.id) throw new StressFailure('applied-mismatch', { round, role: edit.role, expected: edit.id, actual: applied.get(edit.role).editId });
    for (const edit of edits) {
      const writeProgress = applied.get(edit.role).writeProgress;
      if (!checkWriteProgress(edit, edit.role, writeProgress)) throw new StressFailure('write-progress-invalid', { round, role: edit.role });
      if (writeProgress) {
        const expectedAssets = this.config.mode === 'real' ? sha256(canonicalJSON(this.attestations[edit.role].initialPack.assetHashes)) : null;
        if (expectedAssets && writeProgress.writes.some(write => write.assetDigest !== expectedAssets)) throw new StressFailure('write-assets-invalid', { round, role: edit.role });
        this.record('write-progress', { round, role: edit.role, writeProgress });
      }
      if (edit.fieldEdits) {
        const reply = applied.get(edit.role);
        if (JSON.stringify(reply.fieldEditIds) !== JSON.stringify(edit.fieldEdits.map(field => field.id)) || (EDITOR_ROLES.includes(edit.role) && !checkFieldProgress(edit.fieldEdits, edit.role, reply.fieldProgress))) throw new StressFailure('field-progress-invalid', { round, role: edit.role });
        this.record('field-progress', { round, role: edit.role, fieldEditIds: reply.fieldEditIds, ...(reply.fieldProgress ? { fieldProgress: reply.fieldProgress } : {}) });
      }
      const progress = applied.get(edit.role).inputProgress;
      if (!checkInputProgress(edit, progress)) throw new StressFailure('input-progress-invalid', { round, role: edit.role, editId: edit.id, inputProgress: progress });
      const history = applied.get(edit.role).historyProgress;
      if (!checkUndoRedoProgress(edit, history)) throw new StressFailure('history-progress-invalid', { round, role: edit.role, editId: edit.id });
      if (history) this.record('history-progress', { round, role: edit.role, ...history });
      if (progress) this.record('input-progress', { round, role: edit.role, ...progress });
    }
    this.record('edit-barrier', { round, roles: ROLES });
    const restartRole = this.config.restart?.round === round ? this.config.restart.role : null;
    if (restartRole) await this.restartActor(round, restartRole);
    if (this.config.browserClose?.round === round) await this.restartActor(round, this.config.browserClose.role, true);
    if (offlineRole) await this.setTransport(round, offlineRole, true);
    const expectedEditIds = this.plannedRounds(round).flatMap((p) => p.edits.map((e) => e.id)).sort();
    // A client can report a locally stable state before another replica's save reaches it.
    // Keep all six actors open while checking convergence; a premature failure shuts down
    // the very sync processes we are measuring. The deadline still makes stalls visible.
    let states, observed, hashes;
    const convergenceDeadline = Date.now() + this.config.timeoutMs;
    let samples = 0, stableSamples = 0, stableHash = null;
    do {
      const observing = this.collect(round, 'state');
      this.broadcast({ type: 'observe', round, expectedEditIds, expectedAssetPaths: assetPathsOf(this.config), ...((this.config.multiField || this.config.fileWrites || this.config.malformedRepair || this.config.closeDuringTraffic || this.config.folderCaseMove || this.config.leafMove || this.config.lostAck || this.config.mixedSchedule) ? { documentSnapshot: true } : {}) });
      states = await observing;
      observed = {};
      for (const role of ROLES) {
        const s = states.get(role);
        if (!s || typeof s.text !== 'string' || s.text.length > MAX_TEXT) throw new StressFailure('state-invalid', { round, role, reason: 'text missing or over bound' });
        writeFileSync(join(this.dir, 'adapters', `${role}.last-state.json`), JSON.stringify({round, text:s.text, editor:s.editor, editIds:s.editIds}));
        observed[role] = { hash: hashText(s.text), editIds: [...new Set(Array.isArray(s.editIds) ? s.editIds : [])].sort(), editor: s.editor };
      }
      hashes = new Set(Object.values(observed).map((o) => o.hash));
      samples++;
      // Adapter-local settling is insufficient: require three separate all-six
      // observations with the same semantic hash and complete operation evidence.
      for (const role of EDITOR_ROLES) this.checkEditor(round, role, observed[role].editor);
      const documents = (this.config.multiField || this.config.fileWrites || this.config.malformedRepair || this.config.closeDuringTraffic || this.config.folderCaseMove || this.config.leafMove || this.config.lostAck || this.config.mixedSchedule) ? this.documentStates(states) : null;
      const documentHashes = documents ? new Set([...documents.values()].map(snapshot => documentObservation(snapshot).hash)) : null;
      if (hashes.size === 1 && (!documentHashes || documentHashes.size === 1) && this.checkAssets(states, round)) {
        this.checkRoundContent(states, round, expectedEditIds);
        if (documents) {
          const fieldEdits = fieldOperations(this.plannedRounds(round));
          this.finalDocumentHash = checkMultiFieldAccounting(this.documentBaseline, documents, fieldEdits, this.accountingOptions());
        }
        const hash = (this.config.multiField || this.config.fileWrites || this.config.malformedRepair || this.config.closeDuringTraffic || this.config.folderCaseMove || this.config.leafMove || this.config.lostAck || this.config.mixedSchedule) ? this.finalDocumentHash : [...hashes][0];
        stableSamples = hash === stableHash ? stableSamples + 1 : 1;
        stableHash = hash;
        this.record('convergence-sample', { round, sample: samples, stableSamples, hash,
          roles: ROLES, editCount: expectedEditIds.length });
        if (stableSamples >= REQUIRED_CONVERGENCE_SAMPLES) break;
      } else { stableSamples = 0; stableHash = null; }
      this.record('convergence-pending', { round, sample: samples, hashes: Object.fromEntries(ROLES.map(r => [r, observed[r].hash])) });
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < convergenceDeadline);
    const evidence = Object.fromEntries(ROLES.map((r) => [r, { hash: observed[r].hash, editIds: observed[r].editIds }]));
    if (hashes.size !== 1) throw new StressFailure('hash-divergence', { round, samples, durationMs: Date.now() - started, evidence });
    if (!this.checkAssets(states, round)) throw new StressFailure('asset-mismatch', { round, expected: this.config.expectedAssetHashes,
      actual: Object.fromEntries(['mac-cli', 'pc-cli'].map(role => [role, states.get(role)?.assetHashes])) });
    if (stableSamples < REQUIRED_CONVERGENCE_SAMPLES) throw new StressFailure('convergence-unstable', { round, samples, stableSamples, required: REQUIRED_CONVERGENCE_SAMPLES });
    if(this.config.leafMove){
      let final,stable=0;const deadline=Date.now()+this.config.timeoutMs;
      do{const pending=this.collect(round,'state');this.broadcast({type:'observe',round,expectedEditIds,expectedAssetPaths:assetPathsOf(this.config),documentSnapshot:true,leafMove:this.leafRequest('after')});const proofStates=await pending;this.checkRoundContent(proofStates,round,expectedEditIds);for(const role of EDITOR_ROLES)this.checkEditor(round,role,proofStates.get(role).editor);
        final=this.leafProofs(proofStates,'after',null,true);const waiting=ROLES.filter(role=>proofStates.get(role).leafMovePending||final[role].documentSha256!==this.finalDocumentHash||documentObservation(proofStates.get(role).documentSnapshot).hash!==this.finalDocumentHash||canonicalJSON(final[role].assetHashes)!==canonicalJSON(this.leafMoveEvidence.before[role].assetHashes));stable=waiting.length?0:stable+1;this.record('leaf-final-sample',{round,stableSamples:stable,pending:waiting,proofs:final});if(stable>=REQUIRED_CONVERGENCE_SAMPLES)break;await new Promise(r=>setTimeout(r,500));
      }while(Date.now()<deadline);
      if(stable<REQUIRED_CONVERGENCE_SAMPLES)throw new StressFailure('leaf-final-state-timeout',{round});this.leafMoveEvidence.final=final;this.record('leaf-move-final',{round,operationId:this.leafOperationId,proofs:final});
    }
    if (this.config.lostAck) {
      const role = this.config.lostAck.role,
        deadline = Date.now() + this.config.timeoutMs;
      let proof;
      do {
        const pending = this.collect(round, 'lost-ack-state', [role]);
        this.adapters.get(role).send({
          type: 'observeLostAck',
          round
        });
        proof = (await pending).get(role).proof;
        validateLostAckProof(proof, {
          faultId: this.lostAckId,
          editId: `r${round}-${role}`,
          phase: proof?.phase,
          assetHashes: this.config.expectedAssetHashes
        });
        this.record('lost-ack-sample', {
          round,
          role,
          proof
        });
        if (proof.phase === 'replayed') break;
        await new Promise(r => setTimeout(r, 500));
      } while (Date.now() < deadline);
      if (proof?.phase !== 'replayed') throw new StressFailure('lost-ack-exact-retry-timeout', {
        round,
        role
      });
      // Repeat full all-six continuity/content/assets observations AFTER the exact
      // original retry ACK was delivered. Pre-retry convergence is insufficient.
      for (let sample = 1; sample <= REQUIRED_CONVERGENCE_SAMPLES; sample++) {
        const pending = this.collect(round, 'state');
        this.broadcast({
          type: 'observe',
          round,
          expectedEditIds,
          expectedAssetPaths: assetPathsOf(this.config),
          documentSnapshot: true
        });
        const after = await pending;
        this.checkRoundContent(after, round, expectedEditIds);
        for (const editor of EDITOR_ROLES) this.checkEditor(round, editor, after.get(editor).editor);
        if (checkMultiFieldAccounting(this.documentBaseline, this.documentStates(after), edits.map(edit => ({
          ...edit,
          field: 'body'
        }))) !== this.finalDocumentHash || !this.checkAssets(after, round)) throw new StressFailure('lost-ack-post-retry-content-mismatch', {
          round,
          sample
        });
        this.record('lost-ack-post-retry-sample', {
          round,
          sample,
          documentHash: this.finalDocumentHash
        });
        if (sample < REQUIRED_CONVERGENCE_SAMPLES) await new Promise(r => setTimeout(r, 500));
      }
      this.lostAckEvidence = {
        role,
        round,
        proof,
        faultCount: 1,
        postRetrySamples: REQUIRED_CONVERGENCE_SAMPLES
      };
      this.record('lost-ack-complete', this.lostAckEvidence);
    }
    if(this.config.folderCaseMove)await this.moveFolderCase(round,expectedEditIds);
    const result = { ...(this.config.lostAck?{lostAckCount:1}:{}), round, hash: [...hashes][0], ...((this.config.multiField || this.config.fileWrites || this.config.malformedRepair || this.config.closeDuringTraffic || this.config.folderCaseMove || this.config.leafMove || this.config.lostAck || this.config.mixedSchedule) ? { documentHash: this.finalDocumentHash, ...(this.config.multiField ? { fieldEditCount: expectedEditIds.length * 2 } : this.config.fileWrites ? { writeSuboperationCount: round * (5 + this.config.fileWrites.writes) } : this.config.malformedRepair ? { faultCount: round } : this.config.folderCaseMove ? {folderCaseMoves:1} : this.config.lostAck ? {lostAckCount:1} : this.config.mixedSchedule ? {} : { closeTrafficCount: 1 }) } : {}), samples, stableSamples, editCount: expectedEditIds.length, durationMs: Date.now() - started,
      ...(this.config.diagnosticSameEntryRace ? { assetHashes: Object.fromEntries(['mac-cli', 'pc-cli'].map(role => [role, states.get(role)?.assetHashes])) } : {}) };
    if (this.mixedPlan) {
      const planned = this.mixedPlan.rounds[round - 1];
      result.scheduleKind = planned.kind;
      result.scheduleCounts = planned.counts;
      result.scheduleSha256 = this.mixedPlan.sha256;
    }
    this.roundResults.push(result);
    this.record('round', result);
    this.writeDashboard('running');
  }

  documentStates(states) {
    const documents = new Map();
    for (const role of ROLES) {
      const state = states.get(role);
      try {
        const observed = documentObservation(state?.documentSnapshot);
        if (observed.snapshot.content.body !== state.text) throw new Error('visible body differs from live snapshot');
        documents.set(role, observed.snapshot);
        if (this.dir) writeFileSync(join(this.dir, 'adapters', `${role}.last-document.json`), observed.canonical);
      } catch { throw new StressFailure('document-state-invalid', { role }); }
    }
    return documents;
  }

  checkRoundContent(states, round, expectedEditIds) {
    for (const role of ROLES) {
      const state = states.get(role);
      if (!state || typeof state.text !== 'string' || state.text.length > MAX_TEXT)
        throw new StressFailure('state-invalid', { round, role });
      const ids = Array.isArray(state.editIds) ? [...state.editIds].sort() : [];
      if (ids.length !== expectedEditIds.length || ids.some((id, i) => id !== expectedEditIds[i])) throw new StressFailure('edit-id-mismatch', { round, role, expected: expectedEditIds, actual: ids });
    }
    for (const role of ROLES) {
      let remaining = normalizeText(states.get(role).text);
      for (const edit of this.plannedRounds(round).flatMap(p => p.edits)) {
        for (const text of edit.fileWriteSequence?.chunks ?? edit.inputSequence?.chunks ?? [edit.text]) {
          if (remaining.split(text).length !== 2) throw new StressFailure('content-mismatch', { round, role, editId: edit.id, text });
          remaining = remaining.replace(text, '');
        }
      }
      const expectedBaseline = ['overlap-replace', 'file-overlap', 'partial-overlap'].includes(this.config.pattern) ? this.baseline.replace(REPLACE_TARGET, '') : this.baseline;
      if (remaining !== expectedBaseline) throw new StressFailure('baseline-lost', { round, role });
    }
  }

  async setTransport(round, role, online) {
    const pending = this.collect(round, 'transport', [role]);
    this.adapters.get(role).send({ type: 'transport', round, online });
    const reply = (await pending).get(role);
    if (reply.online !== online) throw new StressFailure('transport-mismatch', { round, role, online, actual: reply.online });
    this.record('transport', { round, role, online });
  }

  async closeProbe() {
    const role = 'pc-app';
    const pending = this.collect(this.config.rounds, 'close-probe', [role]);
    this.adapters.get(role).send({ type: 'close-probe', round: this.config.rounds });
    const result = (await pending).get(role);
    if (result.closed !== true || result.keepEditingDialog !== false || result.flushed !== true)
      throw new StressFailure('close-probe-failed', { role, result });
    this.record('close-probe', { role, round: this.config.rounds, ...result });
  }

  async reopenRetainedWindow(round) {
    const role='mac-app',pending=this.collect(round,'window-reopen',[role]);
    this.adapters.get(role).send({type:'window-reopen',round,identitySchema:1});
    const reply=(await pending).get(role),generation=this.attestations[role].generation??1,sessionId=this.editorBaseline[role].sessionId;
    if(reply.lifecycle!=='retained-window-reopen'||reply.windowGeneration!==2||reply.generation!==generation||reply.retained!==true)throw new StressFailure('retained-window-reopen-invalid',{round,role});
    let identity;
    if(this.config.mode==='real'){
      try{identity=checkRetainedWindowAttestation(reply.attestation,this.config.expectedIdentities[role],{fixture:this.config.fixture,machineId:this.attestations[role].machineId,sessionId,generation}).identity;}
      catch(error){throw new StressFailure('retained-window-identity-mismatch',{round,role,reason:String(error.message).slice(0,240)});}
    }
    this.checkEditor(round,role,reply.editor);
    this.record('retained-window-reopen',{round,role,generation,windowGeneration:2,sessionId,...(identity?{identity}:{})});
  }

  leafRequest(phase){return{version:1,operationId:this.leafOperationId,phase,scenario:this.config.leafMove};}
  leafProofs(states,phase,before,allowContentPending=false){
    const result={};for(const role of ROLES){const state=states.get(role),pending=state.leafMovePending===true;
      if(typeof state.leafMovePending!=='boolean'||(phase==='before'&&pending)||(EDITOR_ROLES.includes(role)&&state.leafMoveReviewVisible!==false))throw new StressFailure('leaf-observation-invalid',{role,phase});
      try{const proof=validateLeafProof(state.leafMoveProof,{workspaceId:this.config.fixture.workspaceId,itemId:this.config.fixture.itemId},this.leafRequest(pending?state.leafMoveProof?.phase:phase));
        if((!allowContentPending&&proof.documentSha256!==documentObservation(state.documentSnapshot).hash)||(this.config.expectedAssetHashes&&canonicalJSON(proof.assetHashes)!==canonicalJSON(this.config.expectedAssetHashes)))throw Error('Pack/live snapshot or asset pins differ');
        if(proof.kind!==(role.endsWith('-web')?'manifest':'filesystem')||(!role.endsWith('-app')&&proof.selectedPath!==null)||(role.endsWith('-app')&&!pending&&proof.selectedPath!==proof.relativePath))throw Error('Observed source/live session differs');
        if(before)compareLeafProof(before[role],proof,{archive:role===this.config.leafMove.role});result[role]=proof;
      }catch(error){throw new StressFailure('leaf-proof-invalid',{role,phase,reason:String(error.message).slice(0,200)});}
    }return result;
  }
  checkLeafReopen(states){const proofs=this.leafProofs(states,'after');for(const role of ROLES)if(states.get(role).leafMovePending||canonicalJSON(proofs[role])!==canonicalJSON(this.leafMoveEvidence?.final?.[role]))throw new StressFailure('leaf-reopen-mismatch',{role});}
  async moveLeaf(round,expectedEditIds){
    const observe=async phase=>{const pending=this.collect(round,'state');this.broadcast({type:'observe',round,expectedEditIds,expectedAssetPaths:assetPathsOf(this.config),documentSnapshot:true,leafMove:this.leafRequest(phase)});const states=await pending;
      this.checkRoundContent(states,0,expectedEditIds);if(!this.checkAssets(states,round)||[...this.documentStates(states).values()].some(doc=>documentObservation(doc).hash!==this.finalDocumentHash))throw new StressFailure('leaf-content-changed',{round,phase});for(const role of EDITOR_ROLES)this.checkEditor(round,role,states.get(role).editor);return states;};
    let before,stable=0,last;const beforeDeadline=Date.now()+this.config.timeoutMs;
    do{const states=await observe('before'),proofs=this.leafProofs(states,'before'),digest=canonicalJSON(proofs);stable=digest===last?stable+1:1;last=digest;before=proofs;if(stable>=REQUIRED_CONVERGENCE_SAMPLES)break;await new Promise(r=>setTimeout(r,500));}while(Date.now()<beforeDeadline);
    if(stable<REQUIRED_CONVERGENCE_SAMPLES)throw new StressFailure('leaf-baseline-unstable',{round});this.record('leaf-move-baseline',{round,operationId:this.leafOperationId,proofs:before});
    const role=this.config.leafMove.role,pending=this.collect(round,'leaf-moved',[role]);this.adapters.get(role).send({type:'leafMove',round,leafMove:this.leafRequest('before')});const moved=(await pending).get(role);
    try{validateLeafProof(moved.before,{workspaceId:this.config.fixture.workspaceId,itemId:this.config.fixture.itemId},this.leafRequest('before'));validateLeafProof(moved.after,{workspaceId:this.config.fixture.workspaceId,itemId:this.config.fixture.itemId},this.leafRequest('after'));compareLeafProof(moved.before,moved.after);if(moved.operationId!==this.leafOperationId||moved.retainedEvidence!==true||canonicalJSON(moved.before)!==canonicalJSON(before[role]))throw Error('Mutation changed baseline');}catch(error){throw new StressFailure('leaf-mutation-invalid',{role,round,reason:String(error.message).slice(0,200)});}
    let final,complete=0;const deadline=Date.now()+this.config.timeoutMs;
    do{const states=await observe('after');final=this.leafProofs(states,'after',before);complete=ROLES.some(role=>states.get(role).leafMovePending)?0:complete+1;this.record('leaf-move-sample',{round,stableSamples:complete,proofs:final});if(complete>=REQUIRED_CONVERGENCE_SAMPLES)break;await new Promise(r=>setTimeout(r,500));}while(Date.now()<deadline);
    if(complete<REQUIRED_CONVERGENCE_SAMPLES)throw new StressFailure('leaf-propagation-timeout',{round});this.leafMoveEvidence={operationId:this.leafOperationId,before,final,origin:role,mutation:moved,stableSamples:complete};this.record('leaf-move',{round,...this.leafMoveEvidence});
  }

  folderRequest(phase){return{operationId:this.folderOperationId,phase,scenario:this.config.folderCaseMove};}
  folderProofs(states,phase,before){
    const result={};
    for(const role of ROLES){
      const state=states.get(role),pending=state.folderCasePending===true;
      if(typeof state.folderCasePending!=='boolean'||(phase==='before'&&pending)||(EDITOR_ROLES.includes(role)&&state.folderCaseReviewVisible!==false))throw new StressFailure('folder-case-observation-invalid',{role,phase});
      try{
        const proof=validateFolderProof(state.folderCaseProof,{itemId:this.config.fixture.itemId,title:this.documentBaseline.content.title},this.folderRequest(pending?'before':phase));
        if(proof.kind!==(role.endsWith('-web')?'manifest':'filesystem'))throw Error('Wrong observed source');
        if(before)compareFolderProof(before[role],proof);
        result[role]=proof;
      }catch(error){throw new StressFailure('folder-case-proof-invalid',{role,phase,reason:String(error.message).slice(0,200)});}
    }
    return result;
  }
  checkFolderReopen(states){
    const proofs=this.folderProofs(states,'after');
    for(const role of ROLES){if(states.get(role).folderCasePending||canonicalJSON(proofs[role])!==canonicalJSON(this.folderCaseEvidence?.final?.[role]))throw new StressFailure('folder-case-reopen-mismatch',{role});}
  }
  async moveFolderCase(round,expectedEditIds){
    const observe=async phase=>{const pending=this.collect(round,'state');this.broadcast({type:'observe',round,expectedEditIds,expectedAssetPaths:assetPathsOf(this.config),documentSnapshot:true,folderCase:this.folderRequest(phase)});const states=await pending;
      this.checkRoundContent(states,round,expectedEditIds);if(!this.checkAssets(states,round)||[...this.documentStates(states).values()].some(doc=>documentObservation(doc).hash!==this.finalDocumentHash))throw new StressFailure('folder-case-content-changed',{round,phase});
      for(const role of EDITOR_ROLES)this.checkEditor(round,role,states.get(role).editor);return states;};
    let before,stable=0,last=null;const beforeDeadline=Date.now()+this.config.timeoutMs;
    do{const states=await observe('before'),proofs=this.folderProofs(states,'before'),digest=canonicalJSON(proofs);stable=digest===last?stable+1:1;last=digest;before=proofs;if(stable>=REQUIRED_CONVERGENCE_SAMPLES)break;await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<beforeDeadline);
    if(stable<REQUIRED_CONVERGENCE_SAMPLES)throw new StressFailure('folder-case-baseline-unstable',{round});
    this.record('folder-case-baseline',{round,operationId:this.folderOperationId,proofs:before});
    const role=this.config.folderCaseMove.role,pending=this.collect(round,'folder-moved',[role]);this.adapters.get(role).send({type:'folderMove',round,folderCase:this.folderRequest('before')});const moved=(await pending).get(role);
    try{validateFolderProof(moved.before,{itemId:this.config.fixture.itemId,title:this.documentBaseline.content.title},this.folderRequest('before'));validateFolderProof(moved.after,{itemId:this.config.fixture.itemId,title:this.documentBaseline.content.title},this.folderRequest('after'));compareFolderProof(moved.before,moved.after);if(moved.operationId!==this.folderOperationId||moved.retainedEvidence!==true||canonicalJSON(moved.before)!==canonicalJSON(before[role]))throw Error('Mutation receipt changed baseline');}catch(error){throw new StressFailure('folder-case-mutation-invalid',{round,role,reason:String(error.message).slice(0,200)});}
    let final,complete=0;const deadline=Date.now()+this.config.timeoutMs;
    do{const states=await observe('after');final=this.folderProofs(states,'after',before);const waiting=ROLES.filter(role=>states.get(role).folderCasePending);complete=waiting.length?0:complete+1;this.record('folder-case-sample',{round,operationId:this.folderOperationId,stableSamples:complete,pending:waiting,proofs:final});if(complete>=REQUIRED_CONVERGENCE_SAMPLES)break;await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<deadline);
    if(complete<REQUIRED_CONVERGENCE_SAMPLES)throw new StressFailure('folder-case-propagation-timeout',{round});
    this.folderCaseEvidence={operationId:this.folderOperationId,before,final,origin:role,mutation:moved,stableSamples:complete};this.record('folder-case-move',{round,...this.folderCaseEvidence});
  }

  async restartActor(round, role, graceful = false) {
    if (this.config.mode==='real' && graceful && this.config.browserClose?.role===role && this.config.browserClose.round===round) this.normalCloseInFlight[role]={round};
    const pending = this.collect(round, 'restart', [role]);
    this.adapters.get(role).send({ type: 'restart', round, ...(graceful ? {graceful:true} : {}) });
    const reply = (await pending).get(role);
    if (graceful && reply.lifecycle !== 'normal-close-reopen') throw new StressFailure('close-reopen-lifecycle-invalid',{round,role});
    if (reply.generation !== 2) {
      throw new StressFailure('restart-mismatch', { round, role, generation: reply.generation });
    }
    const baseline = this.editorBaseline[role];
    if (!baseline) throw new StressFailure('restart-mismatch', { round, role, baseline });
    let attested;
    if (this.config.mode === 'real') {
      try { attested = checkRestartAttestation(reply.attestation, this.config.expectedIdentities[role], role,
        { fixture: this.config.fixture, machineId: this.attestations[role].machineId, sessionId: baseline.sessionId, generation: reply.generation }); }
      catch (error) { throw new StressFailure('restart-identity-mismatch', { round, role, reason: String(error.message).slice(0, 240) }); }
    }
    if (role.endsWith('-web') && !graceful && (!reply.crash || reply.crash.method !== 'SIGKILL' || reply.crash.exited !== true || !/^[a-f0-9]{64}$/.test(reply.crash.profileScopeHash ?? '') || !Number.isSafeInteger(reply.crash.pid) || reply.crash.pid <= 1 || reply.online !== true || reply.reconnectByRestart !== (this.config.offline?.role === role && this.config.offline?.round === round))) throw new StressFailure('restart-crash-evidence-invalid', { round, role });
    if (role.endsWith('-web') && graceful && (!reply.normalClose || reply.normalClose.method!=='normal-close' || reply.normalClose.runBeforeUnload!==true || reply.normalClose.pageClosed!==true || reply.normalClose.contextClosed!==true || reply.normalClose.exited!==true || !/^[a-f0-9]{64}$/.test(reply.normalClose.profileScopeHash??'') || !Number.isSafeInteger(reply.normalClose.pid) || reply.normalClose.pid<=1 || reply.crash!==undefined || reply.online!==true || reply.reconnectByRestart!==false || !Number.isSafeInteger(reply.reopenedBrowser?.pid) || reply.reopenedBrowser.pid<=1 || reply.reopenedBrowser.pid===reply.normalClose.pid || reply.reopenedBrowser.profileScopeHash!==reply.normalClose.profileScopeHash)) throw new StressFailure('normal-close-evidence-invalid',{round,role});
    const evidence = { round, ...(graceful ? {lifecycle:'normal-close-reopen'} : {}), ...(role.endsWith('-web') && graceful ? { normalClose:reply.normalClose,reopenedBrowser:reply.reopenedBrowser } : {}), ...(role.endsWith('-web') && !graceful ? { crash: { pid: reply.crash.pid, profileScopeHash: reply.crash.profileScopeHash, method: 'SIGKILL', exited: true }, reconnectByRestart: reply.reconnectByRestart, online: true } : {}), generation: reply.generation, sessionId: null,
      ...(attested ? { attestedSessionId: attested.sessionId, identity: attested.identity } : {}) };
    this.restartEvidence[role] = evidence;
    delete this.normalCloseInFlight[role];
    this.record('restart', { round, role, ...evidence });
  }

  // App/web editors must keep the same editor session with no reload across rounds.
  checkEditor(round, role, editor) {
    if (!editor || typeof editor.sessionId !== 'string' || editor.reloads !== 0) throw new StressFailure('editor-discontinuity', { round, role });
    const base = this.editorBaseline[role];
    if (!base) { this.editorBaseline[role] = { sessionId: editor.sessionId, reloads: editor.reloads }; return; }
    const restart = this.restartEvidence[role];
    if (restart && round >= restart.round) {
      if (restart.sessionId === null) {
        if (editor.sessionId === base.sessionId || (restart.attestedSessionId && editor.sessionId !== restart.attestedSessionId)) throw new StressFailure('editor-discontinuity', { round, role, restart, actual: { sessionId: editor.sessionId, reloads: editor.reloads } });
        restart.sessionId = editor.sessionId;
      } else if (editor.sessionId !== restart.sessionId) throw new StressFailure('editor-discontinuity', { round, role, restart, actual: { sessionId: editor.sessionId, reloads: editor.reloads } });
      return;
    }
    if (base.sessionId !== editor.sessionId || base.reloads !== editor.reloads) throw new StressFailure('editor-discontinuity', { round, role, baseline: base, actual: { sessionId: editor.sessionId, reloads: editor.reloads } });
  }

  async stopAdapters() {
    return await Promise.all([...this.adapters.values()].map(async (a) => {
      // Native actors flush the production journal before exiting. Give that operation
      // its normal request budget instead of killing a healthy save after two seconds.
      let exit;
      if (this.normalCloseInFlight[a.role] && !this.retainedActors[a.role]) {
        const ownership=a.exit ? {driverExited:true,exit:a.exit} : a.retainForReview();
        this.retainedActors[a.role]={...this.normalCloseInFlight[a.role],...ownership,reason:'normal-close-outcome-uncertain',browserOwnershipUnverified:true};
        this.record('actor-retained-for-review',{role:a.role,...this.retainedActors[a.role]});
      }
      if (this.retainedActors[a.role]) {
        exit={code:null,signal:'retained-for-review'};
        this.record('adapter-retained',{role:a.role,ownership:this.retainedActors[a.role]});
        return {role:a.role,exit};
      }
      try { exit = await a.stop(Math.min(60_000, Math.max(2_000, this.config.timeoutMs))); }
      catch { exit = { code: null, signal: 'stop-error' }; }
      if (a.stderr) writeFileSync(join(this.dir, 'adapters', `${a.role}.stderr.log`), a.stderr);
      this.record('adapter-stopped', { role: a.role, exit });
      return { role: a.role, exit };
    }));
  }

  writeDashboard(status, failure = null) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const rows = this.roundResults.map((r) => `<tr><td>${r.round}</td><td><code>${r.hash.slice(0, 16)}</code></td><td>${r.editCount}</td><td>${r.durationMs} ms</td></tr>`).join('');
    const refresh = status === 'running' ? '<meta http-equiv="refresh" content="2">' : '';
    const html = `<!doctype html><html><head><meta charset="utf-8">${refresh}<title>Sync stress ${esc(this.runId)}</title>
<style>body{font:14px system-ui;margin:2rem;color:#1a1a1a;background:#fff}@media(prefers-color-scheme:dark){body{color:#e6e6e6;background:#111}}
table{border-collapse:collapse}td,th{padding:.3rem .8rem;border-bottom:1px solid #8884;text-align:left}.failed{color:#c0392b}.passed{color:#1e8449}pre{white-space:pre-wrap;max-height:20rem;overflow:auto}</style></head>
<body><h1>Sync stress <small>${esc(this.runId)}</small></h1>
<p>Status: <strong class="${esc(status)}">${esc(status)}</strong> · mode ${esc(this.config.mode)} · seed ${this.config.seed} · rounds ${this.roundResults.length}/${this.config.rounds} · rejected events ${this.rejected.length}</p>
<table><thead><tr><th>Participant</th><th>Progress</th></tr></thead><tbody>${ROLES.map(role => `<tr><td>${role}</td><td>${esc(this.actorStatus[role])}</td></tr>`).join('')}</tbody></table>
${this.config.mode === 'simulated' ? '<p><em>Simulated evidence. Not real acceptance.</em></p>' : ''}
${failure ? `<h2 class="failed">Failure ${esc(failure.code)}</h2><pre>${esc(JSON.stringify(failure.detail, null, 2).slice(0, 8000))}</pre>` : ''}
<table><thead><tr><th>Round</th><th>Hash</th><th>Edits</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Attestations</h2><pre>${esc(JSON.stringify(this.attestations, null, 2))}</pre></body></html>`;
    writeFileSync(join(this.dir, 'dashboard.html'), html);
  }
}
