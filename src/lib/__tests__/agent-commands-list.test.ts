import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTextTextApiToken: vi.fn(),
  resolveMcpScopeAccess: vi.fn(),
  runWorkspaceToolForAuth: vi.fn(),
}));

vi.mock("@/lib/mcp/auth", () => ({
  verifyTextTextApiToken: mocks.verifyTextTextApiToken,
}));
vi.mock("@/lib/mcp/tools", () => ({
  resolveMcpScopeAccess: mocks.resolveMcpScopeAccess,
  runWorkspaceToolForAuth: mocks.runWorkspaceToolForAuth,
}));

import {
  WORKSPACE_TOOL_DEFINITIONS,
  type WorkspaceToolName,
} from "@/lib/ai/tools";

const { GET } = await import("@/app/api/agent/commands/route");

function request(): Request {
  return new Request("https://texttext.app/api/agent/commands");
}

/**
 * An agent had no way to find out what it may ask for. The CLI's own
 * "commands" verb was wired to get_workspace, which lists folders: it said one
 * thing and did another.
 */
describe("GET /api/agent/commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyTextTextApiToken.mockResolvedValue({
      token: "",
      clientId: "user-1",
      scopes: ["sync"],
      extra: { userId: "user-1", sub: "sub-1" },
    });
    mocks.resolveMcpScopeAccess.mockReturnValue("full");
  });

  it("answers with the commands this connection may run", async () => {
    const body = (await (await GET(request())).json()) as {
      commands?: Array<{ name: string; mutability: string }>;
    };
    const names = (body.commands ?? []).map((entry) => entry.name);
    expect(names).toContain("move_item");
    expect(names).toContain("update_item_type");
    expect(names).toContain("add_comment");
  });

  it("never names a command the route would refuse", async () => {
    const body = (await (await GET(request())).json()) as {
      commands?: Array<{ name: string }>;
    };
    const names = (body.commands ?? []).map((entry) => entry.name);
    for (const denied of ["delete_item", "set_access", "set_item_status", "add_item_asset"]) {
      expect(names).not.toContain(denied);
    }
  });

  it("offers a read-scoped connection only what it can actually run", async () => {
    // "mutability === read" is the wrong predicate and this test used to bless
    // it. list_access reads and also declares requiredScope "sync", so it was
    // offered to a read-scoped connection and then refused by the executor:
    // a discovery list that sends an agent to be rejected.
    mocks.resolveMcpScopeAccess.mockReturnValue("read");
    const body = (await (await GET(request())).json()) as {
      commands?: Array<{ name: string; mutability: string }>;
    };
    const names = (body.commands ?? []).map((entry) => entry.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("read_item");
    expect(names).not.toContain("list_access");
    for (const name of names) {
      const definition = WORKSPACE_TOOL_DEFINITIONS[name as WorkspaceToolName];
      expect(definition.mutability).toBe("read");
      expect(definition.requiredScope).not.toBe("sync");
    }
  });

  it("refuses without a token", async () => {
    mocks.verifyTextTextApiToken.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });
});
