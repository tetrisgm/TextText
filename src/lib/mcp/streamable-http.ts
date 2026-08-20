// MCP 2026-07-28 Streamable HTTP.
//
// The whole transport is one POST handler. This revision removed sessions, the
// GET stream, `initialize`, and SSE resumability, so there is nothing to keep
// between requests: read the headers, validate them against the body, dispatch,
// answer. That is why this replaced `mcp-handler`, which implements the older
// stateful shape and cannot express this one.
//
// Spec: /specification/2026-07-28/basic/transports/streamable-http

import type { AuthInfo } from "./types";
import { enforceMcpToolScope, verifyTextTextApiToken } from "./auth";
import { publicOrigin } from "./origin";
import {
  CACHE_CATALOG,
  CACHE_WORKSPACE,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_PARSE_ERROR,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_SUPPORTED_VERSIONS,
  META_SERVER_INFO,
  META_SUBSCRIPTION_ID,
  McpError,
  complete,
  decodeHeaderValue,
  headerMismatch,
  invalidParams,
  methodNotFound,
  parseRequestMeta,
} from "./protocol";
import {
  callTool,
  getPrompt,
  listPrompts,
  listResourceTemplates,
  listResources,
  listTools,
  readResource,
} from "./registry";
import type { ToolContext } from "./tools";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const MAX_MCP_BODY_BYTES = 1_100_000;

type JsonRpcId = string | number;

function errorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string,
  status: number,
  data?: unknown,
) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      ...(id === null ? {} : { id }),
      error: { code, message, ...(data === undefined ? {} : { data }) },
    }),
    { status, headers: JSON_HEADERS },
  );
}

function resultResponse(id: JsonRpcId, result: Record<string, unknown>) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

async function readBoundedJson(
  request: Request,
): Promise<{ body?: unknown; invalid?: true; tooLarge?: true }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) {
    return { tooLarge: true };
  }

  const reader = request.body?.getReader();
  if (!reader) return { invalid: true };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MCP_BODY_BYTES) {
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
    return { body: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { invalid: true };
  }
}

/**
 * Origin validation is a MUST. A hosted server is not a browser target, so the
 * common case is no Origin header at all (a CLI or server-side client), which
 * is allowed. A browser-supplied Origin has to be our own.
 */
function originRejected(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== publicOrigin(request);
  } catch {
    return true;
  }
}

function unauthorized(request: Request): Response {
  // A client that lands here needs a workspace token, which a person creates
  // and pastes. There is no authorization server to point it at.
  const docs = `${publicOrigin(request)}/docs/mcp`;
  return new Response(
    JSON.stringify({
      error: "invalid_token",
      error_description: "A valid bearer token is required",
    }),
    {
      status: 401,
      headers: {
        ...JSON_HEADERS,
        "WWW-Authenticate": `Bearer error="invalid_token", error_description="A valid bearer token is required", resource_documentation="${docs}"`,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

/** Methods whose `Mcp-Name` header mirrors a body value. */
const NAME_HEADER_SOURCE: Record<string, "name" | "uri"> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

/**
 * The transport mirrors body fields into headers so intermediaries can route
 * without parsing the body. If a header and the body disagree, a proxy and the
 * server would be acting on different values, so the spec makes that a hard
 * `-32020` rejection rather than a preference for one source.
 */
function validateHeaders(
  request: Request,
  method: string,
  params: Record<string, unknown>,
  metaVersion: string,
): void {
  const headerVersion = request.headers.get("mcp-protocol-version");
  if (!headerVersion) {
    throw headerMismatch("MCP-Protocol-Version header is required");
  }
  if (headerVersion !== metaVersion) {
    throw headerMismatch(
      `MCP-Protocol-Version header '${headerVersion}' does not match body value '${metaVersion}'`,
    );
  }

  const headerMethod = request.headers.get("mcp-method");
  if (!headerMethod) throw headerMismatch("Mcp-Method header is required");
  if (headerMethod !== method) {
    throw headerMismatch(
      `Mcp-Method header '${headerMethod}' does not match body value '${method}'`,
    );
  }

  const source = NAME_HEADER_SOURCE[method];
  if (!source) return;
  const bodyValue = params[source];
  if (typeof bodyValue !== "string") {
    throw invalidParams(`${method} requires params.${source}`);
  }
  const headerName = request.headers.get("mcp-name");
  if (!headerName) throw headerMismatch("Mcp-Name header is required");
  if (decodeHeaderValue(headerName) !== bodyValue) {
    throw headerMismatch(
      `Mcp-Name header does not match body value '${bodyValue}'`,
    );
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

async function dispatch(
  method: string,
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  switch (method) {
    case "server/discover":
      return complete(
        {
          supportedVersions: [...MCP_SUPPORTED_VERSIONS],
          capabilities: { tools: {}, resources: {}, prompts: {} },
          instructions:
            "TextText is a publishing workspace of folders and Markdown items. " +
            "Read before mutating, pass if_match_hash when changing an existing " +
            "item, and pass a stable idempotency_key to create_item and " +
            "append_to_item so retries are safe. Notes and bookmarks are always " +
            "private. Ask before publishing, sharing, or moving anything to Trash.",
        },
        CACHE_CATALOG,
      );

    case "tools/list":
      return complete({ tools: listTools() }, CACHE_CATALOG);

    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string") {
        throw invalidParams("tools/call requires params.name");
      }
      const result = await callTool(name, asRecord(params.arguments), context);
      return complete(result as unknown as Record<string, unknown>);
    }

    case "resources/list":
      return complete({ resources: listResources() }, CACHE_CATALOG);

    case "resources/templates/list":
      return complete(
        { resourceTemplates: listResourceTemplates() },
        CACHE_CATALOG,
      );

    case "resources/read": {
      const uri = params.uri;
      if (typeof uri !== "string") {
        throw invalidParams("resources/read requires params.uri");
      }
      const result = await readResource(uri, context);
      return complete(result as unknown as Record<string, unknown>, CACHE_WORKSPACE);
    }

    case "prompts/list":
      return complete({ prompts: listPrompts() }, CACHE_CATALOG);

    case "prompts/get": {
      const name = params.name;
      if (typeof name !== "string") {
        throw invalidParams("prompts/get requires params.name");
      }
      const args: Record<string, string> = {};
      for (const [key, value] of Object.entries(asRecord(params.arguments))) {
        if (typeof value === "string") args[key] = value;
      }
      const result = await getPrompt(name, args);
      return complete(result as unknown as Record<string, unknown>);
    }

    default:
      throw methodNotFound(method);
  }
}

/**
 * `subscriptions/listen` replaced the GET stream and `resources/subscribe`.
 * TextText has no server-pushed changes to offer an MCP client today: the
 * catalog changes only on deploy, and workspace content changes reach clients
 * through their own polling. So the stream is opened, the acknowledgement
 * honours an empty subset, and it is closed gracefully with the empty result
 * the spec defines. That is a conforming answer, and it is honest: the
 * alternative is holding a connection open forever that will never emit.
 */
function subscriptionResponse(id: JsonRpcId): Response {
  const encoder = new TextEncoder();
  const send = (payload: unknown) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        send({
          jsonrpc: "2.0",
          method: "notifications/subscriptions/acknowledged",
          params: {
            _meta: { [META_SUBSCRIPTION_ID]: id },
            notifications: {},
          },
        }),
      );
      controller.enqueue(
        send({
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "complete",
            _meta: {
              [META_SUBSCRIPTION_ID]: id,
              [META_SERVER_INFO]: MCP_SERVER_INFO,
            },
          },
        }),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Stops nginx-style proxies from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleMcpRequest(request: Request): Promise<Response> {
  // GET and DELETE were the session and standalone-stream verbs. Both are gone.
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (originRejected(request)) {
    return errorResponse(null, JSONRPC_INTERNAL_ERROR, "Forbidden origin", 403);
  }

  const auth = await verifyTextTextApiToken(request);
  if (!auth) return unauthorized(request);
  (request as Request & { auth?: AuthInfo }).auth = auth;

  const decoded = await readBoundedJson(request);
  if (decoded.tooLarge) {
    return errorResponse(
      null,
      JSONRPC_PARSE_ERROR,
      "Request body is too large",
      413,
    );
  }
  if (decoded.invalid) {
    return errorResponse(null, JSONRPC_PARSE_ERROR, "Invalid JSON", 400);
  }
  const body = decoded.body;

  const message = asRecord(body);
  const method = typeof message.method === "string" ? message.method : null;
  const id =
    typeof message.id === "string" || typeof message.id === "number"
      ? message.id
      : null;

  if (!method) {
    return errorResponse(id, JSONRPC_PARSE_ERROR, "Missing method", 400);
  }
  // A notification carries no id and gets no body back.
  if (id === null) return new Response(null, { status: 202 });

  const params = asRecord(message.params);

  try {
    const meta = parseRequestMeta(params);
    validateHeaders(request, method, params, meta.protocolVersion);

    const denied = enforceMcpToolScope(request, body);
    if (denied) return denied;

    if (method === "subscriptions/listen") return subscriptionResponse(id);

    const result = await dispatch(method, params, {
      authInfo: auth,
    } as ToolContext);
    return resultResponse(id, result);
  } catch (error) {
    if (error instanceof McpError) {
      return errorResponse(
        id,
        error.code,
        error.message,
        error.httpStatus,
        error.data,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    return errorResponse(id, JSONRPC_INTERNAL_ERROR, detail, 500);
  }
}

export { MCP_PROTOCOL_VERSION };
export { publicOrigin };
