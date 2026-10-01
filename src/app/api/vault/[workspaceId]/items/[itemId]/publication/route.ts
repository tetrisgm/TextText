import { authorizeVaultItem, authorizeVaultItemAtPath } from "@/app/api/vault/scoped-auth";
import { mutateVaultPublication, readVaultPublication, VaultBusyError } from "@/lib/store";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { isUuid } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string; itemId: string }> };
const headers = { "Cache-Control": "private, no-store" };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
const fail = (status: number, error: string) => respond({ error }, status);

function failure(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof Error && error.name === "AbortError") return new Response(null, { status: 204, headers });
  if (error instanceof VaultBusyError) return Response.json({ error: "Workspace is busy. Retry publishing." },
    { status: 503, headers: { ...headers, "Retry-After": "1" } });
  if (error instanceof Error && /Operation id was reused/.test(error.message)) return fail(409, "Operation identifier was reused");
  if (error instanceof Error && /missing or deleted/.test(error.message)) return fail(404, "Item not found");
  if (error instanceof Error && /Invalid publication marker/.test(error.message)) return fail(409, "Unpublish the invalid marker first");
  return fail(503, "Publication is temporarily unavailable");
}

function state(workspaceId: string, itemId: string, item: NonNullable<Awaited<ReturnType<typeof readVaultPublication>>>, canPublish: boolean) {
  return { itemId, revision: item.revision, published: Boolean(item.publication),
    publishedAt: item.publication?.publishedAt ?? null,
    publicPath: `/v/${encodeURIComponent(workspaceId)}/${encodeURIComponent(itemId)}`, canPublish };
}

export async function GET(request: Request, context: Context) {
  try {
    const { workspaceId, itemId } = await context.params;
    const allowed = await authorizeVaultItem(request, workspaceId, itemId, "read");
    if (allowed instanceof Response) return allowed;
    const item = await readVaultPublication({ root: allowed.root, workspaceId, itemId });
    if (!item) return fail(404, "Item not found");
    const latest = await authorizeVaultItem(request, workspaceId, itemId, "read");
    if (latest instanceof Response) return latest;
    if (latest.actorUserId !== allowed.actorUserId || latest.relativePath !== item.relativePath) return fail(409, "Reopen this item");
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    return respond(state(workspaceId, itemId, item, latest.canManageShares));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const parsed = await readBoundedJson<unknown>(request, 1024);
    if ("error" in parsed) return fail(parsed.error === "too_large" ? 413 : 400, "Invalid publication request");
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Send a JSON object");
    const value = body as Record<string, unknown>;
    if (Object.keys(value).sort().join(",") !== "baseRevision,operationId,published" ||
      typeof value.operationId !== "string" || !isUuid(value.operationId) ||
      typeof value.baseRevision !== "string" || !/^[a-f0-9]{64}$/.test(value.baseRevision) ||
      typeof value.published !== "boolean") return fail(400, "Invalid publication request");
    const { workspaceId, itemId } = await context.params;
    const allowed = await authorizeVaultItem(request, workspaceId, itemId, "read");
    if (allowed instanceof Response) return allowed;
    if (!allowed.canManageShares) return fail(403, "Only the workspace owner can publish");
    const actorUserId = allowed.actorUserId;
    const result = await mutateVaultPublication({ root: allowed.root, workspaceId, itemId,
      operationId: value.operationId, baseRevision: value.baseRevision, published: value.published,
      actorUserId, actorType: allowed.actorType, signal: request.signal,
      beforeCommit: async relativePath => {
        const latest = await authorizeVaultItemAtPath(request, workspaceId, itemId, relativePath, "read");
        if (latest instanceof Response) throw latest;
        if (!latest.canManageShares || latest.actorUserId !== actorUserId) throw fail(403, "Publishing permission changed");
        request.signal.throwIfAborted();
      },
    });
    const latest = await authorizeVaultItem(request, workspaceId, itemId, "read");
    if (latest instanceof Response) return latest;
    if (!latest.canManageShares || latest.actorUserId !== actorUserId) return fail(403, "Publishing permission changed");
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    const item = await readVaultPublication({ root: latest.root, workspaceId, itemId });
    if (!item) return fail(404, "Item not found");
    return respond({ ...state(workspaceId, itemId, item, latest.canManageShares), status: result.status },
      result.status === "stale" || result.status === "conflict" ? 409 : 200);
  } catch (error) { return failure(error); }
}
