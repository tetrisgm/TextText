import { isWorkspaceToolName } from "@/lib/ai/tools";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { TENANT_HANDLE_RE } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: JSON_HEADERS });
}

function resultText(
  result: Awaited<ReturnType<typeof runWorkspaceToolForSession>>,
) {
  const block = result.content.find((entry) => entry.type === "text");
  return block?.type === "text" ? block.text : "";
}

function parseResult(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Stable, session-authenticated transport for the in-app assistant. The route
 * calls the shared workspace command executor directly; it is not an MCP
 * network hop. Keeping the browser protocol as ordinary JSON means an open Mac
 * window remains valid across deployments instead of holding build-specific
 * Next Server Action identifiers.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Sign in to use the assistant.", 401);

  let body: { handle?: unknown; name?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Send a JSON body.", 400);
  }

  if (
    typeof body.handle !== "string" ||
    !TENANT_HANDLE_RE.test(body.handle)
  ) {
    return jsonError("Choose a valid workspace.", 400);
  }
  if (typeof body.name !== "string" || !isWorkspaceToolName(body.name)) {
    return jsonError("Unknown workspace command.", 400);
  }
  if (
    body.args === null ||
    typeof body.args !== "object" ||
    Array.isArray(body.args)
  ) {
    return jsonError("Command arguments must be an object.", 400);
  }

  const userId = user.userId ?? (await getUserIdBySub(user.sub));
  let commandResult: Awaited<
    ReturnType<typeof runWorkspaceToolForSession>
  >;
  try {
    commandResult = await runWorkspaceToolForSession(
      body.name,
      body.args as Record<string, unknown>,
      { sub: user.sub, userId: userId ?? null, handle: body.handle },
    );
  } catch (error) {
    console.error("assistant workspace command failed", error);
    return jsonError("The workspace command failed. Try again.", 409);
  }
  const text = resultText(commandResult);
  if (commandResult.isError) {
    return jsonError(text || "The workspace command failed.", 409);
  }

  return Response.json(
    { result: parseResult(text) },
    { headers: JSON_HEADERS },
  );
}
