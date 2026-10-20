// Owned Chromium + production VaultApp/provider. Controlled page restart, not an OS crash/native acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { chromium, type Page } from "playwright";
import { createRequire } from "node:module";
const Y = createRequire(import.meta.url)("yjs") as typeof import("yjs");
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentText } from "@/lib/collab/document";
import { seedVaultCollaboration, applyVaultCollaboration, type VaultCollaborationState } from "@/sync/engine/collaboration";
import { openPack } from "../pack";

const certifiedStartup = process.argv.slice(2).join(" ") === "--certified-startup";
if (process.argv.length !== 2 && !certifiedStartup) throw Error("This fixture accepts only --certified-startup; no live configuration.");
const itemId = "native-handoff-restart-owned", notePath = "Notes/Untitled.textpack", root = "/test/NativeHandoffRestart";
const config = { namespace: "https://texttext.test/", workspaceId: "11111111-1111-4111-8111-111111111111", itemId,
  localFiles: true, accountId: "fixture-account", localHandoff: { version: 1, profileVersion: 4 } };
const initial = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); initial.content.title = "Untitled"; initial.content.body = "Hello";
const pack = (markdown: string, documentJSON: string) => {
  const bytes = buildTextpack("Untitled", { markdown, document: JSON.parse(documentJSON) });
  return { bytes, file: openPack(bytes, notePath, createHash("sha256").update(bytes).digest("hex")).file };
};
let current = pack(`---\ntextTextId: ${JSON.stringify(itemId)}\ntitle: "Untitled"\n---\n\nHello`, JSON.stringify(initial));
let exists = false, ready = false, opens = 0, pushes = 0, localWrites = 0, creates = 0;
let nativeJournal: string | null = null, nativeProjectedHash: string | null = null;
let restarted = false, startupRefusals = 0;
let state: VaultCollaborationState | null = null, remoteBytes = current.bytes;
let releaseOpen!: () => void;
const openGate = new Promise<void>(resolve => { releaseOpen = resolve; });
const checkpoints: { generation: number; seq: number; pending: boolean; hash: string }[] = [];
const operations: { id: string; updates: string[] }[] = [], errors: string[] = [], fixtureErrors: string[] = [];
const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 160; i++) { if (predicate()) return; await wait(50); }
  throw Error("Timed out: " + label);
};
const dir = await mkdtemp(path.join(tmpdir(), "texttext-native-handoff-restart-")), output = path.join(dir, "ui");
await buildLocalVault({ output });
const browser = await chromium.launch({ headless: true });
async function bind(page: Page) {
  page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
  await page.exposeBinding("nativeVaultRequest", async ({ page }, request: { id: string; method: string; params: Record<string, unknown> }) => {
    let result: unknown = null, error: { code: string; message: string } | null = null;
    const p = request.params;
    try {
      switch (request.method) {
        case "list": result = { root, folders: ["Notes"], items: exists ? [{ path: notePath }] : [] }; break;
        case "connection": result = { connected: true, available: true, workspaceId: config.workspaceId, webURL: "https://texttext.test/vault/workspace" }; break;
        case "folderViews": result = { files: [] }; break;
        case "accountRead": result = { accountId: config.accountId, email: "fixture@example.invalid" }; break;
        case "workspaceAccess": result = { fullAccess: true, isOwner: true, canEditContent: true, canComment: true, canManageShares: true, grants: [] }; break;
        case "preview": result = current.file; break;
        case "importPack": case "create": assert.equal(++creates, 1); exists = true; result = current.file; break;
        case "read": result = current.file; break;
        case "write": assert.equal(p.hash, current.file.hash); localWrites++; current = pack(String(p.markdown), String(p.documentJSON)); result = current.file; break;
        case "collaborationConfig": result = ready ? config : null; break;
        case "collaborationOpen": {
          assert.equal(p.hash, current.file.hash); assert.equal(p.localHandoffVersion, 1); opens++;
          if (certifiedStartup && restarted && startupRefusals++ < 4) { error = { code: "handoff_not_open", message: "Controlled unpublished startup open" }; break; }
          state ??= seedVaultCollaboration(current.bytes, itemId, 1); remoteBytes = opens === 1 ? current.bytes : remoteBytes;
          if (opens === 1) await openGate;
          result = { sessionToken: "owned-session-" + opens, path: notePath, hash: current.file.hash,
            acknowledgedRevision: nativeJournal ? JSON.parse(nativeJournal).revision : state.revision,
            projectedHash: nativeProjectedHash, journal: nativeJournal, retiredReason: null, localHandoff: config.localHandoff };
          break;
        }
        case "collaborationRead": assert.ok(state); result = p.waitMs && p.seq === state.seq
          ? { ...state, unchanged: true, canEditContent: true, canComment: true }
          : { ...state, relativePath: notePath, canEditContent: true, canComment: true }; break;
        case "collaborationCheckpoint": {
          assert.equal(p.hash, current.file.hash, "Native checkpoint CAS");
          const journal = JSON.parse(String(p.journal));
          if (nativeJournal) assert.ok(journal.journalGeneration >= JSON.parse(nativeJournal).journalGeneration);
          current = pack(String(p.markdown), String(p.documentJSON));
          nativeJournal = String(p.journal); nativeProjectedHash = current.file.hash;
          checkpoints.push({ generation: journal.journalGeneration, seq: journal.seq, pending: Boolean(p.pending), hash: current.file.hash });
          result = { path: notePath, hash: current.file.hash }; break;
        }
        case "collaborationPush": {
          assert.ok(state); operations.push({ id: String(p.operationId), updates: [...p.updates as string[]] });
          const next = applyVaultCollaboration(state, remoteBytes, p.updates as string[]);
          state = next.state; remoteBytes = next.bytes; pushes++; result = { status: "written", revision: state.revision }; break;
        }
        case "presenceJoin": result = { epoch: 1, presence: [], session: { clientId: "p-11111111-1111-4111-8111-111111111111", sessionCredential: "v1:test", expiresAt: Date.now() + 60_000 } }; break;
        case "presenceRead": case "presenceUpdate": result = { epoch: 1, presence: [] }; break;
        case "presenceLeave": case "collaborationClose": case "collaborationCancel": result = {}; break;
        case "publicationRead": result = { canPublish: true, revision: current.file.hash, publicURL: null }; break;
        default: throw Error("Unexpected fixture method " + request.method);
      }
    } catch (reason) { fixtureErrors.push(String(reason)); error = { code: "fixture_failure", message: String(reason) }; }
    if (!page.isClosed()) await page.evaluate(detail => window.dispatchEvent(new CustomEvent("texttext:vault-reply", { detail })), { id: request.id, result, error });
  });
  await page.addInitScript({ content: "window.webkit={messageHandlers:{localVault:{postMessage(request){void window.nativeVaultRequest(request);}}}};" });
}
try {
  const firstContext = await browser.newContext(), page = await firstContext.newPage(); await bind(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.removeItem;
    (window as any).handoffRemovalFaults = 0;
    Storage.prototype.removeItem = function(key) {
      const raw = this.getItem(key);
      if (key.startsWith("texttext:vault-item-draft:") && raw && JSON.parse(raw).version === 2) {
        (window as any).handoffRemovalFaults++; throw Error("Owned fixture blocks acknowledged draft removal");
      }
      return original.call(this, key);
    };
  });
  await page.goto(pathToFileURL(path.join(output, "index.html")).href);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Document body", exact: true }); await body.waitFor();
  assert.equal(await body.innerText(), "Hello");
  ready = true;
  await page.evaluate(workspaceId => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", { detail: { connected: true, available: true, workspaceId } })), config.workspaceId);
  await until(() => opens === 1, "native open held");
  await body.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type(" L"); assert.equal(await body.innerText(), "Hello L");
  releaseOpen();
  await page.waitForFunction(() => (window as any).handoffRemovalFaults > 0);
  await until(() => pushes > 0 && nativeJournal !== null && !JSON.parse(nativeJournal).pending.length && !JSON.parse(nativeJournal).batch,
    "actual shared push and clean native checkpoint");
  const closeWhileRetained = await page.evaluate(() => (window as any).texttextFlushForNativeClose());
  assert.equal(closeWhileRetained.ok, false, "Retained transfer draft must fence native close");
  const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)!])));
  const draftKey = Object.keys(storage).find(key => key.startsWith("texttext:vault-item-draft:") && JSON.parse(storage[key]).version === 2)!;
  assert.ok(draftKey); const draft = JSON.parse(storage[draftKey]); assert.ok(draft.handoff.intents.length > 0);
  for (const intent of draft.handoff.intents) {
    assert.equal(intent.updateSha256, createHash("sha256").update(Buffer.from(intent.update, "base64")).digest("hex"));
  }
  assert.ok(draft.handoff.legacyDraftSha256 === null || /^[a-f0-9]{64}$/.test(draft.handoff.legacyDraftSha256));
  const intentHashes = draft.handoff.intents.map((intent: { update: string }) => createHash("sha256").update(intent.update).digest("hex"));
  const retainedNative = nativeJournal, operationsBefore = operations.length, writesBefore = localWrites;
  await page.close(); await firstContext.close();
  assert.ok(state);
  const peer = new Y.Doc(); Y.applyUpdate(peer, Buffer.from(state.update, "base64")); const vector = Y.encodeStateVector(peer);
  documentText(peer, "body").insert(documentText(peer, "body").length, " R");
  const peerUpdate = Buffer.from(Y.encodeStateAsUpdate(peer, vector)).toString("base64"); peer.destroy();
  const next = applyVaultCollaboration(state, remoteBytes, [peerUpdate]); state = next.state; remoteBytes = next.bytes;
  restarted = true;
  const restartContext = await browser.newContext(), reopened = await restartContext.newPage(); await bind(reopened);
  // This case exercises an explicit native startup open, not last-location restoration.
  // Keep every retained draft/journal byte; avoid racing a second automatic open.
  await reopened.addInitScript(({ values, locationKey }) => {
    for (const [key, value] of Object.entries(values)) if (key !== locationKey) localStorage.setItem(key, value);
  }, { values: storage, locationKey: `texttext:vault-location:${root}` });
  await reopened.goto(pathToFileURL(path.join(output, "index.html")).href);
  await reopened.waitForFunction(() => typeof (window as any).texttextOpenFile === "function");
  assert.equal(await reopened.evaluate(path => (window as any).texttextOpenFile(path), notePath), "opened");
  if (certifiedStartup) {
    await reopened.getByRole("button", { name: "Retry connecting", exact: true }).waitFor();
    assert.equal(opens, 5); assert.equal(operations.length, operationsBefore); assert.equal(localWrites, writesBefore);
    assert.equal(await reopened.evaluate(key => localStorage.getItem(key), draftKey), storage[draftKey], "Failed startup must preserve the exact recorded Yjs bytes");
    assert.equal((await reopened.evaluate(() => (window as any).texttextFlushForNativeClose())).ok, false);
    await reopened.getByRole("button", { name: "Retry connecting", exact: true }).click();
  }
  const reopenedBody = reopened.getByRole("textbox", { name: "Document body", exact: true });
  await until(() => nativeJournal !== null && JSON.parse(current.file.documentJSON!).content.body === "Hello L R", "peer append reconciled on restart");
  if (!await reopenedBody.isVisible()) await reopened.getByRole("button", { name: "Edit card", exact: true }).click();
  await reopenedBody.waitFor(); assert.equal(await reopenedBody.innerText(), "Hello L R");
  await reopened.waitForFunction(key => localStorage.getItem(key) === null, draftKey);
  assert.equal(opens, certifiedStartup ? 6 : 2); assert.equal(operations.length, operationsBefore, "Exact replay must not mint a new push operation");
  assert.equal(localWrites, writesBefore, "Restart must not use a direct file writer"); assert.equal(state.epoch, 1);
  assert.deepEqual(errors, []); assert.deepEqual(fixtureErrors, []);
  await writeFile(path.join(dir, "observation.json"), JSON.stringify({ scope: "owned Chromium production VaultApp/provider; controlled page restart, native bridge fixture, not installed-native/OS-crash acceptance",
    itemId, notePath, certifiedStartup, closeWhileRetained, epoch: state.epoch, opens, localWrites, operationsBefore, operationsAfter: operations.length, intentHashes, updateSha256: draft.handoff.intents.map((intent: { updateSha256: string }) => intent.updateSha256), legacyDraftSha256: draft.handoff.legacyDraftSha256,
    retainedNativeGeneration: JSON.parse(retainedNative!).journalGeneration, finalNativeGeneration: JSON.parse(nativeJournal!).journalGeneration,
    finalBody: JSON.parse(current.file.documentJSON!).content.body, checkpoints, errors, fixtureErrors }, null, 2), { flag: "wx" });
  console.log("PASS acknowledged exact handoff survives controlled restart + peer append without duplicate text/new operation. Evidence: " + dir);
  await restartContext.close();
} finally { releaseOpen(); await browser.close(); }
