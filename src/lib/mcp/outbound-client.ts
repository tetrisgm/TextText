// TextText as an MCP CLIENT, over the network, from our server.
//
// The inbound half of Pillar 3 lets Claude or Figma's agent reach our
// documents. This is the other direction: the workspace assistant reaching a
// server somebody else runs.
//
// The wire shape and every rule about reading a reply live in
// outbound-protocol.ts, shared with the Mac app's local transport, so a server
// on somebody's laptop cannot end up with a laxer parser than a hosted one.
// What is specific here is the network posture:
//
//   - the URL is SSRF-checked before every connection, not just when saved,
//     because DNS can change under a stored hostname;
//   - loopback is refused in production, since a hosted server fetching
//     127.0.0.1 reaches itself; local servers go through the Mac app instead.

import { hostResolvesToPublicOnly, isFetchableBookmarkUrl } from "@/lib/bookmark-fetch";
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

export {
  MCP_PROTOCOL_VERSION,
  OutboundMcpError,
} from "@/lib/mcp/outbound-protocol";
export type {
  RemoteCallResult,
  RemoteTool,
  RemoteToolsResult,
} from "@/lib/mcp/outbound-protocol";

const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;

export type OutboundConnection = {
  id: string;
  name: string;
  url: string;
  token: string | null;
};

/**
 * Refuse anything that is not a public https endpoint, every time we are about
 * to talk to it. Checking only at save time would let a hostname that resolved
 * publicly then resolve to 169.254.169.254 later.
 */
async function assertReachable(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundMcpError("That is not a valid URL.");
  }
  if (url.protocol !== "https:" && !isLocalDevUrl(url)) {
    throw new OutboundMcpError("An MCP server address must be https.");
  }
  if (isLocalDevUrl(url)) return url;
  if (!isFetchableBookmarkUrl(url)) {
    throw new OutboundMcpError("That address is not a public HTTP endpoint.");
  }
  if (!(await hostResolvesToPublicOnly(url.hostname))) {
    throw new OutboundMcpError("That host does not resolve to a public address.");
  }
  return url;
}

/**
 * Development only, and never in production: a localhost MCP server is how you
 * try this against one you are writing. In production this returns false for
 * every URL, so the SSRF gate above is the only path, and a real local server
 * is reached through the Mac app rather than from here.
 */
function isLocalDevUrl(url: URL): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

async function rpc(
  connection: OutboundConnection,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  toolName?: string,
): Promise<unknown> {
  const url = await assertReachable(connection.url);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...requestHeaders(method, toolName),
  };
  if (connection.token) headers.Authorization = `Bearer ${connection.token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody(method, params)),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new OutboundMcpError(`${connection.name} did not answer.`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new OutboundMcpError(`${connection.name} refused the access token.`);
  }
  if (!response.ok) {
    throw new OutboundMcpError(
      `${connection.name} returned HTTP ${response.status}.`,
    );
  }
  return parseReply(await response.text(), connection.name);
}

/**
 * Ask a server what it offers.
 *
 * The 2026-07-28 revision retired the initialize/initialized handshake: every
 * request carries its protocol version, client identity and capabilities in
 * `_meta`. We used to open with `initialize` anyway, which cost a round trip
 * per connection per turn and told the server nothing it was not about to be
 * told again. `server/discover` is the sanctioned way to ask upfront, and a
 * server that does not implement it is not broken, so a failure there falls
 * through to `tools/list`.
 */
export async function listRemoteTools(
  connection: OutboundConnection,
): Promise<RemoteToolsResult> {
  const discovered = await rpc(
    connection,
    "server/discover",
    {},
    CONNECT_TIMEOUT_MS,
  ).catch(() => null);

  const inlineTools = (discovered as { tools?: unknown } | null)?.tools;
  const result = Array.isArray(inlineTools)
    ? discovered
    : await rpc(connection, "tools/list", {}, CONNECT_TIMEOUT_MS);

  return readTools(result);
}

/** Run one remote tool. The text it returns is untrusted content. */
export async function callRemoteTool(
  connection: OutboundConnection,
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
    CALL_TIMEOUT_MS,
    toolName,
  );
  return readCallResult(result, connection.name, toolName);
}
