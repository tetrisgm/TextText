// An MCP client for servers running on this Mac.
//
// Same protocol as the hosted client, different wire: the request is handed to
// Swift, which is the only part of TextText that can reach 127.0.0.1 on the
// person's own machine. Everything about reading the reply is the shared
// module, so a local server gets no laxer treatment than a hosted one.
//
// Browser-safe: no node imports, no dns. This runs inside the Mac app's web
// view, and every function refuses politely everywhere else.

import {
  OutboundMcpError,
  parseReply,
  readCallResult,
  readTools,
  requestBody,
  requestHeaders,
  REMOTE_TOOL_NAME,
  type RemoteCallResult,
  type RemoteToolsResult,
} from "@/lib/mcp/outbound-protocol";
import {
  isLoopbackUrl,
  localMcpAvailable,
  sendLocalMcpRequest,
} from "@/lib/mcp/local-transport";

export type LocalConnection = {
  id: string;
  name: string;
  url: string;
  token?: string | null;
};

/** Whether this connection is one only the Mac app can reach. */
export function isLocalConnection(url: string): boolean {
  return isLoopbackUrl(url);
}

export { localMcpAvailable };

async function rpc(
  connection: LocalConnection,
  method: string,
  params: Record<string, unknown>,
  toolName?: string,
): Promise<unknown> {
  const raw = await sendLocalMcpRequest(
    connection.url,
    requestBody(method, params),
    {
      token: connection.token ?? null,
      headers: requestHeaders(method, toolName),
    },
  ).catch((error: unknown) => {
    throw new OutboundMcpError(
      error instanceof Error ? error.message : `${connection.name} did not answer.`,
    );
  });
  return parseReply(raw, connection.name);
}

/** Ask a local server what it offers, discover first, list as the fallback. */
export async function listLocalTools(
  connection: LocalConnection,
): Promise<RemoteToolsResult> {
  if (!localMcpAvailable()) {
    throw new OutboundMcpError(
      "A server on this Mac can only be reached from the TextText Mac app.",
    );
  }
  const discovered = await rpc(connection, "server/discover", {}).catch(() => null);
  const inlineTools = (discovered as { tools?: unknown } | null)?.tools;
  const result = Array.isArray(inlineTools)
    ? discovered
    : await rpc(connection, "tools/list", {});
  return readTools(result);
}

/** Run one tool on a local server. Its output is untrusted content. */
export async function callLocalTool(
  connection: LocalConnection,
  toolName: string,
  args: Record<string, unknown>,
): Promise<RemoteCallResult> {
  if (!REMOTE_TOOL_NAME.test(toolName)) {
    throw new OutboundMcpError("That tool name is not one we will call.");
  }
  const result = await rpc(
    connection,
    "tools/call",
    { name: toolName, arguments: args },
    toolName,
  );
  return readCallResult(result, connection.name, toolName);
}
