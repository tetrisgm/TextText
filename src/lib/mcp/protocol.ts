// MCP 2026-07-28: the protocol primitives.
//
// This revision made MCP stateless. There is no `initialize` handshake, no
// `Mcp-Session-Id`, and no connection-scoped state: every request carries its
// own protocol version, client capabilities, and identity in `_meta`, and the
// server answers it in isolation. That is why this file exists at all, and why
// there is no session store anywhere in the MCP layer.
//
// Spec: https://modelcontextprotocol.io/specification/2026-07-28
//
// Everything here is the wire contract. Business logic lives in tools.ts and
// agent-surface.ts and does not import this file.

/** The revision this server implements. */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * Versions this server will serve. `server/discover` advertises these, and
 * `UnsupportedProtocolVersionError` lists them.
 *
 * The initialize-era versions are served by a separate, deprecated adapter
 * (see legacy.ts) so clients that predate this revision keep working. They are
 * NOT listed here: `supported` describes the stateless protocol, and a client
 * that reads this list should be speaking it.
 */
export const MCP_SUPPORTED_VERSIONS = [MCP_PROTOCOL_VERSION] as const;

export const MCP_SERVER_INFO = {
  name: "texttext",
  title: "TextText",
  version: "2.0.0",
  websiteUrl: "https://TextText.app",
} as const;

// ---------------------------------------------------------------------------
// Reserved `_meta` keys
// ---------------------------------------------------------------------------

export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export const META_CLIENT_CAPABILITIES =
  "io.modelcontextprotocol/clientCapabilities";
export const META_LOG_LEVEL = "io.modelcontextprotocol/logLevel";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
export const META_SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------
//
// The revision partitions the JSON-RPC server-error range: -32000..-32019 is
// legacy and implementation-defined, -32020..-32099 belongs to the spec. We
// emit nothing from the legacy sub-range. Note the renumbering from the draft:
// HeaderMismatch moved -32001 -> -32020, MissingRequiredClientCapability
// -32003 -> -32021, UnsupportedProtocolVersion -32004 -> -32022.

export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;
export const JSONRPC_PARSE_ERROR = -32700;

export const MCP_HEADER_MISMATCH = -32020;
export const MCP_MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export const MCP_UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** Resource-not-found moved to Invalid Params in this revision. -32002 is
 * reserved and MUST NOT be emitted; clients still accept it from old servers. */
export const MCP_RESOURCE_NOT_FOUND = JSONRPC_INVALID_PARAMS;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type McpResultType = "complete" | "input_required";

/**
 * Every result carries `resultType`. Clients treat a missing one as "complete"
 * for backward compatibility, but we always emit it.
 */
export type McpResult = Record<string, unknown> & { resultType: McpResultType };

/** `ttlMs` and `cacheScope` are REQUIRED on the five cacheable list/read
 * results. They are a freshness hint that lets a client cache instead of poll;
 * `cacheScope: "private"` keeps shared intermediaries from caching a response
 * that is scoped to one workspace token. */
export type CacheScope = "public" | "private";

export type CacheHint = { ttlMs: number; cacheScope: CacheScope };

/**
 * Workspace content is per-token and changes when the owner edits, so it is
 * private and short-lived. The tool and prompt catalogs are the same for every
 * caller and change only on deploy, so they are public and cached longer.
 */
export const CACHE_CATALOG: CacheHint = {
  ttlMs: 300_000,
  cacheScope: "public",
};
export const CACHE_WORKSPACE: CacheHint = {
  ttlMs: 5_000,
  cacheScope: "private",
};

export function complete<T extends Record<string, unknown>>(
  body: T,
  cache?: CacheHint,
): McpResult {
  const meta = { [META_SERVER_INFO]: MCP_SERVER_INFO };
  const existingMeta =
    typeof body._meta === "object" && body._meta ? body._meta : {};
  return {
    ...body,
    ...(cache ?? {}),
    resultType: "complete",
    _meta: { ...existingMeta, ...meta },
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly httpStatus: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export const invalidParams = (message: string, data?: unknown) =>
  new McpError(JSONRPC_INVALID_PARAMS, message, 400, data);

export const methodNotFound = (method: string) =>
  // The transport answers 404 here so a client can tell an unknown RPC apart
  // from a legacy HTTP+SSE server that does not host a modern MCP endpoint.
  new McpError(JSONRPC_METHOD_NOT_FOUND, `Unknown method: ${method}`, 404);

export const headerMismatch = (message: string) =>
  new McpError(MCP_HEADER_MISMATCH, `Header mismatch: ${message}`, 400);

export const unsupportedProtocolVersion = (requested: string | null) =>
  new McpError(
    MCP_UNSUPPORTED_PROTOCOL_VERSION,
    requested
      ? `Unsupported protocol version: ${requested}`
      : "Missing protocol version",
    400,
    { supported: [...MCP_SUPPORTED_VERSIONS], requested },
  );

export const missingClientCapability = (required: string[]) =>
  new McpError(
    MCP_MISSING_REQUIRED_CLIENT_CAPABILITY,
    `Missing required client capability: ${required.join(", ")}`,
    400,
    { requiredCapabilities: required },
  );

// ---------------------------------------------------------------------------
// Request metadata
// ---------------------------------------------------------------------------

export type Implementation = {
  name: string;
  version?: string;
  title?: string;
};

export type RequestMeta = {
  protocolVersion: string;
  clientCapabilities: Record<string, unknown>;
  clientInfo: Implementation | null;
  logLevel: string | null;
  progressToken: string | number | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Read the per-request protocol fields. `protocolVersion` and
 * `clientCapabilities` are REQUIRED; a request missing either is malformed and
 * gets -32602 with HTTP 400. `clientInfo` is self-reported and explicitly not
 * to be trusted for security decisions, so it is carried for display only.
 */
export function parseRequestMeta(params: unknown): RequestMeta {
  const meta = asRecord(asRecord(params)?._meta) ?? {};

  const version = meta[META_PROTOCOL_VERSION];
  if (typeof version !== "string" || version.length === 0) {
    throw invalidParams(`Missing required _meta field: ${META_PROTOCOL_VERSION}`);
  }
  if (!(MCP_SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    throw unsupportedProtocolVersion(version);
  }

  const capabilities = asRecord(meta[META_CLIENT_CAPABILITIES]);
  if (!capabilities) {
    throw invalidParams(
      `Missing required _meta field: ${META_CLIENT_CAPABILITIES}`,
    );
  }

  const info = asRecord(meta[META_CLIENT_INFO]);
  const progress = meta.progressToken;

  return {
    protocolVersion: version,
    clientCapabilities: capabilities,
    clientInfo:
      info && typeof info.name === "string"
        ? {
            name: info.name,
            version: typeof info.version === "string" ? info.version : undefined,
            title: typeof info.title === "string" ? info.title : undefined,
          }
        : null,
    logLevel: typeof meta[META_LOG_LEVEL] === "string"
      ? (meta[META_LOG_LEVEL] as string)
      : null,
    progressToken:
      typeof progress === "string" || typeof progress === "number"
        ? progress
        : null,
  };
}

// ---------------------------------------------------------------------------
// Header value encoding
// ---------------------------------------------------------------------------

const BASE64_PREFIX = "=?base64?";
const BASE64_SUFFIX = "?=";

/**
 * `Mcp-Name` and `Mcp-Param-*` carry a body value in an HTTP header. Values
 * that are not plain visible ASCII are wrapped in the spec's sentinel, so the
 * server MUST decode before comparing against the body.
 */
export function decodeHeaderValue(raw: string): string {
  if (raw.startsWith(BASE64_PREFIX) && raw.endsWith(BASE64_SUFFIX)) {
    const encoded = raw.slice(BASE64_PREFIX.length, -BASE64_SUFFIX.length);
    try {
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      throw headerMismatch("value is not valid base64");
    }
  }
  return raw;
}

export function encodeHeaderValue(value: string): string {
  // Visible ASCII only, and never something that could be mistaken for the
  // sentinel itself.
  const safe =
    /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/.test(value) &&
    !(value.startsWith(BASE64_PREFIX) && value.endsWith(BASE64_SUFFIX));
  if (safe) return value;
  return `${BASE64_PREFIX}${Buffer.from(value, "utf8").toString("base64")}${BASE64_SUFFIX}`;
}
