import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { chromium } from "playwright";
import { build } from "esbuild";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";

const output = await mkdtemp(path.join(tmpdir(), "texttext-web-vault-"));
let browser;
try {
  await buildLocalVault({ entry: "src/local-vault/__tests__/web-entry.tsx", output });
  await build({ entryPoints: ["src/lib/vault/collaboration.ts"], outfile: path.join(output, "collaboration.mjs"), bundle: true, platform: "node", format: "esm" });
  const { seedVaultCollaboration, applyVaultCollaboration } = await import(path.join(output, "collaboration.mjs"));
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for web vault file save.");
  };
  const id = "4c417b9d-f935-40c4-a537-7cb70658f898";
  const document = { schemaVersion: 1, content: { title: "Web note", body: "Original body", fields: {}, tags: [], assets: [] }, presentation: { template: { id: "texttext.note", version: 1 }, theme: {} } };
  const prefix = "Document.textbundle/";
  const initial = zipSync({ [prefix + "text.md"]: strToU8(`---\ntextTextId: "${id}"\ntitle: "Web note"\n---\n\nOriginal body`), [prefix + "document.json"]: strToU8(JSON.stringify(document)), [prefix + "assets/preserved.bin"]: new Uint8Array([7, 8, 9]) });
  const files = new Map([[id, { path: "Notes/Web.textpack", bytes: initial }]]);
  const collaboration = new Map();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [], unexpected = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== "https://vault.test") { unexpected.push(request.url()); await route.abort(); return; }
    if (url.pathname === "/api/vault/workspace/access") {
      await route.fulfill({ json: { fullAccess: true, isOwner: true, canEditContent: true, canComment: true, canManageShares: true, grants: [] } }); return;
    }
    if (url.pathname === "/api/vault/workspace/items") {
      if (url.searchParams.has("folderViews")) { await route.fulfill({ json: { files: [] } }); return; }
      if (url.searchParams.has("wait")) await new Promise((resolve) => setTimeout(resolve, 250));
      const items = [...files].map(([itemId, file]) => ({ itemId, relativePath: file.path, revision: digest(file.bytes) }));
      const revision = digest(JSON.stringify(items));
      if (request.headers()["if-none-match"] === `"${revision}"`) await route.fulfill({ status: 304 });
      else await route.fulfill({ json: { items, revision } });
      return;
    }
    if (url.pathname.startsWith("/api/vault/workspace/items/")) {
      if (url.pathname.endsWith("/collaboration")) {
        const itemId = url.pathname.split("/").at(-2), file = files.get(itemId);
        if (!file) { await route.fulfill({ status: 404 }); return; }
        let state = collaboration.get(itemId);
        if (!state || state.revision !== digest(file.bytes)) {
          state = seedVaultCollaboration(file.bytes, itemId, (state?.epoch ?? 0) + 1);
          collaboration.set(itemId, state);
        }
        if (request.method() === "POST") {
          const payload = request.postDataJSON();
          if (payload.epoch !== state.epoch) { await route.fulfill({ status: 409, json: { code: "epoch_changed" } }); return; }
          const applied = applyVaultCollaboration(state, file.bytes, payload.updates);
          files.set(itemId, { ...file, bytes: applied.bytes });
          collaboration.set(itemId, applied.state);
          await route.fulfill({ json: { status: "written", revision: applied.state.revision } }); return;
        }
        if (url.searchParams.has("waitMs") && Number(url.searchParams.get("epoch")) === state.epoch && Number(url.searchParams.get("seq")) === state.seq) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await route.fulfill({ json: { epoch: state.epoch, seq: state.seq, unchanged: true, canEditContent: true, canComment: true } }); return;
        }
        await route.fulfill({ json: { ...state, relativePath: file.path, canEditContent: true, canComment: true } }); return;
      }
      const itemId = url.pathname.split("/").at(-1), stored = files.get(itemId);
      if (url.searchParams.get("metadata") === "preview" && stored) {
        const snapshot = JSON.parse(strFromU8(unzipSync(stored.bytes)[prefix + "document.json"]));
        await route.fulfill({ json: { title: snapshot.content.title, excerpt: snapshot.content.body.slice(0, 400), document: snapshot, incompleteFields: [] } }); return;
      }
      if (request.method() === "PUT") {
        const headers = request.headers();
        if (stored && headers["if-match"] !== `"${digest(stored.bytes)}"`) { await route.fulfill({ status: 409, json: { status: "conflict" } }); return; }
        const bytes = request.postDataBuffer();
        const relativePath = decodeURIComponent(headers["x-texttext-path"]);
        files.set(itemId, { path: relativePath, bytes });
        await route.fulfill({ json: { status: "written", itemId, relativePath, revision: digest(bytes) } });
      } else if (!stored) await route.fulfill({ status: 404 });
      else await route.fulfill({ body: Buffer.from(stored.bytes), contentType: "application/zip", headers: { ETag: `"${digest(stored.bytes)}"`, "X-TextText-Path": encodeURIComponent(stored.path) } });
      return;
    }
    if (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/app.css")) {
      const leaf = url.pathname.split("/").at(-1);
      await route.fulfill({ body: await readFile(path.join(output, leaf)), contentType: leaf.endsWith(".js") ? "application/javascript" : "text/css" }); return;
    }
    if (url.pathname === "/vault/workspace") {
      const html = (await readFile(path.join(output, "index.html"), "utf8")).replace("connect-src 'none'", "connect-src 'self'");
      await route.fulfill({ body: html, contentType: "text/html" }); return;
    }
    unexpected.push(url.pathname); await route.abort();
  });
  await page.goto("https://vault.test/vault/workspace");
  await page.getByRole("navigation", { name: "Folders" }).locator("summary").filter({ hasText: "Notes" }).click();
  await page.getByRole("button", { name: "Open Web note" }).click();
  await page.getByRole("button", { name: "Edit card" }).click();
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Edited through the web");
  await page.waitForFunction(() => !localStorage.getItem("texttext:vault-draft:vault:workspace:Notes/Web.textpack"));
  await waitFor(() => strFromU8(unzipSync(files.get(id).bytes)[prefix + "text.md"]).includes("Edited through the web"));
  assert.match(strFromU8(unzipSync(files.get(id).bytes)[prefix + "text.md"]), /Edited through the web/);
  assert.deepEqual(unzipSync(files.get(id).bytes)[prefix + "assets/preserved.bin"], new Uint8Array([7, 8, 9]));
  // A raw file change on another replica is read when the browser regains focus.
  const external = unzipSync(files.get(id).bytes);
  external[prefix + "text.md"] = strToU8(strFromU8(external[prefix + "text.md"]).replace("Edited through the web", "Agent edited the file"));
  files.set(id, { path: "Notes/Web.textpack", bytes: zipSync(external) });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelector('[aria-label="Document body"]')?.textContent === "Agent edited the file");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.locator('.vault-context-header h2[title*="Untitled.textpack"]').waitFor();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("New web item");
  await page.getByRole("textbox", { name: "Document body", exact: true }).fill("New file bytes");
  await page.waitForFunction(() => Object.keys(localStorage).filter((key) => key.startsWith("texttext:vault-draft:")).length === 0);
  await waitFor(() => [...files.values()].some((file) => strFromU8(unzipSync(file.bytes)[prefix + "text.md"]).includes("New file bytes")));
  assert.equal(files.size, 2);
  assert.ok([...files.values()].some((file) => strFromU8(unzipSync(file.bytes)[prefix + "text.md"]).includes("New file bytes")));
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); document.querySelector(".vault-app>main").scrollTo(0, 0); });
  await page.screenshot({ path: "/tmp/texttext-vault-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-vault-dark.png" });
  assert.deepEqual(failures, []);
  assert.deepEqual(unexpected, []);
  console.log("Web vault UI passed: shared editor, file GET/PUT, assets preserved, raw file refresh, creation; no legacy content routes.");
} finally {
  await browser?.close();
  await rm(output, { recursive: true, force: true });
}
