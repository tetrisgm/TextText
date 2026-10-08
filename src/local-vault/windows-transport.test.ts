import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { strToU8, strFromU8, unzipSync } from "fflate";
import { createNativeRPC, createWindowsVaultTransport } from "./windows-transport";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { emptyPack, encodePack, openPack, packIdentity } from "./pack";
import { executeWindowsFolderAgentTool } from "./windows-agent-tools";
import { readDocument, writePayload } from "./model";
import type { VaultFile } from "./bridge";
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
afterEach(() => { vi.unstubAllGlobals(); });
function native(handler: (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const messages: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const emit = (data: unknown) => { for (const listener of listeners) listener({ data } as MessageEvent); };
  return { messages, listeners, emit,
    addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => { listeners.delete(listener); },
    postMessage(message: unknown) {
      const request = message as typeof messages[number]; messages.push(request);
      void Promise.resolve().then(() => handler(request.method, request.params)).then(result => emit({ id: request.id, result }), error => emit({ id: request.id, error: { message: error.message, code: error.code } }));
    },
  };
}
async function fixture() {
  vi.stubGlobal("window", new EventTarget());
  const itemId = "0bd05f92-c562-4a78-8c0d-b5e41ca3215d", path = "Notes/Original.textpack";
  const doc = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); doc.content.title = "Original"; doc.content.body = "first needle";
  const pack = emptyPack(); pack.entries[pack.prefix + "assets/opaque.bin"] = new Uint8Array([0, 2, 255]); pack.entries[pack.prefix + "agent.json"] = strToU8('{"preserve":true}');
  pack.entries[pack.prefix + "net.texttext.mutations/" + "a".repeat(64) + ".json"] = strToU8('{"fingerprint":"original"}');
  const initial = encodePack(pack, writePayload({ path, hash: "", markdown: `---\ntextTextId: "${itemId}"\n---\n\n` }, doc));
  const files = new Map([[itemId, { path, bytes: initial }]]);
  let ready = true; let checkpoint: Record<string, unknown> | undefined;
  let loseWriteResponse = false;
  const committedOperations = new Set<string>();
  const creations = new Map<string, {intent: string; itemId: string}>();
  const view = native((method, p) => {
    if (method === "native.status") return { root: "C:\\Users\\Person\\TextText\\workspace", workspaceId: "workspace", name: "Workspace", available: true, connected: true };
    if (method === "native.recovery") return null;
    if (method === "files.connection") return { onlineReady: ready };
    if (method === "files.ready") return { ready };
    if (method === "files.list") { const items = [...files].map(([itemId, file]) => ({ itemId, relativePath: file.path, revision: digest(file.bytes) })); return { items, revision: JSON.stringify(items), folders: ["Notes"] }; }
    if (method === "files.creationResume" || method === "files.creationWrite") {
      let receipt = creations.get(String(p.creationOperationId));
      if (receipt && receipt.intent !== p.creationIntent) throw new Error("Different creation intent");
      if (!receipt && method === "files.creationResume") return null;
      if (!receipt) {
        const bytes = new Uint8Array(Buffer.from(String(p.data), "base64"));
        receipt = {intent: String(p.creationIntent), itemId: packIdentity(openPack(bytes, String(p.path), digest(bytes)).file.markdown)!};
        files.set(receipt.itemId, {path: String(p.path), bytes});
        creations.set(String(p.creationOperationId), receipt);
        if (loseWriteResponse) {loseWriteResponse = false; throw new Error("Lost native response");}
      }
      const current = files.get(receipt.itemId);
      if (!current) throw new Error("Created file no longer exists");
      return {path: current.path, hash: digest(current.bytes), itemId: receipt.itemId};
    }
    const file = files.get(String(p.itemId));
    if (method === "files.text") { if (!file) throw Object.assign(new Error("Missing"), { code: "not_found" }); return openPack(file.bytes, file.path, digest(file.bytes), String(p.itemId)).file; }
    if (method === "files.read") { if (!file) throw Object.assign(new Error("Missing"), { code: "not_found" }); return { path: file.path, hash: digest(file.bytes), data: Buffer.from(file.bytes).toString("base64") }; }
    if (method === "files.write") {
      if (committedOperations.has(String(p.operationId)) && file) return { path: file.path, hash: digest(file.bytes) };
      if (file ? digest(file.bytes) !== p.expectedHash : p.expectedHash !== null) throw Object.assign(new Error("Changed"), { code: "conflict" });
      const value = { path: String(p.path), bytes: new Uint8Array(Buffer.from(String(p.data), "base64")) }; files.set(String(p.itemId), value);
      committedOperations.add(String(p.operationId));
      if (loseWriteResponse) { loseWriteResponse = false; throw new Error("Lost native response"); }
      return { path: value.path, hash: digest(value.bytes) };
    }
    if (method === "collaboration.checkpoint") { checkpoint = p; return { path, hash: digest(Buffer.from(String(p.data), "base64")) }; }
    throw new Error(`Unexpected ${method}`);
  });
  const transport = await createWindowsVaultTransport(view);
  return { transport, view, files, itemId, path, initial, checkpoint: () => checkpoint, setReady(value: boolean) { ready = value; }, loseNextWriteResponse() { loseWriteResponse = true; } };
}

describe("Windows native RPC", () => {
  it("cancels held calls and removes listeners/pending calls on teardown", async () => {
    const view = native(() => new Promise(() => {})), rpc = createNativeRPC(view), controller = new AbortController();
    const request = rpc.request("held", {}, controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(view.messages.at(-1)).toMatchObject({ method: "native.cancel", params: { requestId: view.messages[0].id } });
    const second = rpc.request("held"); rpc.destroy();
    await expect(second).rejects.toThrow("Workspace closed"); expect(view.listeners.size).toBe(0);
  });
});
describe("Windows shared transport", () => {
  it("resumes host agent creation across a renderer restart, returning moved and edited content", async () => {
    const f = await fixture();
    const operationId = "11111111-1111-4111-8111-111111111111";
    const args = {title: "Agent creation", body: "Original", kind: "note"};
    let restarted: Awaited<ReturnType<typeof createWindowsVaultTransport>> | undefined;
    try {
      f.loseNextWriteResponse();
      await expect(executeWindowsFolderAgentTool(f.transport.request, "Notes", "create_file", args, undefined, operationId)).rejects.toThrow("Lost native response");
      const [id, file] = [...f.files].find(([id]) => id !== f.itemId)!;
      const pack = openPack(file.bytes, "Notes/Moved.textpack", digest(file.bytes), id);
      const document = readDocument(pack.file); document.content.body += "\nlater human edit";
      f.files.set(id, {path: "Notes/Moved.textpack", bytes: encodePack(pack, writePayload(pack.file, document))});
      f.transport.destroy();
      restarted = await createWindowsVaultTransport(f.view);
      const result = JSON.parse(await executeWindowsFolderAgentTool(restarted.request, "Notes", "create_file", args, undefined, operationId));
      expect(result.path).toBe("Notes/Moved.textpack");
      expect(readDocument(await restarted.request("read", {path: result.path}) as VaultFile).content.body).toBe("Original\nlater human edit");
      expect(f.files.size).toBe(2);
      expect(f.view.messages.filter(message => message.method === "files.creationWrite")).toHaveLength(1);
      expect(f.view.messages.some(message => message.method === "files.write" || message.method === "native.http")).toBe(false);
      await expect(executeWindowsFolderAgentTool(restarted.request, "Notes", "create_file", {...args, body: "Different"}, undefined, operationId)).rejects.toThrow("Different creation intent");
    } finally {restarted?.destroy(); f.transport.destroy();}
  });
  it("replays a lost native save response with the same operation and follows later rename/edit", async () => {
    const f = await fixture();
    try {
      const source = await f.transport.request("read", { path: f.path }) as VaultFile;
      const document = readDocument(source); document.content.body = "agent saved";
      const payload = writePayload(source, document);
      f.loseNextWriteResponse();
      await expect(f.transport.request("write", payload)).rejects.toThrow("Lost native response");
      const committed = f.files.get(f.itemId)!;
      const latest = openPack(committed.bytes, "Notes/Moved.textpack", digest(committed.bytes), f.itemId);
      const latestDocument = readDocument(latest.file); latestDocument.content.body += "\nlater human edit";
      f.files.set(f.itemId, { path: latest.file.path, bytes: encodePack(latest, writePayload(latest.file, latestDocument)) });
      const result = await f.transport.request("write", payload) as VaultFile;
      const writes = f.view.messages.filter(call => call.method === "files.write");
      expect(writes[1].params.operationId).toBe(writes[0].params.operationId);
      expect(result.path).toBe("Notes/Moved.textpack");
      expect(readDocument(result).content.body).toBe("agent saved\nlater human edit");
    } finally { f.transport.destroy(); }
  });
  it("saves reusable look metadata in one complete native publication", async () => {
    const f = await fixture();
    try {
      const source = await f.transport.request("read", { path: f.path }) as VaultFile;
      const document = readDocument(source);
      const template = { ...JSON.parse(source.templateJSON!), id: "local.saved-look", version: 1, name: "Saved look" };
      document.presentation.template = { id: template.id, version: template.version };
      const before = f.view.messages.filter(call => call.method === "files.write").length;
      const saved = await f.transport.request("create", { title: "Saved look", folder: "Templates", sourcePath: source.path, sourceHash: source.hash,
        documentJSON: JSON.stringify(document), templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: null }) as VaultFile;
      expect(f.view.messages.filter(call => call.method === "files.write").length - before).toBe(1);
      expect(f.view.messages.filter(call => call.method === "files.write").at(-1)!.params.operationId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(readDocument(saved)).toEqual(document);
      expect(JSON.parse(saved.templateJSON!).id).toBe(template.id);
      expect(f.files.get(f.itemId)!.bytes).toEqual(f.initial);
    } finally { f.transport.destroy(); }
  });
  it("does not inherit item mutation receipts when cloning or importing a new identity", async () => {
    const f = await fixture();
    try {
      const source = await f.transport.request("read", { path: f.path }) as VaultFile;
      const cloned = await f.transport.request("create", { title: "Copy", folder: "Notes", sourcePath: source.path, sourceHash: source.hash }) as VaultFile;
      const imported = await f.transport.request("importPack", { title: "Import", folder: "Notes", data: Buffer.from(f.files.get(f.itemId)!.bytes).toString("base64") }) as VaultFile;
      for (const file of [cloned, imported]) {
        const bytes = [...f.files.values()].find(entry => entry.path === file.path)!.bytes;
        const entries = unzipSync(bytes);
        expect(Object.keys(entries).some(name => name.includes("/net.texttext.mutations/"))).toBe(false);
        expect(entries["Document.textbundle/assets/opaque.bin"]).toEqual(new Uint8Array([0, 2, 255]));
        expect(strFromU8(entries["Document.textbundle/agent.json"])).toBe('{"preserve":true}');
      }
      expect(Object.keys(unzipSync(f.files.get(f.itemId)!.bytes)).some(name => name.includes("/net.texttext.mutations/"))).toBe(true);
      expect(f.view.messages.some(call => call.method === "native.http")).toBe(false);
    } finally { f.transport.destroy(); }
  });
  it("scopes Notes search before the result cap without reading unrelated packs", async () => {
    const f = await fixture();
    try {
      const original = f.files.get(f.itemId)!; f.files.delete(f.itemId);
      for (let index = 0; index < 105; index++) f.files.set(`other-${index}`, { ...original, path: `Bookmarks/needle-${index}.textpack` });
      f.files.set(f.itemId, original);
      expect(await f.transport.request("search", { query: "needle", folder: "Notes" })).toMatchObject({ items: [{ path: f.path }], truncated: false });
      expect(f.view.messages.filter(call => call.method === "files.text").map(call => call.params.itemId)).toEqual([f.itemId]);
    } finally { f.transport.destroy(); }
  });
  it("reads pending local saved stories and history offline with canonical metadata and deduplication", async () => {
    const f = await fixture();
    const add = (id: string, path: string, fields: Record<string, string | number>) => {
      const doc = emptyDocumentSnapshot({ id: "texttext.article", version: 1 });
      doc.content.title = id; doc.content.fields = fields;
      f.files.set(id, { path, bytes: encodePack(emptyPack(), writePayload({ path, hash: "", markdown: `---\ntextTextId: "${id}"\n---\n\n` }, doc)) });
    };
    try {
      const hash = "a".repeat(64), historyHash = "b".repeat(64);
      add("old", "Bookmarks/Old.textpack", { texttextFeedEntry: "v1", feedEntryHash: hash, keptAt: "2026-01-01" });
      add("new", "Bookmarks/New.textpack", { texttextFeedEntry: "v1", feedEntryHash: hash, keptAt: "2026-02-01", feedTitle: "Publisher", feedTopic: " Design ", texttextBookmarkReadAt: "2026-02-02", texttextFeedReadingProgress: 45 });
      add("history", "Feeds/History/Read.textpack", { texttextFeedHistoryEntry: "v1", feedEntryHash: historyHash, readAt: "2026-03-01", texttextFeedReadingProgress: 100 });
      add("invalid", "Bookmarks/Invalid.textpack", { texttextFeedEntry: "v1", feedEntryHash: "invalid" });
      add("wrong-folder", "Notes/Ignore.textpack", { texttextFeedEntry: "v1", feedEntryHash: "c".repeat(64) });
      expect(await f.transport.request("keptFeedEntries", {})).toEqual({ hashes: [hash], entries: [{ hash, path: "Bookmarks/New.textpack", title: "new", source: "Publisher", keptAt: "2026-02-01", topic: "Design", readAt: "2026-02-02", progress: "45" }] });
      expect(await f.transport.request("readFeedEntries", {})).toEqual({ hashes: [historyHash], entries: [{ hash: historyHash, path: "Feeds/History/Read.textpack", title: "history", source: "", viewedAt: "2026-03-01", readAt: "2026-03-01", progress: "100", revision: digest(f.files.get("history")!.bytes) }] });
      f.files.delete("new");
      expect(await f.transport.request("keptFeedEntries", {})).toMatchObject({ entries: [{ path: "Bookmarks/Old.textpack" }] });
      expect(f.view.messages.some(call => call.method === "native.http")).toBe(false);
    } finally { f.transport.destroy(); }
  });
  it("opens only native recovery copies without forwarding a renderer-controlled path", async () => {
    const f = await fixture();
    try {
      await expect(f.transport.request("recovery", { path: "C:\\arbitrary", url: "https://untrusted.example" })).resolves.toBeNull();
      expect(f.view.messages.at(-1)).toMatchObject({ method: "native.recovery", params: {} });
      expect(f.view.messages.some(message => message.method === "native.http")).toBe(false);
    } finally { f.transport.destroy(); }
  });

  it("reads and creates local packs without issuing cloud file requests", async () => {
    const f = await fixture();
    try {
      expect(await f.transport.request("list", {})).toMatchObject({ root: expect.stringContaining("C:"), folders: ["Notes"] });
      const original = await f.transport.request("read", { path: f.path }) as VaultFile;
      expect(readDocument(original).content.body).toBe("first needle");
      const created = await f.transport.request("create", { title: "Second", folder: "Notes" }) as VaultFile;
      expect(created.path).toBe("Notes/Second.textpack"); expect(f.files.size).toBe(2);
      expect(f.view.messages.some(call => call.method === "native.http")).toBe(false);
    } finally { f.transport.destroy(); }
  });
  it("surfaces a concurrent filesystem change instead of replacing it", async () => {
    const f = await fixture();
    try {
      const opened = await f.transport.request("read", { path: f.path }) as VaultFile;
      const pack = openPack(f.initial, f.path, opened.hash, f.itemId), external = readDocument(opened); external.content.body = "External edit";
      f.files.set(f.itemId, { path: f.path, bytes: encodePack(pack, writePayload(opened, external)) });
      const draft = readDocument(opened); draft.content.body = "My edit";
      await expect(f.transport.request("write", writePayload(opened, draft))).rejects.toMatchObject({ code: "conflict" });
      expect(readDocument(openPack(f.files.get(f.itemId)!.bytes, f.path, "", f.itemId).file).content.body).toBe("External edit");
    } finally { f.transport.destroy(); }
  });
  it("invalidates search after external changes and bounds reads on repeated queries", async () => {
    const f = await fixture();
    try {
      expect(await f.transport.request("search", { query: "needle" })).toMatchObject({ items: [{ path: f.path }] });
      const reads = f.view.messages.filter(call => call.method === "files.text").length;
      expect(reads).toBe(1);
      await f.transport.request("search", { query: "needle" }); expect(f.view.messages.filter(call => call.method === "files.text").length).toBe(reads);
      const pack = openPack(f.initial, f.path, digest(f.initial), f.itemId), document = readDocument(pack.file); document.content.body = "changed haystack";
      f.files.set(f.itemId, { path: f.path, bytes: encodePack(pack, writePayload(pack.file, document)) });
      f.view.emit({ event: "texttext:vault-changed", detail: {} });
      expect(await f.transport.request("search", { query: "needle" })).toMatchObject({ items: [] });
      expect(await f.transport.request("search", { query: "haystack" })).toMatchObject({ items: [{ path: f.path }] });
    } finally { f.transport.destroy(); }
  });
  it("gates collaboration until native sync has a published baseline", async () => {
    const f = await fixture();
    try { f.setReady(false); expect(await f.transport.request("connection", {})).toMatchObject({ onlineReady: false }); expect(await f.transport.request("collaborationConfig", { path: f.path, readyOnly: true })).toBeNull(); f.setReady(true); expect(await f.transport.request("collaborationConfig", { path: f.path })).toMatchObject({ localFiles: true, itemId: f.itemId }); }
    finally { f.transport.destroy(); }
  });
  it("checkpoints preserve opaque ZIP entries and assets, and fence stale hashes", async () => {
    const f = await fixture();
    try {
      const pack = openPack(f.initial, f.path, digest(f.initial), f.itemId), document = readDocument(pack.file); document.content.body = "checkpoint edit";
      const template = { ...requireBuiltinTemplate("texttext.note"), id: "custom.remote" };
      document.presentation.template = { id: template.id, version: template.version };
      const metadata = { templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: null };
      const payload = writePayload({ ...pack.file, ...metadata }, document);
      const journal = JSON.stringify({ presentation: metadata });
      await f.transport.request("collaborationCheckpoint", { itemId: f.itemId, sessionToken: "session", ...payload, journal });
      const entries = unzipSync(Buffer.from(String(f.checkpoint()!.data), "base64"));
      expect(entries[pack.prefix + "assets/opaque.bin"]).toEqual(new Uint8Array([0, 2, 255])); expect(strFromU8(entries[pack.prefix + "agent.json"])).toBe('{"preserve":true}');
      expect(f.checkpoint()).toMatchObject({ journal, sessionToken: "session" });
      expect(JSON.parse(strFromU8(entries[pack.prefix + "template.json"])).id).toBe(template.id);
      await expect(f.transport.request("collaborationCheckpoint", { itemId: f.itemId, ...payload, hash: "stale" })).rejects.toMatchObject({ code: "local_changed" });
    } finally { f.transport.destroy(); }
  });
});

it("discovers folder markers beyond 2048 siblings and caches only metadata by current hash/path", async () => {
  const f = await fixture();
  try {
    const original = f.files.get(f.itemId)!;
    for (let index = 0; index < 2050; index++) f.files.set(`ordinary-${index}`, { ...original, path: `Notes/${index}.textpack` });
    expect(await f.transport.request("folderViews", { folder: "Notes" })).toEqual({ files: [] });
    const reads = f.view.messages.filter(message => message.method === "files.read").length;
    expect(await f.transport.request("folderViews", { folder: "Notes" })).toEqual({ files: [] });
    expect(f.view.messages.filter(message => message.method === "files.read")).toHaveLength(reads);
    const marker = (await import("./folder-view")).createFolderViewPack("Notes", requireBuiltinTemplate("texttext.note"));
    f.files.set("ordinary-2049", { path: "Notes/2049.textpack", bytes: marker.bytes });
    const found = await f.transport.request("folderViews", { folder: "Notes" }) as { files: VaultFile[] };
    expect(found.files.map(file => file.path)).toEqual(["Notes/2049.textpack"]);
    f.files.set("ordinary-2049", { path: "Notes/Renamed.textpack", bytes: marker.bytes });
    const renamed = await f.transport.request("folderViews", { folder: "Notes" }) as { files: VaultFile[] };
    expect(renamed.files.map(file => file.path)).toEqual(["Notes/Renamed.textpack"]);
  } finally { f.transport.destroy(); }
});

it("routes folder reviews through the bound native HTTP adapter without writing local files", async () => {
  vi.stubGlobal("window", new EventTarget());
  const view = native((method, params) => {
    if (method === "native.status") return { root: "C:\\TextText", workspaceId: "workspace", name: "Workspace", connected: true, available: true };
    if (method === "native.http") {
      expect(params).toMatchObject({ path: "/api/vault/workspace/folder-moves", method: "POST" });
      return { status: 201, headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify({ reviewPath: "/proposals/review" })).toString("base64") };
    }
    throw new Error(`Unexpected ${method}`);
  });
  const transport = await createWindowsVaultTransport(view);
  expect(await transport.request("folderMoveReview", { source: "Notes", destination: "Archive/Notes" })).toEqual({ reviewPath: "/proposals/review" });
  expect(view.messages.filter(message => message.method === "native.http")).toHaveLength(1);
  expect(view.messages.some(message => message.method.startsWith("files."))).toBe(false);
  transport.destroy();
});
