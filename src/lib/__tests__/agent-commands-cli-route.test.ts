import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyTextTextApiToken = vi.fn();
const runWorkspaceToolForAuth = vi.fn();

vi.mock("@/lib/mcp/auth", () => ({
  verifyTextTextApiToken: (...args: unknown[]) =>
    verifyTextTextApiToken(...args),
}));
vi.mock("@/lib/mcp/tools", () => ({
  runWorkspaceToolForAuth: (...args: unknown[]) =>
    runWorkspaceToolForAuth(...args),
}));

const { POST } = await import("@/app/api/agent/commands/route");

function command(
  name: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://texttext.app/api/agent/commands", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      name,
      arguments: args,
      actorType: "human",
      userId: "attacker",
    }),
  });
}

describe("POST /api/agent/commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyTextTextApiToken.mockResolvedValue({
      token: "",
      clientId: "user-1",
      scopes: ["sync"],
      extra: { userId: "user-1", sub: "sub-1" },
    });
    runWorkspaceToolForAuth.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      structuredContent: {},
    });
  });

  it("runs an allowlisted command with token identity and bounded agent metadata", async () => {
    const response = await POST(
      command(
        "update_item",
        { id: "item-1", markdown: "# Updated", if_match_hash: "hash-1" },
        {
          "X-TextText-Agent-Name": "Codex",
          "X-TextText-Agent-Intent": "Tighten the introduction",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(runWorkspaceToolForAuth).toHaveBeenCalledWith(
      "update_item",
      { id: "item-1", markdown: "# Updated", if_match_hash: "hash-1" },
      {
        authInfo: expect.objectContaining({
          clientId: "user-1",
          scopes: ["sync"],
          extra: expect.objectContaining({
            userId: "user-1",
            sub: "sub-1",
            actorType: "external_agent",
            connectionName: "Codex",
            actorIntent: "Tighten the introduction",
          }),
        }),
      },
    );
  });

  it("rejects unapproved tools and insufficient scope", async () => {
    let response = await POST(command("delete_item", { id: "item-1" }));
    expect(response.status).toBe(400);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();

    verifyTextTextApiToken.mockResolvedValue({
      clientId: "user-1",
      scopes: ["read"],
      extra: { userId: "user-1", sub: "sub-1" },
    });
    response = await POST(command("read_item", { id: "item-1" }));
    expect(response.status).toBe(403);
  });

  it("rejects invalid agent metadata before executing", async () => {
    const response = await POST(
      command(
        "read_item",
        { id: "item-1" },
        {
          "X-TextText-Agent-Name": "A".repeat(121),
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
  });

  it("requires a verified authenticated workspace token", async () => {
    verifyTextTextApiToken.mockResolvedValue(undefined);
    const response = await POST(command("read_item", { id: "item-1" }));

    expect(response.status).toBe(401);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized body before parsing or executing", async () => {
    const request = command("read_item", { id: "item-1" });
    request.headers.set("content-length", "1100001");

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized body without Content-Length", async () => {
    const request = new Request("https://texttext.app/api/agent/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(1_100_001),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
  });
});
