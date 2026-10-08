import { createHash } from "node:crypto";
import { authorizeVaultWorkspaceOrScoped, canSeeVaultFolder, canSeeVaultItem } from "@/app/api/vault/scoped-auth";
import { listVaultTextpacks, listVaultFolderViews, listVaultKeptFeedEntries, listVaultReadFeedEntries, waitVaultTextpacks, VaultBusyError } from "@/lib/store";
import { roleForVaultItem } from "@/lib/vault/grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Manifest = Awaited<ReturnType<typeof listVaultTextpacks>>;
type Access = Exclude<Awaited<ReturnType<typeof authorizeVaultWorkspaceOrScoped>>, Response>;
function authorizedManifest(manifest: Manifest, access: Access) {
  const canCreateContent = access.fullAccess && access.canEditContent === true;
  const writableFolders = access.fullAccess ? [] : [...new Set(access.grants
    .filter(grant => grant.scope.type === "folder" && grant.role === "editor").map(grant => grant.scope.key))].sort();
  const entries = <T extends { itemId: string; relativePath: string }>(items: T[]) => items
    .filter(item => access.fullAccess || canSeeVaultItem(access.grants, item.itemId, item.relativePath))
    .map(item => ({ ...item, canEditContent: access.fullAccess ? canCreateContent : roleForVaultItem(access.grants, item.itemId, item.relativePath) === "editor" }));
  const items = entries(manifest.items), tombstones = entries(manifest.tombstones ?? []);
  const folders = (manifest.folders ?? []).filter(folder => access.fullAccess || canSeeVaultFolder(access.grants, folder));
  const problems = access.fullAccess ? manifest.problems : [];
  const permissions = { fullAccess: access.fullAccess, canCreateContent, writableFolders };
  // Capabilities participate in the ETag even when no file bytes changed.
  const revision = createHash("sha256").update(JSON.stringify([access.fullAccess ? manifest.revision : null,
    items, tombstones, folders, permissions])).digest("hex");
  return { items, tombstones, folders, problems, revision, ...permissions };
}

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  try {
    if (new URL(request.url).searchParams.has("readFeedEntries")) {
      const manifest = await listVaultTextpacks(authorized);
      const permitted = manifest.items.filter(item => authorized.fullAccess || canSeeVaultItem(authorized.grants, item.itemId, item.relativePath));
      const entries = await listVaultReadFeedEntries({ ...authorized, items: permitted });
      const current = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
      if (current instanceof Response) return current;
      if (request.signal.aborted) return new Response(null, { status: 204 });
      const currentItems = new Map((await listVaultTextpacks(current)).items.map(item => [item.itemId, item.relativePath]));
      const visible = entries.filter(entry => currentItems.get(entry.itemId) === entry.path &&
          (current.fullAccess || canSeeVaultItem(current.grants, entry.itemId, entry.path)))
        .map(entry => ({ hash: entry.hash, path: entry.path, revision: entry.revision,
          title: entry.title, source: entry.source, readAt: entry.readAt }));
      return Response.json({ hashes: visible.map(entry => entry.hash).sort(), entries: visible }, { headers: { "Cache-Control": "no-store" } });
    }
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
    let manifest = await listVaultTextpacks(authorized);
    // Client ETags include permissions; the disk watcher takes the underlying
    // file revision. Do not pass the permission digest to it and spin on reads.
    if (authorized.fullAccess && previous === `"${authorizedManifest(manifest, authorized).revision}"` && wait > 0 && Number.isFinite(wait)) {
      manifest = await waitVaultTextpacks({ ...authorized, revision: manifest.revision, waitMs: Math.min(wait, 25) * 1000, signal: request.signal });
    }
    const stillAuthorized = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
    if (stillAuthorized instanceof Response) return stillAuthorized;
    if (request.signal.aborted) return new Response(null, { status: 204 });
    // A scoped member receives only directly shared items or members of a
    // verified shared folder. The global problem list could name siblings.
    const visible = authorizedManifest(manifest, stillAuthorized);
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
