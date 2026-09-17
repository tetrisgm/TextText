import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolName } from "@/lib/ai/tools";
import { LOCAL_AGENT_COMMANDS, LOCAL_AGENT_READ_ONLY_COMMANDS } from "@/lib/agent-command-access";
import { modelMapper, runFreeTextCommand } from "@/lib/ai/free-text-command.server";
import { verifyTextTextApiToken } from "@/lib/mcp/auth";
import { resolveMcpScopeAccess, runWorkspaceToolForAuth, type ToolContext } from "@/lib/mcp/tools";
import { getBlogOwnerSub, getOwnedBlog } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST { text, execute?, item_id?, folder_path? } with an API token: one
 * sentence, mapped onto one of the commands this connection may already
 * call, run when allowed. The same thing as the run_command MCP tool, for
 * clients that speak plain HTTP: a Shortcut, a bot, a curl.
 */
export async function POST(request: Request) {
  const auth = await verifyTextTextApiToken(request);
  if (!auth) return noStore({ error: "Sign in to TextText on this Mac" }, 401);
  const scope = resolveMcpScopeAccess(auth.scopes);
  if (scope === "none") return noStore({ error: "This connection cannot read the workspace" }, 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return noStore({ error: "Send { text: \"...\" }" }, 400);
  if (text.length > 2000) return noStore({ error: "Keep it under 2000 characters" }, 400);
  const userId = typeof auth.extra?.userId === "string" ? auth.extra.userId : auth.clientId;
  const sub = typeof auth.extra?.sub === "string" ? auth.extra.sub : userId;
  const blog = await getOwnedBlog(sub);
  if (!blog) return noStore({ error: "Workspace not found" }, 404);
  const candidates = [...LOCAL_AGENT_COMMANDS].filter((name) => {
    if (name === "run_command") return false;
    if (scope === "full") return true;
    return LOCAL_AGENT_READ_ONLY_COMMANDS.has(name) && WORKSPACE_TOOL_DEFINITIONS[name].requiredScope !== "sync";
  });
  let model = null;
  try {
    const owner = await getBlogOwnerSub(blog.handle);
    const config = owner ? await import("@/lib/ai/workspace-ai-config.server").then((module) => module.getWorkspaceAiConfigForOwner(owner)) : null;
    if (config) model = (await import("@/lib/ai/provider-model.server")).workspaceLanguageModel(config);
  } catch {
    model = null;
  }
  const context: ToolContext = {
    authInfo: { ...auth, extra: { ...auth.extra, actorType: "external_agent", connectionName: typeof auth.extra?.connectionName === "string" ? auth.extra.connectionName : "TextText CLI", actorIntent: text.slice(0, 500) } },
  };
  const outcome = await runFreeTextCommand({
    text,
    execute: body?.execute === true,
    context: { itemId: typeof body?.item_id === "string" ? body.item_id : undefined, folderPath: typeof body?.folder_path === "string" ? body.folder_path : undefined },
    candidates: candidates as WorkspaceToolName[],
    mapper: modelMapper(model),
    run: (tool, args) => runWorkspaceToolForAuth(tool, args, context),
  });
  return noStore(outcome);
}
