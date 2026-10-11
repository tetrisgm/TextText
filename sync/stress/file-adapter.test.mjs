import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import {
  validateActorConfig, readPack, canonicalRoot, bodyOf, editIdsOf, validateIdentity, appendToPack, replaceTargetInPack,
  stableRead, applyEdit, transientInvalidPack, observeBody, createActor, sanitizeError, ActorError, TITLE_PREFIX,
} from './file-adapter.mjs';

const TITLE = `${TITLE_PREFIX}2026-10-09`;
const ITEM = 'item-abc123';
const WS = 'ws-fixture';
const BASE_BODY = 'Existing fixture text.\n';
const FRONT = `---\nschema: "texttext.markdown-file.v1"\nkind: "note"\ntitle: ${JSON.stringify(TITLE)}\ntextTextId: ${JSON.stringify(ITEM)}\nstatus: "draft"\n---\n\n`;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 7, 200, 99, 1, 255]);

function buildPack({ title = TITLE, itemId = ITEM, body = BASE_BODY, root = 'Six-client acceptance 2026-10-09.textbundle/' } = {}) {
  const document = { schemaVersion: 1, content: { title, body, fields: {}, tags: [] }, template: { id: 'texttext.note', version: 1 }, presentation: { theme: {} } };
  const markdown = FRONT.replace(JSON.stringify(TITLE), JSON.stringify(title)).replace(JSON.stringify(ITEM), JSON.stringify(itemId)) + body;
  const entries = {
    [`${root}text.md`]: [strToU8(markdown), { level: 6 }],
    [`${root}document.json`]: [strToU8(`${JSON.stringify(document, null, 2)}\n`), { level: 6 }],
    [`${root}info.json`]: [strToU8('{"version":2,"type":"net.daringfireball.markdown"}\n'), { level: 0 }],
    [`${root}template.json`]: [strToU8('{"id":"texttext.note","version":1}\n'), { level: 9 }],
    [`${root}assets/`]: [new Uint8Array(0), {}],
    [`${root}assets/photo.png`]: [PNG, { level: 0 }],
    // A decoy Markdown attachment: must never be treated as the document root.
    [`${root}assets/text.md`]: [strToU8('---\ntitle: "decoy"\ntextTextId: "decoy"\n---\n\ndecoy body\n'), { level: 6 }],
    [`${root}net.texttext.projection.json`]: [strToU8('{"version":1,"itemId":"item-abc123"}\n'), { level: 6 }],
  };
  return zipSync(entries);
}

function fixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'file-adapter-'));
  const file = join(dir, `${TITLE}.textpack`);
  writeFileSync(file, buildPack(overrides.pack));
  const config = validateActorConfig({ role: 'mac-cli', file, workspaceId: WS, itemId: ITEM, title: TITLE, receiptDir: join(dir, 'receipts'), observeMaxMs: 2000, ...overrides.config });
  mkdirSync(config.receiptDir);
  return { dir, file, config };
}

const decompressed = (bytes) => {
  const order = [];
  const files = unzipSync(bytes, { filter: (e) => { order.push(e.name); return true; } });
  return { order, files };
};

test('config validation guards role, paths and the acceptance title', () => {
  const { config } = fixture();
  assert.equal(config.role, 'mac-cli');
  assert.throws(() => validateActorConfig({ ...config, role: 'mac-app' }), /role must be/);
  assert.throws(() => validateActorConfig({ ...config, title: 'Notes' }), /Six-client acceptance/);
  assert.throws(() => validateActorConfig({ ...config, file: join(config.receiptDir, 'Other.textpack') }), /<title>\.textpack/);
  assert.throws(() => validateActorConfig({ ...config, receiptDir: 'relative' }), /absolute/);
  assert.throws(() => validateActorConfig({ ...config, observeMaxMs: 60000 }), /observeMaxMs/);
});

test('reads the real pack, picks the bundle root and ignores assets/text.md', () => {
  const pack = readPack(buildPack());
  assert.equal(pack.root, 'Six-client acceptance 2026-10-09.textbundle/');
  assert.equal(pack.entries.length, 8);
  const { body } = validateIdentity(pack, { itemId: ITEM, title: TITLE });
  assert.equal(body, BASE_BODY);
  // A root-level layout works too; a pack with only a deep text.md is refused.
  assert.equal(readPack(buildPack({ root: '' })).root, '');
  assert.throws(() => canonicalRoot([{ name: 'a/b/text.md' }, { name: 'a/b/document.json' }]), /exactly one canonical/);
  assert.throws(() => canonicalRoot([{ name: 'x/text.md' }, { name: 'x/document.json' }, { name: 'text.md' }, { name: 'document.json' }]), /exactly one canonical/);
  assert.throws(() => readPack(strToU8('not a zip')), /not a readable ZIP/);
});

test('accepts a CLI-created pack with no optional Markdown title', () => {
  const bytes = buildPack();
  const pack = decompressed(bytes);
  const name = 'Six-client acceptance 2026-10-09.textbundle/text.md';
  const markdown = strFromU8(pack.files[name]).replace(/^title:.*\n/m, '');
  const entries = Object.fromEntries(pack.order.map((n) => [n, [n === name ? strToU8(markdown) : pack.files[n] ?? new Uint8Array(0), { level: 0 }]]));
  assert.equal(validateIdentity(readPack(zipSync(entries)), { itemId: ITEM, title: TITLE }).body, BASE_BODY);
  const malformed = markdown.replace(/^textTextId:/m, 'title: not-json\ntitle: still-not-json\ntextTextId:');
  const invalidEntries = Object.fromEntries(pack.order.map((n) => [n, [n === name ? strToU8(malformed) : pack.files[n] ?? new Uint8Array(0), { level: 0 }]]));
  assert.throws(() => validateIdentity(readPack(zipSync(invalidEntries)), { itemId: ITEM, title: TITLE }), /text.md title/);
});

test('body and edit-id derivation follow the editor projection and the planned marker shape', () => {
  assert.equal(bodyOf('---\na: 1\n---\n\nhello\n'), 'hello\n');
  assert.equal(bodyOf('---\na: 1\n---\nhello\n'), 'hello\n');
  assert.equal(bodyOf('---\r\na: 1\r\n---\r\n\r\nhello'), 'hello');
  assert.equal(bodyOf('﻿---\na: 1\n---\n\nx'), 'x');
  assert.equal(bodyOf('plain'), 'plain');
  assert.deepEqual(editIdsOf('x [mac-app r1 alpha123] y [pc-cli r2 zulu7] [mac-app r1 alpha123] [bad r1 x1] [mac-web r1]'), ['r1-mac-app', 'r2-pc-cli']);
  assert.deepEqual(editIdsOf(''), []);
});

test('append keeps frontmatter, every opaque entry and document.json byte for byte', () => {
  const before = buildPack();
  const config = { itemId: ITEM, title: TITLE };
  const text = '[mac-cli r1 kilo42]';
  const after = appendToPack(before, config, text);
  const a = decompressed(before); const b = decompressed(after);
  assert.deepEqual(b.order, a.order);
  for (const name of a.order) {
    if (name.endsWith('.textbundle/text.md')) continue;
    assert.ok(Buffer.from(a.files[name] ?? []).equals(Buffer.from(b.files[name] ?? [])), `entry changed: ${name}`);
  }
  const md = strFromU8(b.files['Six-client acceptance 2026-10-09.textbundle/text.md']);
  assert.equal(md, FRONT + BASE_BODY + text);
  assert.equal(bodyOf(md), BASE_BODY + text);
  // The decoy attachment is untouched and document.json still carries the old body: an ordinary external edit.
  assert.equal(strFromU8(b.files['Six-client acceptance 2026-10-09.textbundle/assets/text.md']).includes(text), false);
  assert.equal(JSON.parse(strFromU8(b.files['Six-client acceptance 2026-10-09.textbundle/document.json'])).content.body, BASE_BODY);
  // Appending again appends exactly, with no separator.
  const twice = appendToPack(after, config, '[pc-cli r1 echo9]');
  assert.equal(bodyOf(strFromU8(decompressed(twice).files['Six-client acceptance 2026-10-09.textbundle/text.md'])), `${BASE_BODY}${text}[pc-cli r1 echo9]`);
  assert.throws(() => appendToPack(before, config, ''), /non-empty/);
});

test('same-span replacement changes only the canonical body and refuses a missing target', () => {
  const before = buildPack();
  const config = { itemId: ITEM, title: TITLE };
  const after = replaceTargetInPack(before, config, 'Existing fixture text.', '[mac-cli r1 kilo42]');
  const a = decompressed(before), b = decompressed(after);
  assert.deepEqual(b.order, a.order);
  for (const name of a.order) {
    if (name.endsWith('.textbundle/text.md')) continue;
    assert.ok(Buffer.from(a.files[name] ?? []).equals(Buffer.from(b.files[name] ?? [])), `entry changed: ${name}`);
  }
  assert.equal(bodyOf(strFromU8(b.files['Six-client acceptance 2026-10-09.textbundle/text.md'])), '[mac-cli r1 kilo42]\n');
  assert.throws(() => replaceTargetInPack(after, config, 'Existing fixture text.', '[mac-cli r1 kilo43]'), /exactly once/);
});

test('mismatched identity refuses to write and leaves the file untouched', async () => {
  const cases = [
    [{ itemId: 'item-other' }, /textTextId/],
    [{ title: `${TITLE_PREFIX}other` }, /title/],
  ];
  for (const [packOverride, pattern] of cases) {
    const { file, config } = fixture({ pack: packOverride });
    const original = readFileSync(file);
    await assert.rejects(applyEdit({ file, config, text: '[mac-cli r1 lima1]', round: 1, runDir: config.receiptDir }), pattern);
    assert.ok(readFileSync(file).equals(original));
    assert.deepEqual(readdirSync(config.receiptDir), []);
    assert.deepEqual(readdirSync(join(file, '..')).filter((n) => n.endsWith('.tmp')), []);
  }
  // document.json whose title disagrees with the configured acceptance title is also refused.
  const { file, config } = fixture();
  const pack = decompressed(readFileSync(file));
  const name = 'Six-client acceptance 2026-10-09.textbundle/document.json';
  const doc = JSON.parse(strFromU8(pack.files[name])); doc.content.title = 'Other';
  const entries = Object.fromEntries(pack.order.map((n) => [n, [n === name ? strToU8(JSON.stringify(doc)) : pack.files[n] ?? new Uint8Array(0), { level: 0 }]]));
  writeFileSync(file, zipSync(entries));
  await assert.rejects(applyEdit({ file, config, text: '[mac-cli r1 lima1]', round: 1, runDir: config.receiptDir }), /document\.json title/);
});

test('applyEdit backs up, replaces atomically and retries only on an observed concurrent change', async () => {
  const { file, config } = fixture();
  const original = readFileSync(file);
  const runDir = join(config.receiptDir, 'run-1'); mkdirSync(runDir);
  const events = [];
  const r = await applyEdit({ file, config, text: '[mac-cli r1 lima1]', round: 1, runDir, journal: (e) => events.push(e) });
  assert.equal(r.attempt, 1);
  assert.ok(readFileSync(join(runDir, 'mac-cli-r1-a1-before.textpack')).equals(original));
  assert.equal(bodyOf(validateIdentity(readPack(readFileSync(file)), config).markdown), `${BASE_BODY}[mac-cli r1 lima1]`);
  assert.deepEqual(events.map((e) => e.event), ['replaced']);
  // A concurrent writer lands between the read and the replacement exactly once: retry succeeds on both edits.
  const runDir2 = join(config.receiptDir, 'run-2'); mkdirSync(runDir2);
  let interfered = false;
  const r2 = await applyEdit({ file, config, text: '[mac-cli r2 oscar2]', round: 2, runDir: runDir2, journal: (e) => events.push(e), beforeReplace: async () => {
    if (interfered) return; interfered = true;
    writeFileSync(file, appendToPack(readFileSync(file), config, '[pc-cli r2 tango3]'));
  } });
  assert.equal(r2.attempt, 2);
  assert.deepEqual(editIdsOf(validateIdentity(readPack(readFileSync(file)), config).body), ['r1-mac-cli', 'r2-mac-cli', 'r2-pc-cli']);
  assert.ok(events.some((e) => e.event === 'retry'));
  assert.ok(existsSync(join(runDir2, 'mac-cli-r2-a2-before.textpack')));
  assert.deepEqual(readdirSync(join(file, '..')).filter((n) => n.endsWith('.tmp')), []);
  // A file that keeps changing is never replaced by this actor.
  const runDir3 = join(config.receiptDir, 'run-3'); mkdirSync(runDir3);
  let n = 0;
  await assert.rejects(applyEdit({ file, config, text: '[mac-cli r3 kilo1]', round: 3, runDir: runDir3, beforeReplace: () => {
    n += 1; writeFileSync(file, appendToPack(readFileSync(file), config, `[pc-cli r3 zulu${n}]`));
  } }), /changed before replacement/);
  assert.equal(editIdsOf(validateIdentity(readPack(readFileSync(file)), config).body).includes('r3-mac-cli'), false);
});

test('symlinked fixture is rejected before any read or write', async () => {
  const { dir, file, config } = fixture();
  const link = join(dir, `${TITLE_PREFIX}link.textpack`);
  symlinkSync(file, link);
  await assert.rejects(stableRead(link), /symbolic link/);
  await assert.rejects(applyEdit({ file: link, config, text: '[mac-cli r1 lima1]', round: 1, runDir: config.receiptDir }), /symbolic link/);
});

test('invalid intermediate has a backed-up, byte-identical atomic repair', async () => {
  const { file, config } = fixture();
  const before = readFileSync(file);
  const runDir = join(config.receiptDir, 'invalid'); mkdirSync(runDir);
  const events = [];
  await transientInvalidPack({ file, config, round: 1, runDir, holdMs: 10, journal: e => events.push(e) });
  assert.ok(readFileSync(file).equals(before));
  assert.ok(readFileSync(join(runDir, 'mac-cli-r1-before-invalid.textpack')).equals(before));
  assert.deepEqual(events.map(e => e.event), ['invalid-intermediate', 'repaired-intermediate']);
});

test('observe returns the current body for round 0 and waits for every expected marker', async () => {
  const { file, config } = fixture();
  const zero = await observeBody({ file, config, expectedEditIds: [], pollMs: 20, maxMs: 1000 });
  assert.equal(zero.body, BASE_BODY);
  assert.deepEqual(zero.editIds, []);
  assert.equal(zero.timedOut, false);
  // Another client lands its marker 150 ms after observation begins.
  setTimeout(() => writeFileSync(file, appendToPack(readFileSync(file), config, '[pc-web r1 bravo5]')), 150);
  const o = await observeBody({ file, config, expectedEditIds: ['r1-pc-web'], pollMs: 20, maxMs: 2000 });
  assert.equal(o.timedOut, false);
  assert.equal(o.stable, true);
  assert.equal(o.body, `${BASE_BODY}[pc-web r1 bravo5]`);
  assert.deepEqual(o.editIds, ['r1-pc-web']);
  // A marker that never arrives: bounded timeout, the real body is still reported for evidence.
  const t = await observeBody({ file, config, expectedEditIds: ['r1-pc-web', 'r1-mac-app'], pollMs: 20, maxMs: 300 });
  assert.equal(t.timedOut, true);
  assert.deepEqual(t.editIds, ['r1-pc-web']);
});

test('actor protocol: attests real on its platform, refuses foreign fixture, runs a round, journals', async () => {
  const { file, config } = fixture();
  const actor = createActor(config, { platform: 'darwin' });
  const fixtureOk = { workspaceId: WS, itemId: ITEM };
  let r = await actor.handle({ type: 'prepare', round: 1 });
  assert.equal(r.type, 'error');
  r = await actor.handle({ type: 'hello', runId: 'run-x', role: 'mac-cli', mode: 'real', fixture: { workspaceId: 'ws-other', itemId: ITEM } });
  assert.match(r.message, /fixture/);
  assert.equal(existsSync(join(config.receiptDir, 'run-x')), false);
  r = await actor.handle({ type: 'hello', runId: 'run-x', role: 'mac-cli', mode: 'simulated', fixture: fixtureOk });
  assert.match(r.message, /real runs/);
  r = await actor.handle({ type: 'hello', runId: 'run-x', role: 'pc-cli', mode: 'real', fixture: fixtureOk });
  assert.match(r.message, /assigned role/);
  r = await actor.handle({ type: 'hello', runId: 'run-x', role: 'mac-cli', mode: 'real', fixture: fixtureOk });
  assert.deepEqual(r, { type: 'attest', round: 0, mode: 'real', workspaceId: WS, itemId: ITEM, machineId: hostname(), adapter: 'file-adapter' });
  const runDir = join(config.receiptDir, 'run-x');
  assert.ok(existsSync(join(runDir, 'journal.jsonl')));
  r = await actor.handle({ type: 'observe', round: 0, expectedEditIds: [] });
  assert.deepEqual(r, { type: 'state', round: 0, text: BASE_BODY, editIds: [] });
  assert.deepEqual(await actor.handle({ type: 'prepare', round: 1 }), { type: 'ready', round: 1 });
  r = await actor.handle({ type: 'edit', round: 1, edit: { id: 'r1-mac-cli', op: 'append', text: '[mac-cli r1 delta8]' } });
  assert.deepEqual(r, { type: 'applied', round: 1, editId: 'r1-mac-cli' });
  r = await actor.handle({ type: 'observe', round: 1, expectedEditIds: ['r1-mac-cli'] });
  assert.deepEqual(r, { type: 'state', round: 1, text: `${BASE_BODY}[mac-cli r1 delta8]`, editIds: ['r1-mac-cli'] });
  r = await actor.handle({ type: 'edit', round: 2, edit: { id: 'x', op: 'replace', text: 'nope' } });
  assert.equal(r.type, 'error');
  assert.equal(await actor.handle({ type: 'shutdown' }), null);
  const journal = readFileSync(join(runDir, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((e) => e.event);
  assert.deepEqual(journal, ['hello', 'observed', 'ready', 'replaced', 'applied', 'observed', 'error', 'shutdown']);
  assert.ok(existsSync(join(runDir, 'mac-cli-r1-a1-before.textpack')));
  // A second hello, or a reused run directory, is refused.
  const again = createActor(config, { platform: 'darwin' });
  r = await again.handle({ type: 'hello', runId: 'run-x', role: 'mac-cli', mode: 'real', fixture: fixtureOk });
  assert.match(r.message, /already exists/);
});

test('actor never attests real on the wrong platform and sanitizes errors', async () => {
  const { file, config } = fixture({ config: { role: 'pc-cli' } });
  const actor = createActor(config, { platform: 'darwin' });
  const r = await actor.handle({ type: 'hello', runId: 'run-y', role: 'pc-cli', mode: 'real', fixture: { workspaceId: WS, itemId: ITEM } });
  assert.equal(r.type, 'error');
  assert.match(r.message, /pc-cli requires win32/);
  assert.equal(existsSync(join(config.receiptDir, 'run-y')), false);
  const mac = createActor(validateActorConfig({ ...config, role: 'mac-cli' }), { platform: 'win32' });
  assert.match((await mac.handle({ type: 'hello', runId: 'run-y', role: 'mac-cli', mode: 'real', fixture: { workspaceId: WS, itemId: ITEM } })).message, /mac-cli requires darwin/);
  assert.equal(sanitizeError(new ActorError('x', `failed at ${file} with token=abc123`), config), 'failed at <path> with token=[redacted]');
});
