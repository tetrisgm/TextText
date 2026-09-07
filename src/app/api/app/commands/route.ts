import { resolveSyncWorkspace } from "@/app/api/sync/v1/auth";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
import type { WorkspaceToolName } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";
const allowed = new Set<WorkspaceToolName>(["create_item", "append_to_item", "read_item", "search"]);
const headers = { "Cache-Control": "private, no-store" };
// First-party native transport. Auth and tenant come from the existing sync
// credential, never from JSON. This invokes the shared executor, not /api/mcp.
// Native actions, including owner-configured Shortcuts, act as the account owner.
// They are audited as human actions and do not create agent presence or reversible
// agent changes. External agents must use the hosted MCP transport.
export async function POST(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const decoded = await readBoundedJson(request, 1_100_000);
  if ("error" in decoded) return Response.json({ error: "Invalid command body" }, { status: 400, headers });
  const body = decoded.value as { name?: unknown; args?: unknown } | null;
  if (!body || typeof body.name !== "string" || !allowed.has(body.name as WorkspaceToolName) ||
      !body.args || typeof body.args !== "object" || Array.isArray(body.args)) {
    return Response.json({ error: "Unknown native command or invalid arguments" }, { status: 400, headers });
  }
  try {
    const result = await runWorkspaceToolForSession(body.name as WorkspaceToolName,
      body.args as Record<string, unknown>, {
        sub: workspace.sub, userId: workspace.userId, handle: workspace.blog.handle,
        actorType: "human", connectionId: `native:${workspace.userId}`,
      });
    const text = result.content.find(c => c.type === "text");
    if (result.isError) return Response.json({ error: text?.type === "text" ? text.text : "Command failed" }, { status: 409, headers });
    return Response.json({ result: text?.type === "text" ? JSON.parse(text.text) : null }, { headers });
  } catch {
    return Response.json({ error: "Command failed. Try again." }, { status: 409, headers });
  }
}
