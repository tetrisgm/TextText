import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyTextTextApiToken = vi.fn();
const runWorkspaceToolForAuth = vi.fn();

vi.mock("@/lib/mcp/auth", () => ({
  verifyTextTextApiToken: (...args: unknown[]) =>
    verifyTextTextApiToken(...args),
}));
vi.mock("@/lib/mcp/tools", () => ({
  resolveMcpScopeAccess: (scopes: string[]) =>
    scopes.includes("read")
      ? "read-only"
      : scopes.includes("sync")
        ? "full"
        : "none",
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

  // The owner's own description of what agents are for: "if I say I want you or
  // Codex to work on a note, you need to be able to do all these actions."
  // Five commands could not do them. These are the verbs that were missing.
  it.each([
    ["move_item", { id: "item-1", folder_path: "notes" }],
    ["add_comment", { id: "item-1", body: "Worth expanding this." }],
    ["set_comment_resolved", { id: "item-1", comment_id: "c-1", resolved: true }],
    ["create_folder", { path: "recipes", name: "Recipes" }],
    ["set_folder_template", { folder_path: "notes", template_id: "t-1" }],
    ["list_items", { folder_path: "notes" }],
  ])("lets an agent on this Mac call %s", async (name, args) => {
    const response = await POST(command(name, args));
    expect(response.status).toBe(200);
    expect(runWorkspaceToolForAuth).toHaveBeenCalledWith(
      name,
      args,
      expect.anything(),
    );
  });

  // The boundary that did not move. Widening the surface must not hand a local
  // agent deletion, publication, sharing, or a fetch of a URL it chose.
  it.each([
    ["delete_item", { id: "item-1" }],
    ["restore_item", { id: "item-1" }],
    ["set_item_status", { id: "item-1", status: "published" }],
    ["set_access", { id: "item-1", email: "someone@example.com", role: "editor" }],
    ["revoke_access", { id: "item-1", grant_id: "g-1" }],
    ["add_item_asset", { id: "item-1", url: "https://example.com/a.png" }],
    ["recapture_bookmark", { id: "item-1" }],
  ])("still refuses %s from a local agent", async (name, args) => {
    const response = await POST(command(name, args));
    expect(response.status).toBe(400);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
  });

  it("lets a read-scoped connection call any read command, not just two", async () => {
    // The hand-written list allowed exactly search and read_item to a
    // read-scoped token, so every other read would have been refused with
    // "cannot change the workspace", which is both wrong and confusing.
    verifyTextTextApiToken.mockResolvedValue({
      token: "",
      clientId: "user-1",
      scopes: ["read"],
      extra: { userId: "user-1", sub: "sub-1" },
    });
    const listed = await POST(command("list_items", { folder_path: "notes" }));
    expect(listed.status).toBe(200);

    const moved = await POST(command("move_item", { id: "item-1", folder_path: "notes" }));
    expect(moved.status).toBe(403);
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

  it("runs the shared read-only search command without inventing a local index", async () => {
    const response = await POST(command("search", { query: "field notes" }));

    expect(response.status).toBe(200);
    expect(runWorkspaceToolForAuth).toHaveBeenCalledWith(
      "search",
      { query: "field notes" },
      expect.objectContaining({
        authInfo: expect.objectContaining({
          clientId: "user-1",
          scopes: ["sync"],
        }),
      }),
    );
  });

  it("allows read scope to search and read but not mutate", async () => {
    verifyTextTextApiToken.mockResolvedValue({
      clientId: "user-1",
      scopes: ["read"],
      extra: { userId: "user-1", sub: "sub-1" },
    });

    let response = await POST(command("search", { query: "field notes" }));
    expect(response.status).toBe(200);
    response = await POST(command("read_item", { id: "item-1" }));
    expect(response.status).toBe(200);
    response = await POST(
      command("update_item", {
        id: "item-1",
        markdown: "# Changed",
        if_match_hash: "hash-1",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects unapproved tools and tokens with no workspace scope", async () => {
    let response = await POST(command("delete_item", { id: "item-1" }));
    expect(response.status).toBe(400);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();

    verifyTextTextApiToken.mockResolvedValue({
      clientId: "user-1",
      scopes: [],
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
