import { authorizeVaultItem, authorizeVaultItemAtPath } from "@/app/api/vault/scoped-auth";
import { readVaultCollaboration, waitVaultCollaboration, pushVaultCollaboration, VaultBusyError, VaultCollaborationEpochError } from "@/lib/store";
import { readBoundedJson } from "@/lib/http/bounded-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string; itemId: string }> };
const headers = { "Cache-Control": "no-store" };
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof Error && error.name === "AbortError") return new Response(null, { status: 204, headers });
  if (error instanceof VaultCollaborationEpochError) return Response.json({ error: error.message, epoch: error.epoch, code: "epoch_changed" }, { status: 409, headers });
  if (error instanceof VaultBusyError) return Response.json({ error: "Workspace is busy. Retry this operation." }, { status: 503, headers: { ...headers, "Retry-After": "1" } });
  if (error instanceof Error && /missing or deleted/.test(error.message)) return Response.json({ error: "Item not found" }, { status: 404, headers });
  if (error instanceof Error && /reused/.test(error.message)) return Response.json({ error: "Operation identifier was reused" }, { status: 409, headers });
  if (error instanceof Error && /Invalid|incomplete|exceeds|template/i.test(error.message)) return Response.json({ error: "Invalid collaboration update or file state" }, { status: 422, headers });
  return Response.json({ error: "Collaboration is temporarily unavailable. Retry with the same operation identifier." }, { status: 503, headers });
}
async function authorize(request: Request, context: Context, capability: "read" | "edit") {
  const params = await context.params;
  const access = await authorizeVaultItem(request, params.workspaceId, params.itemId, capability);
  if (access instanceof Response) return access;
  if (!identifier.test(params.itemId)) return Response.json({ error: "Invalid item identifier" }, { status: 400, headers });
  return { ...access, itemId: params.itemId };
}
export async function GET(request: Request, context: Context) {
  try {
    const access = await authorize(request, context, "read");
    if (access instanceof Response) return access;
    const params = new URL(request.url).searchParams;
    const epoch = params.has("epoch") ? Number(params.get("epoch")) : null;
    const seq = params.has("seq") ? Number(params.get("seq")) : null;
    const waitMs = params.has("waitMs") ? Number(params.get("waitMs")) : 0;
    if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 25_000 ||
        ((epoch !== null || seq !== null || waitMs > 0) && (!Number.isSafeInteger(epoch) || epoch! < 1 || !Number.isSafeInteger(seq) || seq! < 0))) {
      return Response.json({ error: "Invalid collaboration cursor" }, { status: 400, headers });
    }
    const state = waitMs > 0 ? await waitVaultCollaboration({ ...access, epoch: epoch!, seq: seq!, waitMs, signal: request.signal }) : await readVaultCollaboration(access);
    // Permission may have changed while the filesystem wait was in progress.
    const current = await authorize(request, context, "read");
    if (current instanceof Response) return current;
    if (state && current.relativePath !== state.relativePath) return Response.json({ error: "Item moved. Reopen it." }, { status: 409, headers });
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    if (!state) return Response.json({ error: "Item not found" }, { status: 404, headers });
    const capabilities = { canEditContent: current.canEditContent, canComment: current.canComment };
    if (state.epoch === epoch && state.seq === seq) return Response.json({ unchanged: true, epoch, seq, ...capabilities }, { headers });
    return Response.json({ ...state, ...capabilities }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const access = await authorize(request, context, "edit");
    if (access instanceof Response) return access;
    const parsed = await readBoundedJson<unknown>(request, 6 * 1024 * 1024);
    if ("error" in parsed) return Response.json({ error: "Invalid or oversized collaboration request" }, { status: parsed.error === "too_large" ? 413 : 400, headers });
    const value = parsed.value as { operationId?: unknown; epoch?: unknown; updates?: unknown } | null;
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.operationId !== "string" || !identifier.test(value.operationId) ||
        typeof value.epoch !== "number" || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || !Array.isArray(value.updates) ||
        !value.updates.length || value.updates.length > 64 || value.updates.some(update => typeof update !== "string" || update.length > 512 * 1024)) {
      return Response.json({ error: "Invalid collaboration request" }, { status: 400, headers });
    }
    // Final authorization happens inside the store lock, after upload and merge.
    const current = access;
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    const result = await pushVaultCollaboration({ ...current, operationId: value.operationId, epoch: value.epoch, updates: value.updates as string[],
      signal: request.signal, beforeCommit: async (relativePath: string) => {
        const { workspaceId, itemId } = await context.params;
        const latest = await authorizeVaultItemAtPath(request, workspaceId, itemId, relativePath, "edit");
        if (latest instanceof Response) throw latest;
        if (latest.actorUserId !== current.actorUserId) throw Response.json({ error: "Session changed" }, { status: 403, headers });
      },
    });
    return Response.json(result, { status: result.status === "conflict" ? 409 : 200, headers });
  } catch (error) { return failure(error); }
}
