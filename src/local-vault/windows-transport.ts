import { VaultError, type VaultFile, type VaultListing, type VaultTransport } from "./bridge";
import { createWebVaultTransport } from "./web-transport";
import { encodePack, openPack, type OpenPack } from "./pack";
import { readDocument } from "./model";
import { executeWindowsAgentTool } from "./windows-agent-tools";

type NativeView = { postMessage(value: unknown): void; addEventListener(type: "message", listener: (event: MessageEvent) => void): void; removeEventListener(type: "message", listener: (event: MessageEvent) => void): void };
type Status = { root: string; workspaceId: string; name: string; connected: boolean; available: boolean };
type Entry = { itemId: string; relativePath: string; revision: string };
type Manifest = { root: string; name: string; items: Entry[]; folders?: string[]; revision: string };
type Read = { path: string; hash: string; data: string };
type Pending = { resolve(value: unknown): void; reject(reason: unknown): void; dispose(): void };
const documentElementCanvas = (width: number, height: number) => { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas; };
const bytes = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0));
const base64 = (data: Uint8Array) => {
  let value = "";
  for (let offset = 0; offset < data.length; offset += 8192) value += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return btoa(value);
};

export function createNativeRPC(view: NativeView) {
  const pending = new Map<string, Pending>();
  const receive = (event: MessageEvent) => {
    const value = event.data;
    if (!value || typeof value !== "object") return;
    if (typeof value.event === "string" && value.event.startsWith("texttext:")) {
      window.dispatchEvent(new CustomEvent(value.event, { detail: value.detail })); return;
    }
    const entry = pending.get(value.id);
    if (!entry) return;
    pending.delete(value.id); entry.dispose();
    if (value.error) entry.reject(new VaultError(value.error.message, value.error.code));
    else entry.resolve(value.result);
  };
  view.addEventListener("message", receive);
  const request = <T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Request cancelled", "AbortError")); return; }
    const id = crypto.randomUUID();
    const abort = () => {
      const entry = pending.get(id); if (!entry) return;
      pending.delete(id); entry.dispose();
      view.postMessage({ id: crypto.randomUUID(), method: "native.cancel", params: { requestId: id } });
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    const timer = setTimeout(abort, 120_000);
    pending.set(id, { resolve: value => resolve(value as T), reject, dispose: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } });
    signal?.addEventListener("abort", abort, { once: true });
    try { view.postMessage({ id, method, params }); } catch (error) { const entry = pending.get(id); pending.delete(id); entry?.dispose(); reject(error); }
  });
  return { request, destroy() { view.removeEventListener("message", receive); for (const entry of pending.values()) { entry.dispose(); entry.reject(new Error("Workspace closed")); } pending.clear(); } };
}

export async function createWindowsVaultTransport(view: NativeView) {
  const rpc = createNativeRPC(view);
  const status = await rpc.request<Status>("native.status");
  if (!status.available || !status.workspaceId) throw new Error("Sign in to open your workspace.");
  const base = `/api/vault/${encodeURIComponent(status.workspaceId)}/items`;
  const list = () => rpc.request<Manifest>("files.list");
  const read = async (itemId: string, signal?: AbortSignal): Promise<OpenPack> => {
    const result = await rpc.request<Read>("files.read", { itemId }, signal);
    return openPack(bytes(result.data), result.path, result.hash, itemId);
  };
  let searchCacheBytes = 0;
  const searchCache = new Map<string, { revision: string; title: string; body: string }>();
  const metadata = async (itemId: string, kind: string, signal?: AbortSignal) => {
    const pack = await read(itemId, signal), file = pack.file, document = readDocument(file);
    const preview = { title: document.content.title, subtitle: String(document.content.fields.subtitle ?? ""), body: document.content.body, sourceUrl: String(document.content.fields.sourceUrl ?? "") };
    if (kind === "template") return { path: file.path, hash: file.hash, templateJSON: file.templateJSON, templateAuthoringSourceJSON: file.templateAuthoringSourceJSON, preview };
    const images: { data: string; contentType: string }[] = [];
    for (const asset of (file.assets ?? []).filter(asset => asset.contentType.startsWith("image/")).slice(0, 8)) {
      try {
        const bitmap = await createImageBitmap(new Blob([bytes(asset.data)], { type: asset.contentType }));
        try {
          const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
          const canvas = documentElementCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
          canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          images.push({ data: canvas.toDataURL("image/jpeg", 0.8).split(",")[1], contentType: "image/jpeg" });
        } finally { bitmap.close(); }
      } catch { /* Unsupported media does not prevent reading the document. */ }
    }
    return { title: document.content.title, excerpt: document.content.body.slice(0, 1500), cardBody: document.content.body, document, templateJSON: file.templateJSON, sourceURL: preview.sourceUrl, image: images[0], images };
  };
  const nativeFetch: typeof fetch = async (input, init) => {
    const request = new Request(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://texttext.local"), init);
    const url = new URL(request.url), method = request.method, signal = request.signal;
    try {
      if (url.pathname === base) {
        const manifest = await list();
        const folder = url.searchParams.get("folderViews");
        if (folder !== null) {
          const result = [];
          for (const item of manifest.items.filter(item => item.relativePath.split("/").slice(0, -1).join("/") === folder)) {
            const pack = await read(item.itemId, signal);
            if (readDocument(pack.file).content.fields.texttextFolderView === "v1") result.push(pack.file);
          }
          return Response.json({ files: result });
        }
        if (url.searchParams.has("keptFeedEntries") || url.searchParams.has("readFeedEntries")) {
          // Feed-specific filtering remains the canonical server operation.
        } else return Response.json(manifest);
      }
      const suffix = url.pathname.startsWith(base + "/") ? url.pathname.slice(base.length + 1) : null;
      if (suffix && !suffix.includes("/")) {
        const itemId = decodeURIComponent(suffix);
        if (method === "GET" && url.searchParams.has("metadata")) return Response.json(await metadata(itemId, url.searchParams.get("metadata")!, signal));
        if (method === "GET" || method === "HEAD") {
          const result = await rpc.request<Read>("files.read", { itemId }, signal);
          return new Response(method === "HEAD" ? null : bytes(result.data), { status: method === "HEAD" ? 204 : 200,
            headers: { ETag: `"${result.hash}"`, "X-TextText-Path": encodeURIComponent(result.path), "Content-Type": "application/zip" } });
        }
        const expectedHash = request.headers.get("If-Match")?.replace(/^"|"$/g, "") ?? null;
        if (method === "PUT") {
          const path = decodeURIComponent(request.headers.get("X-TextText-Path") ?? "");
          const result = await rpc.request<{ path: string; hash: string }>("files.write", { itemId, path, expectedHash, data: base64(new Uint8Array(await request.arrayBuffer())) }, signal);
          return Response.json({ status: "written", revision: result.hash, relativePath: result.path });
        }
        if (method === "PATCH") {
          const body = await request.json();
          const result = await rpc.request<{ path: string; hash: string }>("files.rename", { itemId, path: body.relativePath, expectedHash }, signal);
          return Response.json({ status: "moved", revision: result.hash, relativePath: result.path });
        }
        if (method === "DELETE") { await rpc.request("files.delete", { itemId, expectedHash }, signal); return Response.json({ status: "deleted" }); }
      }
      const body = ["GET", "HEAD"].includes(method) ? undefined : base64(new Uint8Array(await request.arrayBuffer()));
      const result = await rpc.request<{ status: number; headers: Record<string, string>; body: string }>("native.http", { path: url.pathname + url.search, method, headers: Object.fromEntries(request.headers), ...(body === undefined ? {} : { body }) }, signal);
      return new Response([204, 205, 304].includes(result.status) ? null : bytes(result.body), { status: result.status, headers: result.headers });
    } catch (error) {
      if (error instanceof VaultError && ["conflict", "CONFLICT", "not_found"].includes(error.code ?? "")) return Response.json({ status: "conflict", error: error.message }, { status: error.code === "not_found" ? 404 : 409 });
      throw error;
    }
  };
  const shared = createWebVaultTransport(status.workspaceId, status.name, nativeFetch);
  const transport: VaultTransport = async (method, params, signal) => {
    if (method === "workspacesList" || method === "workspaceOpen") return rpc.request(`native.${method}`, params, signal);
    if (method.startsWith("agent")) return rpc.request(method, params, signal);
    if (method === "connection") return { ...await rpc.request<Status>("native.status"), ...await rpc.request<Record<string, unknown>>("files.connection"), webURL: `https://texttext.app/vault/${status.workspaceId}` };
    if (method === "trashReconcile") return rpc.request("files.restoreReconcile", params, signal);
    if (method === "recovery") return rpc.request("native.recovery", {}, signal);
    if (["settings", "signOut", "openWeb", "openFolder"].includes(method)) return rpc.request(`native.${method}`, params, signal);
    if (method === "list" || method === "open") {
      const value = await shared.request("list", params, signal) as VaultListing;
      const local = await list(); return { ...value, root: status.root, folders: local.folders };
    }
    if (method === "keptFeedEntries" || method === "readFeedEntries") {
      const history = method === "readFeedEntries";
      const candidates = (await list()).items.filter(item => item.relativePath.startsWith(history ? "Feeds/History/" : "Bookmarks/"));
      if (candidates.length > 2048) throw new Error("Too many saved stories to read at once.");
      const records = new Map<string, Record<string, string>>();
      let inspected = 0;
      for (const item of candidates) {
        const file = await rpc.request<VaultFile>("files.text", { itemId: item.itemId }, signal);
        inspected += (file.documentJSON?.length ?? 0) * 2;
        if (inspected > 64 * 1024 * 1024) throw new Error("Saved story metadata exceeds the read limit.");
        const document = readDocument(file), fields = document.content.fields;
        const hash = fields.feedEntryHash;
        if (fields[history ? "texttextFeedHistoryEntry" : "texttextFeedEntry"] !== "v1" || typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) continue;
        const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";
        const date = history ? fields.viewedAt ?? fields.readAt : fields.keptAt;
        if (history && (typeof date !== "string" || !date)) continue;
        const dateKey = history ? "viewedAt" : "keptAt";
        const entry: Record<string, string> = { hash, path: file.path, title: text(document.content.title, 300), source: text(fields.feedTitle, 160), [dateKey]: text(date, 32) };
        if (history) entry.revision = file.hash;
        const readAt = fields[history ? "readAt" : "texttextBookmarkReadAt"];
        if (typeof readAt === "string" && readAt) entry.readAt = text(readAt, 32);
        if (typeof fields.feedTopic === "string" && fields.feedTopic.trim()) entry.topic = fields.feedTopic.trim().slice(0, 100);
        const progress = fields.texttextFeedReadingProgress;
        if (typeof progress === "number" && Number.isInteger(progress) && progress >= 0 && progress <= 100) entry.progress = String(progress);
        if (!records.has(hash) || entry[dateKey] > records.get(hash)![dateKey]) records.set(hash, entry);
      }
      const dateKey = history ? "viewedAt" : "keptAt";
      const entries = [...records.values()].sort((a, b) => a[dateKey] === b[dateKey] ? a.path.localeCompare(b.path) : a[dateKey] > b[dateKey] ? -1 : 1);
      return { hashes: [...records.keys()].sort(), entries };
    }
    if (method === "search") {
      const query = String(params.query ?? "").trim().toLocaleLowerCase();
      if (query.length > 500) throw new Error("Enter a shorter search.");
      const matches = []; let skippedCount = 0;
      for (const item of query ? (await list()).items : []) {
        if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
        if (typeof params.folder === "string" && params.folder && !item.relativePath.startsWith(params.folder.replace(/\/+$/, "") + "/")) continue;
        try {
          let cached = searchCache.get(item.itemId);
          if (!cached || cached.revision !== item.revision) {
            const document = readDocument(await rpc.request<VaultFile>("files.text", { itemId: item.itemId }, signal));
            cached = { revision: item.revision, title: document.content.title, body: document.content.body };
            const previous = searchCache.get(item.itemId);
            if (previous) searchCacheBytes -= (previous.title.length + previous.body.length) * 2;
            searchCache.set(item.itemId, cached);
            searchCacheBytes += (cached.title.length + cached.body.length) * 2;
            while (searchCache.size > 4096 || searchCacheBytes > 16 * 1024 * 1024) {
              const oldest = searchCache.keys().next().value!;
              const removed = searchCache.get(oldest)!;
              searchCacheBytes -= (removed.title.length + removed.body.length) * 2;
              searchCache.delete(oldest);
            }
          }
          const { title, body } = cached;
          if (`${title}\n${body}\n${item.relativePath}`.toLocaleLowerCase().includes(query)) matches.push({ path: item.relativePath, itemId: item.itemId, title, snippet: body.slice(0, 240) });
        } catch (error) { if (signal?.aborted) throw error; skippedCount++; }
        if (matches.length >= 100) return { items: matches, truncated: true, skippedCount };
      }
      return { items: matches, truncated: false, skippedCount };
    }
    if (method === "collaborationConfig") {
      const config = await shared.request(method, params, signal) as { itemId: string };
      const readiness = await rpc.request<{ ready: boolean }>("files.ready", { itemId: config.itemId }, signal);
      if (!readiness.ready) return null;
      return { ...config, namespace: "https://texttext.app", localFiles: true };
    }
    if (method === "collaborationCheckpoint") {
      const pack = await read(String(params.itemId), signal);
      if (pack.file.hash !== params.hash) throw new VaultError("This file changed outside the editor.", "local_changed");
      const journal = JSON.parse(String(params.journal)) as { presentation?: { templateJSON: string | null; templateAuthoringSourceJSON: string | null } };
      const data = base64(encodePack(pack, { ...pack.file, ...journal.presentation, markdown: String(params.markdown), documentJSON: String(params.documentJSON) }));
      return rpc.request("collaboration.checkpoint", { ...params, data }, signal);
    }
    if (["collaborationOpen", "collaborationClose", "collaborationRecover"].includes(method)) return rpc.request(`collaboration.${method.slice("collaboration".length).toLowerCase()}`, params, signal);
    // Prefetch reads use remote revisions. A local unsent edit must never be replaced by cached server bytes.
    if (method === "read") return shared.request(method, { ...params, prefetchCollaboration: false }, signal);
    return shared.request(method, params, signal);
  };
  // Manifest hashes invalidate changed entries individually. Unrelated edits must not flush the whole index.
  const changed = () => { void shared.refresh().catch(() => {}); };
  const agentTools = new Map<string, AbortController>();
  const agentTool = (event: Event) => {
    const value = (event as CustomEvent).detail;
    if (!value || typeof value.requestId !== "string" || typeof value.selectedPath !== "string") return;
    const controller = new AbortController(); agentTools.set(value.requestId, controller);
    void executeWindowsAgentTool(transport, value.selectedPath, value.tool, value.arguments, controller.signal)
      .then(result => rpc.request("agentToolResult", { requestId: value.requestId, result }))
      .catch(error => rpc.request("agentToolResult", { requestId: value.requestId, error: error instanceof Error ? error.message : "Tool failed" }).catch(() => {}))
      .finally(() => agentTools.delete(value.requestId));
  };
  const agentCancel = (event: Event) => { agentTools.get((event as CustomEvent).detail?.requestId)?.abort(); };
  window.addEventListener("texttext:windows-agent-tool", agentTool);
  window.addEventListener("texttext:windows-agent-cancel", agentCancel);
  window.addEventListener("texttext:vault-changed", changed);
  window.addEventListener("texttext:vault-sync-status", changed);
  return { request: transport, destroy() { window.removeEventListener("texttext:windows-agent-tool", agentTool); window.removeEventListener("texttext:windows-agent-cancel", agentCancel); for (const controller of agentTools.values()) controller.abort(); agentTools.clear(); window.removeEventListener("texttext:vault-changed", changed); window.removeEventListener("texttext:vault-sync-status", changed); shared.destroy(); rpc.destroy(); } };
}
