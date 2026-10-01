import { describe, expect, it } from "vitest";
import { strToU8, strFromU8, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { createWebVaultTransport } from "./web-transport";
import { emptyPack, encodePack, openPack } from "./pack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { writePayload, readDocument } from "./model";
import type { VaultFile, VaultListing } from "./bridge";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const id = "0bd05f92-c562-4a78-8c0d-b5e41ca3215d", path = "Notes/Original.textpack";
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  document.content.title = "Original"; document.content.body = "Original body";
  const seed = { path, hash: "", markdown: `---\ntextTextId: "${id}"\n---\n\n` };
  const pack = emptyPack();
  pack.entries[pack.prefix + "assets/picture.bin"] = new Uint8Array([0, 1, 255, 4]);
  pack.entries[pack.prefix + "agent-metadata.json"] = strToU8('{"keep":true}');
  const initial = encodePack(pack, writePayload(seed, document));
  const files = new Map([[id, { path, bytes: initial }]]);
  const operations: string[] = [];
  let failNextPut = false;
  const request: typeof fetch = async (_url, init) => {
    const url = String(_url), last = url.split("/").at(-1)!;
    const headers = new Headers(init?.headers);
    if (last === "items") {
      const items = [...files].map(([itemId, file]) => ({ itemId, relativePath: file.path, revision: digest(file.bytes) }));
      const revision = digest(JSON.stringify(items));
      if (headers.get("If-None-Match") === `"${revision}"`) return new Response(null, { status: 304 });
      return Response.json({ items, revision });
    }
    const stored = files.get(last);
    if (init?.method === "PATCH" || init?.method === "DELETE") {
      if (!stored || headers.get("If-Match") !== `"${digest(stored.bytes)}"` || decodeURIComponent(headers.get("X-TextText-Base-Path")!) !== stored.path) return Response.json({ status: "conflict" }, { status: 409 });
      if (init.method === "DELETE") { files.delete(last); return Response.json({ status: "deleted" }); }
      const body = JSON.parse(String(init.body)); stored.path = body.relativePath;
      return Response.json({ status: "moved" });
    }
    if (init?.method !== "PUT") {
      if (!stored) return Response.json({ error: "Not found" }, { status: 404 });
      return new Response(new Uint8Array(stored.bytes), { headers: { ETag: `"${digest(stored.bytes)}"`, "X-TextText-Path": encodeURIComponent(stored.path) } });
    }
    operations.push(headers.get("X-TextText-Operation-Id")!);
    if (failNextPut) { failNextPut = false; throw new Error("Connection lost"); }
    const expected = headers.get("If-Match"), create = headers.get("If-None-Match") === "*";
    if ((stored && create) || (stored && expected !== `"${digest(stored.bytes)}"`)) return Response.json({ status: "conflict" }, { status: 409 });
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
    const nextPath = decodeURIComponent(headers.get("X-TextText-Path")!);
    files.set(last, { path: nextPath, bytes });
    return Response.json({ status: "written", revision: digest(bytes), itemId: last, relativePath: nextPath });
  };
  return { id, path, files, operations, initial, transport: createWebVaultTransport("workspace", "Workspace", request), fail: () => { failNextPut = true; } };
}

describe("web file vault transport", () => {
  it("forwards only collaboration fields with cancellation and stable item identity", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport = createWebVaultTransport("workspace", "Workspace", async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/items")) return Response.json({ items: [{ itemId: "stable-id", relativePath: "Note.textpack", revision: "a".repeat(64) }], revision: "manifest" });
      return Response.json({ epoch: 1, seq: 0, update: "AAA=" });
    });
    expect(await transport.request("collaborationConfig", { path: "Note.textpack" })).toMatchObject({ workspaceId: "workspace", itemId: "stable-id" });
    const abort = new AbortController();
    await transport.request("collaborationRead", { itemId: "stable-id", epoch: 1, seq: 0, waitMs: 25000 }, abort.signal);
    expect(calls.at(-1)?.url).toBe("/api/vault/workspace/items/stable-id/collaboration?epoch=1&seq=0&waitMs=25000");
    expect(calls.at(-1)?.init?.signal).toBe(abort.signal);
    await transport.request("collaborationPush", { itemId: "stable-id", operationId: "op", epoch: 1, updates: ["AAA="], root: "/outside", actorUserId: "fake" }, abort.signal);
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ operationId: "op", epoch: 1, updates: ["AAA="] });
    transport.destroy();
    await expect(transport.request("collaborationRead", { itemId: "stable-id" })).rejects.toThrow("closed");
  });

  it("routes item presence with only session fields and the caller's abort signal", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport = createWebVaultTransport("workspace", "Workspace", async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ epoch: 1, presence: [] });
    });
    const abort = new AbortController();
    await transport.request("presenceRead", { itemId: "stable-id", root: "/private" }, abort.signal);
    expect(calls[0].url).toBe("/api/vault/workspace/items/stable-id/presence");
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.signal).toBe(abort.signal);
    await transport.request("presenceJoin", { itemId: "stable-id", awarenessClientId: 42, actorUserId: "forged" });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ join: true, awarenessClientId: 42 });
    await transport.request("presenceUpdate", { itemId: "stable-id", clientId: "session", sessionCredential: "v1:token", awareness: "AAA=", root: "/private" });
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ clientId: "session", sessionCredential: "v1:token", awareness: "AAA=" });
    await transport.request("presenceLeave", { itemId: "stable-id", clientId: "session", sessionCredential: "v1:token", root: "/private" });
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({ clientId: "session", sessionCredential: "v1:token", leave: true });
    transport.destroy();
  });

  it("reads a retained complete pack without writing and verifies its hash", async () => {
    const seed = fixture();
    const requests: string[] = [];
    const transport = createWebVaultTransport("workspace", "Workspace", async (url) => {
      requests.push(String(url));
      return new Response(new Uint8Array(seed.initial), { headers: { ETag: `"${digest(seed.initial)}"`, "X-TextText-Path": encodeURIComponent(seed.path) } });
    });
    const recovered = await transport.request("recoveryRead", { id: "opaque-token" }) as VaultFile & { data: string };
    expect(recovered.path).toBe(seed.path);
    expect(Buffer.from(recovered.data, "base64")).toEqual(Buffer.from(seed.initial));
    expect(requests).toEqual(["/api/vault/workspace/recovery?id=opaque-token"]);
    transport.destroy();
  });
  it("refuses an occupied exact import destination without suffixing or writing", async () => {
    const f = fixture();
    await expect(f.transport.request("importPack", { folder: "Notes", title: "Original", exactPath: f.path, data: "AA==" })).rejects.toThrow("already occupies");
    expect(f.operations).toEqual([]);
    expect(f.files.size).toBe(1);
  });

  it("imports complete packs with fresh identities and preserves existing files and opaque assets", async () => {
    const test = fixture();
    const data = Buffer.from(test.initial).toString("base64");
    const imported = await test.transport.request("importPack", { data, title: "Original", folder: "Notes" }) as VaultFile;
    expect(imported.path).toBe("Notes/Original 2.textpack");
    expect(imported.markdown).not.toContain(test.id);
    expect(test.files.get(test.id)!.bytes).toEqual(test.initial);
    const entry = [...test.files.values()].find((entry) => entry.path === imported.path)!;
    const unpacked = unzipSync(entry.bytes);
    expect(unpacked["Document.textbundle/assets/picture.bin"]).toEqual(new Uint8Array([0, 1, 255, 4]));
    expect(strFromU8(unpacked["Document.textbundle/agent-metadata.json"])).toBe('{"keep":true}');
    await expect(test.transport.request("importPack", { data, title: "Unsafe", folder: "../escape" })).rejects.toThrow("Invalid folder");
    await expect(test.transport.request("importPack", { data: "junk!!!!", title: "Invalid" })).rejects.toThrow("valid TextPack");
    expect(test.files.size).toBe(2);
    test.transport.destroy();
  });
  it("captures links and notes as complete self-contained TextPacks", async () => {
    const test = fixture();
    const link = await test.transport.request("create", { title: "Example", body: "https://example.com/read", kind: "bookmark", sourceURL: "https://example.com/read", folder: "Reading" }) as VaultFile;
    expect(readDocument(link).content.fields.sourceUrl).toBe("https://example.com/read");
    expect(readDocument(link).content.body).toBe("https://example.com/read");
    expect(JSON.parse(link.templateJSON!).id).toBe("texttext.bookmark");
    const note = await test.transport.request("create", { title: "Thought", body: "Keep this entire note." }) as VaultFile;
    expect(readDocument(note).content.body).toBe("Keep this entire note.");
    expect(JSON.parse(note.templateJSON!).id).toBe("texttext.note");
    await expect(test.transport.request("create", { title: "Invalid", sourceURL: "file:///etc/passwd" })).rejects.toThrow("HTTP or HTTPS");
  });
  it("renames and deletes with observed revisions, preserving cloned starter content and identity", async () => {
    const test = fixture();
    const source = await test.transport.request("read", { path: test.path }) as VaultFile;
    const clone = await test.transport.request("create", { title: "Starter", folder: "Projects", sourcePath: source.path, sourceHash: source.hash }) as VaultFile;
    expect(readDocument(clone)).toEqual(readDocument(source));
    expect(clone.assets).toEqual(source.assets);
    expect(clone.markdown).not.toContain(test.id);
    const moved = await test.transport.request("rename", { path: clone.path, hash: clone.hash, newPath: "Projects/Moved.textpack" }) as VaultFile;
    expect(moved.path).toBe("Projects/Moved.textpack");
    expect(moved.markdown).toBe(clone.markdown);
    await expect(test.transport.request("delete", { path: moved.path, hash: "0".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
    await test.transport.request("delete", { path: moved.path, hash: moved.hash });
    const listing = await test.transport.request("list", {}) as VaultListing;
    expect(listing.items.map((item) => item.path)).toEqual([test.path]);
    test.transport.destroy();
  });

  it("writes the same pack model while preserving asset bytes and unknown entries", async () => {
    const test = fixture();
    const file = await test.transport.request("read", { path: test.path }) as VaultFile;
    const document = readDocument(file); document.content.body = "Web edit\n\n";
    const saved = await test.transport.request("write", writePayload(file, document)) as VaultFile;
    expect(readDocument(saved)).toEqual(document);
    const unpacked = unzipSync(test.files.get(test.id)!.bytes);
    expect(unpacked["Document.textbundle/assets/picture.bin"]).toEqual(new Uint8Array([0, 1, 255, 4]));
    expect(strFromU8(unpacked["Document.textbundle/agent-metadata.json"])).toBe('{"keep":true}');
    test.transport.destroy();
  });
  it("keeps the read snapshot available for a conflict copy with original asset bytes", async () => {
    const test = fixture();
    const file = await test.transport.request("read", { path: test.path }) as VaultFile;
    const changed = openPack(test.initial, test.path, file.hash, test.id);
    changed.entries[changed.prefix + "assets/picture.bin"] = new Uint8Array([9, 9, 9]);
    const remote = { ...file, markdown: file.markdown.replace("Original body", "Remote body") };
    test.files.set(test.id, { path: test.path, bytes: encodePack(changed, remote) });
    const document = readDocument(file); document.content.body = "Conflicting local body";
    await expect(test.transport.request("write", writePayload(file, document))).rejects.toMatchObject({ code: "conflict", current: { markdown: remote.markdown } });
    const copied = await test.transport.request("create", { title: "Conflict copy", sourcePath: file.path, sourceHash: file.hash }) as VaultFile;
    expect(copied.path).not.toBe(test.path);
    expect(copied.assets?.[0].data).toBe("AAH/BA==");
    expect(copied.markdown).not.toContain(test.id);
    test.transport.destroy();
  });
  it("reuses operation identity after an interrupted upload and avoids name collisions", async () => {
    const test = fixture();
    const file = await test.transport.request("read", { path: test.path }) as VaultFile;
    const document = readDocument(file); document.content.body = "Changed";
    const payload = writePayload(file, document);
    test.fail();
    await expect(test.transport.request("write", payload)).rejects.toThrow("Connection lost");
    await test.transport.request("write", payload);
    expect(test.operations[0]).toBe(test.operations[1]);
    const created = await test.transport.request("create", { title: "Original", folder: "Notes" }) as VaultFile;
    expect(created.path).toBe("Notes/Original 2.textpack");
    const list = await test.transport.request("list", {}) as VaultListing;
    expect(list.items).toHaveLength(2);
    expect(await test.transport.refresh()).toBe(false);
    test.transport.destroy();
  });
});
