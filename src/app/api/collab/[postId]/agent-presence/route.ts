// Publish external-agent presence for a locally connected MCP client.
//
//   POST /api/collab/{postId}/agent-presence
//     {actor: {connectionName, clientName?, clientVersion?},
//      activity: {kind: "open" | "edit", field?: "title"|"subtitle"|"body"}}
//     -> {ok: true, clientId, userName}
//
// Hosted MCP publishes agent presence server-side from its own bearer identity.
// The native loopback path cannot: it runs as the signed-in person's browser
// session, so the page posts here and the SERVER decides the identity from the
// session plus the declared connection name. That keeps a local agent from
// claiming to be someone else, and keeps one presence construction site
// (buildAgentPresence) across both transports.
//
// Presence is decoration for a mutation that has its own authorization. This
// route never mutates content, and its caller must treat a failure as
// non-fatal so an edit still lands when presence reporting is unavailable.

import { agentSelectionAtEnd, upsertPresence } from "@/lib/collab";
import { getCollabRequestAccess } from "@/lib/collab/access.server";
import { buildAgentPresence } from "@/lib/collab/agent-presence.server";
import { getPostStoreContext, signalWorkspaceChange } from "@/lib/store";
import type { WorkspaceAgentActivityField } from "@/lib/ai/agent-protocol";

export const dynamic = "force-dynamic";

const ACTIVITY_FIELDS: WorkspaceAgentActivityField[] = [
  "title",
  "subtitle",
  "body",
];

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const access = await getCollabRequestAccess(request, postId);

  // An agent acts for a signed-in editor. A viewer, a capability-link guest, or
  // an anonymous caller may never publish an agent collaborator.
  const userId = access.user?.userId ?? access.user?.sub ?? null;
  if (access.role !== "editor" || !userId) {
    return noStore({ error: "No agent access to this item" }, 403);
  }

  let body: { actor?: unknown; activity?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "Send a JSON body" }, 400);
  }

  const actor = (body.actor ?? {}) as Record<string, unknown>;
  const connectionName =
    typeof actor.connectionName === "string" ? actor.connectionName.trim() : "";
  if (!connectionName) {
    return noStore({ error: "actor.connectionName is required" }, 400);
  }

  const activity = (body.activity ?? {}) as Record<string, unknown>;
  const kind = activity.kind === "edit" ? "edit" : "open";
  const field = ACTIVITY_FIELDS.includes(
    activity.field as WorkspaceAgentActivityField,
  )
    ? (activity.field as WorkspaceAgentActivityField)
    : "body";

  // Place the cursor at the end of the field the agent is about to touch, so an
  // open shows where it is reading and an edit shows where the change lands.
  const selection = await agentSelectionAtEnd(postId, field).catch(() => null);
  const presence = buildAgentPresence(
    { userId, connectionName: connectionName.slice(0, 200) },
    { selection },
  );
  if (!presence) {
    return noStore({ error: "Could not identify the agent" }, 400);
  }

  await upsertPresence(postId, presence);
  // Wake other clients so the collaborator appears without waiting for a poll.
  const context = await getPostStoreContext(postId).catch(() => null);
  if (context?.handle) {
    await signalWorkspaceChange(context.handle).catch(() => {});
  }

  return noStore({
    ok: true,
    clientId: presence.clientId,
    userName: presence.userName,
    activity: kind,
    field,
  });
}
