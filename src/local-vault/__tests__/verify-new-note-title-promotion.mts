// Isolated production-VaultApp title focus across local-to-shared promotion.
// No account, real filesystem writer, native AX or accepted-input-loss claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import type { VaultCollaborationState } from "@/sync/engine/collaboration";
import { openPack } from "../pack";
const { applyVaultCollaboration, seedVaultCollaboration } = createRequire(import.meta.url)("../../sync/engine/collaboration") as typeof import("@/sync/engine/collaboration");
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !["--backward-selection", "--focus-elsewhere"].includes(flag)) || flags.size > 1) throw new Error("Choose one isolated title-promotion scenario; no live configuration is accepted.");
const backwardSelection = flags.has("--backward-selection"), focusElsewhere = flags.has("--focus-elsewhere");
const itemId = "new-note-title-promotion-test", notePath = "Notes/Untitled.textpack", root = "/test/TitlePromotion";
const config = { namespace: "https://texttext.test/", workspaceId: "11111111-1111-4111-8111-111111111111", itemId, localFiles: true };
const initial = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); initial.content.title = "Untitled";
const pack = (text: string, json: string) => { const bytes = buildTextpack("Untitled", { markdown: text, document: JSON.parse(json) }); return { bytes, file: openPack(bytes, notePath, createHash("sha256").update(bytes).digest("hex")).file }; };
let current = pack(`---\ntextTextId: ${JSON.stringify(itemId)}\ntitle: "Untitled"\n---\n\n`, JSON.stringify(initial));
let exists = false, syncedHash: string | null = null, remoteState: VaultCollaborationState | null = null;
let remoteBytes = current.bytes, localWrites = 0, sharedOpens = 0, sharedPushes = 0, publicationReads = 0, checkpointConflicts = 0;
let releaseSharedOpen = () => {}; const sharedOpenPermit = new Promise<void>(resolve => { releaseSharedOpen = resolve; });
const until = async (predicate: () => boolean, label: string) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await wait(50); } throw new Error("Timed out: " + label); };
const dir = await mkdtemp(path.join(tmpdir(), "texttext-title-promotion-")), output = path.join(dir, "ui");
await buildLocalVault({ output });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(7000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.exposeBinding("nativeVaultRequest", async ({ page }, request: { id: string; method: string; params: Record<string, unknown> }) => {
    let result: unknown = null, error: { code: string; message: string } | null = null;
    try {
      switch (request.method) {
        case "list": result = { root, folders: ["Notes"], items: exists ? [{ path: notePath }] : [] }; break;
        case "connection": result = { connected: true, available: true, workspaceId: config.workspaceId, webURL: "https://texttext.test/vault/workspace" }; break;
        case "folderViews": result = { files: [] }; break;
        case "create": exists = true; result = current.file; break;
        case "read": result = current.file; break;
        case "write": {
          assert.equal(request.params.hash, current.file.hash);
          current = pack(String(request.params.markdown), String(request.params.documentJSON));
          localWrites++;
          result = current.file;
          break;
        }
        case "collaborationConfig": result = syncedHash === current.file.hash ? config : null; break;
        case "collaborationOpen":
          assert.equal(request.params.hash, current.file.hash, "Shared editing must open the latest saved local file.");
          sharedOpens++;
          remoteState ??= seedVaultCollaboration(current.bytes, itemId, 1);
          remoteBytes = current.bytes;
          await sharedOpenPermit;
          result = { sessionToken: "session", path: notePath, hash: current.file.hash,
            acknowledgedRevision: current.file.hash, journal: null, retiredReason: null };
          break;
        case "collaborationRead": {
          const state = remoteState ?? seedVaultCollaboration(current.bytes, itemId, 1);
          result = request.params.waitMs && request.params.seq === state.seq
            ? { ...state, unchanged: true, canEditContent: true, canComment: true }
            : { ...state, relativePath: notePath, canEditContent: true, canComment: true };
          break;
        }
        case "collaborationCheckpoint":
          if (request.params.hash !== current.file.hash) {
            checkpointConflicts++;
            error = { code: "local_changed", message: "The local file changed during sync." };
          } else {
            current = pack(String(request.params.markdown), String(request.params.documentJSON));
            result = { path: notePath, hash: current.file.hash };
          }
          break;
        case "collaborationPush": {
          assert.ok(remoteState);
          const next = applyVaultCollaboration(remoteState, remoteBytes, request.params.updates as string[]);
          remoteState = next.state; remoteBytes = next.bytes; sharedPushes++;
          result = { status: "written", revision: next.state.revision };
          break;
        }
        case "presenceJoin": result = { epoch: 1, presence: [], session: { clientId: "p-11111111-1111-4111-8111-111111111111",
          sessionCredential: "v1:test", expiresAt: Date.now() + 60_000 } }; break;
        case "presenceRead": case "presenceUpdate": result = { epoch: 1, presence: [] }; break;
        case "presenceLeave": case "collaborationClose": case "collaborationCancel": result = {}; break;
        case "publicationRead": publicationReads++; result = { canPublish: syncedHash === current.file.hash, revision: current.file.hash, publicURL: null }; break;
        default: throw new Error(`Unexpected native request ${request.method}.`);
      }
    } catch (reason) { error = { code: "test_failure", message: reason instanceof Error ? reason.message : String(reason) }; }
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent("texttext:vault-reply", { detail })), { id: request.id, result, error });
  });
  await page.addInitScript({ content: "window.webkit = { messageHandlers: { localVault: { postMessage(request) { void window.nativeVaultRequest(request); } } } };" });
  await page.addInitScript(() => { (window as any).titlePromotionInputs = []; document.addEventListener("input", event => { const target = event.target as HTMLElement; (window as any).titlePromotionInputs.push({ field: target.getAttribute("aria-label"), trusted: event.isTrusted }); }, true); });
  await page.goto(pathToFileURL(path.join(output, "index.html")).href);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Title");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  const acceptedTitle = "Title accepted before promotion";
  await page.keyboard.insertText(acceptedTitle);
  assert.equal(await title.inputValue(), acceptedTitle, "The title input must actually accept the text before promotion.");
  await until(() => JSON.parse(current.file.documentJSON!).content.title === acceptedTitle, "accepted title committed locally");
  assert.equal(sharedOpens, 0, "No shared editor is available before sync acknowledgement.");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  if (backwardSelection) for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  const before = await title.evaluate(node => ({ value: node.value, focused: node === document.activeElement, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection }));
  assert.equal(before.focused, true); assert.equal(before.start, acceptedTitle.length - (backwardSelection ? 7 : 3)); assert.equal(before.end, acceptedTitle.length - 3);
  if (backwardSelection) assert.equal(before.direction, "backward");
  const acceptedEvents = await page.evaluate(() => (window as any).titlePromotionInputs.filter((x: any) => x.field === "Title"));
  assert.ok(acceptedEvents.length > 0, "Pre-promotion title acceptance needs real input events, not expected-value injection.");
  syncedHash = current.file.hash;
  await page.evaluate(workspaceId => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", { detail: { connected: true, available: true, workspaceId } })), config.workspaceId);
  await until(() => sharedOpens === 1, "actual shared editor opening");
  // Deliberately issue no input while the local editor is inert or the shared
  // baseline is unavailable. This cannot characterize lost unaccepted keystrokes.
  if (focusElsewhere) {
    await page.evaluate(() => { const input = document.createElement("input"); input.setAttribute("aria-label", "Fixture focus target"); document.body.append(input); });
    await page.getByRole("textbox", { name: "Fixture focus target", exact: true }).click();
  }
  releaseSharedOpen();
  await page.locator('[data-collaboration-state="ready"] textarea[aria-label="Title"]').waitFor();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const promoted = await title.evaluate(node => ({ value: node.value, focused: node === document.activeElement, activeLabel: document.activeElement?.getAttribute("aria-label"), start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection }));
  await page.keyboard.insertText("Z"); // no refocus or stale AX/index target
  await wait(600);
  const after = await title.evaluate(node => ({ value: node.value, focused: node === document.activeElement, activeLabel: document.activeElement?.getAttribute("aria-label"), start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection }));
  const expected = acceptedTitle.slice(0, before.start) + "Z" + acceptedTitle.slice(before.end);
  await writeFile(path.join(dir, "observation.json"), JSON.stringify({ before, promoted, after, acceptedEvents, saved: JSON.parse(current.file.documentJSON!), sharedOpens, sharedPushes, checkpointConflicts, errors, focusElsewhere, backwardSelection, outsideValue: focusElsewhere ? await page.getByRole("textbox", { name: "Fixture focus target", exact: true }).inputValue() : null, scope: "isolated Chromium + production VaultApp/provider; not WK/native AX" }, null, 2), { flag: "wx" });
  assert.equal(promoted.value, acceptedTitle, "Already accepted title content must survive promotion.");
  if (focusElsewhere) {
    assert.equal(promoted.focused, false, "Promotion must not steal focus from another active control.");
    assert.equal(promoted.activeLabel, "Fixture focus target");
    assert.equal(await page.getByRole("textbox", { name: "Fixture focus target", exact: true }).inputValue(), "Z");
    assert.equal(after.value, acceptedTitle);
    assert.deepEqual(errors, []);
    console.log("PASS title promotion preserves another active control. Evidence: " + dir);
  } else {
  assert.equal(promoted.focused, true, "A title-focused editor must retain actual Title focus across promotion.");
  assert.equal(promoted.start, before.start, "Title caret must survive promotion."); assert.equal(promoted.end, before.end); assert.equal(promoted.direction, before.direction);
  assert.equal(after.value, expected, "The next real typed character must remain at the retained title caret.");
  assert.equal(JSON.parse(current.file.documentJSON!).content.title, expected);
  assert.deepEqual(errors, []);
  console.log("PASS title-focused local-to-shared promotion retains accepted title, actual focus/caret and next keyboard character. Evidence: " + dir);
  }
} finally { releaseSharedOpen(); await browser.close(); }
