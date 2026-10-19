// Negative native-handoff boundary using production web transport + VaultApp.
// Owned Chromium/HTTP route fixture, no live account or installed-native acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
import { seedVaultCollaboration, applyVaultCollaboration, type VaultCollaborationState } from "@/sync/engine/collaboration";
import { openPack } from "../pack";
if (process.argv.length !== 2) throw Error("This fixture accepts no live configuration.");
const repository = process.cwd(), dir = await mkdtemp(path.join(tmpdir(), "texttext-web-handoff-bootstrap-"));
const workspaceId = "owned-web-handoff", accountId = "owned-web-account", origin = "https://web-handoff.test";
await symlink(path.join(repository, "node_modules"), path.join(dir, "node_modules"));
await writeFile(path.join(dir, "entry.tsx"), `
import React from '${repository}/node_modules/react/index.js';
import {createRoot} from '${repository}/node_modules/react-dom/client.js';
import {VaultApp} from '${repository}/src/local-vault/VaultApp';
import {setVaultTransport} from '${repository}/src/local-vault/bridge';
import {createWebVaultTransport} from '${repository}/src/local-vault/web-transport';
import '${repository}/src/local-vault/style.css';
window.webCalls=[];window.heldConfigs=0;
const gate=new Promise(resolve=>window.releaseWebConfig=resolve);
const transport=createWebVaultTransport('${workspaceId}','Owned web fixture',fetch,undefined,'${accountId}');
setVaultTransport(async(method,params,signal)=>{
 window.webCalls.push({method,params});
 if(method==='collaborationConfig'){window.heldConfigs++;await gate;}
 return transport.request(method,params,signal);
});
createRoot(document.getElementById('root')).render(<VaultApp allowFolderPicker={false}/>);
`);
await buildLocalVault({ entry: path.join(dir, "entry.tsx"), output: dir });
let bytes: Uint8Array | null = null, itemId: string | null = null, relativePath: string | null = null, revision = "empty";
let state: VaultCollaborationState | null = null, puts = 0, pushes = 0, heldBaselines = 0;
let releaseBaseline!: () => void; const baselineGate = new Promise<void>(resolve => { releaseBaseline = resolve; });
const requestErrors: string[] = [], pageErrors: string[] = [];
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(8000); page.on("pageerror", error => pageErrors.push(error.message));
  await page.route(origin + "/**", async route => {
    const request = route.request(), url = new URL(request.url()), base = `/api/vault/${workspaceId}/items`;
    try {
      if (url.pathname.startsWith("/vault/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (url.pathname.endsWith("/account")) return route.fulfill({ json: { email: "owned@example.invalid", identities: [], workspaceName: "Owned web fixture" } });
      if (url.pathname.endsWith("/access")) return route.fulfill({ json: { fullAccess: true, isOwner: true, canEditContent: true, canComment: true, canManageShares: true, grants: [] } });
      if (url.pathname === base) {
        if (url.searchParams.has("folderViews")) return route.fulfill({ json: { files: [] } });
        return route.fulfill({ json: { revision, fullAccess: true, canCreateContent: true, writableFolders: [], folders: ["Notes"],
          items: itemId ? [{ itemId, relativePath, revision, canEditContent: true }] : [] } });
      }
      if (url.pathname.endsWith("/collaboration")) {
        assert.ok(state); assert.ok(bytes);
        if (request.method() === "POST") {
          const submitted = request.postDataJSON(); assert.equal(submitted.epoch, state.epoch);
          const next = applyVaultCollaboration(state, bytes, submitted.updates, relativePath!);
          state = next.state; bytes = next.bytes; revision = state.revision; pushes++;
          return route.fulfill({ json: { status: "written", revision } });
        }
        heldBaselines++; await baselineGate;
        return route.fulfill({ json: { ...state, relativePath, canEditContent: true, canComment: true,
          ...(url.searchParams.get("seq") === String(state.seq) ? { unchanged: true } : {}) } });
      }
      if (url.pathname.includes("/presence")) return route.fulfill({ json: { epoch: 1, presence: [],
        ...(request.method() === "POST" ? { session: { clientId: "p-11111111-1111-4111-8111-111111111111", sessionCredential: "v1:owned", expiresAt: Date.now() + 60_000 } } : {}) } });
      if (url.pathname.startsWith(base + "/")) {
        if (request.method() === "PUT") {
          assert.equal(puts++, 0, "Only the initial remote create may full-pack PUT");
          itemId = decodeURIComponent(url.pathname.slice(base.length + 1));
          relativePath = decodeURIComponent(request.headers()["x-texttext-path"]); bytes = request.postDataBuffer()!;
          revision = digest(bytes); state = seedVaultCollaboration(bytes, itemId, 1);
          return route.fulfill({ json: { status: "written", relativePath, revision } });
        }
        assert.ok(bytes); return route.fulfill({ contentType: "application/zip", body: Buffer.from(bytes), headers: { ETag: `"${revision}"` } });
      }
      throw Error("Unexpected owned web route: " + url.pathname);
    } catch (error) { requestErrors.push(String(error)); return route.fulfill({ status: 500, json: { error: "Owned fixture refusal" } }); }
  });
  await page.goto(`${origin}/vault/${workspaceId}`);
  await page.addStyleTag({ content: await readFile(path.join(dir, "app.css"), "utf8") });
  await page.addScriptTag({ content: await readFile(path.join(dir, "app.js"), "utf8") });
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForFunction(() => (window as any).heldConfigs > 0);
  const editable = () => page.locator('textarea[aria-label="Title"]:not([disabled]),[contenteditable="true"][aria-label="Document body"]');
  assert.equal(await editable().count(), 0, "No local editor may accept input before web configuration");
  await page.evaluate(() => (window as any).releaseWebConfig());
  for (let i = 0; i < 100 && heldBaselines === 0; i++) await wait(30);
  assert.ok(heldBaselines > 0, "Actual web baseline request held");
  assert.equal(await editable().count(), 0, "No local editor may accept input before remote baseline");
  const beforeStorage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)!])));
  assert.ok(!Object.entries(beforeStorage).some(([key, raw]) => key.startsWith("texttext:vault-item-draft:") && JSON.parse(raw).version === 2));
  releaseBaseline();
  const title = page.getByRole("textbox", { name: "Title", exact: true }), body = page.getByRole("textbox", { name: "Document body", exact: true });
  await title.waitFor(); await title.click(); await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("Web title n");
  await body.click(); await page.keyboard.type("Web body n");
  for (let i = 0; i < 160; i++) {
    const document = bytes && openPack(bytes, relativePath!, digest(bytes)).file.documentJSON;
    if (document && JSON.parse(document).content.title === "Web title n" && JSON.parse(document).content.body === "Web body n") break;
    await wait(40);
  }
  assert.ok(bytes); const final = JSON.parse(openPack(bytes, relativePath!, digest(bytes)).file.documentJSON!);
  assert.equal(final.content.title, "Web title n"); assert.equal(final.content.body, "Web body n"); assert.equal(puts, 1); assert.ok(pushes > 0);
  const calls = await page.evaluate(() => (window as any).webCalls);
  assert.ok(calls.every((call: any) => call.method !== "collaborationOpen" && call.params.localHandoffVersion === undefined));
  const afterStorage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)!])));
  assert.ok(!Object.entries(afterStorage).some(([key, raw]) => key.startsWith("texttext:vault-item-draft:") && JSON.parse(raw).version === 2));
  const databases = await page.evaluate(() => indexedDB.databases());
  assert.equal(databases.find(database => database.name === "texttext-file-collaboration")?.version, 1, "Existing web journal schema remains version one");
  assert.deepEqual(pageErrors, []); assert.deepEqual(requestErrors, []);
  await writeFile(path.join(dir, "observation.json"), JSON.stringify({ scope: "owned Chromium production web transport/VaultApp; no native or live account",
    itemId, relativePath, puts, pushes, heldBaselines, heldConfigs: await page.evaluate(() => (window as any).heldConfigs),
    databases, nativeCalls: calls.filter((call: any) => call.method === "collaborationOpen"), finalDocument: final, pageErrors, requestErrors }, null, 2), { flag: "wx" });
  console.log("PASS web creation waits for remote configuration/baseline, then accepts input without native handoff. Evidence: " + dir);
} finally { releaseBaseline(); await browser.close(); }
