/** Canonical executor security regressions. Full file/Yjs/receipt integration
 * lives in vault-tools, vault-mutations and vault-agent-presence tests. SQL
 * content feature fixtures were retired with the public SQL executor. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_TOOL_DEFINITIONS, WORKSPACE_TOOL_NAMES } from "@/lib/ai/tools";
import { VAULT_TOOL_NAMES, vaultToolDefinitions } from "../vault-contract";
const mock = vi.hoisted(() => ({ sqlContent: vi.fn(), user: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
vi.mock("@/lib/store", async (original) => ({ ...await original<object>(), getPostById: mock.sqlContent, getAccessibleAllPosts: mock.sqlContent, createDraftInFolder: mock.sqlContent, getUserIdBySub: mock.user }));
import { executeMcpTool, runWorkspaceToolForSession, resolveMcpScopeAccess } from "../tools";
const id = "11111111-1111-4111-8111-111111111111";
const auth = (scopes: string[]) => ({ authInfo: { token: "test", clientId: "test", scopes, extra: { sub: "subject", userId: "user", connectionId: "connection" } } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TEXTTEXT_VAULT_ROOT", ""); });
describe("single file-backed public agent executor", () => {
  it("fails closed when storage is absent instead of falling back to SQL", async () => {
    const result = await executeMcpTool("read_item", { id }, auth(["read"]));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("storage is not configured");
    expect(mock.sqlContent).not.toHaveBeenCalled(); expect(mock.user).not.toHaveBeenCalled();
  });
  it("uses the same backend for an in-app session actor", async () => {
    const result = await runWorkspaceToolForSession("read_item", { id }, { sub: "subject", userId: "user", handle: "fixture" });
    expect(result.isError).toBe(true); expect(mock.sqlContent).not.toHaveBeenCalled();
  });
  it("denies every write for read-only scope before any content access", async () => {
    for (const name of WORKSPACE_TOOL_NAMES) {
      if (WORKSPACE_TOOL_DEFINITIONS[name].mutability !== "write") continue;
      const result = await executeMcpTool(name, {}, auth(["read"]));
      expect(result.isError, name).toBe(true);
    }
    expect(mock.sqlContent).not.toHaveBeenCalled(); expect(mock.user).not.toHaveBeenCalled();
  });
  it("item grants never widen to workspace reads or other item ids", async () => {
    for (const [name, args] of [["list_items", {}], ["read_item", { id: "22222222-2222-4222-8222-222222222222" }]] as const) {
      expect((await executeMcpTool(name, args, auth([`item:${id}:read`]))).isError).toBe(true);
    }
    expect(mock.sqlContent).not.toHaveBeenCalled();
  });
  it("mixed read scopes take precedence and item scopes do not become workspace scope", () => {
    expect(resolveMcpScopeAccess(["sync", "read"])).toBe("read-only");
    expect(resolveMcpScopeAccess(["sync", `item:${id}:edit`])).toBe("none");
    expect(resolveMcpScopeAccess([])).toBe("none");
  });
  it("advertises only implemented operations with explicit concurrency guards", () => {
    const tools = vaultToolDefinitions(); expect(tools.map((tool) => tool.name)).toEqual(VAULT_TOOL_NAMES);
    for (const name of ["update_item", "append_to_item"]) expect(tools.find((tool) => tool.name === name)?.inputSchema.required).toContain("if_match_hash");
    expect(tools.find((tool) => tool.name === "create_item")?.inputSchema.properties).toHaveProperty("capture");
  });
});
