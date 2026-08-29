import {
  WORKSPACE_TOOL_DEFINITIONS,
  type WorkspaceToolName,
} from "@/lib/ai/tools";
import {
  LOCAL_AGENT_COMMANDS,
  LOCAL_AGENT_READ_ONLY_COMMANDS,
} from "@/lib/agent-command-access";
import { verifyTextTextApiToken } from "@/lib/mcp/auth";
import {
  resolveMcpScopeAccess,
  runWorkspaceToolForAuth,
  type ToolContext,
} from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const HEADER_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_COMMAND_BODY_BYTES = 1_100_000;

async function readCommandBody(
  request: Request,
): Promise<{ body?: Record<string, unknown>; tooLarge?: true }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_COMMAND_BODY_BYTES) {
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
    if (total > MAX_COMMAND_BODY_BYTES) {
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

function boundedHeader(
  request: Request,
  name: string,
  maximumLength: number,
): string | null | undefined {
  const raw = request.headers.get(name);
  if (raw === null) return undefined;
  const value = raw.trim();
  if (!value || value.length > maximumLength || HEADER_CONTROL_RE.test(value)) {
    return null;
  }
  return value;
}

/**
 * What this connection may ask for.
 *
 * An agent had no way to find out. The verbs a local agent may use are decided
 * in one place and were readable only by reading the source, so the CLI's own
 * "commands" verb was wired to get_workspace, which lists folders. It said one
 * thing and did another.
 */
export async function GET(request: Request) {
  const auth = await verifyTextTextApiToken(request);
  if (!auth) return noStore({ error: "Sign in to TextText on this Mac" }, 401);
  const scopeAccess = resolveMcpScopeAccess(auth.scopes);
  if (scopeAccess === "none") {
    return noStore({ error: "This connection cannot read the workspace" }, 403);
  }
  // Two conditions, not one. A read-scoped connection may call a command that
  // reads AND does not declare requiredScope "sync" - list_access reads and
  // declares it, so offering it here promised something the executor then
  // refused. A discovery list that names commands the caller cannot run is
  // worse than no list: it sends an agent to be rejected.
  const available = [...LOCAL_AGENT_COMMANDS].filter((name) => {
    if (scopeAccess === "full") return true;
    if (!LOCAL_AGENT_READ_ONLY_COMMANDS.has(name)) return false;
    return WORKSPACE_TOOL_DEFINITIONS[name].requiredScope !== "sync";
  });
  return noStore({
    commands: available.map((name) => ({
      name,
      title: WORKSPACE_TOOL_DEFINITIONS[name].title,
      description: WORKSPACE_TOOL_DEFINITIONS[name].description,
      mutability: WORKSPACE_TOOL_DEFINITIONS[name].mutability,
    })),
    note:
      scopeAccess === "full"
        ? "Run one with: texttext do <name> --args '{...}'"
        : "This connection may only read. Run one with: texttext do <name> --args '{...}'",
  });
}

export async function POST(request: Request) {
  const auth = await verifyTextTextApiToken(request);
  if (!auth) return noStore({ error: "Sign in to TextText on this Mac" }, 401);

  const requestedName = boundedHeader(request, "x-texttext-agent-name", 120);
  const requestedIntent = boundedHeader(
    request,
    "x-texttext-agent-intent",
    500,
  );
  if (requestedName === null || requestedIntent === null) {
    return noStore({ error: "Agent metadata is invalid" }, 400);
  }

  const decoded = await readCommandBody(request);
  if (decoded.tooLarge) {
    return noStore({ error: "Command body is too large" }, 413);
  }
  const body = decoded.body;
  if (!body) {
    return noStore({ error: "Send a JSON body" }, 400);
  }
  const name = typeof body.name === "string" ? body.name : "";
  if (!LOCAL_AGENT_COMMANDS.has(name as WorkspaceToolName)) {
    return noStore(
      { error: "That command is not available to the local CLI" },
      400,
    );
  }
  const scopeAccess = resolveMcpScopeAccess(auth.scopes);
  if (scopeAccess === "none") {
    return noStore({ error: "This connection cannot read the workspace" }, 403);
  }
  if (
    !LOCAL_AGENT_READ_ONLY_COMMANDS.has(name as WorkspaceToolName) &&
    scopeAccess !== "full"
  ) {
    return noStore(
      { error: "This connection cannot change the workspace" },
      403,
    );
  }
  const args = body.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return noStore({ error: "Command arguments must be an object" }, 400);
  }

  // Authentication identifies the person and workspace. These fields are
  // constructed here, never accepted from the JSON body, so the local agent
  // receives the same permission, audit, and live-document rules as MCP.
  const existingName = auth.extra?.connectionName;
  const connectionName =
    requestedName ??
    (typeof existingName === "string" && existingName.trim()
      ? existingName.trim()
      : "TextText CLI");
  const context: ToolContext = {
    authInfo: {
      ...auth,
      extra: {
        ...auth.extra,
        actorType: "external_agent",
        connectionName,
        // Presence of this trusted key tells the executor to include the local
        // agent in its atomic audit row. Empty means no intent was supplied.
        actorIntent: requestedIntent ?? "",
      },
    },
  };
  const result = await runWorkspaceToolForAuth(
    name as WorkspaceToolName,
    args as Record<string, unknown>,
    context,
  );
  return noStore(result);
}
