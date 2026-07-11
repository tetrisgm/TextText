// Co-editing presence heartbeat: who is in this post right now.
//
//   POST /api/collab/{postId}/presence  {clientId, userName, color}
//     -> {presence: [{clientId, userName, color}]}
//
// Called on a slow interval by every open editor; rows go stale quickly so a
// closed tab drops out on its own. Any collaborator (viewer included) counts
// as present.

import { getCurrentUser } from "@/lib/session";
import {
  activePresence,
  collabAccess,
  removePresence,
  upsertPresence,
} from "@/lib/collab";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const user = await getCurrentUser();
  const role = await collabAccess(user, postId);
  if (!role) {
    return Response.json({ error: "No access to this post" }, { status: 403 });
  }

  let body: {
    clientId?: unknown;
    userName?: unknown;
    color?: unknown;
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
  const userName =
    (typeof body.userName === "string" ? body.userName.trim() : "").slice(0, 60) ||
    "Someone";
  const color =
    typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : "#8a8a8f";

  const presence = await upsertPresence(postId, { clientId, userName, color });
  return Response.json({ presence });
}
