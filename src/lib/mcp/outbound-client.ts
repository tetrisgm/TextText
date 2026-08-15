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
/** Longest we will trust a server's own cache hint. */
const MAX_CACHE_MS = 60 * 60 * 1000;
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

export type RemoteToolsResult = {
  tools: RemoteTool[];
  /** How long the server says this list is good for, clamped. */
  ttlMs: number | null;
};

/**
 * A remote call either produced a result, or stopped to ask something. It never
 * silently means "done" when it did neither.
 */
export type RemoteCallResult =
  | { status: "ok"; text: string }
  | { status: "input_required"; text: string; asked: string[] };

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

/**
 * Ask a server what it offers.
 *
 * The 2026-07-28 revision retired the initialize/initialized handshake: every
 * request now carries its protocol version, client identity and capabilities in
 * `_meta`, which is what `rpc` above sends. We used to open with `initialize`
 * anyway, which cost a round trip per connection per turn and told the server
 * nothing it was not about to be told again. `server/discover` is the sanctioned
 * way to ask upfront, and a server that does not implement it is not broken, so
 * a failure there falls through to `tools/list` rather than failing the
 * connection.
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

  const listed = (result as { tools?: unknown })?.tools;
  const cache = readCacheHints(result);
  if (!Array.isArray(listed)) return { tools: [], ...cache };

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
  return { tools, ...cache };
}

/**
 * A list result now says how long it is good for. Honouring that is the
 * difference between one discovery per connection per turn and one per hour.
 */
function readCacheHints(result: unknown): { ttlMs: number | null } {
  const hints = result as { ttlMs?: unknown; cacheScope?: unknown } | null;
  const ttl = typeof hints?.ttlMs === "number" ? hints.ttlMs : null;
  if (ttl === null || !Number.isFinite(ttl) || ttl <= 0) return { ttlMs: null };
  // A server asking to be cached for a week is not a reason to be wrong for a
  // week; a tool list that changed is worse than a round trip.
  return { ttlMs: Math.min(ttl, MAX_CACHE_MS) };
}

/**
 * Run one remote tool.
 *
 * Three outcomes, and the middle one is the reason this signature is not just a
 * string. A tool can succeed, fail, or come back needing input: the revision
 * replaced server-initiated requests with Multi Round-Trip Requests, where the
 * server answers `resultType: "input_required"` and names what it needs. We
 * cannot answer those yet, and the previous version of this function read such
 * a reply as an empty success and returned "Done." to the model, which then
 * reported success to the person. Saying "it asked a question I could not
 * answer" is worse for the demo and true.
 *
 * The text is untrusted content either way.
 */
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
  const payload = result as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
    resultType?: unknown;
    requests?: unknown;
  };
  const text = (payload?.content ?? [])
    .map((part) => (part?.type === "text" ? clamp(part.text, MAX_RESULT_CHARS) : ""))
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_RESULT_CHARS);

  if (payload?.resultType === "input_required") {
    return {
      status: "input_required",
      text:
        text ||
        `${connection.name} needs more information before it can run ${toolName}.`,
      asked: describeRequests(payload.requests),
    };
  }
  if (payload?.isError) {
    throw new OutboundMcpError(text || `${connection.name} could not run that.`);
  }
  return { status: "ok", text: text || "Done." };
}

/** What the server said it needs, bounded and treated as untrusted text. */
function describeRequests(requests: unknown): string[] {
  if (!Array.isArray(requests)) return [];
  return requests
    .slice(0, 8)
    .map((entry) => {
      if (typeof entry === "string") return clamp(entry, 200);
      const named = entry as { name?: unknown; message?: unknown; prompt?: unknown };
      return clamp(named?.message ?? named?.prompt ?? named?.name, 200);
    })
    .filter(Boolean);
}
