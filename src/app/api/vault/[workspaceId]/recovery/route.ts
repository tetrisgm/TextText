import { authorizeVault } from "@/app/api/vault/auth";
import { listVaultRecovery, readVaultRecovery } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noCache = { "Cache-Control": "no-store" };
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const authorized = await authorizeVault(request, workspaceId);
  if (authorized instanceof Response) return authorized;
  const query = new URL(request.url).searchParams;
  try {
    const id = query.get("id");
    if (id !== null) {
      const item = await readVaultRecovery({ ...authorized, id });
      return new Response(new Uint8Array(item.bytes), { headers: { ...noCache, "Content-Type": "application/zip",
        ETag: `"${item.revision}"`, "X-TextText-Path": encodeURIComponent(item.relativePath), "X-Content-Type-Options": "nosniff" } });
    }
    return Response.json(await listVaultRecovery({ ...authorized, ...(query.has("path") ? { path: query.get("path")! } : {}) }), { headers: noCache });
  } catch {
    return Response.json({ error: "This recovery copy is unavailable or invalid. Refresh recovery and try again." }, { status: 422, headers: noCache });
  }
}
