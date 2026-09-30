import { authorizeVault } from "@/app/api/vault/auth";
import { listVaultTextpacks, waitVaultTextpacks, VaultBusyError } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeVault(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  try {
    const previous = request.headers.get("If-None-Match");
    const wait = Number(new URL(request.url).searchParams.get("wait") ?? "0");
    const manifest = previous && /^"[a-f0-9]{64}"$/.test(previous) && wait > 0 && Number.isFinite(wait)
      ? await waitVaultTextpacks({ ...authorized, revision: previous.slice(1, -1), waitMs: Math.min(wait, 25) * 1000, signal: request.signal })
      : await listVaultTextpacks(authorized);
    if (wait > 0) {
      const stillAuthorized = await authorizeVault(request, workspaceId);
      if (stillAuthorized instanceof Response) return stillAuthorized;
    }
    const etag = `"${manifest.revision}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(manifest, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof VaultBusyError ? "Vault is busy" : "Vault is unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" },
    });
  }
}
