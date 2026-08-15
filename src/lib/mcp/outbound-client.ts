// TextText as an MCP CLIENT.
//
// The inbound half of Pillar 3 lets Claude or Figma's agent reach our
// documents. This is the other direction: the workspace assistant reaching a
// server somebody else runs, so "put this spec in Figma" is one sentence rather
// than a copy and a paste.
//
// Everything a remote server sends back is somebody else's text. Tool names,
// descriptions and results are DATA, never instructions, and this module is
// where that stops being an aspiration:
//
//   - the URL is SSRF-checked before every connection, not just when saved,
//     because DNS can change under a stored hostname;
//   - names are constrained to a known-safe shape so a remote cannot smuggle a
//     separator or shadow one of our own tools;
//   - descriptions and results are length-capped so a server cannot flood the
//     model's context;
//   - the request never carries workspace content the model did not put in the
//     arguments itself.

import { hostResolvesToPublicOnly, isFetchableBookmarkUrl } from "@/lib/bookmark-fetch";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_TOOLS = 60;
const MAX_DESCRIPTION_CHARS = 600;
const MAX_RESULT_CHARS = 20_000;
/** A whole JSON-RPC reply above this is refused rather than truncated. */
const MAX_RESPONSE_CHARS = 2_000_000;
/** Remote tool names we will speak to. Anything else is skipped, not sanitized. */
const REMOTE_TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

export type OutboundConnection = {
  id: string;
  name: string;
  url: string;
  token: string | null;
};

export type RemoteTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export class OutboundMcpError extends Error {}

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

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
 * try this against a server you are writing. In production this returns false
 * for every URL, so the SSRF gate above is the only path.
 */
function isLocalDevUrl(url: URL): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

type JsonRpcResponse = {
  result?: unknown;
  error?: { code?: number; message?: unknown };
};

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
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Method": method,
  };
  if (toolName) headers["Mcp-Name"] = toolName;
  if (connection.token) headers.Authorization = `Bearer ${connection.token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "TextText",
              version: "1",
            },
          },
        },
      }),
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

  // Read it whole, then refuse if it is absurd. Slicing before JSON.parse only
  // guarantees a parse error on a large-but-legitimate tools/list, which is a
  // self-inflicted outage dressed up as a safety limit. The real protection is
  // the per-field caps below.
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_CHARS) {
    throw new OutboundMcpError(`${connection.name} sent too large a reply.`);
  }
  let payload: JsonRpcResponse;
  try {
    // Streamable HTTP may answer as SSE; take the first data frame.
    if (raw.startsWith("event:") || raw.startsWith("data:")) {
      const line = raw.split("\n").find((entry) => entry.startsWith("data:"));
      payload = JSON.parse((line ?? "").slice(5));
    } else {
      payload = JSON.parse(raw);
    }
  } catch {
    throw new OutboundMcpError(`${connection.name} sent a reply we could not read.`);
  }

  if (payload.error) {
    throw new OutboundMcpError(
      clamp(payload.error.message, 300) || `${connection.name} reported an error.`,
    );
  }
  return payload.result;
}

/** Handshake, then ask what it can do. Also the "test this connection" path. */
export async function listRemoteTools(
  connection: OutboundConnection,
): Promise<RemoteTool[]> {
  await rpc(
    connection,
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "TextText", version: "1" },
    },
    CONNECT_TIMEOUT_MS,
  );

  const result = await rpc(connection, "tools/list", {}, CONNECT_TIMEOUT_MS);
  const listed = (result as { tools?: unknown })?.tools;
  if (!Array.isArray(listed)) return [];

  const tools: RemoteTool[] = [];
  for (const entry of listed) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as {
      name?: unknown;
      description?: unknown;
      inputSchema?: unknown;
    };
    if (typeof candidate.name !== "string") continue;
    if (!REMOTE_TOOL_NAME.test(candidate.name)) continue;
    const schema =
      candidate.inputSchema && typeof candidate.inputSchema === "object"
        ? (candidate.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {} };
    tools.push({
      name: candidate.name,
      description: clamp(candidate.description, MAX_DESCRIPTION_CHARS),
      inputSchema: schema,
    });
    if (tools.length >= MAX_TOOLS) break;
  }
  return tools;
}

/** Run one remote tool. The text it returns is untrusted content. */
export async function callRemoteTool(
  connection: OutboundConnection,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
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
  const payload = result as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  const text = (payload?.content ?? [])
    .map((part) => (part?.type === "text" ? clamp(part.text, MAX_RESULT_CHARS) : ""))
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_RESULT_CHARS);
  if (payload?.isError) {
    throw new OutboundMcpError(text || `${connection.name} could not run that.`);
  }
  return text || "Done.";
}
