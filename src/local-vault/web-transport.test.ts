import { describe, expect, it, vi } from "vitest";
import { strToU8, strFromU8, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { createWebVaultTransport } from "./web-transport";
import { emptyPack, encodePack, openPack } from "./pack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { writePayload, readDocument } from "./model";
import type { VaultFile, VaultListing } from "./bridge";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const id = "0bd05f92-c562-4a78-8c0d-b5e41ca3215d", path = "Notes/Original.textpack";
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  document.content.title = "Original"; document.content.body = "Original body";
  const seed = { path, hash: "", markdown: `---\ntextTextId: "${id}"\n---\n\n` };
  const pack = emptyPack();
  pack.entries[pack.prefix + "assets/picture.bin"] = new Uint8Array([0, 1, 255, 4]);
  pack.entries[pack.prefix + "agent-metadata.json"] = strToU8('{"keep":true}');
  pack.entries[pack.prefix + "net.texttext.mutations/" + "a".repeat(64) + ".json"] = strToU8('{"fingerprint":"original"}');
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
function cachedOpenFixture() {
  const { id, path, initial } = fixture();
  const live = { bytes: initial, path, epoch: 1, seq: 0, allowed: true, canEdit: true,
    identityResponse: null as ((signal: AbortSignal | undefined) => Promise<Response>) | null,
    collaborationResponse: null as ((signal: AbortSignal | undefined) => Promise<Response>) | null };
  const calls = { items: 0, identity: 0, collaboration: 0 };
  const transport = createWebVaultTransport("workspace", "Workspace", async (url, init) => {
    const target = String(url);
    if (target.endsWith("/items")) return Response.json({ items: [{ itemId: id, relativePath: path, revision: digest(initial) }], revision: "manifest" });
    if (target.endsWith(`/${id}/collaboration`)) {
      calls.collaboration++;
      if (live.collaborationResponse) return live.collaborationResponse(init?.signal ?? undefined);
      if (!live.allowed) return Response.json({ error: "Access changed" }, { status: 403 });
      return Response.json({ epoch: live.epoch, seq: live.seq, revision: digest(live.bytes), relativePath: live.path,
        update: "AAA=", canEditContent: live.canEdit, canComment: true });
    }
    if (target.endsWith(`/${id}`)) {
      if (init?.method === "HEAD") {
        calls.identity++;
        if (live.identityResponse) return live.identityResponse(init?.signal ?? undefined);
        if (!live.allowed) return Response.json({ error: "Access changed" }, { status: 403 });
        return new Response(null, { status: 204, headers: { ETag: `"${digest(live.bytes)}"`, "X-TextText-Path": encodeURIComponent(live.path) } });
      }
      calls.items++;
      if (!live.allowed) return Response.json({ error: "Access changed" }, { status: 403 });
      return new Response(new Uint8Array(live.bytes), { headers: { ETag: `"${digest(live.bytes)}"`, "X-TextText-Path": encodeURIComponent(live.path) } });
    }
    throw new Error(`Unexpected request: ${target}`);
  });
  return { id, path, live, calls, transport };
}

describe("web file vault transport", () => {
  it("resolves a stable card identity after its TextPack moves", async () => {
    const test = fixture();
    expect(await test.transport.request("resolveItemId", { itemId: test.id })).toEqual({ path: test.path });
    test.files.get(test.id)!.path = "Notes/Moved.textpack";
    expect(await test.transport.request("resolveItemId", { itemId: test.id })).toEqual({ path: "Notes/Moved.textpack" });
    await expect(test.transport.request("resolveItemId", { itemId: "missing-card" })).rejects.toMatchObject({ code: "not_found" });
    await expect(test.transport.request("resolveItemId", { itemId: "../bad" })).rejects.toMatchObject({ code: "invalid_id" });
    test.transport.destroy();
  });
  it("loads saved feed metadata with one bounded server request", async () => {
    const urls: string[] = [];
    const transport = createWebVaultTransport("workspace", "Workspace", async url => {
      urls.push(String(url));
      return Response.json({ hashes: ["a".repeat(64)], entries: [{ hash: "a".repeat(64), path: "Bookmarks/Story.textpack", title: "Story", source: "News", keptAt: "2026-10-02T10:00:00Z" }] });
    });
    const result = await transport.request("keptFeedEntries", {});
    expect(result).toMatchObject({ hashes: ["a".repeat(64)] });
    expect(urls).toEqual(["/api/vault/workspace/items?keptFeedEntries=1"]);
    transport.destroy();
  });
  it("loads unsaved read history through its bounded vault request", async () => {
    const urls: string[] = [];
    const transport = createWebVaultTransport("workspace", "Workspace", async url => {
      urls.push(String(url));
      return Response.json({ hashes: [], entries: [] });
    });
    expect(await transport.request("readFeedEntries", {})).toEqual({ hashes: [], entries: [] });
    expect(urls).toEqual(["/api/vault/workspace/items?readFeedEntries=1"]);
    transport.destroy();
  });
  it("reuses a parsed pack only after a fresh matching collaboration read, including a permission downgrade", async () => {
    const { id, path, live, calls, transport } = cachedOpenFixture();
    const first = await transport.request("read", { path, prefetchCollaboration: true }) as VaultFile;
    await transport.request("collaborationRead", { itemId: id });
    live.canEdit = false;
    const second = await transport.request("read", { path, prefetchCollaboration: true }) as VaultFile;
    const baseline = await transport.request("collaborationRead", { itemId: id }) as { canEditContent: boolean };
    expect(second).toBe(first);
    expect(baseline.canEditContent).toBe(false);
    expect(calls).toEqual({ items: 1, identity: 1, collaboration: 2 });
    transport.destroy();
  });

  it("never returns cached bytes after read access is revoked", async () => {
    const { id, path, live, calls, transport } = cachedOpenFixture();
    await transport.request("read", { path, prefetchCollaboration: true });
    await transport.request("collaborationRead", { itemId: id });
    live.allowed = false;
    await expect(transport.request("read", { path, prefetchCollaboration: true })).rejects.toMatchObject({ code: "403" });
    expect(calls).toEqual({ items: 1, identity: 1, collaboration: 2 });
    transport.destroy();
  });

  it("fetches changed bytes or a moved path, while accepting a new epoch only with a fresh response", async () => {
    const { id, path, live, calls, transport } = cachedOpenFixture();
    const first = await transport.request("read", { path, prefetchCollaboration: true }) as VaultFile;
    await transport.request("collaborationRead", { itemId: id });
    const unpacked = openPack(live.bytes, path, first.hash, id);
    const changed = readDocument(unpacked.file); changed.content.body = "Fresh external edit";
    live.bytes = encodePack(unpacked, writePayload(unpacked.file, changed)); live.epoch = 2;
    const updated = await transport.request("read", { path, prefetchCollaboration: true }) as VaultFile;
    expect(updated.hash).not.toBe(first.hash);
    expect(readDocument(updated).content.body).toBe("Fresh external edit");
    expect((await transport.request("collaborationRead", { itemId: id }) as { epoch: number }).epoch).toBe(2);
    expect(calls.items).toBe(2);
    live.epoch = 3;
    const newEpoch = await transport.request("read", { path, prefetchCollaboration: true }) as VaultFile;
    expect(newEpoch).toBe(updated);
    expect((await transport.request("collaborationRead", { itemId: id }) as { epoch: number }).epoch).toBe(3);
    expect(calls.items).toBe(2);
    live.path = "Moved.textpack";
    const moved = await transport.request("read", { path, prefetchCollaboration: true }) as VaultFile;
    expect(moved.path).toBe(live.path);
    expect(calls.items).toBe(3);
    transport.destroy();
  });

  it("aborts a held warm revalidation without exposing cached bytes or leaving its prefetch alive", async () => {
    const { id, path, live, calls, transport } = cachedOpenFixture();
    await transport.request("read", { path, prefetchCollaboration: true });
    await transport.request("collaborationRead", { itemId: id });
    const started = deferred<AbortSignal | undefined>();
    live.identityResponse = signal => { started.resolve(signal); return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
    }); };
    const controller = new AbortController();
    const opening = transport.request("read", { path, prefetchCollaboration: true }, controller.signal);
    const pendingSignal = await started.promise;
    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect(pendingSignal?.aborted).toBe(true);
    expect(calls.items).toBe(1);
    live.identityResponse = null;
    await expect(transport.request("read", { path, prefetchCollaboration: true })).resolves.toMatchObject({ path });
    expect(calls.collaboration).toBe(3);
    transport.destroy();
  });

  it("starts the initial collaboration read alongside an explicit item open", async () => {
    const { id, path, initial } = fixture();
    const revision = digest(initial);
    const itemStarted = deferred<void>(), collaborationStarted = deferred<void>();
    const releaseItem = deferred<void>(), releaseCollaboration = deferred<void>();
    const calls: string[] = [];
    const state = { epoch: 1, seq: 0, revision, relativePath: path, update: "AAA=", canEditContent: true, canComment: true };
    const transport = createWebVaultTransport("workspace", "Workspace", async url => {
      const target = String(url); calls.push(target);
      if (target.endsWith("/items")) return Response.json({ items: [{ itemId: id, relativePath: path, revision }], revision: "manifest" });
      if (target.endsWith(`/${id}`)) {
        itemStarted.resolve(); await releaseItem.promise;
        return new Response(new Uint8Array(initial), { headers: { ETag: `"${revision}"`, "X-TextText-Path": encodeURIComponent(path) } });
      }
      if (target.includes(`/${id}/collaboration`)) {
        collaborationStarted.resolve(); await releaseCollaboration.promise;
        return Response.json(state);
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    const opening = transport.request("read", { path, prefetchCollaboration: true });
    await Promise.all([itemStarted.promise, collaborationStarted.promise]);
    releaseItem.resolve();
    expect((await opening as VaultFile).hash).toBe(revision);
    const baseline = transport.request("collaborationRead", { itemId: id });
    releaseCollaboration.resolve();
    expect(await baseline).toEqual(state);
    expect(calls.filter(call => call.endsWith(`/${id}/collaboration`))).toHaveLength(1);
    await transport.request("collaborationRead", { itemId: id, epoch: 1, seq: 0, waitMs: 25000 });
    expect(calls.filter(call => call.includes(`/${id}/collaboration`))).toHaveLength(2);
    transport.destroy();
  });

  it("refetches a baseline when the prefetched revision or path does not match the verified pack", async () => {
    const { id, path, initial } = fixture();
    const revision = digest(initial);
    for (const mismatch of [{ revision: "b".repeat(64), relativePath: path },
      { revision, relativePath: "Moved.textpack" }]) {
      let collaborationReads = 0;
      const transport = createWebVaultTransport("workspace", "Workspace", async url => {
        const target = String(url);
        if (target.endsWith("/items")) return Response.json({ items: [{ itemId: id, relativePath: path, revision }], revision: "manifest" });
        if (target.endsWith(`/${id}`)) return new Response(new Uint8Array(initial), { headers: { ETag: `"${revision}"`, "X-TextText-Path": encodeURIComponent(path) } });
        if (target.endsWith(`/${id}/collaboration`)) {
          collaborationReads++;
          return Response.json({ epoch: 1, seq: 0, update: "AAA=", revision: collaborationReads === 1 ? mismatch.revision : revision,
            relativePath: collaborationReads === 1 ? mismatch.relativePath : path });
        }
        throw new Error(`Unexpected request: ${target}`);
      });
      await transport.request("read", { path, prefetchCollaboration: true });
      expect(await transport.request("collaborationRead", { itemId: id })).toMatchObject({ revision, relativePath: path });
      expect(collaborationReads).toBe(2);
      transport.destroy();
    }
  });

  it("rechecks access after a failed speculative collaboration read", async () => {
    const { id, path, initial } = fixture();
    const revision = digest(initial);
    let collaborationReads = 0;
    const transport = createWebVaultTransport("workspace", "Workspace", async url => {
      const target = String(url);
      if (target.endsWith("/items")) return Response.json({ items: [{ itemId: id, relativePath: path, revision }], revision: "manifest" });
      if (target.endsWith(`/${id}`)) return new Response(new Uint8Array(initial), { headers: { ETag: `"${revision}"` } });
      if (target.endsWith(`/${id}/collaboration`)) {
        collaborationReads++;
        return collaborationReads === 1 ? Response.json({ error: "Access changed" }, { status: 403 })
          : Response.json({ epoch: 1, seq: 0, update: "AAA=", revision, relativePath: path });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    await transport.request("read", { path, prefetchCollaboration: true });
    expect(await transport.request("collaborationRead", { itemId: id })).toMatchObject({ revision, relativePath: path });
    expect(collaborationReads).toBe(2);
    transport.destroy();
  });

  it("aborts an unused prefetch and propagates cancellation while consuming one", async () => {
    const { id, path, initial } = fixture();
    const revision = digest(initial);
    const signals: AbortSignal[] = [];
    const transport = createWebVaultTransport("workspace", "Workspace", async (url, init) => {
      const target = String(url);
      if (target.endsWith("/items")) return Response.json({ items: [{ itemId: id, relativePath: path, revision }], revision: "manifest" });
      if (target.endsWith(`/${id}`)) return new Response(new Uint8Array(initial), { headers: { ETag: `"${revision}"` } });
      if (target.endsWith(`/${id}/collaboration`)) {
        signals.push(init!.signal!);
        if (signals.length > 1) return Response.json({ epoch: 1, seq: 0, revision, relativePath: path,
          update: "AAA=", canEditContent: true, canComment: true });
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true }));
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    await transport.request("read", { path, prefetchCollaboration: true });
    const abort = new AbortController();
    const baseline = transport.request("collaborationRead", { itemId: id }, abort.signal);
    abort.abort();
    await expect(baseline).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0].aborted).toBe(true);
    await transport.request("read", { path, prefetchCollaboration: true });
    transport.destroy();
    expect(signals[1].aborted).toBe(true);
  });

  it("routes feed reads to the selected workspace with only approved fields", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport = createWebVaultTransport("selected-workspace", "Workspace", async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ candidates: [], entries: [] });
    });
    const signal = new AbortController().signal;
    await transport.request("feedDiscover", { address: "https://example.com", workspaceId: "forged", token: "forged" }, signal);
    await transport.request("feedRead", { feedURL: "https://example.com/feed", root: "/private" });
    await transport.request("feedEntry", { feedURL: "https://example.com/feed", externalKey: "entry-1", workspaceId: "forged" });
    expect(calls.map(call => call.url)).toEqual(Array(3).fill("/api/vault/selected-workspace/feeds"));
    expect(calls[0].init?.signal).toBe(signal);
    expect(calls.map(call => JSON.parse(String(call.init?.body)))).toEqual([
      { action: "discover", address: "https://example.com" },
      { action: "read", feedURL: "https://example.com/feed" },
      { action: "entry", feedURL: "https://example.com/feed", externalKey: "entry-1" },
    ]);
    await expect(transport.request("feedEntry", { feedURL: "https://example.com/feed", externalKey: "" })).rejects.toThrow("Choose a feed entry");
    transport.destroy();
  });

  it("searches saved text through one scoped server request", async () => {
    const calls: string[] = [];
    const transport = createWebVaultTransport("workspace", "Workspace", async url => {
      calls.push(String(url));
      return Response.json({ items: [{ path: "Bookmarks/Daily.textpack", title: "Daily", snippet: "Matched deep in article" }], truncated: false, skippedCount: 0 });
    });
    expect(await transport.request("search", { query: "deep article", folder: "Bookmarks" })).toMatchObject({
      items: [{ path: "Bookmarks/Daily.textpack", snippet: "Matched deep in article" }],
    });
    expect(calls).toEqual(["/api/vault/workspace/search?q=deep%20article&folder=Bookmarks"]);
    transport.destroy();
  });

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

  it("routes sharing through the selected workspace with only approved fields", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport = createWebVaultTransport("selected-workspace", "Workspace", async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ grants: [] });
    });
    const scope = { scopeType: "folder", scopeKey: "Research/Shared", workspaceId: "forged", root: "/private" };
    await transport.request("shareList", scope);
    expect(calls[0].url).toBe("/api/vault/selected-workspace/shares?scopeType=folder&scopeKey=Research%2FShared");
    expect(calls[0].init?.method).toBe("GET");
    await transport.request("shareInvite", { ...scope, email: "reader@example.com", role: "commenter" });
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ scopeType: "folder", scopeKey: "Research/Shared", email: "reader@example.com", role: "commenter" });
    await transport.request("shareRole", { ...scope, grantId: "grant", role: "viewer", token: "forged" });
    expect(calls[2].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ scopeType: "folder", scopeKey: "Research/Shared", grantId: "grant", role: "viewer" });
    await transport.request("shareRevoke", { ...scope, grantId: "grant" });
    expect(calls[3].init?.method).toBe("DELETE");
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({ scopeType: "folder", scopeKey: "Research/Shared", grantId: "grant" });
    await expect(transport.request("shareList", { scopeType: "folder", scopeKey: "" })).rejects.toThrow("Choose a file or folder");
    transport.destroy();
  });

  it("routes item comments through the selected workspace with bounded fields", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport = createWebVaultTransport("selected-workspace", "Workspace", async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ comments: [], nextCursor: null, revision: "revision" });
    });
    const id = "0bd05f92-c562-4a78-8c0d-b5e41ca3215d";
    const operationId = "2bd05f92-c562-4a78-8c0d-b5e41ca3215d";
    const abort = new AbortController();
    await transport.request("commentsRead", { itemId: id, limit: 100, after: operationId, workspaceId: "forged" }, abort.signal);
    expect(calls[0].url).toBe(`/api/vault/selected-workspace/items/${id}/comments?limit=100&after=${operationId}`);
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.signal).toBe(abort.signal);
    await transport.request("commentsAdd", { itemId: id, operationId, body: "A useful note", parentId: id, actorUserId: "forged" });
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ operationId, body: "A useful note", parentId: id });
    await transport.request("commentsResolve", { itemId: id, operationId, commentId: id, resolved: true, token: "forged" });
    expect(calls[2].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ operationId, commentId: id, resolved: true });
    await expect(transport.request("commentsAdd", { itemId: id, operationId, body: " " })).rejects.toThrow("Write a comment");
    await expect(transport.request("commentsRead", { itemId: id, limit: 101 })).rejects.toThrow("page size");
    transport.destroy();
  });

  it("publishes only the selected item in the bound workspace with a checked revision", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const itemId = "0bd05f92-c562-4a78-8c0d-b5e41ca3215d";
    const operationId = "2bd05f92-c562-4a78-8c0d-b5e41ca3215d";
    const revision = "a".repeat(64);
    const transport = createWebVaultTransport("selected-workspace", "Workspace", async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ itemId, revision, published: init?.method === "POST", publicPath: "/v/selected-workspace/" + itemId });
    });
    await transport.request("publicationRead", { itemId, workspaceId: "forged", path: "/private" });
    expect(calls[0].url).toBe(`/api/vault/selected-workspace/items/${itemId}/publication`);
    expect(calls[0].init?.method).toBe("GET");
    await transport.request("publicationSet", { itemId, operationId, baseRevision: revision, published: true,
      workspaceId: "forged", actorUserId: "forged", publicPath: "/evil" });
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ operationId, baseRevision: revision, published: true });
    await expect(transport.request("publicationSet", { itemId, operationId, baseRevision: "stale", published: false })).rejects.toThrow("Invalid publication request");
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
    expect(Object.keys(unpacked).some(name => name.includes("/net.texttext.mutations/"))).toBe(false);
    await expect(test.transport.request("importPack", { data, title: "Unsafe", folder: "../escape" })).rejects.toThrow("Invalid folder");
    await expect(test.transport.request("importPack", { data: "junk!!!!", title: "Invalid" })).rejects.toThrow("valid TextPack");
    expect(test.files.size).toBe(2);
    test.transport.destroy();
  });
  it("captures links and notes as complete self-contained TextPacks", async () => {
    const test = fixture();
    const link = await test.transport.request("create", { title: "Example", body: "https://example.com/read", kind: "bookmark", sourceURL: "https://example.com/read", folder: "Reading" }) as VaultFile;
    expect(readDocument(link).content.fields).toMatchObject({ sourceUrl: "https://example.com/read", captureStatus: "pending" });
    expect(readDocument(link).content.body).toBe("https://example.com/read");
    expect(JSON.parse(link.templateJSON!).id).toBe("texttext.bookmark");
    const note = await test.transport.request("create", { title: "Thought", body: "Keep this entire note." }) as VaultFile;
    expect(readDocument(note).content.body).toBe("Keep this entire note.");
    expect(JSON.parse(note.templateJSON!).id).toBe("texttext.note");
    for (const kind of ["article", "gallery", "talk"]) {
      const created = await test.transport.request("create", { title: kind, body: "Agent-created content", kind }) as VaultFile;
      expect(readDocument(created).content.body).toBe("Agent-created content");
      expect(readDocument(created).presentation.template.id).toBe(`texttext.${kind}`);
      expect(JSON.parse(created.templateJSON!).id).toBe(`texttext.${kind}`);
    }
    await expect(test.transport.request("create", { title: "Unsupported", kind: "unknown" })).rejects.toThrow("Unsupported item type");
    await expect(test.transport.request("create", { title: "Invalid", sourceURL: "file:///etc/passwd" })).rejects.toThrow("HTTP or HTTPS");
  });
  it("renames and deletes with observed revisions, preserving cloned starter content and identity", async () => {
    const test = fixture();
    const source = await test.transport.request("read", { path: test.path }) as VaultFile;
    const clone = await test.transport.request("create", { title: "Starter", folder: "Projects", sourcePath: source.path, sourceHash: source.hash }) as VaultFile;
    expect(readDocument(clone)).toEqual(readDocument(source));
    expect(clone.assets).toEqual(source.assets);
    expect(clone.markdown).not.toContain(test.id);
    const cloneBytes = [...test.files.values()].find(entry => entry.path === clone.path)!.bytes;
    expect(Object.keys(unzipSync(cloneBytes)).some(name => name.includes("/net.texttext.mutations/"))).toBe(false);
    const moved = await test.transport.request("rename", { path: clone.path, hash: clone.hash, newPath: "Projects/Moved.textpack" }) as VaultFile;
    expect(moved.path).toBe("Projects/Moved.textpack");
    expect(moved.markdown).toBe(clone.markdown);
    await expect(test.transport.request("delete", { path: moved.path, hash: "0".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
    await test.transport.request("delete", { path: moved.path, hash: moved.hash });
    const listing = await test.transport.request("list", {}) as VaultListing;
    expect(listing.items.map((item) => item.path)).toEqual([test.path]);
    test.transport.destroy();
  });

  it("publishes a complete reusable look in one mutation and rejects malformed metadata before publishing", async () => {
    const test = fixture();
    const source = await test.transport.request("read", { path: test.path }) as VaultFile;
    const document = readDocument(source);
    const template = { ...JSON.parse(source.templateJSON!), id: "local.saved-look", version: 1, name: "Saved look" };
    document.presentation.template = { id: template.id, version: template.version };
    const params = { title: "Saved look", folder: "Templates", sourcePath: source.path, sourceHash: source.hash,
      documentJSON: JSON.stringify(document), templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: null };
    const before = test.operations.length;
    const saved = await test.transport.request("create", params) as VaultFile;
    expect(test.operations.length - before).toBe(1);
    expect(readDocument(saved)).toEqual(document);
    expect(JSON.parse(saved.templateJSON!).id).toBe(template.id);
    expect(saved.assets).toEqual(source.assets);
    const bytes = [...test.files.values()].find(entry => entry.path === saved.path)!.bytes;
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).some(name => name.includes("/net.texttext.mutations/"))).toBe(false);
    expect(strFromU8(Object.entries(entries).find(([name]) => name.endsWith("/agent-metadata.json"))![1])).toBe('{"keep":true}');
    const count = test.files.size;
    await expect(test.transport.request("create", { ...params, title: "Broken", templateJSON: "{}" })).rejects.toThrow();
    expect(test.files.size).toBe(count);
    expect(test.operations.length - before).toBe(1);
    expect(test.files.get(test.id)!.bytes).toEqual(test.initial);
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
    expect(strFromU8(unpacked["Document.textbundle/net.texttext.mutations/" + "a".repeat(64) + ".json"])).toBe('{"fingerprint":"original"}');
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


describe("account profile transport", () => {
  it("reads only the bound workspace account with cancellation and no caching", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const request: typeof fetch = async (url, init) => { calls.push([String(url), init]); return Response.json({ email: "writer@example.test", name: null, identities: ["apple"], workspaceName: "My notes" }); };
    const transport = createWebVaultTransport("bound-workspace", "My notes", request);
    const controller = new AbortController();
    expect(await transport.request("accountRead", {}, controller.signal)).toMatchObject({ email: "writer@example.test" });
    expect(calls).toEqual([["/api/vault/bound-workspace/account", { credentials: "same-origin", cache: "no-store", signal: controller.signal }]]);
    await expect(transport.request("accountRead", { workspaceId: "someone-else" })).rejects.toThrow("Invalid account request");
    expect(calls).toHaveLength(1);
    transport.destroy();
  });
});

 it("retains empty folder destinations across a cached web listing", async () => {
  let calls = 0;
  const request: typeof fetch = async () => ++calls === 1
    ? Response.json({ items: [], folders: ["Feeds", "Notes/Research"], revision: "folders" })
    : new Response(null, { status: 304 });
  const transport = createWebVaultTransport("workspace", "Workspace", request);
  expect(await transport.request("list", {})).toMatchObject({ folders: ["Feeds", "Notes/Research"], items: [] });
  expect(await transport.request("list", {})).toMatchObject({ folders: ["Feeds", "Notes/Research"], items: [] });
  transport.destroy();
});

it("restores Trash with caller retry identity and invalidates the same-item manifest", async () => {
  const payload = { itemId: "same-item", operationId: "retry-operation", basePath: "Notes/Deleted.textpack", baseRevision: "a".repeat(64), relativePath: "Notes/Deleted.textpack" };
  const requests: Array<{url: string; body: unknown}> = [];
  let restored = false;
  const transport = createWebVaultTransport("workspace", "Workspace", async (url, init) => {
    requests.push({url:String(url),body:init?.body ? JSON.parse(String(init.body)) : null});
    if(String(url).endsWith("/trash")) { if(init?.method === "POST") { if(!restored){restored=true;throw Error("Lost response");} return Response.json({status:"restored",itemId:payload.itemId,relativePath:payload.relativePath,revision:"b".repeat(64)}); } return Response.json({items:[]}); }
    return Response.json({items:[],revision:"r"});
  });
  await expect(transport.request("trashRestore",payload)).rejects.toThrow("Lost response");
  expect(await transport.request("trashRestore",payload)).toMatchObject({status:"restored",itemId:"same-item"});
  expect(requests.map(request=>request.body)).toEqual([payload,payload]);
  expect(requests.every(request=>request.url==="/api/vault/workspace/trash")).toBe(true);
});

it("releases a stalled manifest request even when fetch ignores abort",async()=>{
 vi.useFakeTimers();try {
  const request=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValue(new Response(JSON.stringify({revision:"next",items:[],folders:[]})));
  const transport=createWebVaultTransport("workspace","Fixture",request);
  const first=expect(transport.request("list",{})).rejects.toMatchObject({code:"408"});await vi.runAllTimersAsync();await first;
  expect(await transport.request("list",{})).toMatchObject({items:[]});expect(request).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});

it("times out a stalled manifest body and ignores its eventual stale result",async()=>{
 vi.useFakeTimers();try {
  const body=deferred<unknown>();
  const request=vi.fn().mockResolvedValueOnce({status:200,ok:true,json:()=>body.promise})
    .mockResolvedValueOnce(Response.json({revision:"fresh",items:[{itemId:"fresh",relativePath:"Notes/Fresh.textpack"}],folders:[]}))
    .mockResolvedValue(new Response(null,{status:304}));
  const transport=createWebVaultTransport("workspace","Fixture",request);
  const first=expect(transport.request("list",{})).rejects.toMatchObject({code:"408"});await vi.runAllTimersAsync();await first;
  expect(await transport.request("list",{})).toMatchObject({items:[{itemId:"fresh"}]});
  body.resolve({revision:"stale",items:[],folders:[]});await Promise.resolve();await Promise.resolve();
  expect(await transport.request("list",{})).toMatchObject({items:[{itemId:"fresh"}]});
 }finally{vi.useRealTimers();}
});

it("stages a folder move review with authenticated scoped transport and never writes items", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ reviewPath: "/proposals/review-id" }, { status: 201 }));
  const transport = createWebVaultTransport("workspace", "Workspace", request);
  expect(await transport.request("folderMoveReview", { source: "Notes", destination: "Archive/Notes" })).toEqual({ reviewPath: "/proposals/review-id" });
  expect(request).toHaveBeenCalledExactlyOnceWith("/api/vault/workspace/folder-moves", expect.objectContaining({
    method: "POST", credentials: "same-origin", cache: "no-store", body: JSON.stringify({ source: "Notes", destination: "Archive/Notes" }),
  }));
  await expect(transport.request("folderMoveReview", { source: "Notes", destination: "Archive/Notes", approved: true })).rejects.toThrow("Choose a source");
  expect(request).toHaveBeenCalledOnce();
  transport.destroy();
});
