import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { chromium } from "playwright";
import sharp from "sharp";

const makeDocument = (body) => ({ schemaVersion: 1, content: { title: "Offline note", body, fields: {}, tags: [], assets: [] }, presentation: { template: { id: "texttext.note", version: 1 }, theme: {} } });
const files = new Map();
const proposalFeedback = [];
const history = new Map();
const importedPacks = [];
let revision = 1;
let connected = false, openedWeb = false, agentState = "signed-out", agentSendCount = 0, agentDisconnectCount = 0, lastAgentSend = null, lastAgentCancel = null, holdAgentTurn = false;
let nextCreatedPath = null, delayedRemoval = null;
let storyItemId = null;
const agentAccountEmail = "writer@example.test";
const workspaceId = "7a32c401-f041-4bc1-bbfd-f60317797873";
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
    let result, error, confirmsDelayedRemoval = false;
    if (request.method === "list" || request.method === "open") {
      result = { root: "/test/Workspace", folders: ["Empty", "Feeds"], items: [...files.values()].map((file) => ({ path: file.path })) };
      if (request.method === "list" && delayedRemoval?.confirming) {
        delayedRemoval.confirming = false;
        confirmsDelayedRemoval = true;
      }
    }
    else if (request.method === "folderViews") result = { files: [...files.values()].filter((file) => file.path.split("/").slice(0, -1).join("/") === request.params.folder && JSON.parse(file.documentJSON).content.fields.texttextFolderView) };
    else if (request.method === "collaborationConfig") result = null;
    else if (request.method === "connection" || request.method === "connect" || request.method === "sync") {
      if (request.method === "connect") connected = true;
      result = { connected, available: true, ...(connected ? { webURL: "https://example.test/vault/workspace", workspaceId } : {}) };
    } else if (request.method === "openWeb") { openedWeb = true; result = {}; }
    else if (request.method === "search") result = { items: [...files.values()].filter((file) => file.markdown.toLowerCase().includes(request.params.query.toLowerCase())).map((file) => ({ path: file.path, title: file.path, snippet: "Matched in file" })), truncated: false };
    else if (request.method === "read" || request.method === "template") {
      const removal = delayedRemoval;
      if (request.method === "read" && removal?.path === request.params.path && !files.has(request.params.path)) {
        removal.started();
        await removal.wait;
        removal.confirming = true;
      }
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
        const images = (file.assets ?? []).filter((asset) => asset.contentType.startsWith("image/")).slice(0, 8).map((asset) => ({ data: asset.data, contentType: asset.contentType }));
        result = { document, sourceURL: document.content.fields.sourceUrl, title: document.content.title, excerpt: document.content.body.slice(0, 400), ...(!request.params.metadataOnly ? { ...(poster ? { image: { data: poster.data, contentType: "image/png" } } : {}), ...(images.length ? { images } : {}) } : {}) };
      }
    }
    else if (request.method === "extractArticle") result = { sourceURL: request.params.sourceURL, markdown: "# Captured reading\n\nThe readable article is saved in this same file.", capturedAt: "2026-09-30T12:00:00Z" };
    else if (request.method === "feedRead") result = { feedURL: request.params.feedURL, title: "Design feed", fetchedAt: "2026-10-02T00:00:00Z", availableCount: 5, truncated: false,
      entries: Array.from({ length: 5 }, (_, index) => ({ externalKey: `story-${index + 1}`, title: index ? `Design headline ${index + 1}` : "A considered design headline", permalink: `https://example.com/story/${index + 1}`, authors: ["Editor"], publishedAt: `2026-10-0${index + 1}T00:00:00Z`, availability: "excerpt", excerpt: "A brief account of the story.", bodyPreview: "A brief account of the story.", imageUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#5d7890"/><circle cx="235" cy="130" r="78" fill="#eac183"/></svg>')}` })) };
    else if (request.method === "feedEntry") result = { feedURL: request.params.feedURL, feedTitle: "Design feed", entry: { externalKey: request.params.externalKey, declaredId: null, title: "A considered design headline", permalink: "https://example.com/story/1", externalUrl: null, authors: ["Editor"], publishedAt: "2026-10-01T00:00:00Z", updatedAt: null, availability: "full", bodyMarkdown: "A full in-app reading view for this story.", bodyText: "A full in-app reading view for this story.", excerpt: "A brief account of the story.", language: "en", attachments: [] } };
    else if (request.method === "publicationRead") {
      const story = files.get("Blog/Story.textpack");
      if (request.params.itemId === storyItemId && story) result = { itemId: storyItemId, revision: story.hash, published: false, publishedAt: null,
        publicPath: `/v/${workspaceId}/${storyItemId}`, canPublish: true };
      else result = { itemId: request.params.itemId, revision: "0".repeat(64), published: false, publishedAt: null,
        publicPath: `/v/${workspaceId}/${request.params.itemId}`, canPublish: false };
    }
    else if (request.method === "agentStatus") result = { state: agentState, ...(agentState === "ready" ? { accountEmail: agentAccountEmail } : {}) };
    else if (request.method === "agentConnect") { agentState = "ready"; result = { state: agentState, accountEmail: agentAccountEmail }; }
    else if (request.method === "agentDisconnect") { agentDisconnectCount++; agentState = "disconnected"; result = { state: agentState }; }
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
        if (request.method === "rename") {
          result = { ...current, path: request.params.newPath }; files.set(result.path, result);
          if (delayedRemoval?.path === current.path) await page.evaluate(() => window.dispatchEvent(new Event("texttext:vault-changed")));
        }
        else result = {};
      }
    } else if (request.method === "create") {
      const createRevision = ++revision;
      const name = nextCreatedPath ?? `${request.params.folder || "Notes"}/Copy-${createRevision}.textpack`;
      nextCreatedPath = null;
      result = { ...(request.params.sourcePath ? (files.get(request.params.sourcePath) ?? history.get(request.params.sourceHash)) : initial), path: name, hash: String(createRevision) };
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
    if (confirmsDelayedRemoval) delayedRemoval?.confirmed();
  });
  await page.addInitScript(() => {
    window.__networkAttempts = [];
    window.fetch = (...arguments_) => { window.__networkAttempts.push(String(arguments_[0])); return Promise.reject(new Error("Offline test forbids fetch")); };
    window.webkit = { messageHandlers: { localVault: { postMessage: (request) => { void window.nativeVaultRequest(request); } } } };
  });
  await page.goto(pathToFileURL(path.resolve("mac/build/LocalVault/index.html")).href);
  const moreActionsMenu = page.locator(".vault-context-menu-items");
  const openMoreActions = async () => {
    const details = page.locator("details.vault-context-menu");
    if (!(await details.evaluate((element) => element.open))) await details.getByLabel("More actions", { exact: true }).click();
    await moreActionsMenu.waitFor();
  };
  const chooseMoreAction = async (name) => {
    await openMoreActions();
    await moreActionsMenu.getByRole("button", { name, exact: true }).click();
  };
  const folderNavigation = page.getByRole("navigation", { name: "Folders", exact: true });
  const chooseFolder = async (name) => folderNavigation.locator("summary").filter({ hasText: name }).first().click();
  const sidebar = page.locator(".vault-sidebar");
  assert.equal(await sidebar.getByRole("button", { name: "New note", exact: true }).count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: "New from template", exact: true }).count(), 0);
  assert.equal(await sidebar.getByRole("button", { name: "Trash and recovery", exact: true }).count(), 0);
  assert.equal(await page.locator("main .vault-folder-grid").count(), 0);
  assert.equal(await folderNavigation.locator("summary").filter({ hasText: "Empty" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "New note", exact: true }).count(), 1);
  await page.locator("details.vault-context-menu").getByLabel("More actions", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await moreActionsMenu.getByRole("button", { name: "New from template", exact: true }).waitFor();
  await moreActionsMenu.getByRole("button", { name: "Capture a link or note", exact: true }).waitFor();
  await moreActionsMenu.getByRole("button", { name: "Import images…", exact: true }).waitFor();
  await moreActionsMenu.getByRole("button", { name: "Import file…", exact: true }).waitFor();
  await moreActionsMenu.getByRole("button", { name: "Trash and recovery", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await moreActionsMenu.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "More actions");
  await chooseMoreAction("New from template");
  const newFromTemplate = page.getByRole("dialog", { name: "New from template", exact: true });
  await newFromTemplate.getByRole("button", { name: "Agent made look", exact: true }).waitFor();
  await newFromTemplate.getByRole("button", { name: "Close", exact: true }).click();
  await chooseFolder("Empty");
  await page.getByRole("heading", { name: "Empty", exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("texttext:vault-location:/test/Workspace") || "null")?.folder === "Empty");
  await page.reload();
  await page.getByRole("heading", { name: "Empty", exact: true }).waitFor();
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  await page.getByRole("heading", { name: "All files", exact: true }).waitFor();
  const searchTrigger = page.getByRole("button", { name: /Search and actions/ });
  await searchTrigger.hover();
  await page.locator(".vault-search-trigger kbd").waitFor({ state: "visible" });
  await searchTrigger.click();
  await page.getByRole("dialog", { name: "Search and actions", exact: true }).waitFor();
  assert.equal(await page.getByRole("option", { name: "New note", exact: true }).locator("kbd").textContent(), "N");
  assert.equal(await page.getByRole("option", { name: "Write a story", exact: true }).locator("kbd").textContent(), "C");
  assert.equal(await page.getByRole("option", { name: "Save bookmark", exact: true }).locator("kbd").textContent(), "B");
  await page.screenshot({ path: "/tmp/texttext-command-reference.png" });
  await page.keyboard.press("Meta+k");
  await page.getByRole("dialog", { name: "Search and actions", exact: true }).waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.classList.contains("vault-search-trigger"));
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox", { name: "Search workspace" }).waitFor();
  await page.getByRole("combobox", { name: "Search workspace" }).fill("bokmark");
  await page.getByRole("option", { name: "Save bookmark", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Search workspace" }).fill("oepn");
  await page.getByRole("option", { name: "Open another folder", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Search workspace" }).fill("");
  await page.getByRole("combobox", { name: "Search workspace" }).press("ArrowDown");
  assert.equal(await page.getByRole("combobox", { name: "Search workspace" }).getAttribute("aria-activedescendant"), "action:write-story");
  await page.getByRole("combobox", { name: "Search workspace" }).fill("save bookmark");
  await page.getByRole("option", { name: "Save bookmark", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Search workspace" }).press("Enter");
  await page.getByRole("dialog", { name: "Save bookmark" }).waitFor();
  await page.getByRole("dialog", { name: "Save bookmark" }).getByRole("button", { name: "Cancel" }).click();
  await searchTrigger.click();
  await page.getByRole("combobox", { name: "Search workspace" }).fill("Offline");
  await page.locator('#vault-command-results [id^="file:"]').first().waitFor();
  await page.getByRole("combobox", { name: "Search workspace" }).fill("no-matching-file-987654");
  assert.equal(await page.locator('#vault-command-results [id^="file:"]').count(), 0);
  await page.locator(".vault-search-backdrop").click({ position: { x: 4, y: 4 } });
  await page.getByRole("dialog", { name: "Search and actions", exact: true }).waitFor({ state: "hidden" });
  await page.keyboard.press("b");
  await page.getByRole("dialog", { name: "Save bookmark" }).waitFor();
  await page.getByRole("dialog", { name: "Save bookmark" }).getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("/");
  await page.getByRole("dialog", { name: "Search and actions", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Search and actions", exact: true }).waitFor({ state: "hidden" });
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
  await page.keyboard.press("Meta+k");
  const connectedCommands = page.getByRole("dialog", { name: "Search and actions", exact: true });
  await connectedCommands.getByRole("option", { name: "Add source", exact: true }).waitFor();
  await connectedCommands.getByRole("option", { name: "Trash and recovery", exact: true }).waitFor();
  await connectedCommands.getByRole("combobox", { name: "Search workspace" }).fill("Offline note");
  await connectedCommands.getByRole("option", { name: /Notes\/Offline.textpack/ }).click();
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
  await page.locator(".tt-editor-more").getByLabel("More actions", { exact: true }).click();
  await page.getByRole("button", { name: "Save as look", exact: true }).click();
  await page.getByRole("textbox", { name: "Name this look", exact: true }).fill("Saved local look");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.getByText(/Saved in Templates\//).waitFor();
  assert.ok([...files.values()].some((file) => file.path.startsWith("Templates/") && JSON.parse(file.templateJSON).name === "Saved local look"));
  await page.keyboard.press("Meta+k");
  const itemCommands = page.getByRole("dialog", { name: "Search and actions", exact: true });
  await itemCommands.getByRole("option", { name: "Add agent to this item", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await itemCommands.waitFor({ state: "hidden" });
  let addAgent = page.getByRole("button", { name: "Add agent", exact: true });
  await addAgent.click();
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
  await addAgent.click();
  agentPanel = page.getByRole("complementary", { name: "Add agent", exact: true });
  await agentPanel.waitFor();
  assert.equal(await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).inputValue(), "Read the selected file.");
  await agentPanel.getByText(/was not sent again/).waitFor();
  await agentPanel.getByRole("button", { name: "Send again", exact: true }).waitFor();
  assert.equal(agentSendCount, 0);
  await agentPanel.getByRole("button", { name: "Disconnect", exact: true }).click();
  await agentPanel.getByRole("button", { name: "Connect Codex", exact: true }).waitFor();
  assert.equal(agentDisconnectCount, 1);
  assert.equal(await agentPanel.getByText(`Connected as ${agentAccountEmail}`, { exact: true }).count(), 0);
  assert.equal(await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).inputValue(), "Read the selected file.");
  assert.equal(agentSendCount, 0);
  await agentPanel.getByRole("button", { name: "Connect Codex", exact: true }).click();
  await agentPanel.getByRole("button", { name: "Disconnect", exact: true }).waitFor();
  assert.equal(await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).inputValue(), "Read the selected file.");
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
  await agentPanel.getByRole("button", { name: "Start task", exact: true }).click();
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
  assert.equal(await agentPanel.getByRole("button", { name: "Disconnect", exact: true }).isDisabled(), true);
  await agentPanel.getByRole("button", { name: "Stop", exact: true }).click();
  await agentPanel.getByText("Stopped. Your task is ready to send again.", { exact: true }).waitFor();
  assert.equal(await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).inputValue(), "Keep this request after Stop.");
  assert.equal(lastAgentCancel.scope, "item");
  assert.equal(lastAgentCancel.taskId, lastAgentSend.taskId);
  assert.equal(await agentPanel.getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
  // UI state-machine fixture only: genuine provider behavior is verified in the installed app.
  const beforeDesign = JSON.stringify(files.get(initial.path));
  holdAgentTurn = true;
  await chooseMoreAction("Customize");
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
  await chooseMoreAction("Customize");
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
  nextCreatedPath = "Notes/Untitled 2.textpack";
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expectAgentTarget(initial.path);
  await agentPanel.getByRole("button", { name: "Stop", exact: true }).click();
  assert.equal(lastAgentCancel.taskId, fencedTaskId);
  await page.waitForFunction((previousPath) => {
    const current = document.querySelector('.vault-assistant-setup small')?.textContent;
    return Boolean(current && current !== previousPath);
  }, initial.path);
  const createdWhileOpen = await agentPanel.getByRole("group", { name: "Agent task target", exact: true }).locator("small").textContent();
  assert.equal(createdWhileOpen, "Notes/Untitled 2.textpack");
  assert.ok(files.has(createdWhileOpen));
  await expectAgentTarget(createdWhileOpen);
  let releaseRemoval, markRemovalStarted, markRemovalConfirmed;
  const removalStarted = new Promise((resolve) => { markRemovalStarted = resolve; });
  const removalConfirmed = new Promise((resolve) => { markRemovalConfirmed = resolve; });
  delayedRemoval = {
    path: createdWhileOpen,
    wait: new Promise((resolve) => { releaseRemoval = resolve; }),
    started: markRemovalStarted,
    confirmed: markRemovalConfirmed,
    confirming: false,
  };
  const renamedWhileOpen = "Notes/Agent panel retarget 1145.textpack";
  await chooseMoreAction("Rename or move");
  await page.getByRole("textbox", { name: "New file path", exact: true }).fill(renamedWhileOpen);
  await page.getByRole("button", { name: "Save path", exact: true }).click();
  await removalStarted;
  await page.locator(`.vault-context-header h2[title="${renamedWhileOpen}"]`).waitFor();
  await expectAgentTarget(renamedWhileOpen);
  releaseRemoval();
  await removalConfirmed;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator(`.vault-context-header h2[title="${renamedWhileOpen}"]`).count(), 1);
  assert.equal(await agentPanel.getByRole("group", { name: "Agent task target", exact: true }).getByText(renamedWhileOpen, { exact: true }).count(), 1);
  assert.equal(await agentPanel.getByRole("textbox", { name: "Message assistant", exact: true }).count(), 1);
  assert.ok(files.has(renamedWhileOpen));
  assert.ok(!files.has(createdWhileOpen));
  delayedRemoval = null;
  await page.keyboard.press("Meta+k");
  await page.getByRole("dialog", { name: "Search and actions", exact: true }).getByRole("option", { name: "New from template", exact: true }).click();
  await page.getByRole("dialog", { name: "New from template", exact: true }).getByRole("button", { name: "Agent made look", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const cloned = [...files.values()].at(-1);
  await expectAgentTarget(cloned.path);
  assert.equal(cloned.templateJSON, files.get("Templates/Agent look.textpack").templateJSON);
  assert.notEqual(cloned.markdown, files.get("Templates/Agent look.textpack").markdown);
  await chooseMoreAction("Rename or move");
  await page.getByRole("textbox", { name: "New file path", exact: true }).fill("Projects/Renamed.textpack");
  await page.getByRole("button", { name: "Save path", exact: true }).click();
  await page.locator('.vault-context-header h2[title="Projects/Renamed.textpack"]').waitFor();
  await expectAgentTarget("Projects/Renamed.textpack");
  assert.ok(files.has("Projects/Renamed.textpack"));
  await chooseMoreAction("Delete");
  await page.getByRole("group", { name: "Confirm file deletion" }).getByText("Projects/Renamed.textpack", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete file", exact: true }).click();
  await page.locator(".vault-overview").waitFor();
  assert.ok(!files.has("Projects/Renamed.textpack"));
  await page.getByRole("button", { name: /Search and actions/ }).click();
  const commandDialog = page.getByRole("dialog", { name: "Search and actions", exact: true });
  await commandDialog.getByRole("option", { name: "New note", exact: true }).waitFor();
  await commandDialog.getByRole("option", { name: "Capture", exact: true }).waitFor();
  await commandDialog.getByRole("option", { name: "New from template", exact: true }).waitFor();
  await commandDialog.getByRole("option", { name: "Add images", exact: true }).waitFor();
  await commandDialog.getByRole("option", { name: "Import file", exact: true }).waitFor();
  await commandDialog.getByRole("option", { name: "Choose folder design", exact: true }).waitFor();
  await commandDialog.getByRole("option", { name: "Trash and recovery", exact: true }).waitFor();
  await commandDialog.getByRole("option", { name: "Customize this folder", exact: true }).waitFor();
  assert.ok(await commandDialog.locator(".vault-command-icon").count() >= 5);
  const commandBox = await commandDialog.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(commandBox && viewport && Math.abs(commandBox.y + commandBox.height / 2 - viewport.height / 2) < 35);
  await page.screenshot({ path: "/tmp/texttext-command-reference.png" });
  await page.getByRole("combobox", { name: "Search workspace" }).fill("Their conflicting version");
  await commandDialog.getByRole("option", { name: /Notes\/Offline.textpack/ }).click();
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
  await expectAgentTarget(initial.path);
  assert.match(await body.innerText(), /Their conflicting version/);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("texttext:vault-location:/test/Workspace") || "null")?.path === "Notes/Offline.textpack");
  await page.reload();
  await page.getByRole("textbox", { name: "Document body", exact: true }).waitFor();
  assert.match(await body.innerText(), /Their conflicting version/);
  await page.keyboard.press("Meta+k");
  await page.getByRole("dialog", { name: "Search and actions", exact: true }).getByRole("option", { name: "Capture", exact: true }).click();
  await page.getByRole("textbox", { name: "Link or note", exact: true }).fill("https://example.com/capture");
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: "/tmp/texttext-vault-capture-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "/tmp/texttext-vault-capture-dark.png" });
  await page.getByRole("button", { name: "Save to folder", exact: true }).click();
  await page.getByRole("dialog", { name: "Save a link or note" }).waitFor({ state: "hidden" });
  await page.screenshot({ path: "/tmp/texttext-after-capture-reference.png" });
  await page.getByRole("article", { name: "Bookmark reader" }).getByRole("button", { name: "Edit" }).click();
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
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  await page.locator("main .vault-document-grid > button").filter({ hasText: "example.com" }).click();
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
  await page.getByRole("button", { name: "TextText", exact: true }).click();
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
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  await openMoreActions();
  await page.getByLabel("Current folder", { exact: true }).fill("Visuals");
  await page.keyboard.press("Escape");
  await moreActionsMenu.waitFor({ state: "hidden" });
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
  await chooseMoreAction("Choose folder design");
  await page.getByLabel("Folder design", { exact: true }).selectOption("texttext.folder-contact");
  await page.locator('.vault-folder-collection img[src^="blob:"]').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.vault-folder-collection img')].some((image) => image.naturalWidth > 0));
  await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
  await page.locator("main .vault-document-grid > button").filter({ hasText: "Original" }).click();
  await page.locator('main img[src^="blob:"]').first().waitFor();
  assert.equal(JSON.parse(visual.documentJSON).presentation.template.id, "texttext.gallery");
  assert.deepEqual(failures, []);
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  for (const gesture of ["drop", "paste"]) {
    await page.evaluate(({ gesture, data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], `${gesture}.gif`, { type: "image/gif" }));
      const event = gesture === "drop" ? new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }) : new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
      document.querySelector(".vault-app").dispatchEvent(event);
    }, { gesture, data: gif.toString("base64") });
    await page.getByRole("button", { name: new RegExp(`${gesture}-`) }).first().waitFor();
    await page.keyboard.press("Meta+k");
    await page.getByRole("dialog", { name: "Search and actions", exact: true }).getByRole("option", { name: "Add images", exact: true }).waitFor();
    await page.keyboard.press("Escape");
  }
  assert.equal(importedPacks.length, 3);
  assert.deepEqual(failures, []);
  assert.deepEqual(await page.evaluate(() => window.__networkAttempts), []);
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  for (let index = 0; index < 30; index++) files.set(`Large/Note ${index}.textpack`, { ...initial, path: `Large/Note ${index}.textpack` });
  const referenceFixture = files.get("Large/Note 0.textpack");
  const referenceDocument = JSON.parse(referenceFixture.documentJSON);
  referenceDocument.content.fields.sourceUrl = "https://www.figma.com/blog/how-figmas-multiplayer-technology-works/";
  files.set(referenceFixture.path, { ...referenceFixture, documentJSON: JSON.stringify(referenceDocument) });
  await page.evaluate(() => window.dispatchEvent(new Event("texttext:vault-changed")));
  await page.getByRole("navigation", { name: "File pages" }).waitFor();
  assert.equal(await page.locator(".vault-document-grid > button").count(), 24);
  await page.getByRole("navigation", { name: "File pages" }).getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Page 2 of 2", { exact: true }).waitFor();
  assert.ok(await page.locator(".vault-document-grid > button").count() <= 24);
  assert.deepEqual(failures, []);
  await chooseFolder("Large");
  const membersBefore = JSON.stringify([...files].filter(([path]) => path.startsWith("Large/")));
  await chooseMoreAction("Choose folder design");
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
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  await chooseFolder("Large");
  await page.getByRole("table").waitFor();
  assert.equal(await page.getByRole("table").getByText("Folder view", { exact: true }).count(), 0);
  await chooseMoreAction("Choose folder design");
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
  await chooseMoreAction("Trash and recovery");
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
  await chooseMoreAction("Trash and recovery");
  await recoveryDialog.getByRole("button", { name: /Notes\/Offline.textpack/ }).click();
  await recoveryDialog.getByRole("button", { name: "Restore as a new file" }).click();
  await recoveryDialog.waitFor({ state: "hidden" });
  const recoveredFile = [...files.values()].find((file) => file.path.startsWith("Recovered/Offline note (recovered)"));
  assert.ok(recoveredFile);
  assert.deepEqual(importedPacks.at(-1), retainedEntries);
  assert.equal(JSON.stringify([...files].filter(([path]) => path !== recoveredFile.path)), liveBeforeRecovery);
  await chooseMoreAction("Version history");
  const versions = page.getByRole("dialog", { name: "Version history", exact: true });
  await versions.getByText("Saved revision", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await versions.waitFor({ state: "hidden" });
  await chooseMoreAction("Version history");
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
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  assert.match(files.get(newNotePath).markdown, /Typing starts in the new note\./);
  await page.keyboard.press("Meta+k");
  const reopenCommands = page.getByRole("dialog", { name: "Search and actions", exact: true });
  await reopenCommands.getByRole("combobox", { name: "Search workspace" }).fill("Their conflicting version");
  await reopenCommands.getByRole("option", { name: /Notes\/Offline.textpack/ }).click();
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
  const narrowHeader = await page.locator(".vault-context-header").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width, scrollWidth: element.scrollWidth };
  });
  assert.deepEqual(narrowHeader, { left: 0, right: 390, width: 390, scrollWidth: 390 });
  const contextMore = page.locator("details.vault-context-menu").getByLabel("More actions", { exact: true });
  await contextMore.focus();
  await page.keyboard.press("Enter");
  const narrowMenu = await moreActionsMenu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  assert.ok(narrowMenu.left >= 0 && narrowMenu.right <= 390 && narrowMenu.top >= 0 && narrowMenu.bottom <= 780, JSON.stringify(narrowMenu));
  await page.screenshot({ path: "/tmp/texttext-quiet-shell-narrow-dark.png" });
  await page.keyboard.press("Escape");
  await moreActionsMenu.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "More actions");
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
  const sample = (path, kind, title, body, fields = {}, assets = []) => {
    const document = { schemaVersion: 1, content: { title, body, fields, tags: [], assets }, presentation: { template: { id: `texttext.${kind}`, version: 1 }, theme: {} } };
    return { path, hash: `sample-${path}`, markdown: `---\ntextTextId: "${crypto.randomUUID()}"\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`, documentJSON: JSON.stringify(document) };
  };
  files.set("Bookmarks/Reading.textpack", sample("Bookmarks/Reading.textpack", "bookmark", "A saved article", "The complete saved reading text.", { sourceUrl: "https://example.com/article" }));
  files.set("Bookmarks/Another.textpack", sample("Bookmarks/Another.textpack", "bookmark", "Another saved link", "A second reading item.", { sourceUrl: "https://example.org/another" }));
  for (let index = 0; index < 25; index++) {
    const name = `Z filler ${String(index).padStart(2, "0")}`;
    files.set(`Bookmarks/${name}.textpack`, sample(`Bookmarks/${name}.textpack`, "bookmark", name, "A saved reference.", { sourceUrl: `https://example.net/${index}` }));
  }
  const publishedStory = { ...sample("Blog/Story.textpack", "article", "An essay title", "An opening paragraph."), hash: "a".repeat(64) };
  publishedStory.documentJSON = JSON.stringify({ ...JSON.parse(publishedStory.documentJSON), content: { ...JSON.parse(publishedStory.documentJSON).content, subtitle: "A considered subtitle" } });
  storyItemId = publishedStory.markdown.match(/textTextId: "([^"]+)"/)?.[1];
  files.set("Blog/Story.textpack", publishedStory);
  files.set("Notes/Formatted.textpack", sample("Notes/Formatted.textpack", "note", "A concise card", "**A useful idea**\n\n- First point\n- Second point"));
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==";
  const portrait = (await sharp({ create: { width: 120, height: 240, channels: 4, background: "#bd806c" } }).png().toBuffer()).toString("base64");
  const landscape = (await sharp({ create: { width: 240, height: 120, channels: 4, background: "#6c93bd" } }).png().toBuffer()).toString("base64");
  files.set("Gallery/Pair.textpack", { ...sample("Gallery/Pair.textpack", "gallery", "Two photographs", "A visual pair.", {}, [
    { id: "one", kind: "image", src: "assets/one.png", alt: "First photograph" }, { id: "two", kind: "image", src: "assets/two.png", alt: "Second photograph" },
  ]), assets: [{ filename: "one.png", contentType: "image/png", data: portrait }, { filename: "two.png", contentType: "image/png", data: landscape }] });
  files.set("Gallery/Single.textpack", { ...sample("Gallery/Single.textpack", "gallery", "One photograph", "A separate image.", {}, [
    { id: "third", kind: "image", src: "assets/third.png", alt: "Third photograph" },
  ]), assets: [{ filename: "third.png", contentType: "image/png", data: pixel }] });
  files.set("Feeds/Design.textpack", sample("Feeds/Design.textpack", "bookmark", "Design feed", "", { texttextFeedSubscription: "v1", feedUrl: "https://example.com/feed.xml" }));
  files.set("Feeds/Design second.textpack", sample("Feeds/Design second.textpack", "bookmark", "Second design feed", "", { texttextFeedSubscription: "v1", feedUrl: "https://example.org/feed.xml" }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByRole("button", { name: "Show folders" }).click();
  await page.getByRole("button", { name: "TextText", exact: true }).click();
  await chooseFolder("Bookmarks");
  await page.getByRole("button", { name: "Save bookmark", exact: true }).waitFor();
  await page.getByRole("option", { name: /A saved article/ }).click();
  const bookmarkReader = page.getByRole("article", { name: "Bookmark reader" });
  await bookmarkReader.getByText("The complete saved reading text.").waitFor();
  await bookmarkReader.getByRole("button", { name: /Favorite/ }).click();
  await bookmarkReader.getByRole("button", { name: "Mark read" }).click();
  await bookmarkReader.getByRole("textbox", { name: "Add bookmark tag" }).fill("research");
  await bookmarkReader.getByRole("button", { name: "Add", exact: true }).click();
  await bookmarkReader.getByRole("button", { name: "Remove research tag" }).waitFor();
  await page.waitForFunction(() => document.querySelector('.vault-bookmark-list [aria-selected="true"]')?.textContent?.includes("Read"));
  const savedBookmark = JSON.parse(files.get("Bookmarks/Reading.textpack").documentJSON);
  assert.equal(savedBookmark.content.fields.texttextBookmarkFavorite, true);
  assert.equal(typeof savedBookmark.content.fields.texttextBookmarkReadAt, "string");
  assert.deepEqual(savedBookmark.content.tags, ["research"]);
  await page.getByRole("group", { name: "Filter bookmark tags" }).getByRole("button", { name: "#research" }).click();
  assert.equal(await page.getByRole("option", { name: /Another saved link/ }).count(), 0);
  await page.getByRole("group", { name: "Filter bookmark tags" }).getByRole("button", { name: "All tags" }).click();
  await page.getByRole("group", { name: "Bookmark filters" }).getByRole("button", { name: "Favorites" }).click();
  await page.getByRole("option", { name: /A saved article/ }).waitFor();
  assert.equal(await page.getByRole("option", { name: /Another saved link/ }).count(), 0);
  await page.getByRole("group", { name: "Bookmark filters" }).getByRole("button", { name: "Unread" }).click();
  await page.getByRole("option", { name: /Another saved link/ }).waitFor();
  await page.getByRole("option", { name: /A saved article/ }).waitFor({ state: "hidden" });
  await page.getByRole("group", { name: "Bookmark filters" }).getByRole("button", { name: "Inbox" }).click();
  await bookmarkReader.getByRole("button", { name: "Archive", exact: true }).click();
  assert.equal(typeof JSON.parse(files.get("Bookmarks/Reading.textpack").documentJSON).content.fields.texttextBookmarkArchivedAt, "string");
  await page.getByRole("option", { name: /A saved article/ }).waitFor({ state: "hidden" });
  await page.getByRole("group", { name: "Bookmark filters" }).getByRole("button", { name: "Archive" }).click();
  await page.getByRole("option", { name: /A saved article/ }).click();
  await bookmarkReader.getByRole("button", { name: "Move to inbox" }).click();
  await page.getByRole("group", { name: "Bookmark filters" }).getByRole("button", { name: "Inbox" }).click();
  await page.getByRole("searchbox", { name: "Filter bookmarks by title or site" }).fill("example.org");
  await page.getByRole("option", { name: /Another saved link/ }).waitFor();
  assert.equal(await page.getByRole("option", { name: /A saved article/ }).count(), 0);
  await page.getByRole("searchbox", { name: "Filter bookmarks by title or site" }).fill("Z filler 24");
  await page.getByRole("option", { name: /Z filler 24/ }).waitFor();
  await page.getByRole("searchbox", { name: "Filter bookmarks by title or site" }).fill("");
  await bookmarkReader.getByText("The complete saved reading text.").waitFor();
  await page.screenshot({ path: "/tmp/texttext-bookmark-reference.png" });
  await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
  await page.getByRole("dialog", { name: "Save bookmark" }).getByRole("textbox", { name: "Web address" }).waitFor();
  await page.getByRole("dialog", { name: "Save bookmark" }).getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("b");
  const saveBookmark = page.getByRole("dialog", { name: "Save bookmark" });
  assert.equal(await saveBookmark.getByRole("textbox", { name: "Capture title" }).isVisible(), false);
  await page.screenshot({ path: "/tmp/texttext-save-bookmark-reference.png" });
  await saveBookmark.getByRole("textbox", { name: "Web address" }).fill("https://example.com/fresh-reading");
  await saveBookmark.getByRole("button", { name: "Save bookmark" }).click();
  await page.getByRole("option", { name: /example.com/ }).filter({ hasText: "example.com" }).first().waitFor();
  await page.waitForFunction(() => document.querySelector('.vault-bookmark-list [aria-selected="true"]')?.textContent?.includes("example.com"));
  assert.equal([...files].some(([path, file]) => path.startsWith("Bookmarks/") && JSON.parse(file.documentJSON).content.fields.sourceUrl === "https://example.com/fresh-reading"), true);
  assert.equal(await page.getByRole("article", { name: "Bookmark reader" }).count(), 1);
  assert.equal(await page.getByRole("main", { name: "Edit item" }).count(), 0);
  await chooseFolder("Blog");
  await page.getByRole("button", { name: "Write a story", exact: true }).waitFor();
  await page.locator(".vault-story-list").getByText("An essay title").waitFor();
  await page.locator(".vault-story-list").getByText("A considered subtitle").waitFor();
  await page.screenshot({ path: "/tmp/texttext-blog-reference.png" });
  await page.getByRole("button", { name: "Open An essay title" }).click();
  const storyReader = page.getByRole("region", { name: "Story reader" });
  await storyReader.getByText("An opening paragraph.").waitFor();
  await page.screenshot({ path: "/tmp/texttext-blog-reader-reference.png" });
  await page.locator(".vault-context-actions > .vault-primary-action").getByText("Publish").waitFor();
  await page.locator(".vault-context-actions > .vault-primary-action").click();
  const publishing = page.getByRole("dialog", { name: "Publish An essay title" });
  await publishing.getByText("Story preview").waitFor();
  await publishing.getByText("An opening paragraph.").waitFor();
  await publishing.getByRole("button", { name: "Publish story" }).waitFor();
  await page.screenshot({ path: "/tmp/texttext-blog-publish-reference.png" });
  await publishing.getByRole("button", { name: "Edit topics in story" }).click();
  const topicInput = page.getByRole("textbox", { name: "Add story topic" });
  await topicInput.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Add story topic");
  await topicInput.fill("Design");
  await page.locator(".tt-article-topics").getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".tt-article-topic-list").getByText("Design").waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await storyReader.getByRole("button", { name: "Edit story" }).waitFor();
  assert.deepEqual(JSON.parse(files.get("Blog/Story.textpack").documentJSON).content.tags, ["Design"]);
  await storyReader.getByRole("button", { name: "Edit story" }).click();
  await page.getByRole("textbox", { name: "Subtitle" }).waitFor();
  await chooseFolder("Blog");
  await page.getByRole("button", { name: "Write a story", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Title");
  const newStory = [...files.values()].at(-1);
  assert.equal(JSON.parse(newStory.documentJSON).presentation.template.id, "texttext.article");
  assert.match(newStory.markdown, /kind: "article"/);
  await page.locator(".vault-context-actions > .vault-primary-action").getByText("Publish").waitFor();
  assert.equal(await page.locator(".vault-context-actions > .vault-primary-action").isDisabled(), true);
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Subtitle");
  await page.getByRole("textbox", { name: "Subtitle" }).fill("A short line beneath the title");
  await page.screenshot({ path: "/tmp/texttext-new-story-editor-reference.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: "/tmp/texttext-new-story-editor-light-reference.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Document body");
  const storyBody = page.getByRole("textbox", { name: "Document body" });
  await storyBody.click();
  await storyBody.type("Draft text");
  await page.keyboard.down("Shift");
  for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page.getByRole("toolbar", { name: "Format selected story text" }).getByRole("button", { name: "Bold" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Document body"]')?.textContent?.includes("**text**"));
  await storyBody.click();
  await page.getByRole("button", { name: "Add image to story" }).waitFor();
  await page.getByLabel("Choose story images").setInputFiles({ name: "story.png", mimeType: "image/png", buffer: Buffer.from(pixel, "base64") });
  await page.waitForFunction(() => document.querySelector('[aria-label="Document body"]')?.textContent?.includes("assets/story.png"));
  await chooseFolder("Gallery");
  assert.equal(JSON.parse(files.get(newStory.path).documentJSON).content.subtitle, "A short line beneath the title");
  await page.getByRole("button", { name: "Add images", exact: true }).waitFor();
  await page.locator(".vault-photo-grid img").first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll(".vault-photo-grid img")].every(image => image.complete && image.naturalHeight > 0));
  const portraitTile = await page.getByRole("button", { name: "Open Two photographs image 1" }).boundingBox();
  const landscapeTile = await page.getByRole("button", { name: "Open Two photographs image 2" }).boundingBox();
  assert.ok(portraitTile && landscapeTile && portraitTile.height > landscapeTile.height * 1.7);
  await page.screenshot({ path: "/tmp/texttext-gallery-grid-reference.png" });
  await page.getByRole("button", { name: "Open Two photographs image 1" }).click();
  const lightbox = page.getByRole("dialog", { name: "Two photographs" });
  await lightbox.getByRole("img", { name: "First photograph" }).waitFor();
  await lightbox.getByRole("button", { name: "Next image" }).click();
  await lightbox.getByRole("img", { name: "Second photograph" }).waitFor();
  const galleryOrder = await page.locator(".vault-photo-grid button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
  const pairSecond = galleryOrder.indexOf("Open Two photographs image 2");
  const single = galleryOrder.indexOf("Open One photograph");
  assert.ok(pairSecond >= 0 && single >= 0);
  const towardsSingle = single < pairSecond ? "ArrowLeft" : "ArrowRight";
  const towardsPair = single < pairSecond ? "ArrowRight" : "ArrowLeft";
  for (let step = 0; step < Math.abs(single - pairSecond); step++) await page.keyboard.press(towardsSingle);
  await page.getByRole("dialog", { name: "One photograph" }).getByRole("img", { name: "Third photograph" }).waitFor();
  for (let step = 0; step < Math.abs(single - pairSecond); step++) await page.keyboard.press(towardsPair);
  await page.getByRole("dialog", { name: "Two photographs" }).getByRole("img", { name: "Second photograph" }).waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.vault-gallery-stage img'); return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0; });
  await page.screenshot({ path: "/tmp/texttext-gallery-reference.png" });
  await lightbox.getByRole("button", { name: "Edit item" }).click();
  await page.getByRole("textbox", { name: "Image title" }).fill("Collected photographs");
  await page.getByRole("textbox", { name: "Image caption" }).fill("Two color studies kept together.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const editedGallery = JSON.parse(files.get("Gallery/Pair.textpack").documentJSON);
  assert.equal(editedGallery.content.title, "Collected photographs");
  assert.equal(editedGallery.content.body, "Two color studies kept together.");
  await page.screenshot({ path: "/tmp/texttext-gallery-editor-reference.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: "/tmp/texttext-gallery-editor-light-reference.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await chooseFolder("Feeds");
  await page.getByRole("button", { name: "Add source", exact: true }).waitFor();
  await page.getByRole("button", { name: "A considered design headline" }).first().waitFor();
  await page.locator(".vault-feed-thumb").first().waitFor();
  await page.locator(".vault-feed-lead").first().waitFor();
  await page.screenshot({ path: "/tmp/texttext-feeds-reference.png" });
  await page.getByRole("button", { name: "Headlines", exact: true }).click();
  await page.getByRole("heading", { name: "Headlines", exact: true }).waitFor();
  await page.locator(".vault-feed-coverage-list").getByRole("button", { name: /A considered design headline/ }).click();
  await page.getByRole("region", { name: "Headline coverage" }).getByText("2 articles", { exact: false }).waitFor();
  await page.screenshot({ path: "/tmp/texttext-feed-coverage-reference.png" });
  await page.locator(".vault-feed-coverage > header button").click();
  await page.getByRole("button", { name: "For You", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "A considered design headline" }).count(), 1);
  await page.screenshot({ path: "/tmp/texttext-feeds-ranked-reference.png" });
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await page.getByRole("button", { name: "A considered design headline" }).first().click();
  await page.getByRole("region", { name: "Feed story" }).getByText("A full in-app reading view for this story.").waitFor();
  await page.screenshot({ path: "/tmp/texttext-feed-reader-reference.png" });
  await page.getByRole("button", { name: "Save to Bookmarks" }).click();
  await page.getByRole("button", { name: "Saved to Bookmarks" }).waitFor();
  const keptFeedBookmark = [...files.values()].find(file => file.path.startsWith("Bookmarks/") && JSON.parse(file.documentJSON).content.fields.feedEntryHash);
  assert.equal(JSON.parse(keptFeedBookmark.documentJSON).presentation.template.id, "texttext.bookmark");
  await page.getByRole("button", { name: "Back to Feeds" }).click();
  await chooseFolder("Notes");
  await page.locator(".vault-note-card").filter({ hasText: "A concise card" }).getByText("A useful idea").waitFor();
  assert.equal(await page.locator(".vault-note-card").filter({ hasText: "A concise card" }).locator("strong").filter({ hasText: "A useful idea" }).count(), 1);
  await page.screenshot({ path: "/tmp/texttext-note-grid-reference.png" });
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Title");
  await page.getByRole("textbox", { name: "Title" }).fill("Thought for later");
  await page.locator(".vault-context-header h2").getByText("Thought for later", { exact: true }).waitFor();
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Document body");
  await page.getByRole("textbox", { name: "Document body" }).fill("A short card about an idea.");
  await page.getByRole("textbox", { name: "Add note tag" }).fill("#Ideas");
  await page.getByRole("region", { name: "Note tags" }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("region", { name: "Note tags" }).getByText("#Ideas").waitFor();
  await page.screenshot({ path: "/tmp/texttext-note-editor-reference.png" });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("region", { name: "Note card" }).getByText("Thought for later").waitFor();
  await page.getByRole("region", { name: "Note card" }).getByText("#Ideas").waitFor();
  await page.screenshot({ path: "/tmp/texttext-note-card-reference.png" });
  await page.getByRole("button", { name: "Edit card" }).click();
  await page.getByRole("textbox", { name: "Title" }).waitFor();
  const newCard = [...files.values()].at(-1);
  assert.equal(JSON.parse(newCard.documentJSON).presentation.template.id, "texttext.note");
  assert.deepEqual(JSON.parse(newCard.documentJSON).content.tags, ["Ideas"]);
  await chooseFolder("Notes");
  await page.getByRole("button", { name: "New note", exact: true }).waitFor();
  await page.keyboard.press("n");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Title");
  const shortcutNote = [...files.values()].at(-1);
  assert.ok(shortcutNote.path.startsWith("Notes/"));
  assert.equal(JSON.parse(shortcutNote.documentJSON).presentation.template.id, "texttext.note");
  files.delete("Feeds/Design.textpack");
  files.delete("Feeds/Design second.textpack");
  await page.reload();
  await chooseFolder("Feeds");
  await page.getByRole("heading", { name: "Choose your sources" }).waitFor();
  await page.screenshot({ path: "/tmp/texttext-feeds-starter-reference.png" });
  await page.locator(".vault-feed-recommendations").getByRole("button", { name: "Follow" }).first().click();
  await page.getByRole("button", { name: "A considered design headline" }).waitFor();
  await page.getByRole("button", { name: "Technology", exact: true }).click();
  await page.getByRole("button", { name: "A considered design headline" }).waitFor();
  const followed = [...files.values()].find((file) => JSON.parse(file.documentJSON).content.fields.feedUrl === "https://www.theverge.com/rss/index.xml");
  assert.ok(followed?.path.startsWith("Feeds/"));
  assert.deepEqual(JSON.parse(followed.documentJSON).content.tags, ["Technology"]);
  assert.deepEqual(failures, []);
  console.log("Bookmark reader, URL-first capture, story list, gallery viewer, and feed headlines passed.");
  console.log("New note focused its body for immediate typing; reopening another note kept the user's focus.");
  console.log("Recovery preview/cancel, full pack restore as copy, and version history passed.");
  console.log("Bounded folder previews and pagination passed.");
  console.log("Image picker, folder drop/paste and embedded GIF still preview passed.");
  console.log("Quiet shell passed: one folder tree, one primary create action, contextual actions, Command-K, and narrow keyboard menu.");
  console.log("Narrow folder drawer, full-width editor, remembered collapse, keyboard escape and reduced-motion render passed.");
  console.log("Offline vault UI passed: file save, raw agent refresh, conflict copy, zero HTTP/fetch calls.");
} finally { await browser.close(); }
