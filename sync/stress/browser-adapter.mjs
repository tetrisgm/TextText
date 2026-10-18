import {createLostAckFault,validateLostAckScenario,readLostAckJournal} from './lost-ack.mjs';
import {inspectLeafPack} from './leaf-move.mjs';
import {unzipSync} from 'fflate';
import {validateLeafMove,leafRequest,observeManifestLeaf} from './leaf-move.mjs';
import {folderRequest,observeManifestFolder} from './folder-case.mjs';
import { crashOwnedBrowser, closeOwnedBrowser, retainGuardedBrowser, observeOwnedBrowser } from './browser-lifecycle.mjs';
import { readLiveFieldDocument } from './multi-field-page.mjs';
import { validateFieldSequence, typeFieldSequence } from './multi-field-input.mjs';
import { validateUndoRedo, exerciseUndoRedo } from './undo-redo.mjs';
import { observeSealedSource, fixedDriverFiles, accountScopeHash, createWebAssetObserver, sha256, canonicalJSON } from './identity-observation.mjs';
import { validateInputSequence, typeInputSequence } from './input-sequence.mjs';
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
import { readFileSync, realpathSync } from 'node:fs';
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
  if (config.identityReceipt !== undefined && (typeof config.identityReceipt !== 'string' || !isAbsolute(config.identityReceipt))) fail('identityReceipt must be an absolute path');
  const auth = validateAuthMode(config.auth);
  return { profile: config.profile, workspaceId: config.workspaceId, itemId: config.itemId, title: config.title, auth, ...(config.lostAck!==undefined?{lostAck:validateLostAckScenario(config.lostAck)}:{}), ...(config.leafMove!==undefined?{leafMove:validateLeafMove(config.leafMove)}:{}), ...(config.identityReceipt ? { identityReceipt: config.identityReceipt } : {}) };
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
  if (!validateUndoRedo(edit)) return { ok: false, reason: 'undo-redo-invalid' };
  if (!validateInputSequence(edit)) return { ok: false, reason: 'input-sequence-invalid' };
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
  const role = platform.role;
  const profile = prepareProfile(config.profile, config.auth);
  const ownedProfile = realpathSync(config.profile);

  const here = dirname(fileURLToPath(import.meta.url));
  const { sharedEditorReady } = await import(pathToFileURL(join(here, '..', '..', 'windows', 'scripts', 'live-browser-ready.mjs')).href);
  const { chromium } = await import('playwright');

  const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  let sessionId = randomUUID(), generation = 1, helloRequest, restarting = false, online = true;
  let context = null, page = null, body = null, heading = null;
  let boundAccountId, lostAckFault;
  let reloads = 0, started = false, stopping = false;
  let inputProgress, historyProgress, fieldProgress, observeAssets, retainedFailure, retentionAnnounced = false;

  const fail = (round, stage, message) => {
    if (retentionAnnounced) return;
    process.stderr.write(`[${stage}] ${safeMessage(message)}\n`);
    out({ type: 'error', round, stage, ...(fieldProgress ? { fieldProgress } : {}), ...(historyProgress ? { historyProgress } : {}), ...(inputProgress ? { inputProgress } : {}), message: `browser adapter failed at stage ${stage}; profile and journals preserved`, ...(retainedFailure ? {retained:retainedFailure} : {}) });
    if (retainedFailure) retentionAnnounced = true;
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

  async function inspectDocument() {
    await assertOnItem();
    const snapshot = await page.evaluate(readLiveFieldDocument, { itemId: config.itemId, workspaceId: config.workspaceId, title: config.title });
    if (!snapshot || snapshot.content?.title !== config.title || snapshot.presentation?.template?.id !== 'texttext.article') throw new StageError('observe', 'live article snapshot or existing subtitle unavailable');
    return snapshot;
  }
  async function openBrowser(m, isRestart) {
      let stage = 'launch';
      try {
        context = await chromium.launchPersistentContext(ownedProfile, { channel: platform.channel, args: ['--enable-automation'], headless: false, viewport: { width: 1280, height: 900 } });
        page = context.pages()[0] ?? await context.newPage();
        if (m.identitySchema === 1) observeAssets = createWebAssetObserver(page, ORIGIN);
        if (config.auth === 'saved-app' && !isRestart) {
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
        const ownedPage = page;
        page.on('load', () => { if (page === ownedPage) reloads += 1; });
        page.on('close', () => { if (page === ownedPage && !stopping && !restarting) fail(0, 'page-closed', 'browser page closed'); });
      } catch (error) {
        throw new StageError(error.stage ?? stage, safeMessage(error));
      }
      let identity;
      if (m.identitySchema === 1) {
        const source = observeSealedSource(config.identityReceipt, platform.role, fixedDriverFiles(platform.role));
        const headers = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
        const buildResponse = await context.request.get(`${ORIGIN}/api/app/build?identity=${encodeURIComponent(m.runId)}`, { headers, timeout: 10000 });
        if (!buildResponse.ok() || !/no-store/i.test(buildResponse.headers()['cache-control'] ?? '')) throw new StageError('identity', 'uncached deployment identity unavailable');
        const build = await buildResponse.json();
        const sessionResponse = await context.request.get(`${ORIGIN}/api/auth/session`, { headers, timeout: 10000 });
        if (!sessionResponse.ok()) throw new StageError('identity', 'authenticated account identity unavailable');
        const accountId = (await sessionResponse.json())?.user?.userId;
        boundAccountId=accountId;
        const browserVersion = context.browser()?.version();
        identity = { schemaVersion: 1, role: platform.role, platform: process.platform, artifactKind: 'browser',
          principalKind: 'authenticated-account', principalScopeHash: accountScopeHash(ORIGIN, accountId),
          runtimeName: platform.channel, runtimeVersion: process.versions.node, browserVersion,
          deploymentId: build.buildId, driverSourceCommit: source.sourceCommit, sourceReceiptSha256: source.sourceReceiptSha256,
          artifacts: { ...source.artifacts, ...await observeAssets() } };
      }
      return { type: 'attest', round: 0, mode: 'real', adapter: ADAPTER_NAME, workspaceId: config.workspaceId, itemId: config.itemId, machineId: hostname(), browser: platform.browser, sessionId, auth: config.auth, profileCreated: !isRestart && profile.created, generation, ...(identity ? { identity } : {}) };
  }
  const handlers = {
    async hello(m) {
      if (started) throw new StageError('hello', 'duplicate hello');
      const v = validateHello(m, config, process.platform);
      if (!v.ok) throw new StageError('hello', v.reason);
      started = true; helloRequest = m;
      out(await openBrowser(m, false));
    },
    async restart(m) {
      await assertOnItem();
      if (m.graceful !== undefined && typeof m.graceful !== 'boolean') throw new StageError('restart', 'graceful must be boolean');
      if (generation !== 1 || !helloRequest) throw new StageError('restart', 'only one attested browser restart supported');
      restarting = true;
      const wasOffline = !online;
      try {
        if (m.graceful === true && wasOffline) throw new StageError('restart', 'normal browser close requires online transport');
        const killed = m.graceful === true ? await closeOwnedBrowser(context, page, ownedProfile) : await crashOwnedBrowser(context, ownedProfile);
        generation += 1; sessionId = randomUUID(); reloads = 0; online = true;
        const attestation = await openBrowser(helloRequest, true);
        out({ type: 'restart', round: m.round, generation, attestation,
          ...(m.graceful === true ? { lifecycle: 'normal-close-reopen', normalClose: killed, reopenedBrowser: await observeOwnedBrowser(context, ownedProfile) } : { crash: killed }), reconnectByRestart: wasOffline, online: true });
      } finally { restarting = false; }
    },
    async prepare(m) {
      await assertOnItem();
      if (!await page.evaluate(sharedEditorReady, config.itemId)) throw new StageError('shared-ready', 'editor left the shared document');
      if (m.select && !await page.evaluate(selectExactText, { selector: EDITOR, target: m.select })) throw new StageError('prepare', 'replacement target could not be selected');
      out({ type: 'ready', round: m.round });
    },
    async armLostAck(m) {
      await assertOnItem();
      if (!config.lostAck ||
          config.lostAck.role !== role ||
          m.round !== 1 ||
          m.edit?.id !== `r1-${role}` ||
          !validateEdit(m.edit).ok ||
          m.edit.op !== 'append' || m.edit.fieldEdits || m.edit.inputSequence || m.edit.undoRedo ||
          lostAckFault ||
          !boundAccountId ||
          helloRequest?.identitySchema !== 1) throw new StageError('lost-ack', 'Bound fault configuration unavailable');
      const scope = {
        origin: ORIGIN,
        accountId: boundAccountId,
        workspaceId: config.workspaceId,
        itemId: config.itemId
      };
      if (!(await page.evaluate(readLostAckJournal, scope))) throw new StageError('lost-ack', 'Existing durable editor journal is not clean');
      lostAckFault = await createLostAckFault({
        cdp: await context.newCDPSession(page),
        url: `${ORIGIN}/api/vault/${config.workspaceId}/items/${config.itemId}/collaboration`,
        itemId: config.itemId,
        faultId: m.faultId,
        editId: m.edit.id,
        verifyRequest: body => page.evaluate(readLostAckJournal, {
          ...scope,
          body
        }),
        proveCommit: async result => {
          await assertOnItem();
          const response = await context.request.get(`${ORIGIN}/api/vault/${config.workspaceId}/items/${config.itemId}`, {
            headers: {
              'Cache-Control': 'no-cache'
            },
            timeout: 10000
          });
          if (!response.ok() || Number(response.headers()['content-length'] ?? 0) > 64 * 1024 * 1024) throw Error('Committed pack unavailable');
          const bytes = await response.body(),
            pack = inspectLeafPack(bytes, config);
          if (decodeURIComponent(response.headers()['x-texttext-path'] ?? '') !== result.relativePath ||
              response.headers().etag !== `"${pack.archiveSha256}"`) throw Error('Committed path changed');
          // A concurrent participant may already have advanced the pack revision.
          // The immutable write receipt still pins the original revision; the
          // fresh complete pack proves the selected edit exists exactly once.
          const entries = unzipSync(bytes, {
            filter: e => e.name === 'document.json' || /^[^/]+\/document\.json$/.test(e.name)
          });
          const docs = Object.values(entries);
          if (docs.length !== 1) throw Error('Ambiguous committed document');
          const doc = JSON.parse(new TextDecoder('utf-8', {
            fatal: true
          }).decode(docs[0]));
          const occurrences = doc.content.body.split(m.edit.text).length - 1;
          if (occurrences === 0) return {
            eligible: false
          };
          if (occurrences !== 1) throw Error('Selected edit is not committed exactly once');
          return {
            archiveSha256: pack.archiveSha256,
            documentSha256: pack.documentSha256,
            assetHashes: pack.assetHashes
          };
        }
      });
      out({
        type: 'lost-ack-armed',
        round: m.round,
        proof: lostAckFault.proof()
      });
    },
    async observeLostAck(m) {
      await assertOnItem();
      if (!lostAckFault || m.round !== 1) throw new StageError('lost-ack', 'No armed fault');
      const proof = lostAckFault.proof();
      if (proof.phase === 'replayed') {
        await lostAckFault.close();
      }
      out({
        type: 'lost-ack-state',
        round: m.round,
        proof
      });
    },
    async transport(m) {
      if (typeof m.online !== 'boolean') throw new StageError('transport', 'online must be boolean');
      await assertOnItem();
      await context.setOffline(!m.online); online = m.online;
      out({ type: 'transport', round: m.round, online: m.online });
    },
    async edit(m) {
      const v = validateEdit(m.edit);
      if (!v.ok) throw new StageError('edit', v.reason);
      await assertOnItem();
      if (m.edit.fieldEdits !== undefined && (!validateFieldSequence(m.edit.fieldEdits, role) || m.edit.fieldEdits[0].text !== m.edit.text || m.edit.fieldEdits.some(field => field.id !== m.edit.id + '-' + field.field) || m.edit.undoRedo || m.edit.inputSequence)) throw new StageError('edit', 'field sequence invalid');
      if (m.edit.op === 'replace-selection') {
        if (!await page.evaluate(() => window.getSelection()?.toString() === 'Existing fixture text.')) throw new StageError('edit', 'replacement selection changed before input');
      } else if (!await page.evaluate(caretToEdge, { selector: EDITOR, start: m.edit.op === 'insert-start' })) throw new StageError('edit', 'editor not editable');
      inputProgress = m.edit.inputSequence ? { editId: m.edit.id, chunks: [], acceptedPrefix: '' } : undefined;
      if (m.edit.fieldEdits) {
        fieldProgress = { role, fields: [] };
        await typeFieldSequence(m.edit.fieldEdits, role, { progress: fieldProgress,
          snapshot: async () => (await inspectDocument()).content,
          insert: async (field, text) => {
            await assertOnItem();
            if (field === 'body') { if (!await page.evaluate(caretToEdge, { selector: EDITOR, start: false })) throw new StageError('edit', 'body not editable'); }
            else { const control = page.getByRole('textbox', { name: 'Subtitle', exact: true }); await control.focus(); await control.evaluate(element => element.setSelectionRange(element.value.length, element.value.length)); }
            await page.keyboard.insertText(text);
          }, now: () => performance.now(), sleep: ms => page.waitForTimeout(ms) });
      } else if (m.edit.undoRedo) {
        historyProgress = { editId: m.edit.id, stages: [] };
        await exerciseUndoRedo(m.edit, { progress: historyProgress,
          insert: async text => { await assertOnItem(); await page.keyboard.insertText(text); },
          undo: async () => { await assertOnItem(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); },
          redo: async () => { await assertOnItem(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y'); },
          snapshot: async () => { await assertOnItem(); return bodyText(); }, now: () => performance.now(), sleep: ms => page.waitForTimeout(ms) });
      } else if (m.edit.inputSequence) {
        await typeInputSequence(m.edit, { insert: async text => { await assertOnItem(); await page.keyboard.insertText(text); },
          visible: async text => { await assertOnItem(); return (await bodyText()).split(text).length === 2; },
          now: () => performance.now(), sleep: ms => page.waitForTimeout(ms), progress: inputProgress, onProgress: progress => { if (m.edit.reportTraffic === true) out({type:"traffic-progress",round:m.round,progress}); } });
      } else {
        await page.keyboard.insertText(m.edit.text);
        const after = await bodyText();
        if (after.split(m.edit.text).length < 2) throw new StageError('edit', 'inserted text not visible in editor');
      }
      out({ type: 'applied', round: m.round, editId: m.edit.id, ...(fieldProgress ? { fieldProgress, fieldEditIds: m.edit.fieldEdits.map(edit => edit.id) } : {}), ...(historyProgress ? { historyProgress } : {}), ...(inputProgress ? { inputProgress } : {}) });
      inputProgress = undefined; historyProgress = undefined; fieldProgress = undefined;
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
      let leafMoveProof,leafMovePending=false,leafMoveReviewVisible=false;
      if(m.leafMove){
        const request=leafRequest(m.leafMove);if(!config.leafMove||canonicalJSON(config.leafMove)!==canonicalJSON(request.scenario))throw new StageError('leaf-move','Scenario differs from actor configuration');const base=`${ORIGIN}/api/vault/${encodeURIComponent(config.workspaceId)}/items`;
        const response=await context.request.get(base+'?leafMove='+request.operationId,{headers:{'Cache-Control':'no-cache'},timeout:10000});
        if(!response.ok())throw new StageError('leaf-move','Authenticated manifest unavailable');
        const pack=await context.request.get(base+'/'+encodeURIComponent(config.itemId),{headers:{'Cache-Control':'no-cache'},timeout:10000});
        if(!pack.ok()||Number(pack.headers()['content-length']??0)>64*1024*1024)throw new StageError('leaf-move','Authenticated pack unavailable');
        const observed=observeManifestLeaf(config,request,await response.json(),await pack.body());leafMoveProof=observed.proof;leafMovePending=observed.pending;
        if(decodeURIComponent(pack.headers()['x-texttext-path']??'')!==leafMoveProof.relativePath||pack.headers().etag!==`"${leafMoveProof.archiveSha256}"`)throw new StageError('leaf-move','Pack path/revision changed during manifest read');
        await assertOnItem();if(leafMoveProof.documentSha256!==sha256(canonicalJSON(await inspectDocument())))leafMovePending=true;
        leafMoveReviewVisible=await page.evaluate(()=>!!document.querySelector('dialog[open]'));
      }
      let folderCaseProof,folderCasePending=false,folderCaseReviewVisible=false;
      if(m.folderCase){
        const request=folderRequest(m.folderCase);
        const response=await context.request.get(`${ORIGIN}/api/vault/${config.workspaceId}/items?folderCase=${request.operationId}`,{headers:{'Cache-Control':'no-cache'},timeout:10000});
        if(!response.ok())throw new StageError('folder-case','Authenticated folder manifest unavailable');
        const observed=observeManifestFolder(config,request,await response.json());folderCaseProof=observed.proof;folderCasePending=observed.pending;
        await assertOnItem();folderCaseReviewVisible=await page.evaluate(()=>!!document.querySelector('dialog[open]'));
      }
      out({ type: 'state' , round: m.round, text, ...(folderCaseProof?{folderCaseProof,folderCasePending,folderCaseReviewVisible}:{}), ...(leafMoveProof?{leafMoveProof,leafMovePending,leafMoveReviewVisible}:{}), editIds: markerEditIds(text), ...(m.documentSnapshot ? { documentSnapshot: await inspectDocument() } : {}), editor: { sessionId, reloads }, settled: isSettled(samples, m.expectedEditIds), samples: samples.length });
    },
    async shutdown() {
      if (retainedFailure) return;
      stopping = true;
      await context?.close().catch(() => {});
      process.exit(0);
    },
  };

  let queue = Promise.resolve();
  const handle = (line) => {
    if (retainedFailure) return;
    if (line.length > MAX_LINE) return fail(0, 'input', 'request line too long');
    let m;
    try { m = JSON.parse(line); } catch { return fail(0, 'input', 'request is not JSON'); }
    if (!m || typeof m.type !== 'string' || !(m.type in handlers)) return fail(0, 'input', 'unknown request type');
    const round = m.type === 'hello' || m.type === 'shutdown' ? 0 : m.round;
    if (!validateRound(round)) return fail(0, 'input', 'round invalid');
    if (m.type !== 'hello' && m.type !== 'shutdown' && !started) return fail(round, m.type, 'hello required first');
    queue = queue.then(() => handlers[m.type](m)).catch((error) => {
      if (error.retention) {
        retainedFailure = error.retention;
        // This human-invoked failed actor remains available for recovery. The
        // owner closing its browser is the only automatic end condition.
        retainGuardedBrowser(context);
      }
      fail(round, error.stage ?? m.type, error);
    });
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
