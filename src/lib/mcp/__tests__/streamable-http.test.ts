// The MCP 2026-07-28 wire contract.
//
// These assert the parts of the revision a client actually depends on and that
// no unit test of the tool layer would catch: header/body mirroring, the
// stateless `_meta` fields, the new error codes, `resultType`, cache hints, and
// the verbs that this revision removed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveApiToken = vi.fn();
vi.mock("@/lib/api-tokens", () => ({
  resolveApiToken: (...args: unknown[]) => resolveApiToken(...args),
}));
vi.mock("@/lib/store", () => ({
  getOwnedBlog: vi.fn(async () => null),
}));

const { handleMcpRequest } = await import("../streamable-http");
const { MCP_PROTOCOL_VERSION } = await import("../protocol");

const ORIGIN = "https://TextText.app";
const ENDPOINT = `${ORIGIN}/api/mcp`;

type Body = {
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function meta(overrides: Record<string, unknown> = {}) {
  return {
    "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "vitest", version: "1.0.0" },
    ...overrides,
  };
}

function post(body: Body, headers: Record<string, string> = {}) {
  const params = body.params ?? {};
  const auto: Record<string, string> = {
    "content-type": "application/json",
    authorization: "Bearer wsk_test",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    "mcp-method": body.method,
  };
  const nameSource =
    body.method === "resources/read" ? params.uri : params.name;
  if (typeof nameSource === "string") auto["mcp-name"] = nameSource;

  return new Request(ENDPOINT, {
    method: "POST",
    headers: { ...auto, ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(body.id === null ? {} : { id: body.id ?? 1 }),
      method: body.method,
      params: { _meta: meta(), ...params },
    }),
  });
}

const json = async (response: Response) => response.json();

beforeEach(() => {
  resolveApiToken.mockReset();
  resolveApiToken.mockResolvedValue({
    userId: "user-1",
    sub: "sub-1",
    scopes: "sync",
    name: "vitest",
    expiresAt: null,
  });
});

describe("verbs this revision removed", () => {
  it.each(["GET", "DELETE"])("answers 405 to %s", async (method) => {
    const response = await handleMcpRequest(
      new Request(ENDPOINT, { method }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("ignores a session id instead of minting or echoing one", async () => {
    const response = await handleMcpRequest(
      post({ method: "tools/list" }, { "mcp-session-id": "abc" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });
});

describe("authorization", () => {
  it("challenges an unauthenticated request and says where to get a token", async () => {
    resolveApiToken.mockResolvedValue(null);
    const response = await handleMcpRequest(post({ method: "tools/list" }));
    expect(response.status).toBe(401);
    const challenge = response.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    // Points at the docs rather than at authorization-server metadata: OAuth
    // was removed 2026-08-15, and advertising a chain that dead-ends in a 404
    // is worse than not advertising one.
    expect(challenge).toContain("resource_documentation=");
    expect(challenge).not.toContain("resource_metadata=");
  });
});

describe("request body limits", () => {
  it("rejects a declared oversized body before parsing it", async () => {
    const request = post({ method: "tools/list" });
    request.headers.set("content-length", "1100001");
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await json(response)).error.message).toBe(
      "Request body is too large",
    );
  });

  it("rejects a streamed oversized body with no Content-Length", async () => {
    const chunk = new Uint8Array(600_000).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: "Bearer wsk_test",
        "content-type": "application/json",
      },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("header and body mirroring", () => {
  it("rejects a missing protocol version header with -32020", async () => {
    const request = post({ method: "tools/list" });
    request.headers.delete("mcp-protocol-version");
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe(-32020);
  });

  it("rejects a header version that disagrees with the body", async () => {
    const response = await handleMcpRequest(
      post({ method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" }),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe(-32020);
  });

  it("rejects a Mcp-Method header that disagrees with the body", async () => {
    const response = await handleMcpRequest(
      post({ method: "tools/list" }, { "mcp-method": "prompts/list" }),
    );
    expect((await json(response)).error.code).toBe(-32020);
  });

  it("rejects a Mcp-Name header that disagrees with the body", async () => {
    const response = await handleMcpRequest(
      post(
        { method: "prompts/get", params: { name: "capture_conversation" } },
        { "mcp-name": "something_else" },
      ),
    );
    expect((await json(response)).error.code).toBe(-32020);
  });

  it("decodes the base64 sentinel before comparing Mcp-Name", async () => {
    const name = "maintain_project_documents";
    const encoded = `=?base64?${Buffer.from(name, "utf8").toString("base64")}?=`;
    const response = await handleMcpRequest(
      post(
        {
          method: "prompts/get",
          params: { name, arguments: { projects: "one" } },
        },
        { "mcp-name": encoded },
      ),
    );
    expect(response.status).toBe(200);
  });
});

describe("per-request protocol metadata", () => {
  it("rejects a request with no protocol version in _meta", async () => {
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: "Bearer wsk_test",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {} } },
      }),
    });
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe(-32602);
  });

  it("rejects a request with no client capabilities", async () => {
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: "Bearer wsk_test",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          },
        },
      }),
    });
    const response = await handleMcpRequest(request);
    expect((await json(response)).error.code).toBe(-32602);
  });

  it("answers an unsupported version with -32022 and the supported list", async () => {
    const response = await handleMcpRequest(
      post(
        {
          method: "tools/list",
          params: {
            _meta: meta({
              "io.modelcontextprotocol/protocolVersion": "1900-01-01",
            }),
          },
        },
        { "mcp-protocol-version": "1900-01-01" },
      ),
    );
    expect(response.status).toBe(400);
    const payload = await json(response);
    expect(payload.error.code).toBe(-32022);
    expect(payload.error.data.supported).toContain(MCP_PROTOCOL_VERSION);
    expect(payload.error.data.requested).toBe("1900-01-01");
  });
});

describe("dispatch", () => {
  it("implements server/discover", async () => {
    const response = await handleMcpRequest(post({ method: "server/discover" }));
    const { result } = await json(response);
    expect(result.resultType).toBe("complete");
    expect(result.supportedVersions).toContain(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toHaveProperty("tools");
    expect(result._meta["io.modelcontextprotocol/serverInfo"].name).toBe(
      "texttext",
    );
    expect(typeof result.instructions).toBe("string");
  });

  it("returns tools with a cache hint and a stable order", async () => {
    const first = await json(await handleMcpRequest(post({ method: "tools/list" })));
    const second = await json(await handleMcpRequest(post({ method: "tools/list" })));
    expect(first.result.resultType).toBe("complete");
    expect(first.result.cacheScope).toBe("public");
    expect(typeof first.result.ttlMs).toBe("number");
    expect(first.result.tools.length).toBeGreaterThan(0);
    expect(first.result.tools.map((t: { name: string }) => t.name)).toEqual(
      second.result.tools.map((t: { name: string }) => t.name),
    );
  });

  it("carries serverInfo on every result", async () => {
    const { result } = await json(
      await handleMcpRequest(post({ method: "prompts/list" })),
    );
    expect(result._meta["io.modelcontextprotocol/serverInfo"]).toBeDefined();
  });

  it("answers an unknown method with 404 and -32601", async () => {
    const response = await handleMcpRequest(post({ method: "initialize" }));
    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe(-32601);
  });

  it("accepts a notification with 202 and no body", async () => {
    const response = await handleMcpRequest(
      post({ id: null, method: "notifications/progress" }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
});

describe("subscriptions/listen", () => {
  it("acknowledges then closes gracefully on a stream", async () => {
    const response = await handleMcpRequest(
      post({ method: "subscriptions/listen", params: { notifications: {} } }),
    );
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    const body = await response.text();
    expect(body).toContain("notifications/subscriptions/acknowledged");
    expect(body).toContain("io.modelcontextprotocol/subscriptionId");
    expect(body).toContain('"resultType":"complete"');
  });
});

describe("origin validation", () => {
  it("forbids a cross-origin browser request", async () => {
    const response = await handleMcpRequest(
      post({ method: "tools/list" }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("allows a request with no Origin header", async () => {
    const response = await handleMcpRequest(post({ method: "tools/list" }));
    expect(response.status).toBe(200);
  });
});

 it("an item token may run the server discovery the transport implements", async () => {
 resolveApiToken.mockResolvedValue({ userId: "user-1", sub: "sub-1", scopes: "item:11111111-1111-1111-1111-111111111111:edit", name: "test", expiresAt: null });
 const response = await handleMcpRequest(post({method: "server/discover"}));
 expect(response.status).toBe(200);
 });
 it("a token revoked while its body was still uploading is refused", async () => {
 let controller!: ReadableStreamDefaultController<Uint8Array>;
 const source = post({method: "tools/list"});
 const payload = await source.text();
 const request = new Request(ENDPOINT, {method: "POST", headers: source.headers,
 body: new ReadableStream({start(c) { controller = c; }}), duplex: "half"} as RequestInit);
 const result = handleMcpRequest(request);
 await new Promise(r => setTimeout(r, 0));
 // Nothing is resolved until the bounded body has fully arrived.
 expect(resolveApiToken).toHaveBeenCalledTimes(0);
 resolveApiToken.mockResolvedValue(null);
 controller.enqueue(new TextEncoder().encode(payload)); controller.close();
 expect((await result).status).toBe(401);
 expect(resolveApiToken).toHaveBeenCalledTimes(1);
 });
