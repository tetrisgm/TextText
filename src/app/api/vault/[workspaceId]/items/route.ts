import { createHash } from "node:crypto";
import { authorizeVaultWorkspaceOrScoped, canSeeVaultFolder, canSeeVaultItem } from "@/app/api/vault/scoped-auth";
import { listVaultTextpacks, listVaultFolderViews, listVaultKeptFeedEntries, waitVaultTextpacks, VaultBusyError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  try {
    if (new URL(request.url).searchParams.has("keptFeedEntries")) {
      const manifest = await listVaultTextpacks(authorized);
      const permitted = manifest.items.filter(item => authorized.fullAccess || canSeeVaultItem(authorized.grants, item.itemId, item.relativePath));
      const entries = await listVaultKeptFeedEntries({ ...authorized, items: permitted });
      const current = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
      if (current instanceof Response) return current;
      if (request.signal.aborted) return new Response(null, { status: 204 });
      const currentItems = new Map((await listVaultTextpacks(current)).items.map(item => [item.itemId, item.relativePath]));
      const visible = entries.filter(entry => currentItems.get(entry.itemId) === entry.path &&
          (current.fullAccess || canSeeVaultItem(current.grants, entry.itemId, entry.path)))
        .map(entry => ({ hash: entry.hash, path: entry.path, title: entry.title, source: entry.source,
          keptAt: entry.keptAt, ...(entry.readAt ? { readAt: entry.readAt } : {}) }));
      return Response.json({ hashes: visible.map(entry => entry.hash).sort(), entries: visible }, { headers: { "Cache-Control": "no-store" } });
    }
    const folder = new URL(request.url).searchParams.get("folderViews");
    if (folder !== null) {
      if (!authorized.fullAccess && !canSeeVaultFolder(authorized.grants, folder)) {
        return Response.json({ error: "Folder not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      const views = await listVaultFolderViews({ ...authorized, folder });
      const current = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
      if (current instanceof Response) return current;
      if (!current.fullAccess && !canSeeVaultFolder(current.grants, folder)) {
        return Response.json({ error: "Folder not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      if (request.signal.aborted) return new Response(null, { status: 204 });
      return Response.json(views, { headers: { "Cache-Control": "no-store" } });
    }
    const previous = request.headers.get("If-None-Match");
    const wait = Number(new URL(request.url).searchParams.get("wait") ?? "0");
    const manifest = authorized.fullAccess && previous && /^"[a-f0-9]{64}"$/.test(previous) && wait > 0 && Number.isFinite(wait)
      ? await waitVaultTextpacks({ ...authorized, revision: previous.slice(1, -1), waitMs: Math.min(wait, 25) * 1000, signal: request.signal })
      : await listVaultTextpacks(authorized);
    const stillAuthorized = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
    if (stillAuthorized instanceof Response) return stillAuthorized;
    if (request.signal.aborted) return new Response(null, { status: 204 });
    // A scoped member receives only directly shared items or members of a
    // verified shared folder. The global problem list could name siblings.
    const visible = stillAuthorized.fullAccess ? manifest : (() => {
      const items = manifest.items.filter(item => canSeeVaultItem(stillAuthorized.grants, item.itemId, item.relativePath));
      const tombstones = manifest.tombstones.filter(item => canSeeVaultItem(stillAuthorized.grants, item.itemId, item.relativePath));
      const revision = createHash("sha256").update(JSON.stringify([items, tombstones,
        stillAuthorized.grants.map(grant => [grant.id, grant.role])])).digest("hex");
      return { items, tombstones, problems: [], revision };
    })();
    const etag = `"${visible.revision}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(visible, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof VaultBusyError ? "Vault is busy" : "Vault is unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" },
    });
  }
}
