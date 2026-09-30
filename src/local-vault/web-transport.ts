import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { VaultError, type VaultFile, type VaultListing, type VaultTransport } from "./bridge";
import { emptyPack, encodePack, openPack, packIdentity, replacePackIdentity, type OpenPack } from "./pack";
import { writePayload } from "./model";

type Manifest = { items: { itemId: string; relativePath: string; revision: string }[]; revision: string };
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map((value) => value.toString(16).padStart(2, "0")).join("");
const safeName = (value: string) => value.trim().replace(/[\\/:\x00-\x1f]/g, "-").replace(/^\.+/, "").slice(0, 120) || "Untitled";

export function createWebVaultTransport(workspaceId: string, name = "Workspace", request: typeof fetch = fetch): { request: VaultTransport; refresh: () => Promise<boolean>; wait: (signal: AbortSignal) => Promise<boolean>; destroy: () => void } {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workspaceId)) throw new Error("Invalid workspace identifier.");
  const base = `/api/vault/${encodeURIComponent(workspaceId)}/items`;
  let manifest: Manifest | null = null;
  let listingRequest: Promise<VaultListing> | null = null;
  const packs = new Map<string, OpenPack>();
  const operations = new Map<string, string>();
  let destroyed = false;
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
      const response = await request(base, { credentials: "same-origin", cache: "no-store", headers: manifest ? { "If-None-Match": `"${manifest.revision}"` } : {} });
      if (response.status !== 304) {
        if (!response.ok) throw await failure(response);
        manifest = await response.json() as Manifest;
      }
      if (!manifest) throw new Error("The workspace listing was empty.");
      return { root: `vault:${workspaceId}`, name, items: manifest.items.map((item) => ({ path: item.relativePath })) };
    })().finally(() => { listingRequest = null; });
    return listingRequest;
  };
  const read = async (path: string): Promise<VaultFile> => {
    if (!manifest) await listing();
    let item = manifest!.items.find((entry) => entry.relativePath === path);
    if (!item) { await listing(); item = manifest!.items.find((entry) => entry.relativePath === path); }
    if (!item) throw new VaultError("This file no longer exists in the workspace.", "not_found");
    const response = await request(`${base}/${encodeURIComponent(item.itemId)}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw await failure(response);
    const revision = response.headers.get("ETag")?.replace(/^"|"$/g, "");
    if (!revision || !/^[a-f0-9]{64}$/.test(revision)) throw new Error("The server did not return a file revision.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await digest(bytes) !== revision) throw new Error("The downloaded TextPack did not match its revision.");
    const storedPath = response.headers.get("X-TextText-Path");
    return remember(openPack(bytes, storedPath ? decodeURIComponent(storedPath) : path, revision, item.itemId));
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
  const transport: VaultTransport = async (method, params) => {
    if (destroyed) throw new Error("This workspace has closed.");
    if (method === "list" || method === "open") return listing();
    if (method === "read") return read(String(params.path));
    if (method === "template") {
      if (!manifest) await listing();
      const item = manifest!.items.find((entry) => entry.relativePath === params.path);
      if (!item) throw new VaultError("The template file was not found.", "not_found");
      const response = await request(`${base}/${encodeURIComponent(item.itemId)}?metadata=template`, { credentials: "same-origin", cache: "no-store" });
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
      return commit(original.itemId, path, encodePack(original, changes), hash);
    }
    if (method === "create") {
      const id = crypto.randomUUID(), title = String(params.title ?? "Untitled");
      const folder = typeof params.folder === "string" ? params.folder : "";
      if (folder && folder.split("/").some((part) => !part || part.startsWith(".") || /[\\:\x00-\x1f]/.test(part))) throw new Error("Invalid folder path.");
      await listing();
      const stem = safeName(title);
      let path = `${folder ? folder + "/" : ""}${stem}.textpack`;
      for (let suffix = 2; manifest!.items.some((item) => item.relativePath.toLowerCase() === path.toLowerCase()); suffix++) path = `${folder ? folder + "/" : ""}${stem} ${suffix}.textpack`;
      let pack: Pick<OpenPack, "entries" | "prefix">, file: VaultFile;
      if (typeof params.sourcePath === "string") {
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
    destroy: () => { destroyed = true; packs.clear(); operations.clear(); },
  };
}
