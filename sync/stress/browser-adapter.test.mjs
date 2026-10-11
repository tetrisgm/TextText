// node --test sync/stress/browser-adapter.test.mjs
// Pure helper tests only: no browser, no network, no profile is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRounds } from './coordinator.mjs';
import {
  roleForPlatform, validateConfig, validateHello, validateEdit, validateExpectedIds, validateRound,
  markerEditIds, allExpectedPresent, isSettled, safeMessage, TITLE_PREFIX,
} from './browser-adapter.mjs';

const WS = '5f211864-df09-4bf6-9410-918c19dfb0eb';
const ITEM = 'a7d2b4f7-2e8e-4b05-8f61-76a4901afb9d';
const config = { profile: '/tmp/texttext-acceptance-profile', workspaceId: WS, itemId: ITEM, title: `${TITLE_PREFIX}2026-10-09` };
const hello = { type: 'hello', runId: 'stress-2026-10-09T00-00-00-000Z-42', role: 'mac-web', mode: 'real', fixture: { workspaceId: WS, itemId: ITEM } };

test('role follows the actual operating system, never a claim', () => {
  assert.deepEqual(roleForPlatform('darwin'), { role: 'mac-web', channel: 'chrome', browser: 'visible Google Chrome' });
  assert.deepEqual(roleForPlatform('win32'), { role: 'pc-web', channel: 'msedge', browser: 'visible Microsoft Edge' });
  assert.equal(roleForPlatform('linux'), null);
});

test('config requires absolute profile, UUID fixture and acceptance title; auth defaults off', () => {
  assert.deepEqual(validateConfig(config), { ...config, auth: 'existing-profile' });
  assert.deepEqual(validateConfig({ ...config, auth: 'saved-app' }), { ...config, auth: 'saved-app' });
  assert.throws(() => validateConfig({ ...config, auth: 'cookie-import' }), /auth/);
  assert.throws(() => validateConfig({ ...config, auth: '' }), /auth/);
  assert.throws(() => validateConfig({ ...config, profile: 'relative/profile' }), /profile/);
  assert.throws(() => validateConfig({ ...config, workspaceId: 'ws-fixture' }), /workspaceId/);
  assert.throws(() => validateConfig({ ...config, itemId: '' }), /itemId/);
  assert.throws(() => validateConfig({ ...config, title: 'Scratch note' }), /title/);
  assert.throws(() => validateConfig(null), /object/);
  assert.throws(() => validateConfig({ ...config, extra: 1, title: 'x'.repeat(300) }), /title/);
});

test('hello must match OS role, real mode, fixture and a bounded run id', () => {
  assert.deepEqual(validateHello(hello, config, 'darwin'), { ok: true, role: 'mac-web' });
  assert.equal(validateHello(hello, config, 'win32').reason, 'role-mismatch');
  assert.equal(validateHello({ ...hello, role: 'pc-web' }, config, 'win32').ok, true);
  assert.equal(validateHello({ ...hello, role: 'mac-app' }, config, 'darwin').reason, 'role-mismatch');
  assert.equal(validateHello({ ...hello, mode: 'simulated' }, config, 'darwin').reason, 'mode-mismatch');
  assert.equal(validateHello({ ...hello, fixture: { workspaceId: WS, itemId: WS } }, config, 'darwin').reason, 'fixture-mismatch');
  assert.equal(validateHello({ ...hello, fixture: undefined }, config, 'darwin').reason, 'fixture-mismatch');
  assert.equal(validateHello({ ...hello, runId: 'bad run/id' }, config, 'darwin').reason, 'run-id-invalid');
  assert.equal(validateHello(hello, config, 'linux').reason, 'unsupported-platform');
});

test('marker-derived edit ids use the coordinator marker format exactly', () => {
  const edits = planRounds(42, 2).flatMap((p) => p.edits);
  const text = `Existing fixture text.\n${edits.map((e) => e.text).join('')} and again ${edits[0].text}`;
  assert.deepEqual(markerEditIds(text), edits.map((e) => e.id));
  assert.deepEqual(markerEditIds('[mac-web r1 alpha]'), []);          // missing number
  assert.deepEqual(markerEditIds('[linux-web r1 alpha1]'), []);       // unknown machine
  assert.deepEqual(markerEditIds('[mac-web r1  alpha1]'), []);        // extra whitespace
  assert.deepEqual(markerEditIds('[mac-web r01 alpha1]'), ['r1-mac-web']);
  assert.deepEqual(markerEditIds(''), []);
});

test('planned edits validate; forged, mismatched or oversized edits do not', () => {
  const edit = planRounds(42, 1)[0].edits.find((e) => e.role === 'mac-web');
  assert.equal(validateEdit({ id: edit.id, op: 'append', text: edit.text }).ok, true);
  assert.equal(validateEdit({ id: 'r1-pc-web', op: 'append', text: edit.text }).reason, 'edit-marker-mismatch');
  assert.equal(validateEdit({ id: edit.id, op: 'replace', text: edit.text }).reason, 'edit-op-unsupported');
  assert.equal(validateEdit({ id: edit.id, op: 'append', text: `${edit.text}${edit.text}` }).reason, 'edit-marker-mismatch');
  assert.equal(validateEdit({ id: edit.id, op: 'append', text: 'x'.repeat(2000) }).reason, 'edit-text-invalid');
  assert.equal(validateEdit({ id: 'drop table', op: 'append', text: edit.text }).reason, 'edit-id-invalid');
  assert.equal(validateEdit(null).reason, 'edit-missing');
});

test('rounds and expected id lists are bounded', () => {
  assert.equal(validateRound(0), true);
  assert.equal(validateRound(10001), false);
  assert.equal(validateRound('1'), false);
  assert.equal(validateExpectedIds([]), true);
  assert.equal(validateExpectedIds(['r1-mac-web']), true);
  assert.equal(validateExpectedIds([1]), false);
  assert.equal(validateExpectedIds(new Array(10001).fill('r1-mac-web')), false);
  assert.equal(validateExpectedIds('r1-mac-web'), false);
});

test('settled only when expected ids are present and consecutive samples are identical', () => {
  const a = '[mac-web r1 alpha1]';
  const ab = '[mac-web r1 alpha1][pc-web r1 bravo2]';
  const expected = ['r1-mac-web', 'r1-pc-web'];
  assert.equal(allExpectedPresent(a, expected), false);
  assert.equal(allExpectedPresent(ab, expected), true);
  assert.equal(isSettled([ab, ab], expected), false);               // too few samples
  assert.equal(isSettled([a, a, a], expected), false);              // stable but incomplete
  assert.equal(isSettled([a, ab, ab], expected), false);            // still changing
  assert.equal(isSettled([a, ab, ab, ab], expected), true);
  assert.equal(isSettled([ab, ab, ab], []), true);                  // round zero baseline
});

test('diagnostics strip urls and credential-like fragments', () => {
  const m = safeMessage(new Error('goto https://texttext.app/vault/x?token=abc failed Authorization: Bearer zzz'));
  assert.doesNotMatch(m, /https?:/);
  assert.doesNotMatch(m, /abc|zzz/);
  assert.ok(safeMessage('x'.repeat(1000)).length <= 300);
});
