import { isWorkspaceToolName } from "@/lib/ai/tools";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog, getUserIdBySub } from "@/lib/store";
import { TENANT_HANDLE_RE } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;
const MAX_COMMAND_BODY_BYTES = 1_100_000;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: JSON_HEADERS });
}

async function readCommandBody(
  request: Request,
): Promise<
  | { body: { handle?: unknown; name?: unknown; args?: unknown } }
  | { error: "invalid" | "too_large" }
> {
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    const declared = Number(rawLength);
    if (Number.isFinite(declared) && declared > MAX_COMMAND_BODY_BYTES) {
      return { error: "too_large" };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { error: "invalid" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_COMMAND_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return { error: "too_large" };
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "invalid" };
    }
    return {
      body: parsed as { handle?: unknown; name?: unknown; args?: unknown },
    };
  } catch {
    return { error: "invalid" };
  }
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

  const decoded = await readCommandBody(request);
  if ("error" in decoded && decoded.error === "too_large") {
    return jsonError("The workspace command is too large.", 413);
  }
  if ("error" in decoded) {
    return jsonError("Send a JSON body.", 400);
  }
  const body = decoded.body;

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

  // This route is a privileged in-app assistant transport, not a general
  // collaborator command API. Match the exact workspace the session owns
  // before resolving an actor or reaching the shared command executor. UI
  // gating is only presentation; this is the authorization boundary.
  //
  // Authorization, and not confirmation. A destructive command reaching here
  // has been confirmed by a dialog in the app - `confirmTool` in
  // `agent-tools.ts` - and this route cannot verify that happened. That is why
  // the cloud lane, where there is no app to ask, routes the same commands
  // through durable proposals instead. Anything wanting a confirmation the
  // SERVER can vouch for has to go the proposal way, and moving this transport
  // onto it is a design decision rather than a flag.
  const ownedWorkspace = await getOwnedBlog(user.sub);
  if (!ownedWorkspace || ownedWorkspace.handle !== body.handle) {
    return jsonError(
      "Only the workspace owner can run assistant commands.",
      403,
    );
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
