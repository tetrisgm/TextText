import { installMalformed, observeMalformed, repairMalformed } from './malformed-repair.mjs';
import { validateWriteSequence, applyWriteSequence } from './file-write-sequence.mjs';
import { appendFieldToPack } from './multi-field-pack.mjs';
import { validateFieldSequence } from './multi-field-input.mjs';
import { observeSealedSource, fixedDriverFiles, ownerBindingScope, captureOwnerBindingGuard, canonicalJSON } from './identity-observation.mjs';
// Direct-file stress actor for the mac-cli and pc-cli roles. It speaks the coordinator's JSONL
// protocol and edits one dedicated acceptance TextPack the way an ordinary external tool would:
// read the whole ZIP, append the exact edit text to the canonical text.md body, keep every other
// entry byte for byte, leave document.json alone, and replace the file atomically. No app, API,
// or MCP command is used. It attests "real" only when it actually runs on the role's platform.
//
// Usage: node sync/stress/file-adapter.mjs <actor-config.json>
// Config: { role: "mac-cli"|"pc-cli", file, workspaceId, itemId, title, receiptDir, observeMaxMs? }
// `file` and `receiptDir` are absolute. `title` must start with "Six-client acceptance " and equal
// the file's base name. Each run creates `<receiptDir>/<runId>/` and refuses an existing one.
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { hostname, homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, lstatSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export const ROLE_PLATFORM = { 'mac-cli': 'darwin', 'pc-cli': 'win32' };
export const TITLE_PREFIX = 'Six-client acceptance ';
export const LIMITS = { fileBytes: 64 * 1024 * 1024, entries: 10000, expandedBytes: 64 * 1024 * 1024, markdownBytes: 1024 * 1024 };
export const OBSERVE = { pollMs: 200, stableSamples: 3, maxMs: 30000 };
const WRITE_RETRIES = 5;
const RUN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
// The coordinator's planned text is `[<role> r<round> <word><n>]`; the edit ID is `r<round>-<role>`.
const MARKER = /\[(mac|pc)-(app|web|cli) r(\d+) [a-z]+\d+\]/g;
const EPOCH = new Date(1980, 0, 1);
const SECRET = /\b(token|secret|password|passwd|cookie|authorization|api[_-]?key|bearer)\b(\s*[:=]\s*|\s+)(bearer\s+)?[^\s"']+/gi;

export class ActorError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safePath = (path) => !!path && !path.includes('\\') && !Array.from(path).some((c) => c.charCodeAt(0) < 32)
  && !path.split('/').some((part) => !part || part === '.' || part === '..') && !/^[A-Za-z]:/.test(path);

// ---- configuration ----------------------------------------------------------------------------

export function validateActorConfig(raw) {
  const fail = (m) => { throw new ActorError('config', m); };
  if (!raw || typeof raw !== 'object') fail('actor config must be an object');
  const { role, file, workspaceId, itemId, title, receiptDir } = raw;
  if (!(role in ROLE_PLATFORM)) fail('role must be mac-cli or pc-cli');
  for (const [k, v] of Object.entries({ file, receiptDir })) {
    if (typeof v !== 'string' || !isAbsolute(v)) fail(`${k} must be an absolute path`);
  }
  if (typeof title !== 'string' || !title.startsWith(TITLE_PREFIX) || title.length > 200) fail('title must start with "Six-client acceptance "');
  if (extname(file) !== '.textpack' || basename(file, '.textpack') !== title) fail('file must be <title>.textpack');
  if (typeof workspaceId !== 'string' || !IDENTITY.test(workspaceId)) fail('workspaceId is required');
  if (typeof itemId !== 'string' || !IDENTITY.test(itemId)) fail('itemId is required');
  const observeMaxMs = raw.observeMaxMs ?? OBSERVE.maxMs;
  if (!Number.isInteger(observeMaxMs) || observeMaxMs < 100 || observeMaxMs > OBSERVE.maxMs) fail(`observeMaxMs must be 100..${OBSERVE.maxMs}`);
  for (const name of ['identityReceipt', 'workspaceRoot', 'ownerBindingPath']) if (raw[name] !== undefined && (typeof raw[name] !== 'string' || !isAbsolute(raw[name]))) fail(`${name} must be an absolute path`);
  return { role, file, workspaceId, itemId, title, receiptDir, observeMaxMs, ...Object.fromEntries(['identityReceipt', 'workspaceRoot', 'ownerBindingPath'].filter(name => raw[name] !== undefined).map(name => [name, raw[name]])) };
}

export function loadActorConfig(path) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new ActorError('config', `cannot read actor config: ${e.message}`); }
  return validateActorConfig(parsed);
}

// ---- pack reading -----------------------------------------------------------------------------

// Decompress every entry with bounds; keep order and directory markers. Nothing is interpreted yet.
export function readPack(bytes) {
  if (bytes.byteLength > LIMITS.fileBytes) throw new ActorError('pack-too-large', 'TextPack exceeds the file size limit');
  let expanded = 0; const seen = new Set(); const order = [];
  let files;
  try {
    files = unzipSync(bytes, { filter(entry) {
      const path = entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name;
      if (!safePath(path) || seen.has(entry.name)) throw new ActorError('pack-invalid', 'invalid or duplicate ZIP entry');
      seen.add(entry.name); order.push(entry.name);
      if (seen.size > LIMITS.entries || (expanded += entry.originalSize) > LIMITS.expandedBytes) throw new ActorError('pack-too-large', 'expanded TextPack exceeds limits');
      return true;
    } });
  } catch (e) { throw e instanceof ActorError ? e : new ActorError('pack-invalid', 'not a readable ZIP'); }
  const entries = order.map((name) => ({ name, data: files[name] ?? new Uint8Array(0) }));
  return { entries, root: canonicalRoot(entries) };
}

// The canonical document root is the one place where text.md and document.json sit together at the
// archive root or inside exactly one top-level folder. A deeper text.md (for example assets/text.md
// or <bundle>/assets/text.md) is an attachment, never the document.
export function canonicalRoot(entries) {
  const names = new Set(entries.map((e) => e.name));
  const roots = [...names].filter((n) => n === 'text.md' || /^[^/]+\/text\.md$/.test(n)).map((n) => n.slice(0, -'text.md'.length))
    .filter((root) => names.has(`${root}document.json`));
  if (roots.length !== 1) throw new ActorError('pack-root', 'TextPack must contain exactly one canonical text.md and document.json pair');
  return roots[0];
}

const entryOf = (pack, leaf) => pack.entries.find((e) => e.name === pack.root + leaf);

export function markdownOf(pack) {
  const entry = entryOf(pack, 'text.md');
  if (!entry || entry.data.byteLength > LIMITS.markdownBytes) throw new ActorError('pack-invalid', 'text.md missing or too large');
  return strFromU8(entry.data);
}

// Frontmatter scalar as the projection parser reads it: single line `key: value`, JSON string or bare.
function frontmatterValue(markdown, key) {
  const header = markdown.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)?.[1] ?? '';
  const values = [...header.matchAll(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'gm'))];
  if (values.length === 0) return undefined;
  if (values.length !== 1) return null;
  let value = values[0][1];
  if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { return null; } }
  return typeof value === 'string' ? value : null;
}

// The body exactly as the editor holds it: everything after the closing delimiter and one optional
// blank separator line, matching parseProjectionMarkdown. Without frontmatter the whole file is body.
export function bodyOf(markdown) {
  const text = markdown.replace(/^﻿/, '');
  return text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n(?:\r?\n)?([\s\S]*)$/)?.[1] ?? text;
}

export function editIdsOf(body) {
  const ids = new Set();
  for (const m of body.matchAll(MARKER)) ids.add(`r${m[3]}-${m[1]}-${m[2]}`);
  return [...ids].sort();
}

export function assetHashesOf(pack, paths) {
  if (!Array.isArray(paths) || paths.length > 32 || paths.some(path => typeof path !== 'string' || !safePath(path) || !path.startsWith('assets/'))) {
    throw new ActorError('observe', 'asset paths must be a bounded list below assets/');
  }
  return Object.fromEntries(paths.map(path => {
    const entry = pack.entries.find(e => e.name === `${pack.root}${path}`);
    return [path, entry ? sha256(entry.data) : null];
  }));
}

// Identity lives in text.md (textTextId) and document.json (schema-v1 title).
// CLI-created packs may omit the optional Markdown title; an explicit title must still agree.
// The pack does not record its workspace; that comes from
// the actor config and must equal the coordinator's fixture before anything is written.
export function validateIdentity(pack, config) {
  const markdown = markdownOf(pack);
  const docEntry = entryOf(pack, 'document.json');
  let document;
  try { document = JSON.parse(strFromU8(docEntry.data)); } catch { throw new ActorError('identity', 'document.json is not JSON'); }
  if (!document || document.schemaVersion !== 1 || typeof document.content?.body !== 'string' || typeof document.content?.title !== 'string') {
    throw new ActorError('identity', 'document.json is not a schema-v1 document');
  }
  const id = frontmatterValue(markdown, 'textTextId');
  if (id !== config.itemId) throw new ActorError('identity', 'text.md textTextId does not match the configured item');
  const title = frontmatterValue(markdown, 'title');
  if (title !== undefined) {
    if (title !== config.title) throw new ActorError('identity', 'text.md title does not match the configured acceptance title');
  }
  if (document.content.title !== config.title) throw new ActorError('identity', 'document.json title does not match the configured acceptance title');
  return { markdown, body: bodyOf(markdown) };
}

// Append `text` to text.md and re-pack: same entry order, every other entry's decompressed bytes
// unchanged, stored (level 0) with the fixed timestamp the app writer uses. document.json is not
// touched; that is what an ordinary external edit looks like and what the app must reconcile.
export function appendToPack(bytes, config, text) {
  return editPack(bytes, config, text);
}

export function replaceTargetInPack(bytes, config, target, text) {
  if (typeof target !== 'string' || !target.length || target.length > 1000) throw new ActorError('edit', 'replacement target is invalid');
  return editPack(bytes, config, text, target);
}

function editPack(bytes, config, text, target, assetReplacement) {
  if (typeof text !== 'string' || !text.length) throw new ActorError('edit', 'edit text must be a non-empty string');
  const pack = readPack(bytes);
  const { markdown, body } = validateIdentity(pack, config);
  if (target && body.split(target).length !== 2) throw new ActorError('edit', 'replacement target must occur exactly once');
  const nextMarkdown = strToU8(target ? markdown.slice(0, markdown.length - body.length) + body.replace(target, text) : markdown + text);
  if (nextMarkdown.byteLength > LIMITS.markdownBytes) throw new ActorError('pack-too-large', 'text.md would exceed its limit');
  let assetPath = null; let assetBytes = null;
  if (assetReplacement !== undefined) {
    assetPath = assetReplacement?.path;
    const encoded = assetReplacement?.bytesBase64;
    if (typeof assetPath !== 'string' || !safePath(assetPath) || !assetPath.startsWith('assets/')
      || typeof encoded !== 'string' || !encoded.length || encoded.length > 96 * 1024
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new ActorError('edit', 'invalid asset replacement');
    assetBytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
    if (!pack.entries.some(e => e.name === `${pack.root}${assetPath}`)) throw new ActorError('edit', 'asset replacement target is missing');
  }
  const zip = {};
  for (const e of pack.entries) zip[e.name] = [e.name === `${pack.root}text.md` ? nextMarkdown
    : e.name === `${pack.root}${assetPath}` ? assetBytes : e.data, { level: 0, mtime: EPOCH }];
  return zipSync(zip, { mtime: EPOCH });
}

// ---- file access ------------------------------------------------------------------------------

function rejectSymlink(path, what) {
  let st;
  try { st = lstatSync(path); } catch { throw new ActorError('file', `${what} does not exist`); }
  if (st.isSymbolicLink()) throw new ActorError('file', `${what} is a symbolic link`);
  return st;
}

// Two consecutive identical reads (bounded) so a writer in the middle of its own replacement is not
// observed half way.
export async function stableRead(file, { attempts = 20, settleMs = 50 } = {}) {
  const st = rejectSymlink(file, 'fixture file');
  if (!st.isFile()) throw new ActorError('file', 'fixture is not a regular file');
  if (st.size > LIMITS.fileBytes) throw new ActorError('pack-too-large', 'fixture exceeds the file size limit');
  let previous = readFileSync(file);
  for (let i = 0; i < attempts; i += 1) {
    await sleep(settleMs);
    const current = readFileSync(file);
    if (current.equals(previous)) return current;
    previous = current;
  }
  throw new ActorError('unstable', 'fixture kept changing while being read');
}

// Read, append, verify the bytes are still what was read, then temp+rename. A concurrent change seen
// at the final check restarts the whole cycle, a bounded number of times. The pre-edit bytes are kept
// as a backup in the receipt directory before the original is replaced.
export async function applyEdit({ file, config, text, target, assetReplacement, fieldEdits, round, runDir, journal = () => {}, beforeReplace = () => {} }) {
  for (let attempt = 1; attempt <= WRITE_RETRIES; attempt += 1) {
    const before = await stableRead(file);
    const beforeSha = sha256(before);
    const next = fieldEdits ? fieldEdits.reduce((pack, edit) => appendFieldToPack(pack, config, edit.field, edit.text), before) : assetReplacement ? editPack(before, config, text, target, assetReplacement)
      : target ? replaceTargetInPack(before, config, target, text) : appendToPack(before, config, text);
    const backup = join(runDir, `${config.role}-r${round}-a${attempt}-before.textpack`);
    if (existsSync(backup)) throw new ActorError('receipts', 'backup for this round already exists; use a new run');
    writeFileSync(backup, before, { flag: 'wx' });
    const temp = `${file}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    writeFileSync(temp, next, { flag: 'wx' });
    try {
      await beforeReplace(attempt);
      const now = readFileSync(file);
      if (sha256(now) !== beforeSha) {
        journal({ event: 'retry', round, attempt, reason: 'file changed before replacement' });
        unlinkSync(temp);
        continue; // the backup of the superseded read is kept as evidence
      }
      rejectSymlink(file, 'fixture file');
      renameSync(temp, file);
    } catch (e) {
      if (existsSync(temp)) unlinkSync(temp);
      throw e;
    }
    journal({ event: 'replaced', round, attempt, beforeSha256: beforeSha, afterSha256: sha256(next), backup: basename(backup) });
    return { beforeSha256: beforeSha, afterSha256: sha256(next), attempt };
  }
  throw new ActorError('contended', `file changed before replacement ${WRITE_RETRIES} times; original left in place`);
}

// A dedicated invalid intermediate followed by an atomic repair. The original
// bytes are backed up first. Never overwrite a different writer's intervening
// change: if the temporary invalid file is no longer ours, leave the backup for
// recovery and fail the scenario.
export async function transientInvalidPack({ file, config, round, runDir, journal = () => {}, holdMs = 500 }) {
  const before = await stableRead(file);
  validateIdentity(readPack(before), config);
  const backup = join(runDir, `${config.role}-r${round}-before-invalid.textpack`);
  writeFileSync(backup, before, { flag: 'wx' });
  const invalid = Buffer.from('TextText acceptance: incomplete ZIP\n');
  const damaged = `${file}.${process.pid}.${Date.now()}.invalid.tmp`;
  writeFileSync(damaged, invalid, { flag: 'wx' });
  renameSync(damaged, file);
  journal({ event: 'invalid-intermediate', round, beforeSha256: sha256(before) });
  await sleep(holdMs);
  if (!readFileSync(file).equals(invalid)) throw new ActorError('contended', 'another writer changed the invalid intermediate; backup retained');
  const repaired = `${file}.${process.pid}.${Date.now()}.repair.tmp`;
  writeFileSync(repaired, before, { flag: 'wx' });
  renameSync(repaired, file);
  validateIdentity(readPack(await stableRead(file)), config);
  journal({ event: 'repaired-intermediate', round, afterSha256: sha256(before) });
}

// Read the body until every expected ID is present and several consecutive samples agree, bounded.
// On timeout the last observation is returned anyway; the coordinator records the mismatch as
// evidence rather than this actor guessing.
export async function observeBody({ file, config, expectedEditIds = [], expectedAssetPaths = [], includeDocument = false, maxMs = config.observeMaxMs ?? OBSERVE.maxMs, pollMs = OBSERVE.pollMs, stableSamples = OBSERVE.stableSamples }) {
  const deadline = Date.now() + maxMs;
  const expected = new Set(expectedEditIds);
  let last = null; let agree = 0; let sample;
  for (;;) {
    const bytes = await stableRead(file);
    const pack = readPack(bytes);
    const { body } = validateIdentity(pack, config);
    sample = { body, ...(includeDocument ? { documentSnapshot: JSON.parse(strFromU8(entryOf(pack, 'document.json').data)) } : {}), editIds: editIdsOf(body), assetHashes: assetHashesOf(pack, expectedAssetPaths), sha256: sha256(bytes) };
    agree = last && last.sha256 === sample.sha256 ? agree + 1 : 1;
    last = sample;
    const complete = [...expected].every((id) => sample.editIds.includes(id));
    if (complete && agree >= stableSamples) return { ...sample, stable: true, timedOut: false };
    if (Date.now() >= deadline) return { ...sample, stable: agree >= stableSamples, timedOut: true };
    await sleep(pollMs);
  }
}

// ---- protocol actor ---------------------------------------------------------------------------

export function sanitizeError(error, config) {
  let message = String(error?.message ?? error);
  for (const p of [config?.file, config?.receiptDir, homedir()].filter(Boolean)) message = message.split(p).join('<path>');
  return message.replace(SECRET, (_, k) => `${k}=[redacted]`).slice(0, 500);
}

// One actor instance: `handle(message)` returns the reply (or null). Commands are serialized by the
// caller (stdin pipe) or by the test. `platform` is injectable only so tests can prove the refusal path.
export function createActor(config, { platform = process.platform, machineId = hostname(), now = () => new Date().toISOString() } = {}) {
  const state = { malformed: null, writeProgress: null, ownerScope: null, ownerGuard: null, runId: null, runDir: null, role: config.role };
  const journal = (entry) => { if (state.runDir) appendFileSync(join(state.runDir, 'journal.jsonl'), `${JSON.stringify({ at: now(), ...entry })}\n`); };
  const handlers = {
    async hello(m) {
      if (state.runId) throw new ActorError('protocol', 'hello already received');
      if (ROLE_PLATFORM[config.role] !== platform) throw new ActorError('platform', `${config.role} requires ${ROLE_PLATFORM[config.role]}, this actor runs on ${platform}; it will not pretend`);
      if (m.role !== config.role) throw new ActorError('protocol', `coordinator assigned role ${m.role} but this actor is configured as ${config.role}`);
      if (m.mode !== 'real') throw new ActorError('protocol', 'the direct-file actor only takes part in real runs');
      if (!m.fixture || m.fixture.workspaceId !== config.workspaceId || m.fixture.itemId !== config.itemId) throw new ActorError('fixture', 'hello fixture does not match the actor configuration');
      if (typeof m.runId !== 'string' || !RUN_ID.test(m.runId)) throw new ActorError('protocol', 'invalid runId');
      rejectSymlink(config.receiptDir, 'receipt directory');
      const runDir = join(config.receiptDir, m.runId);
      if (existsSync(runDir)) throw new ActorError('receipts', 'receipt directory for this run already exists; use a new run');
      // Read-only identity check before any receipt or mutation.
      validateIdentity(readPack(await stableRead(config.file)), config);
      mkdirSync(runDir, { recursive: false, mode: 0o700 });
      state.runId = m.runId; state.runDir = runDir;
      journal({ event: 'hello', runId: m.runId, role: config.role, machineId, platform, fixture: m.fixture, fileSha256: sha256(readFileSync(config.file)) });
      let identity, initialPack;
      if (m.identitySchema === 1) {
        const source = observeSealedSource(config.identityReceipt, config.role, fixedDriverFiles(config.role));
        const bytes = await stableRead(config.file), pack = readPack(bytes), body = validateIdentity(pack, config).body;
        const paths = pack.entries.filter(entry => entry.name.startsWith(pack.root + 'assets/') && !entry.name.endsWith('/')).map(entry => entry.name.slice(pack.root.length));
        if (paths.length > 32) throw new ActorError('identity', 'physical fixture exceeds asset identity bound');
        identity = { schemaVersion: 1, role: config.role, platform, artifactKind: 'direct-file-driver',
          principalKind: 'workspace-owner-binding', principalScopeHash: ownerBindingScope(config),
          runtimeName: 'Node.js', runtimeVersion: process.versions.node, ...source };
        state.ownerScope = identity.principalScopeHash;
        state.ownerGuard = captureOwnerBindingGuard(config);
        if (state.ownerGuard() !== state.ownerScope) throw new ActorError('identity', 'workspace owner binding changed during hello');
        initialPack = { packSha256: sha256(bytes), bodySha256: sha256(body.replace(/\r\n/g, '\n')),
          documentSha256: sha256(canonicalJSON(JSON.parse(strFromU8(entryOf(pack, 'document.json').data)))),
          assetHashes: assetHashesOf(pack, paths) };
      }
      return { type: 'attest', round: 0, mode: 'real', workspaceId: config.workspaceId, itemId: config.itemId, machineId, adapter: 'file-adapter',
        ...(identity ? { identity, initialPack } : {}) };
    },
    async prepare(m) {
      requireRun();
      validateIdentity(readPack(await stableRead(config.file)), config);
      requireRun();
      journal({ event: 'ready', round: m.round });
      return { type: 'ready', round: m.round };
    },
    async edit(m) {
      requireRun();
      const edit = m.edit ?? {};
      if (!['append', 'replace-target'].includes(edit.op) || typeof edit.id !== 'string' || typeof edit.text !== 'string') throw new ActorError('edit', 'unsupported file edit');
      if (edit.fieldEdits !== undefined && (!validateFieldSequence(edit.fieldEdits, config.role) || edit.fieldEdits[0].text !== edit.text || edit.fieldEdits.some(field => field.id !== edit.id + '-' + field.field) || edit.assetReplacement || edit.op !== 'append')) throw new ActorError('edit', 'invalid field sequence');
      state.writeProgress = null;
      if (edit.fileWriteSequence !== undefined) {
        if (!validateWriteSequence(edit, config.role) || edit.fieldEdits || edit.assetReplacement) throw new ActorError('edit', 'invalid ordinary write sequence');
        state.writeProgress = { editId: edit.id, mode: edit.fileWriteSequence.mode, writes: [], acceptedPrefix: '' };
        const writeProgress = await applyWriteSequence({ file: config.file, config, edit, round: m.round, runDir: state.runDir, progress: state.writeProgress, guard: requireRun, journal });
        state.writeProgress = null;
        return { type: 'applied', round: m.round, editId: edit.id, writeProgress };
      }
      const result = await applyEdit({ file: config.file, config, text: edit.text, target: edit.op === 'replace-target' ? edit.target : undefined,
        assetReplacement: edit.assetReplacement, fieldEdits: edit.fieldEdits, beforeReplace: () => requireRun(), round: m.round, runDir: state.runDir, journal });
      requireRun();
      journal({ event: 'applied', round: m.round, editId: edit.id, ...result });
      return { type: 'applied', round: m.round, editId: edit.id, ...(edit.fieldEdits ? { fieldEditIds: edit.fieldEdits.map(field => field.id) } : {}) };
    },
    async installMalformed(m) {
      requireRun();
      if (state.malformed?.active) throw new ActorError('fault', 'malformed fault already active');
      state.malformed = await installMalformed({ file: config.file, config, round: m.round, kind: m.kind, runDir: state.runDir, guard: requireRun, journal });
      journal({ event: 'malformed-installed', ...state.malformed.proof });
      return { type: 'malformed-installed', round: m.round, proof: state.malformed.proof };
    },
    async observeMalformed(m) {
      requireRun();
      if (state.malformed?.proof.round !== m.round) throw new ActorError('fault', 'wrong malformed round');
      const proof = observeMalformed(state.malformed);
      journal({ event: 'malformed-present', ...proof });
      return { type: 'malformed-present', round: m.round, proof };
    },
    async repairMalformed(m) {
      requireRun();
      if (state.malformed?.proof.round !== m.round) throw new ActorError('fault', 'wrong malformed round');
      const proof = repairMalformed(state.malformed, { cleanup: m.cleanup === true });
      journal({ event: 'malformed-repaired', ...proof });
      return { type: 'malformed-repaired', round: m.round, proof };
    },
    async perturb(m) {
      requireRun();
      await transientInvalidPack({ file: config.file, config, round: m.round, runDir: state.runDir, journal });
      return { type: 'perturb', round: m.round, repaired: true };
    },
    async observe(m) {
      requireRun();
      const o = await observeBody({ file: config.file, config, expectedEditIds: Array.isArray(m.expectedEditIds) ? m.expectedEditIds : [], expectedAssetPaths: m.expectedAssetPaths ?? [], includeDocument: m.documentSnapshot === true });
      requireRun();
      journal({ event: 'observed', round: m.round, sha256: o.sha256, bodySha256: sha256(strToU8(o.body)), editIds: o.editIds, assetHashes: o.assetHashes, stable: o.stable, timedOut: o.timedOut });
      const documentSnapshot = o.documentSnapshot;
      return { type: 'state', round: m.round, ...(documentSnapshot ? { documentSnapshot } : {}), text: o.body, editIds: o.editIds, assetHashes: o.assetHashes };
    },
    async shutdown() { journal({ event: 'shutdown' }); return null; },
  };
  const requireRun = () => { if (!state.runId) throw new ActorError('protocol', 'hello must come first'); state.ownerGuard?.(); };
  return {
    state,
    async handle(m) {
      const round = Number.isInteger(m?.round) ? m.round : 0;
      try {
        if (!m || typeof m.type !== 'string' || !handlers[m.type]) throw new ActorError('protocol', `unknown message type`);
        return await handlers[m.type](m);
      } catch (error) {
        const message = `${error?.code ?? 'error'}: ${sanitizeError(error, config)}`;
        try { journal({ event: 'error', round, message }); } catch { /* evidence directory may not exist yet */ }
        return { type: 'error', round, message, ...(state.writeProgress ? { writeProgress: state.writeProgress } : {}) };
      }
    },
  };
}

// ---- CLI --------------------------------------------------------------------------------------

export async function main(argv = process.argv) {
  const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  let config;
  try { config = loadActorConfig(argv[2]); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
  const actor = createActor(config);
  let queue = Promise.resolve();
  const rl = createInterface({ input: process.stdin });
  const run = (m) => { queue = queue.then(async () => {
    const reply = await actor.handle(m);
    if (reply) out(reply);
    if (m.type === 'shutdown') { rl.close(); process.exit(0); }
  }); };
  rl.on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return run({ type: 'invalid' }); }
    run(m);
  });
  rl.on('close', () => { queue.then(() => process.exit(0)); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
