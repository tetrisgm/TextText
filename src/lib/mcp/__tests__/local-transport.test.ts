// The local bridge's refusals, and the shape it puts on the wire.
//
// This is the one path in TextText that deliberately reaches a private address,
// so what it will NOT do matters more than what it will. The Swift side does
// the authoritative check by resolving the host; this side refuses early so an
// obvious mistake never becomes a message to the app.

import { describe, expect, it } from "vitest";
import { isLoopbackUrl, localMcpAvailable } from "@/lib/mcp/local-transport";
import {
  connectionSlug,
  isRemoteToolName,
  remoteToolName,
  requestBody,
  requestHeaders,
  MCP_PROTOCOL_VERSION,
} from "@/lib/mcp/outbound-protocol";

describe("what counts as a server on this Mac", () => {
  it("accepts the loopback addresses a local MCP server actually uses", () => {
    expect(isLoopbackUrl("http://127.0.0.1:29979/mcp")).toBe(true);
    expect(isLoopbackUrl("http://localhost:3845/mcp")).toBe(true);
    expect(isLoopbackUrl("https://127.0.0.1/mcp")).toBe(true);
  });

  it("refuses anything that is not loopback", () => {
    expect(isLoopbackUrl("https://example.com/mcp")).toBe(false);
    // The address that makes SSRF worth caring about.
    expect(isLoopbackUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isLoopbackUrl("http://10.0.0.5/mcp")).toBe(false);
    expect(isLoopbackUrl("http://192.168.1.50/mcp")).toBe(false);
  });

  it("refuses a scheme that is not http", () => {
    expect(isLoopbackUrl("file:///etc/passwd")).toBe(false);
    expect(isLoopbackUrl("ftp://127.0.0.1/x")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("is unavailable outside the Mac app", () => {
    // No __TEXTTEXT_APP__ in a test environment, so every call refuses rather
    // than silently doing nothing.
    expect(localMcpAvailable()).toBe(false);
  });
});

describe("the request a local server receives", () => {
  it("carries the 2026-07-28 self-describing meta, not a handshake", () => {
    const body = requestBody("tools/call", { name: "create_frame" }) as {
      method: string;
      params: Record<string, unknown>;
    };
    expect(body.method).toBe("tools/call");
    const meta = body.params._meta as Record<string, unknown>;
    expect(meta["io.modelcontextprotocol/protocolVersion"]).toBe(
      MCP_PROTOCOL_VERSION,
    );
    expect(meta["io.modelcontextprotocol/clientInfo"]).toEqual({
      name: "TextText",
      version: "1",
    });
  });

  it("sets the routing headers the revision requires", () => {
    const headers = requestHeaders("tools/call", "create_frame");
    expect(headers["MCP-Protocol-Version"]).toBe(MCP_PROTOCOL_VERSION);
    expect(headers["Mcp-Method"]).toBe("tools/call");
    expect(headers["Mcp-Name"]).toBe("create_frame");
  });

  it("omits Mcp-Name when there is no tool", () => {
    expect(requestHeaders("server/discover")["Mcp-Name"]).toBeUndefined();
  });
});

describe("namespacing is the same on both rungs", () => {
  it("gives a local server's tools the same names a hosted one would get", () => {
    expect(remoteToolName("Paper", "create_frame")).toBe("paper__create_frame");
    expect(connectionSlug("Paper Desktop")).toBe("paper_desktop");
    expect(isRemoteToolName("paper__create_frame")).toBe(true);
    expect(isRemoteToolName("create_item")).toBe(false);
  });
});
