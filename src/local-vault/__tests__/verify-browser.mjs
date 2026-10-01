import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { chromium } from "playwright";

const makeDocument = (body) => ({ schemaVersion: 1, content: { title: "Offline note", body, fields: {}, tags: [], assets: [] }, presentation: { template: { id: "texttext.note", version: 1 }, theme: {} } });
const files = new Map();
const proposalFeedback = [];
const history = new Map();
const importedPacks = [];
let revision = 1;
let connected = false, openedWeb = false, agentState = "signed-out", agentSendCount = 0, lastAgentSend = null, lastAgentCancel = null, holdAgentTurn = false;
const agentAccountEmail = "writer@example.test";
const initial = { path: "Notes/Offline.textpack", hash: String(revision), markdown: '---\ntextTextId: "d6090b67-e3bb-46a3-9d34-76061bcb1dbb"\ntitle: "Offline note"\n---\n\nFirst line\nSecond line', documentJSON: JSON.stringify(makeDocument("First line\nSecond line")) };
files.set(initial.path, initial);
const preset = unzipSync(await readFile("presets/builtin/note.textpack"));
const template = JSON.parse(strFromU8(preset[Object.keys(preset).find((name) => name.endsWith("/template.json"))]));
template.id = "custom.agent-look"; template.name = "Agent made look";
files.set("Templates/Agent look.textpack", { ...initial, path: "Templates/Agent look.textpack", hash: "template-1", templateJSON: JSON.stringify(template) });
const retainedEntries = {
  "Recovery.textbundle/text.md": strToU8(initial.markdown),
  "Recovery.textbundle/document.json": strToU8(initial.documentJSON),
  "Recovery.textbundle/template.json": strToU8(JSON.stringify(template)),
  "Recovery.textbundle/assets/original.bin": new Uint8Array([0, 17, 255, 84]),
  "Recovery.textbundle/opaque.dat": new Uint8Array([82, 69, 67]),
};
const recoveryData = Buffer.from(zipSync(retainedEntries)).toString("base64");
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
    else if (request.method === "folderViews") result = { files: [...files.values()].filter((file) => file.path.split("/").slice(0, -1).join("/") === request.params.folder && JSON.parse(file.documentJSON).content.fields.texttextFolderView) };
    else if (request.method === "collaborationConfig") result = null;
    else if (request.method === "connection" || request.method === "connect" || request.method === "sync") {
      if (request.method === "connect") connected = true;
      result = { connected, available: true, ...(connected ? { webURL: "https://example.test/vault/workspace" } : {}) };
    } else if (request.method === "openWeb") { openedWeb = true; result = {}; }
    else if (request.method === "search") result = { items: [...files.values()].filter((file) => file.markdown.toLowerCase().includes(request.params.query.toLowerCase())).map((file) => ({ path: file.path, title: file.path, snippet: "Matched in file" })), truncated: false };
    else if (request.method === "read" || request.method === "template") {
      result = files.get(request.params.path);
      if (!result) error = { message: "File not found", code: "not_found" };
    }
    else if (request.method === "recoveryList") result = { entries: [{ id: "retained-copy", path: initial.path, kind: request.params.path ? "revision" : "deleted", savedAt: "2026-09-30T12:00:00Z", hash: "saved-version" }], truncated: false };
    else if (request.method === "recoveryRead") result = { ...initial, hash: "saved-version", templateJSON: JSON.stringify(template), data: recoveryData, assets: [] };
    else if (request.method === "importPack") {
      const bytes = Buffer.from(request.params.data, "base64");
      const entries = unzipSync(bytes);
      const prefix = Object.keys(entries).find((name) => name.endsWith("/document.json")).replace(/document.json$/, "");
      importedPacks.push(entries);
      result = { path: request.params.exactPath || `${request.params.folder ? request.params.folder + "/" : ""}${request.params.title}-${++revision}.textpack`, hash: String(++revision),
        markdown: strFromU8(entries[prefix + "text.md"]), documentJSON: strFromU8(entries[prefix + "document.json"]), templateJSON: strFromU8(entries[prefix + "template.json"]),
        assets: Object.entries(entries).filter(([name]) => name.startsWith(prefix + "assets/")).map(([name, data]) => ({ filename: name.slice((prefix + "assets/").length), contentType: name.endsWith(".png") ? "image/png" : "image/gif", data: Buffer.from(data).toString("base64") })) };
      files.set(result.path, result);
    }
    else if (request.method === "preview") {
      const file = files.get(request.params.path);
      if (!file) error = { message: "File not found" };
      else {
        const document = JSON.parse(file.documentJSON);
        const poster = file.assets?.find((asset) => asset.filename === "preview.png");
        result = { document, sourceURL: document.content.fields.sourceUrl, title: document.content.title, excerpt: document.content.body.slice(0, 400), ...(!request.params.metadataOnly && poster ? { image: { data: poster.data, contentType: "image/png" } } : {}) };
      }
    }
    else if (request.method === "extractArticle") result = { sourceURL: request.params.sourceURL, markdown: "# Captured reading\n\nThe readable article is saved in this same file.", capturedAt: "2026-09-30T12:00:00Z" };
    else if (request.method === "agentStatus") result = { state: agentState, ...(agentState === "ready" ? { accountEmail: agentAccountEmail } : {}) };
    else if (request.method === "agentConnect") { agentState = "ready"; result = { state: agentState, accountEmail: agentAccountEmail }; }
    else if (request.method === "agentProposalResult") { proposalFeedback.push(request.params); result = {}; }
    else if (request.method === "agentCancel") {
      lastAgentCancel = request.params; result = {};
      await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail })), {
        type: "turn-cancelled", taskId: request.params.taskId, message: "Stopped. Your task is ready to send again.",
      });
    }
    else if (request.method === "agentSend") {
      agentSendCount++; lastAgentSend = request.params;
      result = {};
      if (request.params.customizing) {
        const current = files.get(request.params.path);
        const proposed = JSON.parse(current.templateJSON);
        proposed.name = request.params.prompt.startsWith("Refine") ? "Refined design" : "Proposed design";
        await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail })),
          { type: "template-proposal", taskId: request.params.taskId, path: current.path, hash: current.hash, templateJSON: JSON.stringify(proposed) });
      }
      if (holdAgentTurn) holdAgentTurn = false;
      else await page.evaluate((taskId) => {
          window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "final-text", taskId, text: "I can work with these local files." } }));
          window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "turn-completed", taskId } }));
        }, request.params.taskId);
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
      if (!request.params.sourcePath && (typeof request.params.body === "string" || request.params.title === "Untitled")) {
        const body = typeof request.params.body === "string" ? request.params.body : "";
        const document = makeDocument(body);
        document.content.title = request.params.title || "Untitled";
        if (request.params.sourceURL) document.content.fields.sourceUrl = request.params.sourceURL;
        result.documentJSON = JSON.stringify(document);
        result.markdown = `---\ntextTextId: "copy-${revision}"\ntitle: ${JSON.stringify(document.content.title)}\n---\n\n${body}`;
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
  await page.getByRole("button", { name: "Start with a template", exact: true }).click();
  await page.getByRole("region", { name: "Ready-to-use templates" }).getByRole("button", { name: "Agent made look", exact: true }).waitFor();
  await page.getByRole("region", { name: "Folders" }).getByRole("button", { name: /Empty/ }).click();
  await page.getByRole("heading", { name: "Empty", exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("texttext:vault-location:/test/Workspace") || "null")?.folder === "Empty");
  await page.reload();
  await page.getByRole("heading", { name: "Empty", exact: true }).waitFor();
  await page.getByRole("button", { name: "Start with a template", exact: true }).click();
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("heading", { name: "Your workspace", exact: true }).waitFor();
  await page.getByRole("button", { name: "Hide templates", exact: true }).click();
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
  await page.keyboard.press("Meta+k");
  const itemCommands = page.getByRole("dialog", { name: "Search and actions", exact: true });
  await itemCommands.getByRole("button", { name: "Add agent to this item", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await itemCommands.waitFor({ state: "hidden" });
  let addAgent = page.getByRole("button", { name: "Add agent", exact: true });
  await addAgent.focus();
  await page.keyboard.press("Enter");
  let agentPanel = page.getByRole("complementary", { name: "Add agent", exact: true });
  await agentPanel.waitFor();
  const expectAgentTarget = async (targetPath) => {
    await agentPanel.getByRole("group", { name: "Agent task target", exact: true }).getByText(targetPath, { exact: true }).waitFor();
    await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).waitFor();
  };
  await expectAgentTarget(initial.path);
  await agentPanel.getByRole("group", { name: "Agent task target", exact: true }).getByText("This item · Read and edit", { exact: true }).waitFor();
  await agentPanel.getByText("Codex uses your ChatGPT account. Authorization opens in your browser. Your request stays here while you sign in. You won’t need to paste a token or use Terminal.", { exact: true }).waitFor();
  assert.equal(await agentPanel.getByText(`Connected as ${agentAccountEmail}`, { exact: true }).count(), 0);
  const taskComposer = agentPanel.getByRole("textbox", { name: "Message assistant", exact: true });
  await taskComposer.fill("Read the selected file.");
  await agentPanel.getByRole("button", { name: "Connect Codex", exact: true }).click();
  await agentPanel.getByRole("button", { name: "Start task", exact: true }).waitFor();
  await agentPanel.getByText(`Connected as ${agentAccountEmail}`, { exact: true }).waitFor();
  assert.equal(await taskComposer.inputValue(), "Read the selected file.");
  await page.waitForFunction(() => Object.entries(localStorage).some(([key, value]) => key.startsWith("texttext:agent-task:") && JSON.parse(value).prompt === "Read the selected file."));
  assert.equal(agentSendCount, 0);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("texttext:agent-task:"));
    if (!key) throw new Error("Missing saved agent task");
    const task = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...task, phase: "submitted" }));
  });
  await page.reload();
  addAgent = page.getByRole("button", { name: "Add agent", exact: true });
  await addAgent.waitFor();
  await addAgent.focus();
  await page.keyboard.press("Enter");
  agentPanel = page.getByRole("complementary", { name: "Add agent", exact: true });
  await agentPanel.waitFor();
  assert.equal(await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).inputValue(), "Read the selected file.");
  await agentPanel.getByText(/was not sent again/).waitFor();
  await agentPanel.getByRole("button", { name: "Send again", exact: true }).waitFor();
  assert.equal(agentSendCount, 0);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector(".vault-app")?.classList.contains("sidebar-collapsed"));
  const narrowAgentLayout = await page.evaluate(() => {
    const panel = document.querySelector(".vault-assistant");
    const target = document.querySelector(".vault-assistant-setup");
    const account = document.querySelector(".vault-assistant-account");
    const composer = document.querySelector('.vault-assistant textarea[aria-label="Message assistant"]');
    const visibleAndClear = (element) => {
      if (!(element instanceof HTMLElement)) return { clear: false, box: null, hit: null };
      const box = element.getBoundingClientRect();
      const point = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { clear: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth &&
        box.top >= 0 && box.bottom <= innerHeight && Boolean(point && (point === element || element.contains(point))),
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, hit: point?.className ?? point?.tagName ?? null };
    };
    return { panelWidth: panel?.getBoundingClientRect().width ?? 0, target: visibleAndClear(target), account: visibleAndClear(account), composer: visibleAndClear(composer) };
  });
  assert.ok(narrowAgentLayout.panelWidth <= 390);
  assert.equal(narrowAgentLayout.target.clear, true, JSON.stringify(narrowAgentLayout));
  assert.equal(narrowAgentLayout.account.clear, true, JSON.stringify(narrowAgentLayout));
  assert.equal(narrowAgentLayout.composer.clear, true, JSON.stringify(narrowAgentLayout));
  await page.screenshot({ path: "/tmp/texttext-add-agent-narrow-dark.png" });
  await page.keyboard.press("Escape");
  await agentPanel.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Add agent");
  await page.keyboard.press("Enter");
  agentPanel = page.getByRole("complementary", { name: "Add agent", exact: true });
  await agentPanel.waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await agentPanel.getByRole("button", { name: "Send again", exact: true }).click();
  await page.getByText("I can work with these local files.").waitFor();
  assert.equal(agentSendCount, 1);
  assert.equal(lastAgentSend.path, initial.path);
  assert.equal(lastAgentSend.scope, "item");
  assert.equal(typeof lastAgentSend.taskId, "string");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("texttext:vault-agent", {
    detail: { type: "final-text", taskId: "different-task", text: "Late message from another task" },
  })));
  assert.equal(await page.getByText("Late message from another task", { exact: true }).count(), 0);
  holdAgentTurn = true;
  await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).fill("Keep this request after Stop.");
  await agentPanel.getByRole("button", { name: "Send", exact: true }).click();
  await agentPanel.getByRole("button", { name: "Stop", exact: true }).click();
  await agentPanel.getByText("Stopped. Your task is ready to send again.", { exact: true }).waitFor();
  assert.equal(await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).inputValue(), "Keep this request after Stop.");
  assert.equal(lastAgentCancel.scope, "item");
  assert.equal(lastAgentCancel.taskId, lastAgentSend.taskId);
  assert.equal(await agentPanel.getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
  // UI state-machine fixture only: genuine provider behavior is verified in the installed app.
  const beforeDesign = JSON.stringify(files.get(initial.path));
  holdAgentTurn = true;
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("textbox", { name: "Message assistant", exact: true }).fill("Propose a design");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const designPreview = page.getByRole("region", { name: "Design preview", exact: true });
  await designPreview.getByRole("button", { name: "Keep this design", exact: true }).waitFor();
  assert.equal(lastAgentSend.scope, "item");
  assert.equal(lastAgentSend.customizing, true);
  assert.equal(lastAgentSend.path, initial.path);
  assert.equal(JSON.stringify(files.get(initial.path)), beforeDesign);
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail })), {
    type: "template-proposal", taskId: lastAgentSend.taskId, proposalId: "invalid-fixture", path: initial.path, hash: files.get(initial.path).hash,
    templateJSON: JSON.stringify({ ...template, item: { type: "script", code: "bad" } }),
  });
  await page.getByText(/The proposed design needs a correction/).waitFor();
  assert.ok(proposalFeedback.some((feedback) => feedback.proposalId === "invalid-fixture" && feedback.valid === false && feedback.message.length > 0));
  assert.equal(JSON.stringify(files.get(initial.path)), beforeDesign);
  await page.evaluate(() => {
    const valid = JSON.parse(localStorage.getItem("texttext:design-preview:/test/Workspace"));
    window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { ...valid, type: "template-proposal", proposalId: "repaired-fixture" } }));
  });
  await page.getByText(/The proposed design needs a correction/).waitFor({ state: "hidden" });
  await page.evaluate((taskId) => window.dispatchEvent(new CustomEvent("texttext:vault-agent", {
    detail: { type: "turn-completed", taskId },
  })), lastAgentSend.taskId);
  await designPreview.getByRole("button", { name: "Compare original", exact: true }).click();
  await designPreview.getByRole("button", { name: "Show proposed design", exact: true }).click();
  await page.getByRole("textbox", { name: "Message assistant", exact: true }).fill("Refine this design");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("texttext:design-preview:/test/Workspace") || "{}").templateJSON?.includes("Refined design"));
  assert.equal(await page.getByText(/The proposed design needs a correction/).count(), 0);
  assert.equal(JSON.stringify(files.get(initial.path)), beforeDesign);
  await page.waitForFunction(() => { const button = [...document.querySelectorAll(".vault-design-preview button")].find((el) => el.textContent === "Keep this design"); return button && !button.disabled; });
  await page.screenshot({ path: "/tmp/texttext-template-preview-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-template-preview-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await designPreview.getByRole("button", { name: "Keep this design", exact: true }).click();
  await designPreview.waitFor({ state: "hidden" });
  assert.equal(JSON.parse(files.get(initial.path).templateJSON).name, "Refined design");
  assert.equal(files.get(initial.path).markdown, JSON.parse(beforeDesign).markdown);
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("textbox", { name: "Message assistant", exact: true }).fill("Propose another design");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await designPreview.getByRole("button", { name: "Cancel design", exact: true }).click();
  assert.equal(JSON.parse(files.get(initial.path).templateJSON).name, "Refined design");
  await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  addAgent = page.getByRole("button", { name: "Add agent", exact: true });
  await addAgent.click();
  agentPanel = page.getByRole("complementary", { name: "Add agent", exact: true });
  await agentPanel.waitFor();
  agentState = "disconnected";
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "status", state: "disconnected" } }));
  });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll(".vault-assistant button")].find((element) => element.textContent === "Send");
    return button instanceof HTMLButtonElement && button.disabled;
  });
  assert.equal(await agentPanel.getByRole("button", { name: "Send", exact: true }).isEnabled(), false);
  assert.equal(await agentPanel.getByText(`Connected as ${agentAccountEmail}`, { exact: true }).count(), 0);
  agentState = "ready";
  await page.evaluate((accountEmail) => {
    window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: { type: "status", state: "ready", accountEmail } }));
  }, agentAccountEmail);
  await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).fill("Keep this task fenced while the target changes.");
  holdAgentTurn = true;
  await agentPanel.getByRole("button", { name: "Send", exact: true }).click();
  const fencedTaskId = lastAgentSend.taskId;
  await page.getByRole("button", { name: "Show folders", exact: true }).click();
  await page.getByRole("combobox", { name: "Folder for new items", exact: true }).fill("Projects/Draft");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expectAgentTarget(initial.path);
  await agentPanel.getByRole("button", { name: "Stop", exact: true }).click();
  assert.equal(lastAgentCancel.taskId, fencedTaskId);
  await page.waitForFunction((previousPath) => {
    const current = document.querySelector('.vault-assistant-setup small')?.textContent;
    return Boolean(current && current !== previousPath);
  }, initial.path);
  const createdWhileOpen = await agentPanel.getByRole("group", { name: "Agent task target", exact: true }).locator("small").textContent();
  assert.ok(createdWhileOpen?.startsWith("Projects/Draft/"));
  assert.ok(files.has(createdWhileOpen));
  await expectAgentTarget(createdWhileOpen);
  assert.ok([...files.keys()].some((name) => name.startsWith("Projects/Draft/")));
  await page.getByRole("button", { name: "New from template", exact: true }).click();
  await page.getByRole("button", { name: "Agent made look", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const cloned = [...files.values()].at(-1);
  await expectAgentTarget(cloned.path);
  assert.equal(cloned.templateJSON, files.get("Templates/Agent look.textpack").templateJSON);
  assert.notEqual(cloned.markdown, files.get("Templates/Agent look.textpack").markdown);
  await page.getByRole("button", { name: "Rename or move", exact: true }).click();
  await page.getByRole("textbox", { name: "New file path", exact: true }).fill("Projects/Renamed.textpack");
  await page.getByRole("button", { name: "Save path", exact: true }).click();
  await page.getByRole("button", { name: "Projects/Renamed", exact: true }).waitFor();
  await expectAgentTarget("Projects/Renamed.textpack");
  assert.ok(files.has("Projects/Renamed.textpack"));
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("group", { name: "Confirm file deletion" }).getByText("Projects/Renamed.textpack", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete file", exact: true }).click();
  await page.locator(".vault-overview").waitFor();
  assert.ok(!files.has("Projects/Renamed.textpack"));
  await page.getByRole("button", { name: /Search and actions/ }).click();
  const commandDialog = page.getByRole("dialog", { name: "Search and actions", exact: true });
  await commandDialog.getByRole("button", { name: "New note", exact: true }).waitFor();
  await commandDialog.getByRole("button", { name: "Capture", exact: true }).waitFor();
  await commandDialog.getByRole("button", { name: "Customize this folder", exact: true }).waitFor();
  await page.getByRole("searchbox", { name: "Search workspace" }).fill("Their conflicting version");
  await commandDialog.getByRole("button", { name: /Notes\/Offline.textpack/ }).click();
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
  await expectAgentTarget(initial.path);
  assert.match(await body.innerText(), /Their conflicting version/);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("texttext:vault-location:/test/Workspace") || "null")?.path === "Notes/Offline.textpack");
  await page.reload();
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
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByLabel("Folder for new items", { exact: true }).fill("Visuals");
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  await page.getByLabel("Choose images", { exact: true }).setInputFiles({ name: "Original.gif", mimeType: "image/gif", buffer: gif });
  await page.getByRole("status").filter({ hasText: "Imported 1 image." }).waitFor();
  assert.equal(importedPacks.length, 1);
  await page.locator('.vault-file-preview').first().waitFor();
  assert.deepEqual(Buffer.from(importedPacks[0]["Document.textbundle/assets/original.gif"]), gif);
  const visual = [...files.values()].find((file) => file.path.startsWith("Visuals/Original-"));
  assert.ok(visual);
  const asset = JSON.parse(visual.documentJSON).content.assets[0];
  assert.equal(asset.poster, "assets/preview.png");
  assert.equal(asset.width, 1);
  assert.equal(asset.height, 1);
  assert.deepEqual([...importedPacks[0]["Document.textbundle/assets/preview.png"].slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await page.getByLabel("Folder design", { exact: true }).selectOption("texttext.folder-contact");
  await page.locator('.vault-folder-collection img[src^="blob:"]').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.vault-folder-collection img')].some((image) => image.naturalWidth > 0));
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  await page.getByRole("button", { name: visual.path.replace(/\.textpack$/, ""), exact: true }).click();
  await page.locator('main img[src^="blob:"]').first().waitFor();
  assert.equal(JSON.parse(visual.documentJSON).presentation.template.id, "texttext.gallery");
  assert.deepEqual(failures, []);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  for (const gesture of ["drop", "paste"]) {
    await page.evaluate(({ gesture, data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], `${gesture}.gif`, { type: "image/gif" }));
      const event = gesture === "drop" ? new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }) : new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
      document.querySelector(".vault-app").dispatchEvent(event);
    }, { gesture, data: gif.toString("base64") });
    await page.getByRole("button", { name: new RegExp(`${gesture}-`) }).first().waitFor();
    await page.getByRole("button", { name: "Import images…", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find((b) => b.textContent === "Import images…")?.disabled);
  }
  assert.equal(importedPacks.length, 3);
  assert.deepEqual(failures, []);
  assert.deepEqual(await page.evaluate(() => window.__networkAttempts), []);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  for (let index = 0; index < 30; index++) files.set(`Large/Note ${index}.textpack`, { ...initial, path: `Large/Note ${index}.textpack` });
  await page.evaluate(() => window.dispatchEvent(new Event("texttext:vault-changed")));
  await page.getByRole("navigation", { name: "File pages" }).waitFor();
  assert.equal(await page.locator(".vault-document-grid > button").count(), 24);
  await page.getByRole("navigation", { name: "File pages" }).getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Page 2 of 2", { exact: true }).waitFor();
  assert.ok(await page.locator(".vault-document-grid > button").count() <= 24);
  assert.deepEqual(failures, []);
  const referenceFixture = files.get("Large/Note 0.textpack");
  const referenceDocument = JSON.parse(referenceFixture.documentJSON);
  referenceDocument.content.fields.sourceUrl = "https://www.figma.com/blog/how-figmas-multiplayer-technology-works/";
  files.set(referenceFixture.path, { ...referenceFixture, documentJSON: JSON.stringify(referenceDocument) });
  await page.getByRole("region", { name: "Folders", exact: true }).getByRole("button", { name: /Large/ }).click();
  const membersBefore = JSON.stringify([...files].filter(([path]) => path.startsWith("Large/")));
  await page.getByLabel("Folder design", { exact: true }).selectOption("texttext.folder-reference");
  await page.getByRole("table").waitFor();
  assert.equal(files.has("Large/Folder view.textpack"), false);
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  assert.equal(files.has("Large/Folder view.textpack"), false);
  await page.getByLabel("Folder design", { exact: true }).selectOption("texttext.folder-reference");
  await page.getByRole("button", { name: "Keep folder design", exact: true }).click();
  await page.getByRole("button", { name: "Customize folder", exact: true }).waitFor();
  assert.equal(JSON.stringify([...files].filter(([path]) => path.startsWith("Large/") && !path.endsWith("Folder view.textpack"))), membersBefore);
  assert.equal(JSON.parse(files.get("Large/Folder view.textpack").documentJSON).content.fields.texttextFolderView, "v1");
  await page.screenshot({ path: "/tmp/texttext-folder-reference-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-folder-reference-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("region", { name: "Folders", exact: true }).getByRole("button", { name: /Large/ }).click();
  await page.getByRole("table").waitFor();
  assert.equal(await page.getByRole("table").getByText("Folder view", { exact: true }).count(), 0);
  await page.getByLabel("Folder design", { exact: true }).selectOption("texttext.folder-reading");
  await page.locator('.vault-folder-collection[data-layout="list"]').waitFor();
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  await page.getByLabel("Folder design", { exact: true }).selectOption("texttext.folder-contact");
  await page.locator('.vault-folder-collection[data-layout="cards"]').waitFor();
  const existingView = files.get("Large/Folder view.textpack");
  files.set(existingView.path, { ...existingView, hash: "concurrent-folder-change" });
  await page.evaluate(() => window.dispatchEvent(new Event("texttext:vault-changed")));
  await page.getByRole("button", { name: "Keep folder design", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "The folder design changed" }).waitFor();
  assert.equal(files.get(existingView.path).templateJSON, existingView.templateJSON);
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  const beforeFolderProposal = JSON.stringify(files.get(existingView.path));
  await page.getByRole("button", { name: "Customize folder", exact: true }).click();
  await page.getByRole("textbox", { name: "Message assistant", exact: true }).fill("Propose a folder design");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await designPreview.getByRole("table").waitFor();
  assert.equal(JSON.stringify(files.get(existingView.path)), beforeFolderProposal);
  await designPreview.getByRole("navigation", { name: "File pages" }).getByRole("button", { name: "Next", exact: true }).click();
  await designPreview.getByText("Page 2 of 2", { exact: true }).waitFor();
  await designPreview.getByRole("button", { name: "Keep this design", exact: true }).click();
  await designPreview.waitFor({ state: "hidden" });
  assert.equal(JSON.parse(files.get(existingView.path).templateJSON).name, "Proposed design");
  assert.equal(JSON.stringify([...files].filter(([path]) => path.startsWith("Large/") && !path.endsWith("Folder view.textpack"))), membersBefore);
  assert.deepEqual(failures, []);
  // Recovery preview is read-only; restoring preserves the complete retained pack.
  const liveBeforeRecovery = JSON.stringify([...files]);
  await page.getByRole("button", { name: "Trash and recovery", exact: true }).click();
  const recoveryDialog = page.getByRole("dialog", { name: "Trash and recovery", exact: true });
  await recoveryDialog.getByRole("button", { name: /Notes\/Offline.textpack/ }).click();
  await recoveryDialog.getByText("First line\nSecond line", { exact: true }).waitFor();
  assert.equal(JSON.stringify([...files]), liveBeforeRecovery);
  await page.screenshot({ path: "/tmp/texttext-recovery-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-recovery-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await recoveryDialog.getByRole("button", { name: "Close recovery" }).click();
  assert.equal(JSON.stringify([...files]), liveBeforeRecovery);
  await page.getByRole("button", { name: "Trash and recovery", exact: true }).click();
  await recoveryDialog.getByRole("button", { name: /Notes\/Offline.textpack/ }).click();
  await recoveryDialog.getByRole("button", { name: "Restore as a new file" }).click();
  await recoveryDialog.waitFor({ state: "hidden" });
  const recoveredFile = [...files.values()].find((file) => file.path.startsWith("Recovered/Offline note (recovered)"));
  assert.ok(recoveredFile);
  assert.deepEqual(importedPacks.at(-1), retainedEntries);
  assert.equal(JSON.stringify([...files].filter(([path]) => path !== recoveredFile.path)), liveBeforeRecovery);
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const versions = page.getByRole("dialog", { name: "Version history", exact: true });
  await versions.getByText("Saved revision", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await versions.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  await versions.waitFor();
  await versions.getByRole("button", { name: "Close recovery" }).click();
  await versions.waitFor({ state: "hidden" });
  assert.equal(await page.locator("dialog.vault-recovery").count(), 0);
  await page.getByRole("textbox", { name: "Title", exact: true }).waitFor();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Document body");
  const newNotePath = [...files.keys()].at(-1);
  assert.ok(newNotePath);
  assert.equal(JSON.parse(files.get(newNotePath).documentJSON).content.body, "");
  await page.keyboard.insertText("Typing starts in the new note.");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  assert.match(files.get(newNotePath).markdown, /Typing starts in the new note\./);
  await page.getByRole("button", { name: "Notes/Offline", exact: true }).click();
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Document body");
  const closeAssistant = page.getByRole("button", { name: "Close assistant" });
  if (await closeAssistant.isVisible()) await closeAssistant.click();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole("button", { name: "Hide folders" }).click();
  await page.getByRole("button", { name: "Show folders" }).waitFor();
  assert.equal(await page.locator(".vault-sidebar").isVisible(), false);
  assert.equal(await page.locator(".vault-app > main").evaluate((main) => Math.round(main.getBoundingClientRect().width)), 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const narrowTitle = await page.getByRole("textbox", { name: "Title", exact: true }).evaluate((element) => ({
    height: element.clientHeight, scrollHeight: element.scrollHeight,
    font: getComputedStyle(element).font, overflow: getComputedStyle(element).overflow,
  }));
  assert.ok(narrowTitle.height >= narrowTitle.scrollHeight - 1, "narrow title fits without clipping");
  await page.screenshot({ path: "/tmp/texttext-narrow-note-light.png" });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.screenshot({ path: "/tmp/texttext-narrow-note-dark.png" });
  await page.getByRole("button", { name: "Show folders" }).click();
  assert.equal(await page.locator(".vault-sidebar").isVisible(), true);
  assert.equal(await page.locator(".vault-app > main").evaluate((main) => Math.round(main.getBoundingClientRect().width)), 390);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".vault-sidebar").isVisible(), false);
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Show folders");
  assert.equal(await page.evaluate(() => localStorage.getItem("texttext:vault-sidebar-open")), "false");
  await page.reload();
  await page.getByRole("button", { name: "Show folders" }).waitFor();
  assert.equal(await page.locator(".vault-sidebar").isVisible(), false);
  assert.deepEqual(failures, []);
  console.log("New note focused its body for immediate typing; reopening another note kept the user's focus.");
  console.log("Recovery preview/cancel, full pack restore as copy, and version history passed.");
  console.log("Bounded folder previews and pagination passed.");
  console.log("Image picker, folder drop/paste and embedded GIF still preview passed.");
  console.log("Narrow folder drawer, full-width editor, remembered collapse, keyboard escape and reduced-motion render passed.");
  console.log("Offline vault UI passed: file save, raw agent refresh, conflict copy, zero HTTP/fetch calls.");
} finally { await browser.close(); }
