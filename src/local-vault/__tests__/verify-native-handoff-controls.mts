// Owned Chromium + production VaultApp/controller nontext guards; not installed native acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { chromium, type Page } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { seedVaultCollaboration, applyVaultCollaboration, type VaultCollaborationState } from "@/sync/engine/collaboration";
import { openPack } from "../pack";

const flag = process.argv.slice(2).join(" ");
const captureScenario = flag === "--capture", readerScenario = flag === "--reader", drainScenario = flag === "--drain";
const accountScenario = flag === "--retry-account-change", unverifiedScenario = flag === "--unverified-open";
const retryScenario = flag === "--certified-retry" || accountScenario, onceScenario = flag === "--certified-once", unknownScenario = flag === "--unknown-open";
const recoveryScenario = retryScenario || onceScenario || unknownScenario || unverifiedScenario;
if (process.argv.length !== 2 && !["--capture", "--reader", "--drain", "--certified-retry", "--certified-once", "--unknown-open", "--retry-account-change", "--unverified-open"].includes(flag)) throw Error("Only one owned controls scenario is accepted; no live configuration.");
const itemId = "native-handoff-controls-owned", notePath = "Notes/Untitled.textpack", root = "/test/NativeHandoffControls";
const config = { namespace: "https://texttext.test/", workspaceId: "11111111-1111-4111-8111-111111111111", itemId,
  localFiles: true, accountId: "fixture-account", localHandoff: { version: 1, profileVersion: 4 } };
const initial = emptyDocumentSnapshot({ id: readerScenario ? "texttext.article" : "texttext.note", version: 1 }); initial.content.title = "Untitled"; initial.content.body = captureScenario ? "https://owned.example.invalid/article" : "Hello";
if (captureScenario) initial.content.fields = { sourceUrl: "https://owned.example.invalid/article", captureStatus: "pending" };
const pack = (markdown: string, documentJSON: string) => {
  const bytes = buildTextpack("Untitled", { markdown, document: JSON.parse(documentJSON) });
  return { bytes, file: openPack(bytes, notePath, createHash("sha256").update(bytes).digest("hex")).file };
};
let current = pack(`---\ntextTextId: ${JSON.stringify(itemId)}\ntitle: "Untitled"\n---\n\n${initial.content.body}`, JSON.stringify(initial));
let exists = false, ready = false, opens = 0, pushes = 0, localWrites = 0, creates = 0;
let nativeJournal: string | null = null, nativeProjectedHash: string | null = null;
let publishedOpens = 0, nativeCloses = 0;
let changedAccount = false;
let state: VaultCollaborationState | null = null, remoteBytes = current.bytes;
let releaseOpen!: () => void;
const openGate = new Promise<void>(resolve => { releaseOpen = resolve; });
let captureRequests = 0, releaseCapture!: () => void;
const captureGate = new Promise<void>(resolve => { releaseCapture = resolve; });
let addedAssetRequests = 0, heldWrites = 0;
let releaseWrite!: () => void; const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
const checkpoints: { generation: number; seq: number; pending: boolean; hash: string }[] = [];
const operations: { id: string; updates: string[] }[] = [], errors: string[] = [], fixtureErrors: string[] = [];
const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 160; i++) { if (predicate()) return; await wait(50); }
  throw Error("Timed out: " + label);
};
const dir = await mkdtemp(path.join(tmpdir(), "texttext-native-handoff-controls-")), output = path.join(dir, "ui");
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
        case "extractArticle": captureRequests++; await captureGate; result = { sourceURL: p.sourceURL, markdown: "# Captured source\n\nOwned article content", capturedAt: "2026-10-18T12:00:00Z" }; break;
        case "write": if (p.addedAssets) addedAssetRequests++; assert.equal(p.hash, current.file.hash); localWrites++; if (drainScenario && heldWrites++ === 0) await writeGate; current = pack(String(p.markdown), String(p.documentJSON)); result = current.file; break;
        case "collaborationConfig": result = ready ? { ...config, ...(changedAccount ? { accountId: "different-account" } : {}) } : null; break;
        case "collaborationOpen": {
          assert.equal(p.hash, current.file.hash); assert.equal(p.localHandoffVersion, 1); opens++;
          if (unknownScenario || onceScenario && opens === 1 || retryScenario && opens <= 4) {
            error = { code: unknownScenario ? "503" : "handoff_not_open", message: "Controlled native open rejection" }; break;
          }
          state ??= seedVaultCollaboration(current.bytes, itemId, 1); remoteBytes = publishedOpens++ === 0 ? current.bytes : remoteBytes;
          if (publishedOpens === 1) await openGate;
          result = { sessionToken: "owned-session-" + opens, path: notePath, hash: current.file.hash,
            acknowledgedRevision: nativeJournal ? JSON.parse(nativeJournal).revision : state.revision,
            projectedHash: nativeProjectedHash, journal: nativeJournal, retiredReason: null, localHandoff: unverifiedScenario ? undefined : config.localHandoff };
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
        case "collaborationClose": nativeCloses++; result = {}; break;
        case "presenceLeave": case "collaborationCancel": result = {}; break;
        case "publicationRead": result = { canPublish: true, revision: current.file.hash, publicURL: null }; break;
        default: throw Error("Unexpected fixture method " + request.method);
      }
    } catch (reason) { fixtureErrors.push(String(reason)); error = { code: "fixture_failure", message: String(reason) }; }
    if (!page.isClosed()) await page.evaluate(detail => window.dispatchEvent(new CustomEvent("texttext:vault-reply", { detail })), { id: request.id, result, error });
  });
  await page.addInitScript({ content: "window.webkit={messageHandlers:{localVault:{postMessage(request){void window.nativeVaultRequest(request);}}}};" });
}
try {
  const page = await browser.newPage(); await bind(page);
  await page.goto(pathToFileURL(path.join(output, "index.html")).href);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  if (captureScenario) await page.getByRole("button", { name: "Edit", exact: true }).click();
  await title.waitFor();
  if (captureScenario) await until(() => captureRequests === 1, "actual article capture started before pause");
  await title.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("Owned controls title");
  await body.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type(" accepted before open");
  if (drainScenario) await until(() => heldWrites === 1, "actual first file write issued and held");
  else if (!captureScenario) await until(() => JSON.parse(current.file.documentJSON!).content.title === "Owned controls title", "accepted local content saved");
  if (readerScenario) {
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Edit story", exact: true }).waitFor();
  }
  ready = true;
  await page.evaluate(workspaceId => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", { detail: { connected: true, available: true, workspaceId } })), config.workspaceId);
  if (recoveryScenario) {
    const original = await title.elementHandle(), writesBefore = localWrites;
    if (unverifiedScenario) releaseOpen();
    await until(() => opens >= 1, "first controlled native open");
    if (retryScenario) await page.getByRole("button", { name: "Retry connecting", exact: true }).waitFor();
    if (unknownScenario) await page.getByRole("status").filter({ hasText: "Controlled native open rejection" }).waitFor();
    if (unverifiedScenario) await page.getByRole("status").filter({ hasText: "could not verify its recovery format" }).waitFor();
    if (onceScenario) await until(() => publishedOpens === 1, "certified automatic retry reaches held actual open");
    await title.click(); await page.keyboard.press("End"); await page.keyboard.type(" retry text");
    await body.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End"); await page.keyboard.type(" retained input");
    const finalTitle = await title.inputValue(), finalBody = await body.innerText();
    assert.equal((await page.evaluate(async () => (window as any).texttextFlushForNativeClose())).ok, false);
    assert.equal(localWrites, writesBefore); assert.equal(nativeCloses, 0);
    if (unknownScenario || unverifiedScenario || accountScenario) {
      if (accountScenario) {
        changedAccount = true;
        await page.getByRole("button", { name: "Retry connecting", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "Return to the original account and workspace" }).waitFor();
      }
      await wait(500); assert.equal(opens, accountScenario ? 4 : 1); assert.equal(publishedOpens, unverifiedScenario ? 1 : 0);
      assert.equal(await page.getByRole("button", { name: "Retry connecting", exact: true }).count(), accountScenario ? 1 : 0);
      const retained = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("texttext:vault-item-draft:"))?.[1]);
      assert.equal(JSON.parse(retained!).document.content.title, finalTitle); assert.equal(JSON.parse(retained!).document.content.body, finalBody);
    }
    if (!unknownScenario && !unverifiedScenario) {
      if (accountScenario) changedAccount = false;
      if (retryScenario) { assert.equal(opens, 4); assert.equal(publishedOpens, 0); }
      releaseOpen();
      if (retryScenario) await page.getByRole("button", { name: "Retry connecting", exact: true }).click();
      await until(() => pushes > 0 && JSON.parse(current.file.documentJSON!).content.title === finalTitle && JSON.parse(current.file.documentJSON!).content.body === finalBody, "retry preserves accepted text exactly");
      await page.waitForFunction(async () => (await (window as any).texttextFlushForNativeClose()).ok === true);
      assert.equal(opens, retryScenario ? 5 : 2); assert.equal(publishedOpens, 1); assert.equal(nativeCloses, 0);
      assert.equal(await title.evaluate((node, prior) => node === prior, original), true, "Retry must preserve the actual mounted Title");
      assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("texttext:vault-item-draft:") && !key.includes(":before-handoff-v2:"))), false);
    }
    assert.equal(creates, 1); assert.equal(localWrites, writesBefore); assert.deepEqual(errors, []); assert.deepEqual(fixtureErrors, []);
    await writeFile(path.join(dir, "observation.json"), JSON.stringify({ flag, opens, publishedOpens, nativeCloses, finalTitle, finalBody, creates, localWrites, writesBefore, errors, fixtureErrors }, null, 2), { flag: "wx" });
    console.log("PASS certified-only handoff retry/unknown retention. Evidence: " + dir);
  } else {
  if (readerScenario) {
    await wait(250); assert.equal(opens, 0, "A reader without an editor surface must not acquire a native lease");
    await page.getByRole("button", { name: "Edit story", exact: true }).click();
    // No second external sync event: actual editor surface registration triggers readiness.
  }
  if (drainScenario) {
    await wait(200); assert.equal(opens, 0, "Native open must await the actual issued file-write reply");
    await body.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
    await page.keyboard.type(" newer while write held");
    await wait(400); assert.equal(localWrites, 1, "The paused writer cannot issue a second autosave");
    releaseWrite();
  }
  if (captureScenario) {
    await wait(250); assert.equal(opens, 0, "Native lease waits for the whole pending capture");
    await body.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
    await page.keyboard.type(" typed while capture held");
    releaseCapture();
  }
  await until(() => opens === 1, "native open held");
  const writesAtPause = localWrites, assetsAtPause = addedAssetRequests, createsAtPause = creates;
  const acceptedBody = await body.innerText();
  if (!captureScenario && !readerScenario && !drainScenario) {
    await body.click();
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), c => c.charCodeAt(0))], "Owned.png", { type: "image/png" }));
      document.querySelector('[aria-label="Document body"]')!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await wait(200);
    await writeFile(path.join(dir, "paste-observation.json"), JSON.stringify({
      observed: await page.evaluate(() => ({ statuses: [...document.querySelectorAll('[role="status"]')].map(node => node.textContent), body: document.querySelector('[aria-label="Document body"]')?.outerHTML, active: document.activeElement?.getAttribute("aria-label") })),
      localWrites, addedAssetRequests, creates, errors, fixtureErrors
    }, null, 2), { flag: "wx" });
    await page.getByRole("status").filter({ hasText: "Finish connecting this note before pasting an image. Your clipboard is unchanged." }).waitFor();
    assert.equal(await body.innerText(), acceptedBody, "Refused image paste must not alter accepted text");
    await page.locator(".tt-editor-more").getByLabel("More actions", { exact: true }).click();
    await page.getByRole("button", { name: "Save as look", exact: true }).click();
    await page.getByRole("textbox", { name: "Name this look", exact: true }).fill("Owned paused look");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await wait(200);
    await writeFile(path.join(dir, "look-observation.json"), JSON.stringify({
      statuses: await page.getByRole("status").allTextContents(), localWrites, addedAssetRequests, creates, errors, fixtureErrors
    }, null, 2), { flag: "wx" });
    await page.getByRole("status").filter({ hasText: "Finish connecting this item before keeping its look." }).waitFor();
    assert.equal(localWrites, writesAtPause); assert.equal(addedAssetRequests, assetsAtPause); assert.equal(creates, createsAtPause);
  }
  await title.click(); await page.keyboard.press("End"); await page.keyboard.type(" n");
  const finalTitle = await title.inputValue();
  await body.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type(" n"); const finalBody = await body.innerText();
  assert.equal(localWrites, writesAtPause, "Paused direct file writer remains stopped while text stays editable");
  releaseOpen();
  await until(() => pushes > 0 && JSON.parse(current.file.documentJSON!).content.title === finalTitle && JSON.parse(current.file.documentJSON!).content.body === finalBody, "accepted controls text durably transferred");
  const saved = JSON.parse(current.file.documentJSON!);
  assert.deepEqual(saved.presentation.template, initial.presentation.template, "Handoff preserves the actual template identity");
  await writeFile(path.join(dir, "preassert-observation.json"), JSON.stringify({ captureScenario, readerScenario, drainScenario, heldWrites, captureRequests,
    opens, creates, localWrites, writesAtPause, addedAssetRequests, pushes, acceptedBody, saved, errors, fixtureErrors }, null, 2), { flag: "wx" });
  if (captureScenario) {
    assert.equal(captureRequests, 1); assert.equal(saved.content.fields.capturedSourceBody, "# Captured source\n\nOwned article content");
    assert.ok(saved.content.body.includes("typed while capture held"));
  }
  assert.equal(addedAssetRequests, assetsAtPause); assert.equal(creates, 1);
  assert.deepEqual(errors, []); assert.deepEqual(fixtureErrors, []);
  await writeFile(path.join(dir, "observation.json"), JSON.stringify({ scope: "owned Chromium production VaultApp/controller, synthetic ClipboardEvent only for paste; no installed-native/liveaccount claim",
    captureScenario, readerScenario, drainScenario, heldWrites, captureRequests, opens, creates, localWrites, writesAtPause, addedAssetRequests, pushes, acceptedBody, saved, errors, fixtureErrors }, null, 2), { flag: "wx" });
  console.log("PASS held-native-open controls preserve text and reject nontext writes. Evidence: " + dir);
  }
} finally { releaseOpen(); releaseCapture(); releaseWrite(); await browser.close(); }
