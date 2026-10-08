import { authorizeVault } from "@/app/api/vault/auth";
import { listVaultTrash, restoreVaultTextpack } from "@/lib/store";
import { readBoundedJson } from "@/lib/http/bounded-json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string }> };
const headers = { "Cache-Control": "no-store" };
function privateResponse(response: Response) { response.headers.set("Cache-Control", "no-store"); return response; }
export async function GET(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const actor = await authorizeVault(request, workspaceId);
  if (actor instanceof Response) return privateResponse(actor);
  try {
    const page = await listVaultTrash(actor);
    const current = await authorizeVault(request, workspaceId);
    if (current instanceof Response) return privateResponse(current);
    if (current.actorUserId !== actor.actorUserId) return Response.json({ error: "Session changed." }, { status: 403, headers });
    return Response.json(page, { headers });
  }
  catch { return Response.json({ error: "Trash could not be loaded. Try again when connected." }, { status: 503, headers }); }
}
export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const actor = await authorizeVault(request, workspaceId);
  if (actor instanceof Response) return privateResponse(actor);
  try {
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 8192);
    if ("error" in parsed) return Response.json({ error: "Invalid restore request." }, { status: 400, headers });
    const body = parsed.value;
    const keys = ["itemId", "operationId", "basePath", "baseRevision", "relativePath"] as const;
    if (!body || Object.keys(body).length !== keys.length || keys.some(key => typeof body[key] !== "string")) return Response.json({ error: "Invalid restore request." }, { status: 400, headers });
    const result = await restoreVaultTextpack({ ...actor, ...Object.fromEntries(keys.map(key => [key, body[key]])) as Record<typeof keys[number], string>, signal: request.signal,
      beforeCommit: async () => { const current = await authorizeVault(request, workspaceId); if (current instanceof Response) throw current; if (current.actorUserId !== actor.actorUserId) throw new Response(null, { status: 403 }); } });
    return Response.json(result, { status: result.status === "conflict" ? 409 : 200, headers });
  } catch (error) {
    if (error instanceof Response) return privateResponse(error);
    if (error instanceof Error && /Invalid |invalid |reused|already|occupied|changed|another item|deleted revision|path/.test(error.message)) return Response.json({ error: "This Trash item or its original location changed. Close and refresh Trash before restoring it." }, { status: 409, headers });
    return Response.json({ error: "The item could not be restored. Your selection is kept; try again when connected." }, { status: 503, headers });
  }
}
