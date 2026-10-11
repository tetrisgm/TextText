// Real browser adapter for the six-client stress coordinator (roles mac-web / pc-web).
// Drives a visible installed Chrome (darwin) or Edge (win32) through Playwright against
// https://texttext.app using a persistent profile. It never runs headless, never simulates
// and never deletes profiles.
//
//   node sync/stress/browser-adapter.mjs <config.json>
//   config: { "profile": "/abs/dir", "workspaceId": uuid, "itemId": uuid, "title": "Six-client acceptance ...",
//             "auth": "existing-profile" (default) | "saved-app" }
//
// auth "existing-profile": the profile must already be signed in manually.
// auth "saved-app": the already linked native app account is exchanged for the browser
// session cookie through /api/app/session (browser-session.mjs), the same path the Windows
// production acceptance script uses; a missing profile directory is then created empty.
//
// Protocol: see sync/stress/README.md. Requests are handled one at a time, in order.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateAuthMode, prepareProfile, establishSavedAppSession } from './browser-session.mjs';
import { readBody } from './editor-projection.mjs';

export const ORIGIN = 'https://texttext.app';
export const ADAPTER_NAME = 'browser-adapter';
export const TITLE_PREFIX = 'Six-client acceptance ';
export const OBSERVE_MS = 30_000;
export const SAMPLE_MS = 500;
export const STABLE_SAMPLES = 3;
const MAX_LINE = 64 * 1024;
const MAX_EDIT_TEXT = 1024;
const MAX_EXPECTED_IDS = 10_000;
const MAX_ROUND = 10_000;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
// Must match the coordinator's planned edit text `[${role} r${round} ${word}${n}]`.
const MARKER = /\[(mac|pc)-(app|web|cli) r(\d{1,5}) [a-z]+\d{1,3}\]/g;

// ---- pure helpers (tested in browser-adapter.test.mjs) ----

export function roleForPlatform(platform) {
  if (platform === 'darwin') return { role: 'mac-web', channel: 'chrome', browser: 'visible Google Chrome' };
  if (platform === 'win32') return { role: 'pc-web', channel: 'msedge', browser: 'visible Microsoft Edge' };
  return null;
}

export function validateConfig(config) {
  const fail = (m) => { throw new Error(`config: ${m}`); };
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('must be an object');
  if (typeof config.profile !== 'string' || !config.profile || !isAbsolute(config.profile)) fail('profile must be an absolute directory path');
  if (typeof config.workspaceId !== 'string' || !UUID.test(config.workspaceId)) fail('workspaceId must be a UUID');
  if (typeof config.itemId !== 'string' || !UUID.test(config.itemId)) fail('itemId must be a UUID');
  if (typeof config.title !== 'string' || !config.title.startsWith(TITLE_PREFIX) || config.title.length > 200) fail(`title must start with "${TITLE_PREFIX}"`);
  const auth = validateAuthMode(config.auth);
  return { profile: config.profile, workspaceId: config.workspaceId, itemId: config.itemId, title: config.title, auth };
}

// Hello must name this machine's web role, real mode, and the configured fixture.
export function validateHello(message, config, platform) {
  const expected = roleForPlatform(platform);
  if (!expected) return { ok: false, reason: 'unsupported-platform' };
  if (message.role !== expected.role) return { ok: false, reason: 'role-mismatch' };
  if (message.mode !== 'real') return { ok: false, reason: 'mode-mismatch' };
  const f = message.fixture;
  if (!f || f.workspaceId !== config.workspaceId || f.itemId !== config.itemId) return { ok: false, reason: 'fixture-mismatch' };
  if (typeof message.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.runId)) return { ok: false, reason: 'run-id-invalid' };
  return { ok: true, role: expected.role };
}

export function validateRound(round) {
  return Number.isInteger(round) && round >= 0 && round <= MAX_ROUND;
}

export function validateEdit(edit) {
  if (!edit || typeof edit !== 'object') return { ok: false, reason: 'edit-missing' };
  if (typeof edit.id !== 'string' || !/^r\d{1,5}-(mac|pc)-(app|web|cli)$/.test(edit.id)) return { ok: false, reason: 'edit-id-invalid' };
  if (!['append', 'insert-start', 'replace-selection'].includes(edit.op)) return { ok: false, reason: 'edit-op-unsupported' };
  if (typeof edit.text !== 'string' || !edit.text.length || edit.text.length > MAX_EDIT_TEXT) return { ok: false, reason: 'edit-text-invalid' };
  const markers = [...edit.text.matchAll(MARKER)];
  const ids = markerEditIds(edit.text);
  if (markers.length !== 1 || ids[0] !== edit.id) return { ok: false, reason: 'edit-marker-mismatch' };
  return { ok: true };
}

export function validateExpectedIds(ids) {
  return Array.isArray(ids) && ids.length <= MAX_EXPECTED_IDS && ids.every((id) => typeof id === 'string' && id.length <= 64);
}

// Edit IDs derived from the markers actually present in the text, unique, first-seen order.
export function markerEditIds(text) {
  const ids = new Set();
  for (const m of String(text).matchAll(MARKER)) ids.add(`r${Number(m[3])}-${m[1]}-${m[2]}`);
  return [...ids];
}

export function allExpectedPresent(text, expectedEditIds) {
  const present = new Set(markerEditIds(text));
  return expectedEditIds.every((id) => present.has(id));
}

// Convergence sample rule: last N samples identical and every expected ID present in the last one.
export function isSettled(samples, expectedEditIds, stable = STABLE_SAMPLES) {
  if (samples.length < stable) return false;
  const tail = samples.slice(-stable);
  return tail.every((s) => s === tail[0]) && allExpectedPresent(tail[0], expectedEditIds);
}

// Diagnostics never carry URLs or credential-like pairs.
export const safeMessage = (error) => String(error?.message ?? error)
  .replace(/https?:\/\/\S+/gi, '[url]')
  .replace(/\b(token|secret|password|cookie|authorization|bearer)\b(\s*[:=]\s*|\s+)?(bearer\s+)?\S*/gi, '[redacted]')
  .slice(0, 300);

// ---- browser-facing functions, evaluated inside the page (self-contained) ----

const EDITOR = '[aria-label="Document body"]';
// Caret to the end through a DOM Range on the selection: no document data mutation.
const caretToEdge = ({ selector, start }) => {
  const el = document.querySelector(selector);
  if (!el || !el.isContentEditable) return false;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(start);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
};
const selectExactText = ({ selector, target }) => {
  const el = document.querySelector(selector);
  if (!el?.isContentEditable || el.textContent.split(target).length !== 2) return false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const offset = node.textContent.indexOf(target);
    if (offset < 0) continue;
    el.focus();
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + target.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString() === target;
  }
  return false;
};
const installContinuity = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  window.__texttextStressContinuity = { removed: false };
  new MutationObserver(() => { if (!el.isConnected) window.__texttextStressContinuity.removed = true; })
    .observe(document.body, { childList: true, subtree: true });
  return true;
};
const continuityRemoved = () => {
  const c = window.__texttextStressContinuity;
  return !c || c.removed === true;
};

// ---- adapter runtime ----

class StageError extends Error { constructor(stage, message) { super(message); this.stage = stage; } }

async function main() {
  const platform = roleForPlatform(process.platform);
  const configPath = process.argv[2];
  if (!platform) throw new StageError('platform', 'browser adapter runs only on macOS (Chrome) or Windows (Edge)');
  if (!configPath) throw new StageError('config', 'usage: browser-adapter.mjs <config.json>');
  const config = validateConfig(JSON.parse(readFileSync(configPath, 'utf8').replace(/^﻿/, '')));
  const profile = prepareProfile(config.profile, config.auth);

  const here = dirname(fileURLToPath(import.meta.url));
  const { sharedEditorReady } = await import(pathToFileURL(join(here, '..', '..', 'windows', 'scripts', 'live-browser-ready.mjs')).href);
  const { chromium } = await import('playwright');

  const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const sessionId = randomUUID();
  let context = null, page = null, body = null, heading = null;
  let reloads = 0, started = false, stopping = false;

  const fail = (round, stage, message) => {
    process.stderr.write(`[${stage}] ${safeMessage(message)}\n`);
    out({ type: 'error', round, stage, message: `browser adapter failed at stage ${stage}; profile and journals preserved` });
  };

  const assertOnItem = async () => {
    const text = (await heading.textContent().catch(() => null))?.trim();
    if (text !== config.title) throw new StageError('heading', 'browser is not on the acceptance item');
    if (await page.evaluate(continuityRemoved)) throw new StageError('continuity', 'original editor node was removed');
  };

  const bodyText = async () => {
    const text = await page.evaluate(readBody, EDITOR);
    if (typeof text !== 'string') throw new StageError('body', 'document body editor not present');
    return text;
  };

  const handlers = {
    async hello(m) {
      if (started) throw new StageError('hello', 'duplicate hello');
      const v = validateHello(m, config, process.platform);
      if (!v.ok) throw new StageError('hello', v.reason);
      started = true;
      let stage = 'launch';
      try {
        context = await chromium.launchPersistentContext(config.profile, { channel: platform.channel, headless: false, viewport: { width: 1280, height: 900 } });
        page = context.pages()[0] ?? await context.newPage();
        if (config.auth === 'saved-app') {
          stage = 'sign-in';
          // Fixed-message errors only; the loaded account never reaches this scope.
          await establishSavedAppSession({ context, platform: process.platform, workspaceId: config.workspaceId, itemId: config.itemId });
        }
        stage = 'open-item';
        await page.goto(`${ORIGIN}/vault/${config.workspaceId}?item=${config.itemId}`, { waitUntil: 'domcontentloaded' });
        heading = page.locator('.vault-context-location h2');
        const deadline = Date.now() + 45_000;
        for (;;) {
          const path = new URL(page.url()).pathname;
          if (!path.startsWith('/vault/')) {
            stage = 'signed-in';
            throw new Error(config.auth === 'saved-app' ? 'saved app session did not open the workspace' : 'profile is not signed in; sign in manually in that profile first');
          }
          if ((await heading.textContent().catch(() => null))?.trim() === config.title) break;
          if (Date.now() > deadline) { stage = 'heading'; throw new Error('acceptance item heading did not appear'); }
          await page.waitForTimeout(SAMPLE_MS);
        }
        stage = 'open-editor';
        body = page.getByRole('textbox', { name: 'Document body', exact: true });
        if (!await body.isVisible()) await page.getByRole('button', { name: 'Edit card', exact: true }).click();
        await body.waitFor({ state: 'visible', timeout: 30_000 });
        stage = 'shared-ready';
        await page.waitForFunction(sharedEditorReady, config.itemId, { timeout: 45_000 })
          .catch(() => { throw new Error('editor did not join the shared document'); });
        stage = 'continuity';
        if (!await page.evaluate(installContinuity, EDITOR)) throw new Error('editor node missing');
        page.on('load', () => { reloads += 1; });
        page.on('close', () => { if (!stopping) fail(0, 'page-closed', 'browser page closed'); });
      } catch (error) {
        throw new StageError(error.stage ?? stage, safeMessage(error));
      }
      out({ type: 'attest', round: 0, mode: 'real', adapter: ADAPTER_NAME, workspaceId: config.workspaceId, itemId: config.itemId, machineId: hostname(), browser: platform.browser, sessionId, auth: config.auth, profileCreated: profile.created });
    },
    async prepare(m) {
      await assertOnItem();
      if (!await page.evaluate(sharedEditorReady, config.itemId)) throw new StageError('shared-ready', 'editor left the shared document');
      if (m.select && !await page.evaluate(selectExactText, { selector: EDITOR, target: m.select })) throw new StageError('prepare', 'replacement target could not be selected');
      out({ type: 'ready', round: m.round });
    },
    async transport(m) {
      if (typeof m.online !== 'boolean') throw new StageError('transport', 'online must be boolean');
      await assertOnItem();
      await context.setOffline(!m.online);
      out({ type: 'transport', round: m.round, online: m.online });
    },
    async edit(m) {
      const v = validateEdit(m.edit);
      if (!v.ok) throw new StageError('edit', v.reason);
      await assertOnItem();
      if (m.edit.op === 'replace-selection') {
        if (!await page.evaluate(() => window.getSelection()?.toString() === 'Existing fixture text.')) throw new StageError('edit', 'replacement selection changed before input');
      } else if (!await page.evaluate(caretToEdge, { selector: EDITOR, start: m.edit.op === 'insert-start' })) throw new StageError('edit', 'editor not editable');
      await page.keyboard.insertText(m.edit.text);
      const after = await bodyText();
      if (after.split(m.edit.text).length < 2) throw new StageError('edit', 'inserted text not visible in editor');
      out({ type: 'applied', round: m.round, editId: m.edit.id });
    },
    async observe(m) {
      if (!validateExpectedIds(m.expectedEditIds)) throw new StageError('observe', 'expectedEditIds invalid');
      await assertOnItem();
      const samples = [];
      const deadline = Date.now() + OBSERVE_MS;
      // Real body samples only; the state sent is the last actual sample even when not settled,
      // so the coordinator judges convergence from evidence rather than from this adapter's claim.
      for (;;) {
        samples.push(await bodyText());
        if (isSettled(samples, m.expectedEditIds) || Date.now() > deadline) break;
        await page.waitForTimeout(SAMPLE_MS);
      }
      if (await page.evaluate(continuityRemoved)) throw new StageError('continuity', 'original editor node was removed');
      const text = samples[samples.length - 1];
      out({ type: 'state', round: m.round, text, editIds: markerEditIds(text), editor: { sessionId, reloads }, settled: isSettled(samples, m.expectedEditIds), samples: samples.length });
    },
    async shutdown() {
      stopping = true;
      await context?.close().catch(() => {});
      process.exit(0);
    },
  };

  let queue = Promise.resolve();
  const handle = (line) => {
    if (line.length > MAX_LINE) return fail(0, 'input', 'request line too long');
    let m;
    try { m = JSON.parse(line); } catch { return fail(0, 'input', 'request is not JSON'); }
    if (!m || typeof m.type !== 'string' || !(m.type in handlers)) return fail(0, 'input', 'unknown request type');
    const round = m.type === 'hello' || m.type === 'shutdown' ? 0 : m.round;
    if (!validateRound(round)) return fail(0, 'input', 'round invalid');
    if (m.type !== 'hello' && m.type !== 'shutdown' && !started) return fail(round, m.type, 'hello required first');
    queue = queue.then(() => handlers[m.type](m)).catch((error) => fail(round, error.stage ?? m.type, error));
  };
  const rl = createInterface({ input: process.stdin });
  rl.on('line', handle);
  rl.on('close', () => { queue = queue.then(() => handlers.shutdown()); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[${error.stage ?? 'startup'}] ${safeMessage(error)}\n`);
    process.stdout.write(`${JSON.stringify({ type: 'error', round: 0, stage: error.stage ?? 'startup', message: `browser adapter failed at stage ${error.stage ?? 'startup'}` })}\n`);
    process.exit(1);
  });
}
