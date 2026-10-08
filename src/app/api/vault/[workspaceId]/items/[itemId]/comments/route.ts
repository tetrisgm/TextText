import { authorizeVaultItem, authorizeVaultItemAtPath } from "@/app/api/vault/scoped-auth";
import { listVaultItemComments, mutateVaultItemComments, VaultBusyError } from "@/lib/store";
import { VaultCommentCapacityError, VaultCommentInputError, VaultCommentNotFoundError } from "@/lib/vault/item-comments";
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
  if (error instanceof VaultCommentInputError) return fail(400, error.message);
  if (error instanceof VaultCommentNotFoundError || (error instanceof Error && /missing or deleted/.test(error.message))) return fail(404, "Comment or item not found");
  if (error instanceof VaultCommentCapacityError) return fail(413, error.message);
  if (error instanceof Error && /Operation id was reused/.test(error.message)) return fail(409, "Operation identifier was reused");
  if (error instanceof VaultBusyError) return Response.json({ error: "Workspace is busy. Retry this comment." },
    { status: 503, headers: { ...headers, "Retry-After": "1" } });
  return fail(503, "Item comments are temporarily unavailable");
}
async function access(request: Request, context: Context, capability: "read" | "comment" | "edit") {
  const { workspaceId, itemId } = await context.params;
  return authorizeVaultItem(request, workspaceId, itemId, capability);
}
async function afterWrite(request: Request, context: Context, actorUserId: string,
  result: Awaited<ReturnType<typeof mutateVaultItemComments>>) {
  const current = await access(request, context, "read");
  if (current instanceof Response) return current;
  if (current.actorUserId !== actorUserId) return fail(403, "Session changed");
  if (request.signal.aborted) return new Response(null, { status: 204, headers });
  return respond(result, result.status === "conflict" ? 409 : 200);
}

export async function GET(request: Request, context: Context) {
  try {
    const authorized = await access(request, context, "read");
    if (authorized instanceof Response) return authorized;
    const search = new URL(request.url).searchParams;
    const limit = search.has("limit") ? Number(search.get("limit")) : 50;
    const after = search.get("after");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (after !== null && !isUuid(after))) return fail(400, "Invalid comment cursor or limit");
    const page = await listVaultItemComments({ ...authorized, limit, after });
    const latest = await access(request, context, "read");
    if (latest instanceof Response) return latest;
    if (latest.actorUserId !== authorized.actorUserId) return fail(403, "Session changed");
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    if (!page) return fail(404, "Item not found");
    if (page.relativePath !== latest.relativePath) return fail(409, "Item moved. Reopen it.");
    return respond({ comments: page.comments, nextCursor: page.nextCursor, revision: page.revision });
  } catch (error) { return failure(error); }
}

async function change(request: Request, context: Context, capability: "comment" | "edit") {
  try {
    const parsed = await readBoundedJson<unknown>(request, 24 * 1024);
    if ("error" in parsed) return fail(parsed.error === "too_large" ? 413 : 400, "Invalid or oversized comment request");
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Send a JSON object");
    const value = body as Record<string, unknown>;
    const allowed = capability === "comment" ? ["operationId", "body", "parentId", "imageAssetId"] : ["operationId", "commentId", "resolved"];
    if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.operationId !== "string" || !isUuid(value.operationId)) {
      return fail(400, "Invalid comment operation");
    }
    const mutation = capability === "comment"
      ? typeof value.body === "string" && (value.imageAssetId === undefined || typeof value.imageAssetId === "string" && !!value.imageAssetId.trim() && value.imageAssetId.length <= 120) && (value.parentId === undefined || value.parentId === null || typeof value.parentId === "string" && isUuid(value.parentId))
        ? { kind: "create" as const, body: value.body, parentId: value.parentId as string | null | undefined, ...(value.imageAssetId === undefined ? {} : { imageAssetId: value.imageAssetId as string }) } : null
      : typeof value.commentId === "string" && isUuid(value.commentId) && typeof value.resolved === "boolean"
        ? { kind: "resolve" as const, commentId: value.commentId, resolved: value.resolved } : null;
    if (!mutation) return fail(400, "Invalid comment request");
    // Body parsing precedes authorization so a slow upload cannot retain a
    // grant that was revoked while it was arriving.
    const authorized = await access(request, context, capability);
    if (authorized instanceof Response) return authorized;
    const { workspaceId, itemId } = await context.params;
    const actorUserId = authorized.actorUserId;
    const result = await mutateVaultItemComments({ root: authorized.root, workspaceId, itemId,
      operationId: value.operationId, mutation, actor: { userId: actorUserId,
        name: authorized.actorName || "Collaborator", type: authorized.actorType,
        authorType: authorized.canUseHumanPresence ? "human" : authorized.actorType }, signal: request.signal,
      beforeCommit: async relativePath => {
        const latest = await authorizeVaultItemAtPath(request, workspaceId, itemId, relativePath, capability);
        if (latest instanceof Response) throw latest;
        if (latest.actorUserId !== actorUserId) throw fail(403, "Session changed");
        request.signal.throwIfAborted();
      },
    });
    return afterWrite(request, context, actorUserId, result);
  } catch (error) { return failure(error); }
}
export const POST = (request: Request, context: Context) => change(request, context, "comment");
export const PATCH = (request: Request, context: Context) => change(request, context, "edit");
