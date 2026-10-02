import { authorizeVaultWorkspaceOrScoped, canSeeVaultItem } from "@/app/api/vault/scoped-auth";
import { listVaultTextpacks, searchVaultTextpacks, VaultBusyError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const folder = new URL(request.url).searchParams.get("folder");
  if (!query.trim() || query.length > 500) return Response.json({ error: "Enter a search query up to 500 characters." }, { status: 400, headers });
  const authorized = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  try {
    const manifest = await listVaultTextpacks(authorized);
    const visible = manifest.items.filter(item => (folder !== "Bookmarks" || item.relativePath.startsWith("Bookmarks/")) &&
      (authorized.fullAccess || canSeeVaultItem(authorized.grants, item.itemId, item.relativePath)));
    const page = await searchVaultTextpacks(authorized, visible, query, request.signal);
    const current = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
    if (current instanceof Response) return current;
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    const paths = new Map(visible.map(item => [item.relativePath, item.itemId]));
    return Response.json({ ...page, items: page.items.filter(item => {
      const itemId = paths.get(item.path);
      return itemId && (current.fullAccess || canSeeVaultItem(current.grants, itemId, item.path));
    }) }, { headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    return Response.json({ error: error instanceof VaultBusyError ? "Vault is busy" : "Search is unavailable" }, { status: 503, headers: { ...headers, "Retry-After": "1" } });
  }
}
