import { beforeEach, describe, expect, it, vi } from "vitest";
const resolveApiToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-tokens", () => ({ resolveApiToken }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: vi.fn() }));
import { verifyTextTextApiToken } from "@/lib/mcp/auth";

describe("authenticated agent history identity", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses the verified capability row id, never a request header or client name", async () => {
    resolveApiToken.mockResolvedValue({ id: "verified-capability-id", userId: "owner-id", sub: "owner-sub",
      name: "Claude", scopes: "sync", expiresAt: null });
    const auth = await verifyTextTextApiToken(new Request("https://texttext.test/api/mcp", {
      headers: { "x-texttext-connection-id": "forged-id", "x-texttext-agent-name": "Other" },
    }));
    expect(auth?.extra).toMatchObject({ connectionId: "verified-capability-id", userId: "owner-id", connectionName: "Claude" });
    expect(JSON.stringify(auth?.extra)).not.toContain("forged-id");
  });
  it("keeps two identically named connections distinct", async () => {
    const identity = { userId: "owner-id", sub: "owner-sub", name: "Claude", scopes: "sync", expiresAt: null };
    resolveApiToken.mockResolvedValueOnce({ ...identity, id: "connection-a" }).mockResolvedValueOnce({ ...identity, id: "connection-b" });
    const request = new Request("https://texttext.test/api/mcp");
    expect((await verifyTextTextApiToken(request))?.extra?.connectionId).toBe("connection-a");
    expect((await verifyTextTextApiToken(request))?.extra?.connectionId).toBe("connection-b");
  });
  it("cannot attribute or execute through a revoked connection", async () => {
    resolveApiToken.mockResolvedValue(null);
    expect(await verifyTextTextApiToken(new Request("https://texttext.test/api/mcp"))).toBeUndefined();
  });
});
