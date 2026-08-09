// Co-editing presence: who is in this post right now, and where their cursor is.
//
//   POST /api/collab/{postId}/presence  {clientId, userName, color, awareness}
//     -> {presence: [{clientId, userName, color, awareness}]}
//   GET  /api/collab/{postId}/presence
//     -> {presence: [...]}
//
// The POST is a write plus a read, which is enough for whoever is typing: their
// own awareness changes drive a heartbeat, and the response carries everyone
// else's. It is NOT enough for someone who is only watching, because their
// awareness never changes, so they would learn where a colleague's cursor moved
// only on their next slow heartbeat. Watching a colleague write is the common
// case, so the read is also available on its own and is polled quickly.
//
// Rows go stale quickly so a closed tab drops out on its own. Any collaborator
// (viewer included) counts as present.

import {
  activePresence,
  removePresence,
  upsertPresence,
} from "@/lib/collab";
import { getCollabRequestAccess } from "@/lib/collab/access.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const access = await getCollabRequestAccess(request, postId);
  if (!access.role) {
    return Response.json({ error: "No access to this post" }, { status: 403 });
  }
  return Response.json(
    { presence: await activePresence(postId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const access = await getCollabRequestAccess(request, postId);
  const role = access.role;
  if (!role) {
    return Response.json({ error: "No access to this post" }, { status: 403 });
  }

  let body: {
    clientId?: unknown;
    userName?: unknown;
    color?: unknown;
    awareness?: unknown;
    leave?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body" }, { status: 400 });
  }
  const clientId = typeof body.clientId === "string" ? body.clientId.slice(0, 64) : "";
  if (!clientId) {
    return Response.json({ error: "clientId is required" }, { status: 400 });
  }
  if (body.leave === true) {
    await removePresence(postId, clientId);
    return Response.json({ presence: await activePresence(postId) });
  }
  const awareness =
    typeof body.awareness === "string" && body.awareness.length <= 64 * 1024
      ? body.awareness
      : null;

  const presence = await upsertPresence(postId, {
    clientId,
    userName: access.userName,
    color: access.color,
    awareness,
  });
  return Response.json({ presence });
}
