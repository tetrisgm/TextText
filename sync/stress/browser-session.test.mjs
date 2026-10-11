// node --test sync/stress/browser-session.test.mjs
// Pure tests with injected loaders/exchange: no browser, no network, no credential file,
// no profile directory is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORIGIN, DEFAULT_AUTH, AUTH_MODES, SessionError, validateAuthMode, prepareProfile,
  validateWindowsAccount, validateMacCredentials, macCredentialsPath, sessionRequest, establishSavedAppSession,
} from './browser-session.mjs';

const WS = '5f211864-df09-4bf6-9410-918c19dfb0eb';
const ITEM = 'a7d2b4f7-2e8e-4b05-8f61-76a4901afb9d';
const SECRET = 'wsk_SECRETtokenVALUE0123456789';
const winAccount = () => ({ WorkspaceId: WS, Token: SECRET });
const macCreds = () => ({ token: SECRET, serverOrigin: ORIGIN, tokenName: 'Mac', linkedAt: '2026-10-01T00:00:00Z' });

// Every rejection must be a fixed message: no secret, no cause, no stack from the thrown input.
const assertNoLeak = (error) => {
  assert.ok(error instanceof SessionError, 'session errors only');
  assert.doesNotMatch(error.message, /SECRET|wsk_/);
  assert.doesNotMatch(String(error.stack), /SECRET|wsk_/);
  assert.equal(error.cause, undefined);
};

test('auth defaults to existing-profile and accepts only the two known modes', () => {
  assert.equal(validateAuthMode(undefined), 'existing-profile');
  assert.equal(DEFAULT_AUTH, 'existing-profile');
  assert.deepEqual([...AUTH_MODES], ['existing-profile', 'saved-app']);
  assert.equal(validateAuthMode('saved-app'), 'saved-app');
  assert.throws(() => validateAuthMode('cookie-import'), /auth/);
  assert.throws(() => validateAuthMode(null), /auth/);
  assert.throws(() => validateAuthMode(''), /auth/);
});

test('profile is created only for saved-app, only non-recursively, never removed', () => {
  const calls = [];
  const fsWith = (entries) => ({
    existsSync: (p) => p in entries,
    statSync: (p) => ({ isDirectory: () => entries[p] === 'dir' }),
    mkdirSync: (p, opts) => { calls.push([p, opts]); entries[p] = 'dir'; },
  });
  // existing directory: nothing created in either mode
  assert.deepEqual(prepareProfile('/parent/profile', 'existing-profile', fsWith({ '/parent': 'dir', '/parent/profile': 'dir' })), { created: false });
  assert.deepEqual(prepareProfile('/parent/profile', 'saved-app', fsWith({ '/parent': 'dir', '/parent/profile': 'dir' })), { created: false });
  assert.deepEqual(calls, []);
  // missing directory: existing-profile refuses
  assert.throws(() => prepareProfile('/parent/profile', 'existing-profile', fsWith({ '/parent': 'dir' })), /already exist and be signed in/);
  assert.deepEqual(calls, []);
  // saved-app creates it with recursive false when the parent exists
  assert.deepEqual(prepareProfile('/parent/profile', 'saved-app', fsWith({ '/parent': 'dir' })), { created: true });
  assert.deepEqual(calls, [['/parent/profile', { recursive: false, mode: 0o700 }]]);
  // saved-app still refuses a missing parent and a non-directory path
  assert.throws(() => prepareProfile('/missing/profile', 'saved-app', fsWith({})), /parent directory/);
  assert.throws(() => prepareProfile('/parent/profile', 'saved-app', fsWith({ '/parent': 'dir', '/parent/profile': 'file' })), /not a directory/);
  assert.equal(calls.length, 1);
});

test('windows account must name the configured workspace and carry a usable token', () => {
  assert.deepEqual(validateWindowsAccount(winAccount(), WS), { token: SECRET });
  for (const bad of [
    { ...winAccount(), WorkspaceId: ITEM },
    { ...winAccount(), WorkspaceId: WS.toUpperCase() + 'x' },
    { ...winAccount(), WorkspaceId: undefined },
    { ...winAccount(), Token: '' },
    { ...winAccount(), Token: 'abc' },
    { ...winAccount(), Token: `${SECRET} trailing` },
    { ...winAccount(), Token: 'x'.repeat(600) },
    { ...winAccount(), Token: 42 },
    null, 'string', [],
  ]) {
    assert.throws(() => validateWindowsAccount(bad, WS), assertNoLeakThrows);
  }
});

test('mac credentials must be for exactly the live origin', () => {
  assert.deepEqual(validateMacCredentials(macCreds()), { token: SECRET });
  for (const origin of ['https://texttext.app/', 'http://texttext.app', 'https://TEXTTEXT.app', 'https://texttext.app.evil.example',
    'http://localhost:3000', 'http://127.0.0.1:3000', 'https://evil.example', '', undefined]) {
    assert.throws(() => validateMacCredentials({ ...macCreds(), serverOrigin: origin }), (e) => { assertNoLeak(e); return /live app origin/.test(e.message); });
  }
  assert.throws(() => validateMacCredentials({ ...macCreds(), token: 'not-a-device-token' }), assertNoLeakThrows);
  assert.throws(() => validateMacCredentials(null), assertNoLeakThrows);
  assert.ok(macCredentialsPath('/Users/example').replaceAll('\\', '/').endsWith('/Library/Application Support/TextText/credentials.json'));
});

test('session request targets only the live origin with a vault destination', () => {
  const { url, destination } = sessionRequest(WS, ITEM);
  assert.equal(destination, `/vault/${WS}?item=${ITEM}`);
  assert.equal(url, `${ORIGIN}/api/app/session?next=${encodeURIComponent(destination)}`);
  assert.throws(() => sessionRequest('../admin', ITEM), SessionError);
  assert.throws(() => sessionRequest(WS, 'x'), SessionError);
});

test('exchange sends the bearer header and app marker once, expects 303, then drops the token', async () => {
  const seen = [];
  const exchange = async (request) => { seen.push({ ...request, headers: { ...request.headers } }); return { status: () => 303 }; };
  const result = await establishSavedAppSession({ context: null, platform: 'win32', workspaceId: WS, itemId: ITEM, load: () => winAccount(), exchange });
  assert.deepEqual(result, { destination: `/vault/${WS}?item=${ITEM}` });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${ORIGIN}/api/app/session?next=${encodeURIComponent(`/vault/${WS}?item=${ITEM}`)}`);
  assert.equal(seen[0].maxRedirects, 0);
  assert.deepEqual(seen[0].headers, { Authorization: `Bearer ${SECRET}`, 'x-texttext-app': '1' });

  // mac path with plain numeric status also works
  const mac = await establishSavedAppSession({ context: null, platform: 'darwin', workspaceId: WS, itemId: ITEM, load: () => macCreds(), exchange: async () => ({ status: 303 }) });
  assert.equal(mac.destination, `/vault/${WS}?item=${ITEM}`);
});

test('exchange hands the loaded record to the platform validator and scrubs it afterwards', async () => {
  const record = winAccount();
  await establishSavedAppSession({ context: null, platform: 'win32', workspaceId: WS, itemId: ITEM, load: () => record, exchange: async () => ({ status: () => 303 }) });
  assert.equal(record.Token, '');
  const macRecord = macCreds();
  await establishSavedAppSession({ context: null, platform: 'darwin', workspaceId: WS, itemId: ITEM, load: () => macRecord, exchange: async () => ({ status: () => 303 }) });
  assert.equal(macRecord.token, '');
  // mac loader output is never accepted as a windows record and vice versa
  await assert.rejects(establishSavedAppSession({ context: null, platform: 'win32', workspaceId: WS, itemId: ITEM, load: () => macCreds(), exchange: async () => ({ status: () => 303 }) }), assertNoLeakThrows);
  await assert.rejects(establishSavedAppSession({ context: null, platform: 'darwin', workspaceId: WS, itemId: ITEM, load: () => winAccount(), exchange: async () => ({ status: () => 303 }) }), assertNoLeakThrows);
});

test('workspace mismatch, non-303, loader and transport failures never leak the secret', async () => {
  let exchanges = 0;
  const counting = async () => { exchanges += 1; return { status: () => 303 }; };
  // wrong workspace: no request is made at all
  await assert.rejects(establishSavedAppSession({ context: null, platform: 'win32', workspaceId: ITEM, itemId: ITEM, load: () => winAccount(), exchange: counting }), (e) => { assertNoLeak(e); return e.stage === 'account'; });
  assert.equal(exchanges, 0);
  // wrong origin on mac: no request is made at all
  await assert.rejects(establishSavedAppSession({ context: null, platform: 'darwin', workspaceId: WS, itemId: ITEM, load: () => ({ ...macCreds(), serverOrigin: 'http://localhost:3000' }), exchange: counting }), (e) => { assertNoLeak(e); return e.stage === 'account'; });
  assert.equal(exchanges, 0);
  // unsupported platform
  await assert.rejects(establishSavedAppSession({ context: null, platform: 'linux', workspaceId: WS, itemId: ITEM, load: () => winAccount(), exchange: counting }), (e) => { assertNoLeak(e); return e.stage === 'account'; });
  assert.equal(exchanges, 0);
  // 401 / 200 / 302 are all failures
  for (const status of [401, 403, 200, 302, 404, undefined]) {
    await assert.rejects(establishSavedAppSession({ context: null, platform: 'win32', workspaceId: WS, itemId: ITEM, load: () => winAccount(), exchange: async () => ({ status: () => status }) }), (e) => { assertNoLeak(e); return e.stage === 'sign-in'; });
  }
  // loader errors carrying the decrypted text (what a child-process or JSON.parse error does) are replaced
  const leakyLoader = () => { const e = new Error(`Unexpected token in JSON: {"Token":"${SECRET}"}`); e.stdout = SECRET; throw e; };
  await assert.rejects(establishSavedAppSession({ context: null, platform: 'win32', workspaceId: WS, itemId: ITEM, load: leakyLoader, exchange: counting }), (e) => { assertNoLeak(e); assert.equal(e.stdout, undefined); return e.stage === 'account'; });
  // transport errors echoing request headers are replaced
  const leakyExchange = async (request) => { throw new Error(`request failed: ${JSON.stringify(request.headers)}`); };
  await assert.rejects(establishSavedAppSession({ context: null, platform: 'win32', workspaceId: WS, itemId: ITEM, load: () => winAccount(), exchange: leakyExchange }), (e) => { assertNoLeak(e); return e.stage === 'sign-in'; });
  assert.equal(exchanges, 0);
});

function assertNoLeakThrows(error) { assertNoLeak(error); return true; }
