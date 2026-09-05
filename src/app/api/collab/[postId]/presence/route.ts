// GET reads presence. POST {join: true, awarenessClientId} issues a session;
// subsequent {clientId, sessionCredential, awareness|leave} requests own that row.
import { activePresence, removePresence, upsertPresence } from "@/lib/collab";
import { getCollabRequestAccess } from "@/lib/collab/access.server";
import { sanitizePresenceAwareness } from "@/lib/collab/presence-awareness";
import { issuePresenceSession, verifyPresenceSession } from "@/lib/collab/presence-session.server";
import { readBoundedJson } from "@/lib/http/bounded-json";
import type { AuditEntry } from "@/lib/audit";

export const dynamic = "force-dynamic";
const MAX_PRESENCE_BODY_BYTES = 96 * 1024;
const respond = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function GET(request: Request, ctx: { params: Promise<{ postId: string }> }) {
  const { postId } = await ctx.params;
  const access = await getCollabRequestAccess(request, postId);
  if (!access.role) return respond({ error: "No access to this post" }, 403);
  return respond({ presence: await activePresence(postId) });
}

export async function POST(request: Request, ctx: { params: Promise<{ postId: string }> }) {
  const { postId } = await ctx.params;
  const decoded = await readBoundedJson<unknown>(request, MAX_PRESENCE_BODY_BYTES);
  if ("error" in decoded) {
    return decoded.error === "too_large"
      ? respond({ error: "Presence update is too large" }, 413)
      : respond({ error: "Send a JSON body" }, 400);
  }
  if (!decoded.value || typeof decoded.value !== "object" || Array.isArray(decoded.value)) {
    return respond({ error: "Send a JSON object" }, 400);
  }
  // Authorize after consuming the body: a slow upload must not retain a revoked grant.
  const access = await getCollabRequestAccess(request, postId);
  if (!access.role) {
    return access.trashed
      ? respond({ error: "This item was moved to Trash", reason: "trashed" }, 410)
      : respond({ error: "No access to this post" }, 403);
  }
  // A capability is a principal too, but never the unbound "Guest" fallback.
  const principal = access.user
    ? `account:${access.user.userId ?? access.user.sub}`
    : access.capability ? `capability:${access.capability.id}` : null;
  if (!principal) return respond({ error: "A presence identity is required" }, 403);

  const body = decoded.value as Record<string, unknown>;
  if (body.join === true) {
    if (!Number.isSafeInteger(body.awarenessClientId) || Number(body.awarenessClientId) < 0 ||
        body.leave !== undefined || body.awareness !== undefined || body.sessionCredential !== undefined) {
      return respond({ error: "Send a valid awareness client ID to join" }, 400);
    }
    // Never let the caller choose the row ID, including when rejoining.
    try {
      return respond({ session: issuePresenceSession(principal, postId, Number(body.awarenessClientId)) });
    } catch {
      return respond({ error: "Presence is unavailable" }, 503);
    }
  }
  const session = verifyPresenceSession(body.sessionCredential, principal, postId, body.clientId);
  if (!session) return respond({ error: "Join presence again", reason: "presence_session" }, 409);
  const audit: AuditEntry = {
    actorUserId: access.user?.userId ?? null,
    actorType: "human",
    actionName: body.leave === true ? "collab.presence.leave" : "collab.presence.update",
    targetType: "item",
    targetId: postId,
  };
  if (body.leave === true) {
    await removePresence(postId, session.clientId, audit);
    return respond({ presence: await activePresence(postId) });
  }
  let awareness: string;
  try {
    awareness = sanitizePresenceAwareness(body.awareness, session.awarenessClientId, {
      clientId: session.clientId,
      name: access.userName,
      color: access.color,
      role: access.role,
    });
  } catch {
    return respond({ error: "Invalid presence awareness" }, 400);
  }
  return respond({ presence: await upsertPresence(postId, {
    clientId: session.clientId,
    userName: access.userName,
    color: access.color,
    awareness,
  }, audit) });
}
