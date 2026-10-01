import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { seedVaultCollaboration } from "@/lib/vault/collaboration";
import { openPack } from "../pack";

const itemId = "new-note-promotion-test";
const notePath = "Notes/Untitled.textpack";
const root = "/test/Workspace";
const markdown = `---\ntextTextId: ${JSON.stringify(itemId)}\ntitle: "Untitled"\n---\n\n`;
const config = { namespace: "https://texttext.test/", workspaceId: "11111111-1111-4111-8111-111111111111", itemId, localFiles: true };
const initial = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
initial.content.title = "Untitled";
const pack = (text: string, json: string) => {
  const bytes = buildTextpack("Untitled", { markdown: text, document: JSON.parse(json) });
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, file: openPack(bytes, notePath, hash).file };
};
let current = pack(markdown, JSON.stringify(initial));
let exists = false, syncedHash: string | null = null;
let localWrites = 0, sharedOpens = 0, sharedPushes = 0, publicationReads = 0;
const until = async (condition: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

await buildLocalVault();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeBinding("nativeVaultRequest", async ({ page }, request: { id: string; method: string; params: Record<string, unknown> }) => {
    let result: unknown = null, error: { code: string; message: string } | null = null;
    try {
      switch (request.method) {
        case "list": result = { root, folders: ["Notes"], items: exists ? [{ path: notePath }] : [] }; break;
        case "connection": result = { connected: true, available: true, workspaceId: config.workspaceId, webURL: "https://texttext.test/vault/workspace" }; break;
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
          result = { sessionToken: "session", path: notePath, hash: current.file.hash,
            acknowledgedRevision: current.file.hash, journal: null, retiredReason: null };
          break;
        case "collaborationRead": {
          const state = seedVaultCollaboration(current.bytes, itemId, 1);
          result = request.params.waitMs ? { ...state, unchanged: true, canEditContent: true, canComment: true }
            : { ...state, relativePath: notePath, canEditContent: true, canComment: true };
          break;
        }
        case "collaborationCheckpoint": result = { path: notePath, hash: current.file.hash }; break;
        case "collaborationPush": sharedPushes++; throw new Error("Clean promotion must not push a duplicate edit.");
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
  await page.goto(pathToFileURL(path.resolve("mac/build/LocalVault/index.html")).href);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Document body");
  await page.keyboard.insertText("Typed before the first sync.");
  await until(() => localWrites === 1, "the local note save");
  assert.equal(JSON.parse(current.file.documentJSON!).content.body, "Typed before the first sync.");
  assert.equal(sharedOpens, 0);
  syncedHash = current.file.hash;
  await page.evaluate(workspaceId => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", {
    detail: { connected: true, available: true, workspaceId },
  })), config.workspaceId);
  try { await page.getByRole("button", { name: "Publish", exact: true }).waitFor({ timeout: 10_000 }); }
  catch (reason) {
    console.error({ localWrites, sharedOpens, sharedPushes, publicationReads, syncedHash, currentHash: current.file.hash,
      body: (await page.locator("body").innerText()).slice(0, 900), errors });
    throw reason;
  }
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Document body");
  assert.equal(await page.getByRole("textbox", { name: "Document body" }).innerText(), "Typed before the first sync.");
  assert.equal(sharedOpens, 1);
  assert.equal(localWrites, 1);
  assert.equal(sharedPushes, 0);
  assert.ok(publicationReads >= 2, "Publishing access must refresh after the first sync.");
  await page.evaluate(workspaceId => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", {
    detail: { connected: true, available: true, workspaceId },
  })), config.workspaceId);
  await wait(150);
  assert.equal(sharedOpens, 1);
  assert.equal(localWrites, 1);
  assert.equal(sharedPushes, 0);
  assert.deepEqual(errors, []);
  console.log("New note promoted after exact local bytes synced; focus, content, and publish access survived without repeat writes.");
} finally { await browser.close(); }
