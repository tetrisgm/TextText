import { boundedBootstrapRead } from "./bootstrap-retry";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { VaultError, type VaultFile, type VaultListing, type VaultTransport } from "./bridge";
import { emptyPack, encodePack, openPack, packIdentity, replacePackIdentity, type OpenPack, type PackAssetAddition } from "./pack";
import { writePayload } from "./model";
import { imageType } from "./image-import";

type Manifest = { folders?: string[]; items: { itemId: string; relativePath: string; revision: string }[]; revision: string };
type OpenCollaborationPrefetch = {
  itemId: string; controller: AbortController; result: Promise<unknown | null>;
  revision?: string; path?: string; timer?: ReturnType<typeof setTimeout>;
};
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map((value) => value.toString(16).padStart(2, "0")).join("");
const safeName = (value: string) => value.trim().replace(/[\\/:\x00-\x1f]/g, "-").replace(/^\.+/, "").slice(0, 120) || "Untitled";

function addedAssets(value: unknown): PackAssetAddition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error("Invalid pasted image data.");
  let total = 0;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid pasted image data.");
    const { filename, data, contentType, remoteURL } = entry as Record<string, unknown>;
    if (typeof filename !== "string" || typeof contentType !== "string" || typeof data !== "string" || !data.length || data.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new Error("Invalid pasted image data.");
    }
    const decoded = atob(data);
    if (btoa(decoded) !== data) throw new Error("Invalid pasted image data.");
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    const detected = imageType(bytes);
    const extension = filename.split(".").at(-1)?.toLocaleLowerCase();
    if (detected.contentType !== contentType || (detected.extension === "jpg" ? !["jpg", "jpeg"].includes(extension ?? "") : extension !== detected.extension)) {
      throw new Error("Invalid pasted image data.");
    }
    let source: string | undefined;
    if (remoteURL !== undefined) {
      if (typeof remoteURL !== "string") throw new Error("Invalid pasted image data.");
      const url = new URL(remoteURL);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096) throw new Error("Invalid pasted image data.");
      source = url.href;
    }
    total += bytes.length;
    if (total > 40 * 1024 * 1024) throw new Error("Pasted images exceed 40 MiB.");
    return { filename, data: bytes, contentType, ...(source ? { remoteURL: source } : {}) };
  });
}

export function createWebVaultTransport(workspaceId: string, name = "Workspace", request: typeof fetch = fetch): { request: VaultTransport; refresh: () => Promise<boolean>; wait: (signal: AbortSignal) => Promise<boolean>; destroy: () => void } {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workspaceId)) throw new Error("Invalid workspace identifier.");
  const base = `/api/vault/${encodeURIComponent(workspaceId)}/items`;
  let manifest: Manifest | null = null;
  let listingRequest: Promise<VaultListing> | null = null;
  const packs = new Map<string, OpenPack>();
  const operations = new Map<string, string>();
  let openCollaboration: OpenCollaborationPrefetch | null = null;
  let destroyed = false;
  const cancelOpenCollaboration = () => {
    if (!openCollaboration) return;
    clearTimeout(openCollaboration.timer);
    openCollaboration.controller.abort();
    openCollaboration = null;
  };
  const remember = (pack: OpenPack) => {
    packs.delete(pack.file.hash); packs.set(pack.file.hash, pack);
    // Keep the current baseline and one changed replica for conflict copies.
    while (packs.size > 2) packs.delete(packs.keys().next().value!);
    return pack.file;
  };
  const failure = async (response: Response) => {
    let message = `The workspace request failed (${response.status}).`;
    try { const payload = await response.json(); if (typeof payload.error === "string") message = payload.error; } catch { /* HTTP status is sufficient. */ }
    return new VaultError(message, response.status === 401 ? "unauthorized" : String(response.status));
  };
  const listing = async (): Promise<VaultListing> => {
    if (listingRequest) return listingRequest;
    listingRequest = (async () => {
      const next = await boundedBootstrapRead(async signal => {
        const response = await request(base, { signal, credentials: "same-origin", cache: "no-store", headers: manifest ? { "If-None-Match": `"${manifest.revision}"` } : {} });
        if (response.status === 304) return null;
        if (!response.ok) throw await failure(response);
        return await response.json() as Manifest;
      }, new AbortController().signal);
      // Publish only after the complete body finishes within its deadline.
      // A late timed-out response must never replace a newer manifest.
      if (next) manifest = next;
      if (!manifest) throw new Error("The workspace listing was empty.");
      return { root: `vault:${workspaceId}`, name, folders: manifest.folders ?? [], items: manifest.items.map((item) => ({ path: item.relativePath, itemId: item.itemId })) };
    })().finally(() => { listingRequest = null; });
    return listingRequest;
  };
  const read = async (path: string, prefetchCollaboration = false, signal?: AbortSignal): Promise<VaultFile> => {
    if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    if (!manifest) await listing();
    if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    let item = manifest!.items.find((entry) => entry.relativePath === path);
    if (!item) { await listing(); item = manifest!.items.find((entry) => entry.relativePath === path); }
    if (!item) throw new VaultError("This file no longer exists in the workspace.", "not_found");
    const cached = prefetchCollaboration ? [...packs.values()].reverse().find(pack => pack.itemId === item.itemId && pack.file.path === path) : null;
    const cachedIdentity = cached ? request(`${base}/${encodeURIComponent(item.itemId)}`, {
      method: "HEAD", credentials: "same-origin", cache: "no-store", signal,
    }) : null;
    let prefetch: OpenCollaborationPrefetch | null = null;
    let abortPrefetch: (() => void) | null = null;
    if (prefetchCollaboration) {
      cancelOpenCollaboration();
      const controller = new AbortController();
      abortPrefetch = () => controller.abort();
      signal?.addEventListener("abort", abortPrefetch, { once: true });
      prefetch = { itemId: item.itemId, controller,
        // A failed speculative read is retried normally when the editor starts.
        result: request(`${base}/${encodeURIComponent(item.itemId)}/collaboration`, {
          method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        }).then(async response => response.ok ? response.json() : null, () => null).catch(() => null),
      };
      openCollaboration = prefetch;
    }
    const armPrefetch = (opened: VaultFile) => {
      if (!prefetch || openCollaboration !== prefetch) return;
      prefetch.revision = opened.hash; prefetch.path = opened.path;
      prefetch.timer = setTimeout(() => { if (openCollaboration === prefetch) cancelOpenCollaboration(); }, 2000);
    };
    try {
      if (cached && prefetch) {
        const identity = await cachedIdentity!;
        if (signal?.aborted || destroyed || openCollaboration !== prefetch) throw new DOMException("Request canceled", "AbortError");
        if (!identity.ok) throw await failure(identity);
        const revision = identity.headers.get("ETag")?.replace(/^"|"$/g, "");
        const storedPath = identity.headers.get("X-TextText-Path");
        if (revision === cached.file.hash && storedPath && decodeURIComponent(storedPath) === cached.file.path) {
          const opened = remember(cached);
          armPrefetch(opened);
          return opened;
        }
      }
      const response = await request(`${base}/${encodeURIComponent(item.itemId)}`, { credentials: "same-origin", cache: "no-store", signal });
      if (signal?.aborted || destroyed || (prefetch && openCollaboration !== prefetch)) throw new DOMException("Request canceled", "AbortError");
      if (!response.ok) throw await failure(response);
      const revision = response.headers.get("ETag")?.replace(/^"|"$/g, "");
      if (!revision || !/^[a-f0-9]{64}$/.test(revision)) throw new Error("The server did not return a file revision.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const verified = await digest(bytes);
      if (signal?.aborted || destroyed || (prefetch && openCollaboration !== prefetch)) throw new DOMException("Request canceled", "AbortError");
      if (verified !== revision) throw new Error("The downloaded TextPack did not match its revision.");
      const storedPath = response.headers.get("X-TextText-Path");
      const opened = remember(openPack(bytes, storedPath ? decodeURIComponent(storedPath) : path, revision, item.itemId));
      armPrefetch(opened);
      return opened;
    } catch (error) {
      if (prefetch && openCollaboration === prefetch) cancelOpenCollaboration();
      throw error;
    } finally {
      if (abortPrefetch) signal?.removeEventListener("abort", abortPrefetch);
    }
  };
  const commit = async (itemId: string, path: string, bytes: Uint8Array, baseRevision: string | null): Promise<VaultFile> => {
    const revision = await digest(bytes);
    const operationKey = `${itemId}:${baseRevision ?? "new"}:${revision}`;
    const operationId = operations.get(operationKey) ?? crypto.randomUUID();
    operations.set(operationKey, operationId);
    const response = await request(`${base}/${encodeURIComponent(itemId)}`, {
      method: "PUT", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/zip", "X-TextText-Path": encodeURIComponent(path), "X-TextText-Operation-Id": operationId,
        ...(baseRevision ? { "If-Match": `"${baseRevision}"` } : { "If-None-Match": "*" }) },
      body: new Uint8Array(bytes),
    });
    if (response.status === 409) {
      const result = await response.json();
      operations.delete(operationKey);
      if (result.status === "conflict") throw new VaultError("This file changed elsewhere. Your edits have been preserved.", "conflict", await read(path));
      throw new VaultError(result.error ?? "The file could not be saved at this path.", "path_conflict");
    }
    if (!response.ok) throw await failure(response);
    const result = await response.json();
    operations.delete(operationKey);
    if (result.status !== "written") throw new Error("The server did not confirm the file save.");
    const entry = { itemId, relativePath: path, revision: result.revision };
    if (manifest) manifest = { ...manifest, items: [...manifest.items.filter((item) => item.itemId !== itemId), entry] };
    if (result.revision !== revision) return read(path); // The server merged another replica.
    return remember(openPack(bytes, path, revision, itemId));
  };
  const transport: VaultTransport = async (method, params, signal) => {
    if (destroyed) throw new Error("This workspace has closed.");
    if (method === "workspacesList") {
      if (Object.keys(params).length) throw new Error("Invalid workspace request.");
      const response = await request("/api/vault/workspaces", { credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw await failure(response);
      const value = await response.json();
      return { currentId: workspaceId, workspaces: value.workspaces };
    }
    if (method === "accountRead") {
      if (Object.keys(params).length) throw new Error("Invalid account request.");
      const response = await request(`/api/vault/${encodeURIComponent(workspaceId)}/account`, { credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw await failure(response);
      return response.json();
    }
    if (method === "keptFeedEntries" || method === "readFeedEntries") {
      const response = await request(`${base}?${method}=1`, { credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw await failure(response);
      return response.json();
    }
    if (method === "feedDiscover" || method === "feedRead" || method === "feedEntry") {
      const field = method === "feedDiscover" ? "address" : "feedURL";
      const address = params[field];
      if (typeof address !== "string" || !address.trim() || address.length > 4096) throw new Error("Choose a feed address up to 4096 characters.");
      const body: Record<string, string> = { action: method === "feedDiscover" ? "discover" : method === "feedRead" ? "read" : "entry", [field]: address };
      if (method === "feedEntry") {
        if (typeof params.externalKey !== "string" || !params.externalKey || params.externalKey.length > 2048) throw new Error("Choose a feed entry from the current list.");
        body.externalKey = params.externalKey;
      }
      const response = await request(`/api/vault/${encodeURIComponent(workspaceId)}/feeds`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw await failure(response);
      if (response.status === 204) throw new DOMException("Request canceled", "AbortError");
      return response.json();
    }
    if (method === "search") {
      const query = params.query;
      if (typeof query !== "string" || query.length > 500) throw new Error("Enter a shorter search.");
      if (!query.trim()) return { items: [], truncated: false, skippedCount: 0 };
      const folder = params.folder === "Bookmarks" ? "&folder=Bookmarks" : "";
      const response = await request(`/api/vault/${encodeURIComponent(workspaceId)}/search?q=${encodeURIComponent(query)}${folder}`, {
        credentials: "same-origin", cache: "no-store", signal,
      });
      if (!response.ok) throw await failure(response);
      return response.json();
    }
    if (method === "collaborationConfig") {
      if (!manifest) await listing();
      const item = manifest!.items.find(entry => entry.relativePath === params.path);
      if (!item) throw new VaultError("This file no longer exists.", "not_found");
      return { namespace: typeof location === "undefined" ? "web" : location.origin, workspaceId, itemId: item.itemId };
    }
    if (method === "collaborationRead" || method === "collaborationPush") {
      const itemId = String(params.itemId);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)) throw new Error("Invalid collaboration item.");
      const query = new URLSearchParams();
      for (const key of ["epoch", "seq", "waitMs"]) if (params[key] !== undefined) query.set(key, String(params[key]));
      const prefetched = openCollaboration;
      if (method === "collaborationRead" && !query.size && prefetched?.itemId === itemId && prefetched.revision) {
        openCollaboration = null;
        clearTimeout(prefetched.timer);
        const abort = () => prefetched.controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        try {
          if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
          const value = await prefetched.result;
          if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
          if (value && typeof value === "object" && !Array.isArray(value) &&
              (value as { revision?: unknown }).revision === prefetched.revision &&
              (value as { relativePath?: unknown }).relativePath === prefetched.path) return value;
        } finally {
          signal?.removeEventListener("abort", abort);
          prefetched.controller.abort();
        }
      }
      const response = await request(`${base}/${encodeURIComponent(itemId)}/collaboration${method === "collaborationRead" && query.size ? `?${query}` : ""}`, {
        method: method === "collaborationRead" ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal,
        ...(method === "collaborationPush" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: params.operationId, epoch: params.epoch, updates: params.updates }) } : {}),
      });
      if (!response.ok) throw await failure(response);
      if (response.status === 204) throw new DOMException("Request canceled", "AbortError");
      return response.json();
    }
    if (["shareList", "shareInvite", "shareRole", "shareRevoke"].includes(method)) {
      const scopeType = params.scopeType;
      const scopeKey = params.scopeKey;
      if ((scopeType !== "item" && scopeType !== "folder") || typeof scopeKey !== "string" || !scopeKey || scopeKey.length > 512) {
        throw new Error("Choose a file or folder to share.");
      }
      const verb = { shareList: "GET", shareInvite: "POST", shareRole: "PATCH", shareRevoke: "DELETE" }[method];
      const query = new URLSearchParams({ scopeType, scopeKey });
      const body = verb === "GET" ? null : { scopeType, scopeKey,
        ...(verb === "POST" ? { email: params.email, role: params.role }
          : verb === "PATCH" ? { grantId: params.grantId, role: params.role }
            : { grantId: params.grantId }),
      };
      const response = await request(`/api/vault/${encodeURIComponent(workspaceId)}/shares${verb === "GET" ? `?${query}` : ""}`, {
        method: verb, credentials: "same-origin", cache: "no-store", signal,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw await failure(response);
      return response.json();
    }
    if (method === "publicationRead" || method === "publicationSet") {
      const itemId = params.itemId;
      if (typeof itemId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)) throw new Error("Choose a file to publish.");
      let body: { operationId: string; baseRevision: string; published: boolean } | null = null;
      if (method === "publicationSet") {
        if (typeof params.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.operationId) ||
          typeof params.baseRevision !== "string" || !/^[a-f0-9]{64}$/.test(params.baseRevision) || typeof params.published !== "boolean") {
          throw new Error("Invalid publication request.");
        }
        body = { operationId: params.operationId, baseRevision: params.baseRevision, published: params.published };
      }
      const response = await request(`${base}/${encodeURIComponent(itemId)}/publication`, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw await failure(response);
      if (response.status === 204) throw new DOMException("Request canceled", "AbortError");
      return response.json();
    }
    if (["commentsRead", "commentsAdd", "commentsResolve"].includes(method)) {
      const itemId = params.itemId;
      if (typeof itemId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)) throw new Error("Choose an item to comment on.");
      const endpoint = `${base}/${encodeURIComponent(itemId)}/comments`;
      let url = endpoint;
      let body: Record<string, unknown> | null = null;
      if (method === "commentsRead") {
        const query = new URLSearchParams();
        if (params.limit !== undefined) {
          if (typeof params.limit !== "number" || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 100) throw new Error("Invalid comment page size.");
          query.set("limit", String(params.limit));
        }
        if (params.after !== undefined && params.after !== null) {
          if (typeof params.after !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.after)) throw new Error("Invalid comment cursor.");
          query.set("after", params.after);
        }
        if (query.size) url += `?${query}`;
      } else {
        if (typeof params.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.operationId)) throw new Error("Invalid comment operation.");
        body = { operationId: params.operationId };
        if (method === "commentsAdd") {
          if (typeof params.body !== "string" || !params.body.trim() || params.body.length > 4000) throw new Error("Write a comment up to 4000 characters.");
          body.body = params.body;
          if (params.imageAssetId !== undefined) {
            if (typeof params.imageAssetId !== "string" || !params.imageAssetId.trim() || params.imageAssetId.length > 120) throw new Error("Invalid image anchor.");
            body.imageAssetId = params.imageAssetId;
          }
          if (params.parentId !== undefined && params.parentId !== null) {
            if (typeof params.parentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.parentId)) throw new Error("Invalid comment thread.");
            body.parentId = params.parentId;
          }
        } else {
          if (typeof params.commentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.commentId) || typeof params.resolved !== "boolean") throw new Error("Invalid comment resolution.");
          body.commentId = params.commentId;
          body.resolved = params.resolved;
        }
      }
      const response = await request(url, {
        method: method === "commentsRead" ? "GET" : method === "commentsAdd" ? "POST" : "PATCH",
        credentials: "same-origin", cache: "no-store", signal,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw await failure(response);
      if (response.status === 204) throw new DOMException("Request canceled", "AbortError");
      return response.json();
    }
    if (["presenceRead", "presenceJoin", "presenceUpdate", "presenceLeave"].includes(method)) {
      const itemId = String(params.itemId);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)) throw new Error("Invalid presence item.");
      const body = method === "presenceJoin" ? { join: true, awarenessClientId: params.awarenessClientId }
        : method === "presenceUpdate" ? { clientId: params.clientId, sessionCredential: params.sessionCredential, awareness: params.awareness }
        : method === "presenceLeave" ? { clientId: params.clientId, sessionCredential: params.sessionCredential, leave: true }
        : null;
      if (body && params.agent !== undefined) Object.assign(body, { agent: params.agent });
      const response = await request(`${base}/${encodeURIComponent(itemId)}/presence`, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw await failure(response);
      if (response.status === 204) throw new DOMException("Request canceled", "AbortError");
      return response.json();
    }
    if (method === "list" || method === "open") return listing();
    if (method === "trashReconcile") { manifest = null; return null; }
    if (method === "trashList" || method === "trashRestore") {
      const response = await request(`/api/vault/${encodeURIComponent(workspaceId)}/trash`, {
        method: method === "trashList" ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal,
        ...(method === "trashRestore" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) } : {}),
      });
      if (!response.ok) throw await failure(response);
      if (method === "trashRestore") manifest = null;
      return response.json();
    }
    if (method === "recoveryList" || method === "recoveryRead") {
      const query = new URLSearchParams();
      if (method === "recoveryRead") query.set("id", String(params.id));
      else if (typeof params.path === "string") query.set("path", params.path);
      const response = await request(`/api/vault/${encodeURIComponent(workspaceId)}/recovery?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw await failure(response);
      if (method === "recoveryList") return response.json();
      const revision = response.headers.get("ETag")?.replace(/^"|"$/g, "");
      const encodedPath = response.headers.get("X-TextText-Path");
      if (!revision || !/^[a-f0-9]{64}$/.test(revision) || !encodedPath) throw new Error("The retained copy is missing recovery metadata.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 32 * 1024 * 1024 || await digest(bytes) !== revision) throw new Error("The retained copy does not match its saved revision.");
      const pack = openPack(bytes, decodeURIComponent(encodedPath), revision);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return { ...pack.file, data: btoa(binary) };
    }
    if (method === "folderViews") {
      const response = await request(`${base}?folderViews=${encodeURIComponent(String(params.folder ?? ""))}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw await failure(response);
      return response.json();
    }
    if (method === "read") return read(String(params.path), params.prefetchCollaboration === true, signal);
    if (method === "resolveItemId") {
      const itemId = String(params.itemId ?? "");
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)) throw new VaultError("The card link has an invalid identity.", "invalid_id");
      await listing();
      const matches = manifest!.items.filter(item => item.itemId === itemId);
      if (matches.length !== 1) throw new VaultError(matches.length ? "More than one TextPack has this item identity." : "This linked card is no longer in the workspace.", "not_found");
      return { path: matches[0].relativePath };
    }
    if (method === "template" || method === "preview") {
      if (!manifest) await listing();
      const item = manifest!.items.find((entry) => entry.relativePath === params.path);
      if (!item) throw new VaultError("The template file was not found.", "not_found");
      const response = await request(`${base}/${encodeURIComponent(item.itemId)}?metadata=${method}${params.metadataOnly === true ? "&metadataOnly=1" : ""}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw await failure(response);
      return response.json();
    }
    if (method === "extractArticle") {
      const response = await request("/api/vault/extract", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceURL: params.sourceURL }) });
      if (!response.ok) throw await failure(response);
      return response.json();
    }
    if (method === "rename" || method === "delete") {
      if (!manifest) await listing();
      const path = String(params.path), hash = String(params.hash);
      const item = manifest!.items.find((entry) => entry.relativePath === path);
      if (!item) throw new VaultError("This file no longer exists at that path.", "not_found");
      const newPath = String(params.newPath ?? "");
      const operationKey = `${method}:${item.itemId}:${hash}:${path}:${newPath}`;
      const operationId = operations.get(operationKey) ?? crypto.randomUUID();
      operations.set(operationKey, operationId);
      const response = await request(`${base}/${encodeURIComponent(item.itemId)}`, {
        method: method === "rename" ? "PATCH" : "DELETE", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "If-Match": `"${hash}"`, "X-TextText-Base-Path": encodeURIComponent(path), "X-TextText-Operation-Id": operationId },
        ...(method === "rename" ? { body: JSON.stringify({ relativePath: newPath }) } : {}),
      });
      if (response.status === 409) { operations.delete(operationKey); throw new VaultError("This file changed or moved elsewhere. Review the current file before trying again.", "conflict"); }
      if (!response.ok) throw await failure(response);
      const result = await response.json();
      if (result.status !== (method === "rename" ? "moved" : "deleted")) throw new Error("The server did not confirm the file operation.");
      operations.delete(operationKey);
      for (const [revision, pack] of packs) if (pack.itemId === item.itemId) packs.delete(revision);
      manifest = null; await listing();
      return method === "rename" ? read(newPath) : result;
    }
    if (method === "write") {
      const path = String(params.path), hash = String(params.hash);
      let original = packs.get(hash);
      if (!original) {
        const fresh = await read(path);
        if (fresh.hash !== hash) throw new VaultError("This file changed elsewhere.", "conflict", fresh);
        original = packs.get(hash)!;
      }
      if (original.file.path !== path) throw new Error("The file revision belongs to a different path.");
      const changes = { ...original.file, ...params } as VaultFile;
      if (packIdentity(changes.markdown) !== original.itemId) throw new Error("A write cannot change this file's identity.");
      return commit(original.itemId, path, encodePack(original, changes, addedAssets(params.addedAssets)), hash);
    }
    if (method === "create" || method === "importPack") {
      const id = crypto.randomUUID(), title = String(params.title ?? "Untitled");
      const folder = typeof params.folder === "string" ? params.folder : "";
      if (folder && folder.split("/").some((part) => !part || part.startsWith(".") || /[\\:\x00-\x1f]/.test(part))) throw new Error("Invalid folder path.");
      await listing();
      const stem = safeName(title);
      let path = `${folder ? folder + "/" : ""}${stem}.textpack`;
      if (params.exactPath !== undefined && params.exactPath !== path) throw new Error("The folder view destination does not match its folder.");
      if (params.exactPath !== undefined && manifest!.items.some((item) => item.relativePath.toLowerCase() === path.toLowerCase())) throw new Error("A file already occupies the folder view path.");
      for (let suffix = 2; manifest!.items.some((item) => item.relativePath.toLowerCase() === path.toLowerCase()); suffix++) path = `${folder ? folder + "/" : ""}${stem} ${suffix}.textpack`;
      let pack: Pick<OpenPack, "entries" | "prefix">, file: VaultFile;
      if (method === "importPack") {
        const data = params.data;
        const limit = 32 * 1024 * 1024;
        if (typeof data !== "string" || !data.length || data.length > Math.ceil(limit / 3) * 4 || (data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data) || data.indexOf("=") >= 0 && !/^[^=]*={1,2}$/.test(data))) throw new Error("Choose a valid TextPack no larger than 32 MiB.");
        const decoded = atob(data);
        if (decoded.length > limit) throw new Error("Choose a TextPack no larger than 32 MiB.");
        const source = openPack(Uint8Array.from(decoded, (character) => character.charCodeAt(0)), path, "");
        pack = source;
        file = { ...source.file, path, hash: "", markdown: replacePackIdentity(source.file.markdown, id) };
      } else if (typeof params.sourcePath === "string") {
        const source = packs.get(String(params.sourceHash));
        if (!source || source.file.path !== params.sourcePath) throw new Error("The original conflict snapshot is unavailable. Keep this editor open and save its text before closing.");
        pack = source; file = { ...source.file, path, hash: "", markdown: replacePackIdentity(source.file.markdown, id) };
      } else {
        pack = emptyPack();
        const kind = String(params.kind ?? "note");
        if (kind !== "note" && kind !== "bookmark") throw new Error("Unsupported capture type.");
        const template = BUILTIN_TEMPLATES.find((item) => item.id === `texttext.${kind}`)!;
        const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
        document.content.title = title; document.content.body = String(params.body ?? "");
        if (typeof params.sourceURL === "string") {
          const source = new URL(params.sourceURL);
          if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error("Choose an HTTP or HTTPS link without credentials.");
          document.content.fields.sourceUrl = source.href;
          document.content.fields.captureStatus = "pending";
        }
        file = { path, hash: "", markdown: `---\ntextTextId: ${JSON.stringify(id)}\n---\n\n`, documentJSON: JSON.stringify(document), templateJSON: JSON.stringify(template) };
        file = { ...file, ...writePayload(file, document) };
      }
      return commit(id, path, encodePack(pack, file), null);
    }
    throw new Error(`Unsupported workspace operation: ${method}`);
  };
  return { request: transport,
    refresh: async () => { const before = manifest?.revision; await listing(); return before !== manifest?.revision; },
    wait: async (signal) => {
      if (!manifest) await listing();
      const previous = manifest!.revision;
      const response = await request(`${base}?wait=25`, { signal, credentials: "same-origin", cache: "no-store", headers: { "If-None-Match": `"${previous}"` } });
      if (response.status === 304) return false;
      if (!response.ok) throw await failure(response);
      const next = await response.json() as Manifest;
      // A local save/list may finish during the wait. Avoid replacing that
      // newer manifest with an older response; reconcile through a fresh list.
      if (manifest!.revision !== previous) return true;
      manifest = next;
      return next.revision !== previous;
    },
    destroy: () => { destroyed = true; cancelOpenCollaboration(); packs.clear(); operations.clear(); },
  };
}
