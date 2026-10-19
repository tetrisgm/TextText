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
const allowedFlags = ["--backward-selection", "--focus-elsewhere", "--typing-during-promotion", "--typing-during-baseline", "--typing-during-checkpoint", "--body", "--ime", "--continuous", "--handoff"];
const typingFlags = [...flags].filter(flag => flag.startsWith("--typing-during-"));
if ([...flags].some(flag => !allowedFlags.includes(flag)) || typingFlags.length > 1 || flags.size > 3 ||
    (flags.size > 1 && !(typingFlags.length === 1 && [...flags].every(flag => flag.startsWith("--typing-during-") || ["--body", "--ime", "--continuous"].includes(flag)) ||
      flags.size === 2 && flags.has("--handoff") && (flags.has("--backward-selection") || flags.has("--focus-elsewhere"))))) throw new Error("Choose one isolated title-promotion scenario; no live configuration is accepted.");
const backwardSelection = flags.has("--backward-selection"), focusElsewhere = flags.has("--focus-elsewhere"), typingDuringPromotion = [...flags].some(flag => flag.startsWith("--typing-during-"));
const nativeHandoff = typingDuringPromotion || flags.has("--handoff"), continuous = flags.has("--continuous");
const ime = flags.has("--ime"), editBody = flags.has("--body"), acceptedBody = "Body accepted before promotion";
const typingBoundary = flags.has("--typing-during-baseline") ? "baseline" : flags.has("--typing-during-checkpoint") ? "checkpoint" : "open";
const itemId = "new-note-title-promotion-test", notePath = "Notes/Untitled.textpack", root = "/test/TitlePromotion";
const config = { namespace: "https://texttext.test/", workspaceId: "11111111-1111-4111-8111-111111111111", itemId, localFiles: true, accountId: "fixture-account", ...(nativeHandoff ? { localHandoff: { version: 1, profileVersion: 4 } } : {}) };
const initial = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); initial.content.title = "Untitled";
const pack = (text: string, json: string) => { const bytes = buildTextpack("Untitled", { markdown: text, document: JSON.parse(json) }); return { bytes, file: openPack(bytes, notePath, createHash("sha256").update(bytes).digest("hex")).file }; };
let current = pack(`---\ntextTextId: ${JSON.stringify(itemId)}\ntitle: "Untitled"\n---\n\n`, JSON.stringify(initial));
let createRequests = 0;
let exists = false, syncedHash: string | null = null, remoteState: VaultCollaborationState | null = null;
let remoteBytes = current.bytes, localWrites = 0, sharedOpens = 0, sharedPushes = 0, publicationReads = 0, checkpointConflicts = 0, nativeCheckpoints = 0;
let holdPromotionRead = false, heldPromotionReads = 0, heldBaselines = 0, heldCheckpoints = 0;
let releaseBoundary = () => {}; const boundaryPermit = new Promise<void>(resolve => { releaseBoundary = resolve; });
let releasePromotionRead = () => {}; const promotionReadPermit = new Promise<void>(resolve => { releasePromotionRead = resolve; });
let releaseSharedOpen = () => {}; const sharedOpenPermit = new Promise<void>(resolve => { releaseSharedOpen = resolve; });
const until = async (predicate: () => boolean, label: string) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await wait(50); } throw new Error("Timed out: " + label); };
const dir = await mkdtemp(path.join(tmpdir(), "texttext-title-promotion-")), output = path.join(dir, "ui");
await buildLocalVault({ output });
const browser = await chromium.launch({ headless: true });
if (typingDuringPromotion && typingBoundary !== "open") releaseSharedOpen();
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
        case "importPack":
        case "create": createRequests++; if (createRequests > 1) throw new Error("Fixture refuses an unexpected second creation."); exists = true; result = current.file; break;
        case "read": if (holdPromotionRead) { heldPromotionReads++; await promotionReadPermit; } result = current.file; break;
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
            acknowledgedRevision: current.file.hash, journal: null, retiredReason: null, ...(request.params.localHandoffVersion === 1 ? { localHandoff: { version: 1, profileVersion: 4 } } : {}) };
          break;
        case "collaborationRead": {
          if (typingDuringPromotion && typingBoundary === "baseline" && !request.params.waitMs && heldBaselines++ === 0) await boundaryPermit;
          const state = remoteState ?? seedVaultCollaboration(current.bytes, itemId, 1);
          result = request.params.waitMs && request.params.seq === state.seq
            ? { ...state, unchanged: true, canEditContent: true, canComment: true }
            : { ...state, relativePath: notePath, canEditContent: true, canComment: true };
          break;
        }
        case "collaborationCheckpoint":
          nativeCheckpoints++;
          if (typingDuringPromotion && typingBoundary === "checkpoint" && heldCheckpoints++ === 0) await boundaryPermit;
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
  await page.addInitScript(() => {
    (window as any).titlePromotionInputs = []; (window as any).titlePromotionKeys = []; (window as any).titlePromotionComposition = [];
    for (const type of ["compositionstart", "compositionupdate", "compositionend"]) document.addEventListener(type, event => (window as any).titlePromotionComposition.push({type, trusted:event.isTrusted}), true);
    document.addEventListener("input", event => { const target = event.target as HTMLElement; (window as any).titlePromotionInputs.push({ field: target.getAttribute("aria-label"), trusted: event.isTrusted, value: target instanceof HTMLTextAreaElement ? target.value : target.textContent, inputType: (event as InputEvent).inputType, composing: (event as InputEvent).isComposing }); }, true);
    window.addEventListener("keydown", event => { const observed = { key: event.key, trusted: event.isTrusted, target: (event.target as HTMLElement)?.tagName }; queueMicrotask(() => (window as any).titlePromotionKeys.push({...observed, prevented:event.defaultPrevented})); }, true);
  });
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
  const field = editBody ? page.getByRole("textbox", { name: "Document body", exact: true }) : title;
  if (editBody) {
    await field.click(); await page.keyboard.insertText(acceptedBody);
    await until(() => JSON.parse(current.file.documentJSON!).content.body === acceptedBody, "accepted body committed locally");
  }
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  if (backwardSelection) for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  const before = await field.evaluate(node => {
    if (node instanceof HTMLTextAreaElement) return { value: node.value, focused: node === document.activeElement, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection };
    const selection = window.getSelection();
    const range = document.createRange(); range.selectNodeContents(node);
    range.setEnd(selection!.anchorNode!, selection!.anchorOffset); const start = range.toString().length;
    range.setEnd(selection!.focusNode!, selection!.focusOffset); const end = range.toString().length;
    return { value: node.textContent ?? "", focused: node === document.activeElement, start, end, direction: "none" };
  });
  const acceptedValue = editBody ? acceptedBody : acceptedTitle;
  assert.equal(before.focused, true); assert.equal(before.start, acceptedValue.length - (backwardSelection ? 7 : 3)); assert.equal(before.end, acceptedValue.length - 3);
  if (backwardSelection) assert.equal(before.direction, "backward");
  const acceptedEvents = await page.evaluate(() => (window as any).titlePromotionInputs.filter((x: any) => x.field === "Title"));
  assert.ok(acceptedEvents.length > 0, "Pre-promotion title acceptance needs real input events, not expected-value injection.");
  if (typingDuringPromotion && typingBoundary === "open") holdPromotionRead = true;
  syncedHash = current.file.hash;
  await page.evaluate(workspaceId => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", { detail: { connected: true, available: true, workspaceId } })), config.workspaceId);
  await until(() => typingDuringPromotion ? typingBoundary === "baseline" ? heldBaselines > 0 : typingBoundary === "checkpoint" ? heldCheckpoints > 0 : heldPromotionReads > 0 || sharedOpens === 1 : sharedOpens === 1, "actual promotion boundary");
  if (typingDuringPromotion) {
    const during = await page.evaluate(() => ({active:document.activeElement?.getAttribute("aria-label"), inert:!!document.querySelector('[inert] textarea[aria-label="Title"]')}));
    const originalTitleNode = await field.elementHandle();
    const typedCharacters = continuous ? "n continuous input through handoff" : "n";
    let commitWhileTyping = false, whileTypingClose: unknown = null;
    const cdp = ime ? await page.context().newCDPSession(page) : null;
    if (cdp) await cdp.send("Input.imeSetComposition", {text:"文",selectionStart:1,selectionEnd:1});
    else if (continuous) {
      let typingComplete = false;
      const typing = page.keyboard.type(typedCharacters, {delay:30}).finally(() => { typingComplete = true; });
      await wait(80); releasePromotionRead(); releaseSharedOpen(); releaseBoundary();
      for (let attempt = 0; attempt < 40 && !typingComplete; attempt++) {
        whileTypingClose = await page.evaluate(async () => (window as any).texttextFlushForNativeClose());
        if ((whileTypingClose as any).ok) { commitWhileTyping = !typingComplete; break; }
        await wait(10);
      }
      await typing;
      assert.equal(commitWhileTyping, true, "The shared handoff must actually complete before continuous trusted typing ends.");
    } else await page.keyboard.type(typedCharacters); // trusted keydown, not a synthetic event
    await wait(300);
    const keys = await page.evaluate(() => (window as any).titlePromotionKeys.filter((event: any) => event.key === "n"));
    await writeFile(path.join(dir,"shortcut-observation.json"), JSON.stringify({before,during,keys,createRequests,sharedOpens,heldPromotionReads,savedTitle:JSON.parse(current.file.documentJSON!).content.title,errors,scope:"owned Chromium/provider; unexpected creation refused by fixture; no native cause or accepted-input-loss claim"},null,2),{flag:"wx"});
    if (!ime) assert.ok(keys.some((event: any) => event.trusted), "The boundary probe must use an actual trusted keydown.");
    assert.equal(createRequests,1,"Typing while the selected editor is promoting must not invoke New note.");
    assert.equal(during.active, editBody ? "Document body" : "Title", "The single local surface stays focused while native open is held.");
    assert.equal(during.inert, false);
    const typedTitle = acceptedValue.slice(0, before.start) + (ime ? "文" : typedCharacters) + acceptedValue.slice(before.end);
    const fieldValue = () => editBody ? field.textContent() : title.inputValue();
    assert.equal(await fieldValue(), typedTitle, "The held handoff must accept the actual typed character.");
    releasePromotionRead(); releaseSharedOpen(); releaseBoundary();
    let compositionClose: unknown = null;
    if (cdp) {
      await until(() => nativeCheckpoints > 0, "native checkpoint during active composition");
      await wait(150);
      compositionClose = await page.evaluate(async () => (window as any).texttextFlushForNativeClose());
      assert.equal((compositionClose as any).ok, false, "Composition cannot be acknowledged as a completed surface handoff.");
      await cdp.send("Input.insertText", {text:"文"});
      await wait(100);
      const composition = await page.evaluate(() => (window as any).titlePromotionComposition);
      await writeFile(path.join(dir, "composition-probe.json"), JSON.stringify({composition, value: await fieldValue(), compositionClose}, null, 2), {flag:"wx"});
      assert.ok(composition.some((event: any) => event.type === "compositionstart" && event.trusted));
      assert.ok(composition.some((event: any) => event.type === "compositionend"));
      assert.ok(await page.evaluate(({ expected, field }) => (window as any).titlePromotionInputs.some((event: any) => event.field === field && event.trusted && event.value === expected),
        { expected: typedTitle, field: editBody ? "Document body" : "Title" }), "The IME probe must actually accept trusted input into the selected field.");
    }
    await until(() => JSON.parse(current.file.documentJSON!).content[editBody ? "body" : "title"] === typedTitle && sharedPushes > 0, "typed title durably transferred");
    assert.equal(await field.evaluate((node, original) => node === original, originalTitleNode), true, "Promotion must not remount the Title surface.");
    assert.equal(await fieldValue(), typedTitle);
    assert.deepEqual(errors, []);
    await writeFile(path.join(dir, "handoff-final.json"), JSON.stringify({ typingBoundary, editBody, ime, continuous, commitWhileTyping, whileTypingClose, compositionClose, before, during, keys, createRequests, localWrites, sharedOpens, sharedPushes, checkpointConflicts,
      saved: JSON.parse(current.file.documentJSON!), actualTitle: await fieldValue(), sameTitleNode: await field.evaluate((node, original) => node === original, originalTitleNode), errors }, null, 2), { flag: "wx" });
    console.log("PASS held " + typingBoundary + " handoff accepts " + (continuous ? "continuous " : "") + "typing in the same mounted " + (editBody ? "body" : "Title") + " without invoking New note. Evidence: "+dir);
  } else {
  // Deliberately issue no input while the local editor is inert or the shared
  // baseline is unavailable. This cannot characterize lost unaccepted keystrokes.
  if (focusElsewhere) {
    await page.evaluate(() => { const input = document.createElement("input"); input.setAttribute("aria-label", "Fixture focus target"); document.body.append(input); });
    await page.getByRole("textbox", { name: "Fixture focus target", exact: true }).click();
  }
  releaseSharedOpen();
  if (nativeHandoff) await page.waitForFunction(async () => (await (window as any).texttextFlushForNativeClose()).ok === true);
  else await page.locator('[data-collaboration-state="ready"] textarea[aria-label="Title"]').waitFor();
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
  }
} finally { releasePromotionRead(); releaseSharedOpen(); releaseBoundary(); await browser.close(); }
