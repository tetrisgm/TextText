import type { WorkspaceToolName } from "@/lib/ai/tools";
import { verifyTextTextApiToken } from "@/lib/mcp/auth";
import {
  resolveMcpScopeAccess,
  runWorkspaceToolForAuth,
  type ToolContext,
} from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const ALLOWED_COMMANDS = new Set<WorkspaceToolName>([
  "search",
  "read_item",
  "create_item",
  "update_item",
  "append_to_item",
]);
const READ_ONLY_COMMANDS = new Set<WorkspaceToolName>([
  "search",
  "read_item",
]);
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
  if (!ALLOWED_COMMANDS.has(name as WorkspaceToolName)) {
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
    !READ_ONLY_COMMANDS.has(name as WorkspaceToolName) &&
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
