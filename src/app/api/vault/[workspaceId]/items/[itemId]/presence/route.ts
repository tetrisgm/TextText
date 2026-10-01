import { authorizeVaultItem, authorizeVaultItemAtPath } from "@/app/api/vault/scoped-auth";
import { colorForSub } from "@/lib/collab";
import { sanitizePresenceAwareness } from "@/lib/collab/presence-awareness";
import { readBoundedJson } from "@/lib/http/bounded-json";
import {
  readVaultPresence, readVaultCollaboration, joinVaultPresence,
  updateVaultPresence, leaveVaultPresence, VaultBusyError,
  VaultCollaborationEpochError, VaultPresenceSessionError,
} from "@/lib/store";
import { issueVaultPresenceSession, verifyVaultPresenceSession } from "@/lib/vault/presence-session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string; itemId: string }> };
const headers = { "Cache-Control": "private, no-store" };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });

function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof VaultCollaborationEpochError) return respond({ error: error.message, epoch: error.epoch, code: "epoch_changed" }, 409);
  if (error instanceof VaultPresenceSessionError) return respond({ error: "Join item presence again", code: "presence_session" }, 409);
  if (error instanceof VaultBusyError) return Response.json({ error: "Workspace is busy. Retry presence." }, {
    status: 503, headers: { ...headers, "Retry-After": "1" },
  });
  if (error instanceof Error && /capacity/i.test(error.message)) return respond({ error: "This item has too many active editors" }, 503);
  return respond({ error: "Item presence is temporarily unavailable" }, 503);
}

async function humanAccess(request: Request, context: Context) {
  const { workspaceId, itemId } = await context.params;
  const access = await authorizeVaultItem(request, workspaceId, itemId, "read");
  if (access instanceof Response) return access;
  if (access.actorType !== "human" || !access.actorUserId) return respond({ error: "Human sign-in is required for item presence" }, 403);
  return access;
}

async function discloseAfterWrite(request: Request, context: Context, actorUserId: string, body: unknown) {
  const current = await humanAccess(request, context);
  if (current instanceof Response) return current;
  if (current.actorUserId !== actorUserId) return respond({ error: "Session changed" }, 403);
  if (request.signal.aborted) return new Response(null, { status: 204, headers });
  return respond(body);
}

export async function GET(request: Request, context: Context) {
  try {
    const access = await humanAccess(request, context);
    if (access instanceof Response) return access;
    const state = await readVaultPresence(access);
    const current = await humanAccess(request, context);
    if (current instanceof Response) return current;
    if (current.actorUserId !== access.actorUserId) return respond({ error: "Session changed" }, 403);
    if (request.signal.aborted) return new Response(null, { status: 204, headers });
    return state ? respond(state) : respond({ error: "Item not found" }, 404);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const parsed = await readBoundedJson<unknown>(request, 96 * 1024);
    if ("error" in parsed) return respond({ error: "Invalid or oversized presence request" }, parsed.error === "too_large" ? 413 : 400);
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return respond({ error: "Send a JSON object" }, 400);
    // Authorize after the body arrives: an upload must not retain a revoked grant.
    const access = await humanAccess(request, context);
    if (access instanceof Response) return access;
    const principal = `account:${access.actorUserId}`;
    const role = access.canEditContent ? "editor" as const : "viewer" as const;
    const userName = access.actorName?.trim() || "Member";
    const color = colorForSub(access.actorUserId);
    const body = parsed.value as Record<string, unknown>;
    const beforeCommit = async (relativePath: string) => {
      const latest = await authorizeVaultItemAtPath(request, access.workspaceId, access.itemId, relativePath, "read");
      if (latest instanceof Response) throw latest;
      if (latest.actorType !== "human" || latest.actorUserId !== access.actorUserId) throw respond({ error: "Session changed" }, 403);
      if (latest.canEditContent !== access.canEditContent) throw respond({ error: "Item role changed. Join presence again." }, 409);
      request.signal.throwIfAborted();
    };
    if (body.join === true) {
      if (!Number.isSafeInteger(body.awarenessClientId) || Number(body.awarenessClientId) < 0 || Number(body.awarenessClientId) > 0xffffffff ||
          body.clientId !== undefined || body.sessionCredential !== undefined || body.leave !== undefined || body.awareness !== undefined) {
        return respond({ error: "Send a valid awareness client ID to join" }, 400);
      }
      const state = await readVaultCollaboration(access);
      if (!state) return respond({ error: "Item not found" }, 404);
      const session = issueVaultPresenceSession(principal, access.workspaceId, access.itemId, state.epoch, Number(body.awarenessClientId));
      const joined = await joinVaultPresence({ ...access, principal, clientId: session.clientId, epoch: state.epoch,
        awarenessClientId: Number(body.awarenessClientId), sessionExpiresAt: session.expiresAt,
        userName, color, role, beforeCommit });
      return joined ? discloseAfterWrite(request, context, access.actorUserId, { ...joined, session })
        : respond({ error: "Item not found" }, 404);
    }
    const session = verifyVaultPresenceSession(body.sessionCredential, principal, access.workspaceId, access.itemId, body.clientId);
    if (!session) return respond({ error: "Join item presence again", code: "presence_session" }, 409);
    if (body.leave === true) {
      if (body.awareness !== undefined) return respond({ error: "Leave must not include awareness" }, 400);
      const left = await leaveVaultPresence({ ...access, principal, clientId: session.clientId, epoch: session.epoch, beforeCommit });
      return left ? discloseAfterWrite(request, context, access.actorUserId, left) : respond({ error: "Item not found" }, 404);
    }
    let awareness: string;
    try {
      awareness = sanitizePresenceAwareness(body.awareness, session.awarenessClientId, {
        clientId: session.clientId, name: userName, color, role,
      });
    } catch { return respond({ error: "Invalid presence awareness" }, 400); }
    const updated = await updateVaultPresence({ ...access, principal, clientId: session.clientId, epoch: session.epoch,
      awarenessClientId: session.awarenessClientId, sessionExpiresAt: session.expiresAt,
      userName, color, role, awareness, beforeCommit });
    return updated ? discloseAfterWrite(request, context, access.actorUserId, updated) : respond({ error: "Item not found" }, 404);
  } catch (error) { return failure(error); }
}
