// Publish agent presence for the `texttext` CLI.
//
//   POST /api/agent/presence
//     Authorization: Bearer <wsk_ workspace token held by the signed-in app>
//     {itemId, agent, activity: "open"|"edit", active, section?, message?}
//     -> {ok: true, clientId, userName}
//
// The CLI ships inside the app bundle and authenticates with the workspace
// credential the signed-in app already holds, so unlike the browser path there is no
// session cookie here. The token identifies the person; the declared agent name
// only chooses which collaborator to render, exactly as `clientInfo` did for
// MCP.
//
// Presence is decoration for a change that has its own authorization. This route
// never mutates content, and the CLI treats every failure as non-fatal so an
// edit still lands when presence reporting is unavailable.

import {
  agentSelectionAtEnd,
  agentSelectionAtSection,
  removePresence,
  upsertPresence,
} from "@/lib/collab";
import { buildAgentPresence } from "@/lib/collab/agent-presence.server";
import { verifyTextTextApiToken, workspaceBlog } from "@/lib/mcp/auth";
import { getPostStoreContext, signalWorkspaceChange } from "@/lib/store";

export const dynamic = "force-dynamic";
const AGENT_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_PRESENCE_BODY_BYTES = 16_384;

async function readPresenceBody(
  request: Request,
): Promise<{ body?: Record<string, unknown>; tooLarge?: true }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PRESENCE_BODY_BYTES) {
    return { tooLarge: true };
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PRESENCE_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return { body: parsed as Record<string, unknown> };
  } catch {
    return {};
  }
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await verifyTextTextApiToken(request);
  const userId =
    typeof auth?.extra?.userId === "string" ? auth.extra.userId : null;
  if (!auth || !userId) {
    return noStore({ error: "Sign in to TextText on this Mac" }, 401);
  }
  if (!auth.scopes.includes("sync")) {
    return noStore(
      { error: "This connection cannot change the workspace" },
      403,
    );
  }
  const decoded = await readPresenceBody(request);
  if (decoded.tooLarge) {
    return noStore({ error: "Presence body is too large" }, 413);
  }
  const body = decoded.body;
  if (!body) {
    return noStore({ error: "Send a JSON body" }, 400);
  }

  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  const agent = typeof body.agent === "string" ? body.agent.trim() : "";
  if (!itemId || !agent || agent.length > 120 || AGENT_CONTROL_RE.test(agent)) {
    return noStore({ error: "itemId and agent are required" }, 400);
  }
  const section = typeof body.section === "string" ? body.section.trim() : "";
  if (section.length > 200 || AGENT_CONTROL_RE.test(section)) {
    return noStore({ error: "Agent metadata is invalid" }, 400);
  }
  const active = body.active !== false;
  const blog = await workspaceBlog(auth);
  if (!blog) return noStore({ error: "No workspace" }, 404);

  // The item must exist and belong to this token's workspace, or a valid token
  // could publish presence onto someone else's document.
  const context = await getPostStoreContext(itemId);
  if (!context || context.handle !== blog.handle) {
    return noStore({ error: "No such item" }, 404);
  }

  // One construction site for agent presence across every transport, so a CLI
  // agent renders as the same collaborator MCP produces.
  // The CLI already reports which section it is working in. Using it puts the
  // agent's caret where the work is happening instead of parking every agent
  // at the end of the document.
  const presence = buildAgentPresence(
    { userId, connectionName: agent },
    active
      ? {
          selection:
            (section
              ? await agentSelectionAtSection(itemId, section).catch(() => null)
              : null) ??
            (await agentSelectionAtEnd(itemId, "body").catch(() => null)),
        }
      : {},
  );
  if (!presence) return noStore({ error: "Could not build presence" }, 400);

  try {
    if (active) {
      await upsertPresence(itemId, presence);
    } else {
      // Delete rather than blank the awareness, or the agent would linger as a
      // collaborator with no cursor after its command finished.
      await removePresence(itemId, presence.clientId);
    }
    await signalWorkspaceChange(context.handle).catch(() => {});
  } catch {
    // Never fail the caller for a presence problem.
    return noStore({ ok: false }, 200);
  }

  return noStore({
    ok: true,
    clientId: presence.clientId,
    userName: presence.userName,
  });
}
