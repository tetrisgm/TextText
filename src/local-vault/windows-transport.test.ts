import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { strToU8, strFromU8, unzipSync } from "fflate";
import { createNativeRPC, createWindowsVaultTransport } from "./windows-transport";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { emptyPack, encodePack, openPack } from "./pack";
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
  const initial = encodePack(pack, writePayload({ path, hash: "", markdown: `---\ntextTextId: "${itemId}"\n---\n\n` }, doc));
  const files = new Map([[itemId, { path, bytes: initial }]]);
  let ready = true; let checkpoint: Record<string, unknown> | undefined;
  const view = native((method, p) => {
    if (method === "native.status") return { root: "C:\\Users\\Person\\TextText\\workspace", workspaceId: "workspace", name: "Workspace", available: true, connected: true };
    if (method === "native.recovery") return null;
    if (method === "files.connection") return { onlineReady: ready };
    if (method === "files.ready") return { ready };
    if (method === "files.list") { const items = [...files].map(([itemId, file]) => ({ itemId, relativePath: file.path, revision: digest(file.bytes) })); return { items, revision: JSON.stringify(items), folders: ["Notes"] }; }
    const file = files.get(String(p.itemId));
    if (method === "files.text") { if (!file) throw Object.assign(new Error("Missing"), { code: "not_found" }); return openPack(file.bytes, file.path, digest(file.bytes), String(p.itemId)).file; }
    if (method === "files.read") { if (!file) throw Object.assign(new Error("Missing"), { code: "not_found" }); return { path: file.path, hash: digest(file.bytes), data: Buffer.from(file.bytes).toString("base64") }; }
    if (method === "files.write") {
      if (file ? digest(file.bytes) !== p.expectedHash : p.expectedHash !== null) throw Object.assign(new Error("Changed"), { code: "conflict" });
      const value = { path: String(p.path), bytes: new Uint8Array(Buffer.from(String(p.data), "base64")) }; files.set(String(p.itemId), value); return { path: value.path, hash: digest(value.bytes) };
    }
    if (method === "collaboration.checkpoint") { checkpoint = p; return { path, hash: digest(Buffer.from(String(p.data), "base64")) }; }
    throw new Error(`Unexpected ${method}`);
  });
  const transport = await createWindowsVaultTransport(view);
  return { transport, view, files, itemId, path, initial, checkpoint: () => checkpoint, setReady(value: boolean) { ready = value; } };
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
      const payload = writePayload(pack.file, document);
      await f.transport.request("collaborationCheckpoint", { itemId: f.itemId, sessionToken: "session", ...payload, journal: "journal" });
      const entries = unzipSync(Buffer.from(String(f.checkpoint()!.data), "base64"));
      expect(entries[pack.prefix + "assets/opaque.bin"]).toEqual(new Uint8Array([0, 2, 255])); expect(strFromU8(entries[pack.prefix + "agent.json"])).toBe('{"preserve":true}');
      expect(f.checkpoint()).toMatchObject({ journal: "journal", sessionToken: "session" });
      await expect(f.transport.request("collaborationCheckpoint", { itemId: f.itemId, ...payload, hash: "stale" })).rejects.toMatchObject({ code: "local_changed" });
    } finally { f.transport.destroy(); }
  });
});
