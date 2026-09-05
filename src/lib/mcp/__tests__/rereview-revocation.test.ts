import {it, expect, vi} from "vitest";
const spies = vi.hoisted(() => ({ revoked: false, calls: vi.fn() }));
vi.mock("@/lib/api-tokens", () => ({resolveApiToken: vi.fn(async () => spies.revoked ? null : ({id: "grant", userId: "owner", sub: "owner", scopes: "item:11111111-1111-1111-1111-111111111111:edit", expiresAt: null}))}));
vi.mock("@/lib/store", () => ({getOwnedBlog: vi.fn()}));
vi.mock("../registry", () => ({callTool: spies.calls, listTools: vi.fn(), getPrompt: vi.fn(), listPrompts: vi.fn(), listResourceTemplates: vi.fn(), listResources: vi.fn(), readResource: vi.fn()}));
import {handleMcpRequest, MCP_PROTOCOL_VERSION} from "../streamable-http";
it("refuses an item mutation whose token was revoked while its body was still uploading", async () => {
 let controller!: ReadableStreamDefaultController<Uint8Array>;
 spies.calls.mockResolvedValue({content: []});
 const request = new Request("https://texttext.app/api/mcp", {method: "POST", headers: {
 authorization: "Bearer mock", "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": "update_item", "mcp-protocol-version": MCP_PROTOCOL_VERSION,
 }, body: new ReadableStream({start(c) {controller = c;}}), duplex: "half"} as RequestInit);
 const work = handleMcpRequest(request);
 await new Promise(r => setTimeout(r, 0));
 spies.revoked = true;
 controller.enqueue(new TextEncoder().encode(JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/call", params: {
 name: "update_item", arguments: {id: "11111111-1111-1111-1111-111111111111", body: "chosen after revoke"},
 _meta: {"io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION, "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": {name: "probe", version: "1"}},
 }}))); controller.close();
 expect((await work).status).toBe(401);
 expect(spies.calls).not.toHaveBeenCalledWith("update_item", expect.objectContaining({body: "chosen after revoke"}), expect.anything());
});
