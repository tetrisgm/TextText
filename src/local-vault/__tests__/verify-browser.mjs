import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { chromium } from "playwright";

const makeDocument = (body) => ({ schemaVersion: 1, content: { title: "Offline note", body, fields: {}, tags: [], assets: [] }, presentation: { template: { id: "texttext.note", version: 1 }, theme: {} } });
const files = new Map();
const history = new Map();
let revision = 1;
let connected = false, openedWeb = false;
const initial = { path: "Notes/Offline.textpack", hash: String(revision), markdown: '---\ntextTextId: "d6090b67-e3bb-46a3-9d34-76061bcb1dbb"\ntitle: "Offline note"\n---\n\nFirst line\nSecond line', documentJSON: JSON.stringify(makeDocument("First line\nSecond line")) };
files.set(initial.path, initial);
const preset = unzipSync(await readFile("presets/builtin/note.textpack"));
const template = JSON.parse(strFromU8(preset[Object.keys(preset).find((name) => name.endsWith("/template.json"))]));
template.id = "custom.agent-look"; template.name = "Agent made look";
files.set("Templates/Agent look.textpack", { ...initial, path: "Templates/Agent look.textpack", hash: "template-1", templateJSON: JSON.stringify(template) });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const failures = [], network = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.route(/^https?:/, (route) => route.abort());
  await page.exposeBinding("nativeVaultRequest", async ({ page }, request) => {
    let result, error;
    if (request.method === "list" || request.method === "open") result = { root: "/test/Workspace", folders: ["Empty"], items: [...files.values()].map((file) => ({ path: file.path })) };
    else if (request.method === "connection" || request.method === "connect" || request.method === "sync") {
      if (request.method === "connect") connected = true;
      result = { connected, available: true, ...(connected ? { webURL: "https://example.test/vault/workspace" } : {}) };
    } else if (request.method === "openWeb") { openedWeb = true; result = {}; }
    else if (request.method === "search") result = { items: [...files.values()].filter((file) => file.markdown.toLowerCase().includes(request.params.query.toLowerCase())).map((file) => ({ path: file.path, title: file.path, snippet: "Matched in file" })), truncated: false };
    else if (request.method === "read" || request.method === "template") {
      result = files.get(request.params.path);
      if (!result) error = { message: "File not found", code: "not_found" };
    }
    else if (request.method === "extractArticle") result = { sourceURL: request.params.sourceURL, markdown: "# Captured reading\n\nThe readable article is saved in this same file.", capturedAt: "2026-09-30T12:00:00Z" };
    else if (request.method === "agentStatus" || request.method === "agentConnect") result = { state: "ready" };
    else if (request.method === "agentSend") {
      result = {};
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "final-text", text: "I can work with these local files." } }));
        window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "turn-completed" } }));
      });
    }
    else if (request.method === "write") {
      const current = files.get(request.params.path);
      if (!current) error = { code: "not_found", message: "File not found" };
      else if (current.hash !== request.params.hash) error = { code: "conflict", message: "File changed", current };
      else { result = { ...current, ...request.params, hash: String(++revision) }; files.set(result.path, result); }
    } else if (request.method === "rename" || request.method === "delete") {
      const current = files.get(request.params.path);
      if (!current) error = { code: "not_found", message: "File not found" };
      else if (current.hash !== request.params.hash) error = { code: "conflict", message: "File changed", current };
      else {
        files.delete(current.path);
        if (request.method === "rename") { result = { ...current, path: request.params.newPath }; files.set(result.path, result); }
        else result = {};
      }
    } else if (request.method === "create") {
      const name = `${request.params.folder || "Notes"}/Copy-${++revision}.textpack`;
      result = { ...(request.params.sourcePath ? (files.get(request.params.sourcePath) ?? history.get(request.params.sourceHash)) : initial), path: name, hash: String(revision) };
      result.markdown = result.markdown.replace(/textTextId: [^\n]+/, `textTextId: "copy-${revision}"`);
      if (!request.params.sourcePath && typeof request.params.body === "string") {
        const document = makeDocument(request.params.body);
        document.content.title = request.params.title || "Untitled";
        if (request.params.sourceURL) document.content.fields.sourceUrl = request.params.sourceURL;
        result.documentJSON = JSON.stringify(document);
        result.markdown = `---\ntextTextId: "copy-${revision}"\ntitle: ${JSON.stringify(document.content.title)}\n---\n\n${request.params.body}`;
      }
      files.set(name, result);
    } else error = { message: `Unexpected operation ${request.method}` };
    await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("texttext:vault-reply", { detail })), { id: request.id, result, error });
  });
  await page.addInitScript(() => {
    window.__networkAttempts = [];
    window.fetch = (...arguments_) => { window.__networkAttempts.push(String(arguments_[0])); return Promise.reject(new Error("Offline test forbids fetch")); };
    window.webkit = { messageHandlers: { localVault: { postMessage: (request) => { void window.nativeVaultRequest(request); } } } };
  });
  await page.goto(pathToFileURL(path.resolve("mac/build/LocalVault/index.html")).href);
  await page.getByRole("region", { name: "Ready-to-use templates" }).getByRole("button", { name: "Agent made look", exact: true }).waitFor();
  await page.getByRole("region", { name: "Folders" }).getByRole("button", { name: /Empty/ }).click();
  await page.getByRole("heading", { name: "Empty", exact: true }).waitFor();
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("heading", { name: "Your workspace", exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/texttext-starter-overview-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-starter-overview-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Connect to web", exact: true }).click();
  await page.getByRole("button", { name: "Open on web", exact: true }).click();
  assert.equal(openedWeb, true);
  assert.equal(await page.getByText(/^(?:Syncing|Synced)$/).count(), 0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", { detail: { connected: true, available: true, webURL: "https://example.test/vault/workspace", message: "A conflicting edit was preserved." } })));
  await page.getByText("A conflicting edit was preserved.").waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("texttext:vault-sync-status", { detail: { connected: true, available: true, webURL: "https://example.test/vault/workspace" } })));
  await page.getByRole("button", { name: "Notes/Offline", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Local first line\nSecond line");
  await page.waitForFunction(() => !localStorage.getItem("texttext:vault-draft:/test/Workspace:Notes/Offline.textpack"));
  assert.match(files.get(initial.path).markdown, /Local first line/);
  // Direct agent write must become visible without a reload or a server.
  const current = files.get(initial.path);
  files.set(initial.path, { ...current, hash: String(++revision), markdown: current.markdown.replace("Second line", "Agent second line") });
  await page.evaluate(() => window.dispatchEvent(new Event("texttext:vault-changed")));
  await page.waitForFunction(() => document.querySelector('[aria-label="Document body"]')?.textContent?.includes("Agent second line"));
  assert.match(await body.innerText(), /Local first line/);
  // A stale-base same-line edit must preserve disk and offer a separate copy.
  await body.fill("My conflicting version");
  const beforeConflict = files.get(initial.path);
  files.set(initial.path, { ...beforeConflict, hash: String(++revision), markdown: beforeConflict.markdown.replace(/Local first line\nAgent second line$/, "Their conflicting version") });
  await page.getByRole("button", { name: "Save my edits as a copy" }).waitFor();
  assert.match(files.get(initial.path).markdown, /Their conflicting version/);
  await page.getByRole("button", { name: "Save my edits as a copy" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Document body"]')?.textContent === "Their conflicting version");
  assert.ok([...files.values()].some((file) => file.path !== initial.path && file.markdown.includes("My conflicting version")));
  await page.getByRole("button", { name: /^Look / }).click();
  await page.getByRole("button", { name: "Agent made look", exact: true }).click();
  await page.waitForFunction(() => !localStorage.getItem("texttext:vault-draft:/test/Workspace:Notes/Offline.textpack"));
  assert.equal(JSON.parse(files.get(initial.path).templateJSON).id, "custom.agent-look");
  await page.getByLabel("More actions", { exact: true }).click();
  await page.getByRole("button", { name: "Save as look", exact: true }).click();
  await page.getByRole("textbox", { name: "Name this look", exact: true }).fill("Saved local look");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.getByText(/Saved in Templates\//).waitFor();
  assert.ok([...files.values()].some((file) => file.path.startsWith("Templates/") && JSON.parse(file.templateJSON).name === "Saved local look"));
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("textbox", { name: "Message assistant", exact: true }).fill("Read the selected file.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("I can work with these local files.").waitFor();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "status", state: "disconnected" } }));
    window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "turn-completed" } }));
  });
  assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  await page.getByRole("combobox", { name: "Folder for new notes", exact: true }).fill("Projects/Draft");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  assert.ok([...files.keys()].some((name) => name.startsWith("Projects/Draft/")));
  await page.getByRole("button", { name: "New from template", exact: true }).click();
  await page.getByRole("button", { name: "Agent made look", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const cloned = [...files.values()].at(-1);
  assert.equal(cloned.templateJSON, files.get("Templates/Agent look.textpack").templateJSON);
  assert.notEqual(cloned.markdown, files.get("Templates/Agent look.textpack").markdown);
  await page.getByRole("button", { name: "Rename or move", exact: true }).click();
  await page.getByRole("textbox", { name: "New file path", exact: true }).fill("Projects/Renamed.textpack");
  await page.getByRole("button", { name: "Save path", exact: true }).click();
  await page.getByRole("button", { name: "Projects/Renamed", exact: true }).waitFor();
  assert.ok(files.has("Projects/Renamed.textpack"));
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("group", { name: "Confirm file deletion" }).getByText("Projects/Renamed.textpack", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete file", exact: true }).click();
  await page.locator(".vault-overview").waitFor();
  assert.ok(!files.has("Projects/Renamed.textpack"));
  await page.getByRole("button", { name: /Search files/ }).click();
  await page.getByRole("searchbox", { name: "Search workspace" }).fill("Their conflicting version");
  await page.getByRole("dialog", { name: "Search files", exact: true }).getByRole("button", { name: /Notes\/Offline.textpack/ }).click();
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
  assert.match(await body.innerText(), /Their conflicting version/);
  await page.getByRole("button", { name: "Save a link or note", exact: true }).click();
  await page.getByRole("textbox", { name: "Link or note", exact: true }).fill("https://example.com/capture");
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: "/tmp/texttext-vault-capture-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-vault-capture-dark.png" });
  await page.getByRole("button", { name: "Save to folder", exact: true }).click();
  await page.getByRole("dialog", { name: "Save a link or note" }).waitFor({ state: "hidden" });
  await page.getByText("Article captured. Your original link is retained.", { exact: true }).waitFor();
  await page.getByText("Your notes", { exact: true }).click();
  await page.getByRole("textbox", { name: "Your article notes", exact: true }).fill("My annotation survives source refresh.");
  await page.waitForFunction(() => !Object.keys(localStorage).some((key) => key.startsWith("texttext:vault-draft:")));
  const captured = [...files.values()].find((file) => JSON.parse(file.documentJSON).content.fields.sourceUrl === "https://example.com/capture");
  assert.equal(JSON.parse(captured.documentJSON).content.fields.commentary, "My annotation survives source refresh.");
  assert.match(JSON.parse(captured.documentJSON).content.body, /Captured reading/);
  const reader = page.getByRole("region", { name: "Article reader", exact: true });
  await reader.waitFor();
  await page.evaluate(() => {
    const root = document.querySelector(".vault-reading .tt-document");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent.indexOf("readable article");
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + "readable article".length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange")); break;
    }
  });
  await page.getByRole("button", { name: "Highlight selection", exact: true }).click();
  await page.getByRole("textbox", { name: "Note about this highlight", exact: true }).fill("Keep this cited excerpt.");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: captured.path.replace(/\.textpack$/, ""), exact: true }).click();
  await page.getByRole("textbox", { name: "Note about this highlight", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Note about this highlight", exact: true }).inputValue(), "Keep this cited excerpt.");
  assert.equal(JSON.parse(files.get(captured.path).documentJSON).content.fields.readerHighlights[0].quote, "readable article");
  assert.equal(await page.evaluate(() => CSS.highlights.get("texttext-reader").size), 1);
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator("main").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/texttext-article-reader-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-article-reader-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  // A clean open file deleted by another replica must close, not offer Retry save.
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("[inert]"));
  const removed = [...files.keys()].at(-1);
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
  files.delete(removed);
  await page.evaluate(() => window.dispatchEvent(new Event("texttext:vault-changed")));
  await page.locator(".vault-overview").waitFor();
  assert.equal(await page.getByRole("button", { name: "Retry save", exact: true }).count(), 0);
  // A deleted file with a pending draft must retain its edits and offer a copy.
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("[inert]"));
  const dirtyPath = [...files.keys()].at(-1);
  const dirtyBase = files.get(dirtyPath);
  history.set(dirtyBase.hash, dirtyBase);
  await body.fill("Unsaved deletion recovery");
  files.delete(dirtyPath);
  await page.evaluate(() => window.dispatchEvent(new Event("texttext:vault-changed")));
  await page.getByRole("button", { name: "Save my edits as a copy" }).click();
  await page.locator(".vault-overview").waitFor();
  assert.ok([...files.values()].some((file) => file.markdown.includes("Unsaved deletion recovery")));
  assert.ok(!files.has(dirtyPath));
  assert.deepEqual(await page.evaluate(() => window.__networkAttempts), []);
  assert.deepEqual(network, []);
  assert.deepEqual(failures, []);
  console.log("Offline vault UI passed: file save, raw agent refresh, conflict copy, zero HTTP/fetch calls.");
} finally { await browser.close(); }
