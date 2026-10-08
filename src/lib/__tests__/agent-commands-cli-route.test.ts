import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyTextTextApiToken = vi.fn();
const runWorkspaceToolForAuth = vi.fn();
const stageAgentToolProposal = vi.fn();
vi.mock("@/lib/mcp/write-proposals", () => ({ stageAgentToolProposal: (...args: unknown[]) => stageAgentToolProposal(...args) }));

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
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "");
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

  it.each(["proposal:delete_folder", "delete_folder"])("rejects %s before legacy dispatch for a file workspace", async name => {
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/fixture");
    const response = await POST(command(name, { id: "item-1" }));
    expect(response.status).toBe(400);
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
  });

  it.each([
    ["get_workspace", {}],
    ["list_folders", {}],
    ["create_item", { title: "New note", kind: "note" }],
    ["append_to_item", { id: "item-1", markdown: "More", if_match_hash: "hash" }],
    ["list_items", { folder_path: "Notes" }],
  ])("lets an agent on this Mac call %s", async (name, args) => {
    const response = await POST(command(name, args));
    expect(response.status).toBe(200);
    expect(runWorkspaceToolForAuth).toHaveBeenCalledWith(
      name,
      args,
      expect.anything(),
    );
  });

  it("stages explicit retirement with trusted local origin and never directly executes", async () => {
    stageAgentToolProposal.mockResolvedValue({ structuredContent: { approvalRequired: true, proposalId: "proposal-1", reviewUrl: "https://texttext.app/proposals/proposal-1" } });
    const args = { template_id: "local.test", source_item_id: "source", source_hash: "a".repeat(64), idempotency_key: "key" };
    const response = await POST(command("proposal:retire_document_template", args));
    expect(response.status).toBe(200);
    expect(stageAgentToolProposal).toHaveBeenCalledWith("retire_document_template", args, expect.objectContaining({ authInfo: expect.objectContaining({ extra: expect.objectContaining({ actorType: "external_agent", userId: "user-1" }) }) }), "local_cli");
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
  });
  it.each([{ scopes: ["read"] }, { scopes: ["sync", "item:11111111-1111-4111-8111-111111111111:edit"] }])("cannot stage proposals with restricted scopes %j", async ({ scopes }) => {
    verifyTextTextApiToken.mockResolvedValue({ scopes, extra: { userId: "user-1", sub: "sub-1" } });
    expect((await POST(command("proposal:retire_document_template", {}))).status).toBe(403);
    expect(stageAgentToolProposal).not.toHaveBeenCalled();
    expect(runWorkspaceToolForAuth).not.toHaveBeenCalled();
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

    const moved = await POST(command("update_item", { id: "item-1", body: "New body", if_match_hash: "hash" }));
    expect(moved.status).toBe(403);
  });

  it("runs an allowlisted command with token identity and bounded agent metadata", async () => {
    const response = await POST(
      command(
        "update_item",
        { id: "item-1", body: "# Updated", if_match_hash: "hash-1" },
        {
          "X-TextText-Agent-Name": "Codex",
          "X-TextText-Agent-Intent": "Tighten the introduction",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(runWorkspaceToolForAuth).toHaveBeenCalledWith(
      "update_item",
      { id: "item-1", body: "# Updated", if_match_hash: "hash-1" },
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
