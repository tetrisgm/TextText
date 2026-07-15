import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOwnedBlog: vi.fn(),
  resolveApiToken: vi.fn(),
}));

vi.mock("@/lib/api-tokens", () => ({
  resolveApiToken: mocks.resolveApiToken,
}));
vi.mock("@/lib/store", () => ({
  getOwnedBlog: mocks.getOwnedBlog,
}));

import { resolveSyncWorkspace } from "@/app/api/sync/v1/auth";
import {
  enforceMcpToolScope,
  verifyWriteApiToken,
} from "@/lib/mcp/auth";
import { protectedResourceMetadataResponse } from "@/lib/mcp/resource-metadata";

type AuthenticatedRequest = Request & {
  auth?: { token: string; clientId: string; scopes: string[] };
};

function mcpRequest(scope: string, name: string): Request {
  const request = new Request("https://write.example/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  }) as AuthenticatedRequest;
  request.auth = { token: "test", clientId: "user-1", scopes: [scope] };
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OAuth scope boundaries", () => {
  it("advertises read and sync in protected-resource metadata", async () => {
    const response = protectedResourceMetadataResponse(
      new Request("https://write.example/.well-known/oauth-protected-resource"),
    );
    await expect(response.json()).resolves.toMatchObject({
      resource: "https://write.example/api/mcp",
      scopes_supported: ["read", "sync"],
    });
  });

  it("carries normalized scope and expiry into MCP AuthInfo", async () => {
    const expiresAt = new Date("2026-07-15T13:00:00.000Z");
    mocks.resolveApiToken.mockResolvedValue({
      userId: "user-1",
      sub: "provider-subject",
      scopes: "read read",
      expiresAt,
    });

    await expect(
      verifyWriteApiToken(
        new Request("https://write.example/api/mcp", {
          headers: { Authorization: `Bearer wsk_${"a".repeat(43)}` },
        }),
        `wsk_${"a".repeat(43)}`,
      ),
    ).resolves.toEqual({
      token: `wsk_${"a".repeat(43)}`,
      clientId: "user-1",
      scopes: ["read"],
      expiresAt: expiresAt.getTime() / 1000,
      extra: { userId: "user-1", sub: "provider-subject" },
    });
  });

  it.each(["list_folders", "list_items", "read_item", "search"])(
    "allows read scope to call %s",
    async (name) => {
      await expect(enforceMcpToolScope(mcpRequest("read", name))).resolves.toBeNull();
    },
  );

  it.each(["create_folder", "create_item", "update_item", "append_to_item", "future_write"])(
    "requires sync scope for %s",
    async (name) => {
      const response = await enforceMcpToolScope(mcpRequest("read", name));
      expect(response?.status).toBe(403);
      expect(response?.headers.get("www-authenticate")).toContain(
        'error="insufficient_scope"',
      );
      expect(response?.headers.get("www-authenticate")).toContain('scope="sync"');
    },
  );

  it("allows sync scope to call mutating tools", async () => {
    await expect(
      enforceMcpToolScope(mcpRequest("sync", "create_item")),
    ).resolves.toBeNull();
  });

  it("keeps read tokens out of the existing sync API mutation boundary", async () => {
    mocks.resolveApiToken.mockResolvedValue({
      userId: "user-1",
      sub: "provider-subject",
      scopes: "read",
      expiresAt: new Date("2026-07-15T13:00:00.000Z"),
    });
    const result = await resolveSyncWorkspace(
      new Request("https://write.example/api/sync/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer wsk_${"a".repeat(43)}` },
      }),
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(mocks.getOwnedBlog).not.toHaveBeenCalled();
  });
});
