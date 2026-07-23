// Co-editing presence heartbeat: who is in this post right now.
//
//   POST /api/collab/{postId}/presence  {clientId, userName, color}
//     -> {presence: [{clientId, userName, color}]}
//
// Called on a slow interval by every open editor; rows go stale quickly so a
// closed tab drops out on its own. Any collaborator (viewer included) counts
// as present.

import {
  activePresence,
  removePresence,
  upsertPresence,
} from "@/lib/collab";
import { getCollabRequestAccess } from "@/lib/collab/access.server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const access = await getCollabRequestAccess(postId);
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
