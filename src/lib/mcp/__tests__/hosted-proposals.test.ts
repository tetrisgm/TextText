import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_TOOL_DEFINITIONS, WORKSPACE_TOOL_NAMES } from "@/lib/ai/tools";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(), approvedExecute: vi.fn(), insert: vi.fn(), audit: vi.fn(),
  getOwnedBlog: vi.fn(), getBlogEditRecord: vi.fn(), batch: vi.fn(),
  getPostById: vi.fn(), getFolders: vi.fn(), getTrashedPosts: vi.fn(),
  getTrashedFolders: vi.fn(), getAllPosts: vi.fn(), listDocumentTemplates: vi.fn(),
}));
vi.mock("@/lib/mcp/agent-surface", () => ({ registerAgentSurface: vi.fn() }));
vi.mock("@/lib/mcp/tools", async (original) => ({
  ...await original<typeof import("@/lib/mcp/tools")>(),
  executeMcpTool: mocks.execute, runWorkspaceToolForSession: mocks.approvedExecute,
}));
vi.mock("@/lib/store", () => ({
  getOwnedBlog: mocks.getOwnedBlog, getBlogEditRecord: mocks.getBlogEditRecord,
  getPostById: mocks.getPostById, getFolders: mocks.getFolders,
  getTrashedPosts: mocks.getTrashedPosts, getTrashedFolders: mocks.getTrashedFolders,
  getAllPosts: mocks.getAllPosts, listDocumentTemplates: mocks.listDocumentTemplates,
}));
vi.mock("@/lib/shares", () => ({ listScopeShares: vi.fn(async () => []) }));
vi.mock("@/lib/db/client", () => ({ db: {}, executeAtomicBatch: mocks.batch }));
vi.mock("@/lib/audit", () => ({ auditInsertQuery: mocks.audit, auditCteFrom: vi.fn(), recordAction: vi.fn() }));
import { callTool, listTools } from "@/lib/mcp/registry";
import { hostedToolNeedsProposal, stageHostedToolProposal } from "@/lib/mcp/write-proposals";
import type { ToolContext } from "@/lib/mcp/tools";
const context: ToolContext = { authInfo: { token: "", clientId: "user-1", scopes: ["sync"], extra: {
  sub: "apple-sub", userId: "user-1", connectionName: "Research agent",
} } };
const hash = `sha256:${"a".repeat(64)}`;
const risky: Array<[string, Record<string, unknown>]> = [
  ["delete_item", { id: "item-1", if_match_hash: hash }],
  ["delete_items", { ids: ["item-1"] }], ["empty_trash", {}],
  ["set_item_status", { id: "item-1", status: "published" }],
  ["delete_folder", { folder_id: "folder-1" }],
  ["remove_item_asset", { id: "item-1", asset_url: "https://example.com/a.png" }],
  ["retire_document_template", { template_id: "custom-look" }],
];
describe("hosted MCP durable proposal boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ content: [{ type: "text", text: "direct" }] });
    mocks.getOwnedBlog.mockImplementation(async (sub) => sub === "apple-sub" ? { handle: "alpha" } : null);
    mocks.getBlogEditRecord.mockResolvedValue({ id: "blog-1", handle: "alpha", ownerId: "user-1" });
    mocks.getPostById.mockResolvedValue({ id: "item-1", title: "Draft article", folderId: "folder-1", status: "draft", revision: 12 });
    const folder = { id: "folder-1", path: "blog", name: "Blog" };
    mocks.getFolders.mockResolvedValue([folder]); mocks.getTrashedFolders.mockResolvedValue([folder]);
    mocks.getTrashedPosts.mockResolvedValue([]); mocks.getAllPosts.mockResolvedValue([]);
    mocks.listDocumentTemplates.mockResolvedValue([{ id: "custom-look", name: "Custom look", version: 1 }]);
    mocks.insert.mockImplementation((row) => ({ inserted: row })); mocks.audit.mockReturnValue({ audit: true });
    mocks.batch.mockImplementation(async (build) => build({ insert: () => ({ values: mocks.insert }) }));
  });
  it("item edit grants cannot stage a proposal through either entry point", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const scoped = { authInfo: { ...context.authInfo!, scopes: [`item:${id}:edit`] } };
    expect((await callTool("delete_item", { id }, scoped)).isError).toBe(true);
    expect((await stageHostedToolProposal("delete_item", { id }, scoped)).isError).toBe(true);
    expect(mocks.getOwnedBlog).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(risky)("stages %s through the real proposal service without executing", async (name, args) => {
    const result = await callTool(name, args, context);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const data = result.structuredContent!;
    expect(data).toMatchObject({ approvalRequired: true, proposalId: expect.any(String), reviewUrl: expect.stringContaining(`/proposals/${data.proposalId}`) });
    expect(mocks.getOwnedBlog).toHaveBeenCalledWith("apple-sub");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: data.proposalId, blogId: "blog-1", actorUserId: "user-1", proposalKind: "workspace",
      toolName: name, arguments: args, status: "pending", connectionId: null,
      metadata: expect.objectContaining({ origin: { surface: "hosted_mcp", connectionName: "Research agent" } }),
    }));
    const row = mocks.insert.mock.calls[0][0];
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(15 * 60_000);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user-1", actionName: "ai.write_proposed", targetId: data.proposalId }), expect.anything());
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.approvedExecute).not.toHaveBeenCalled();
  });
  it.each([
    ["read_item", { id: "item-1" }], ["list_items", {}],
    ["create_item", { capture: "A new private note" }],
    ["append_to_item", { id: "item-1", markdown: "Another paragraph" }],
    ["update_item", { id: "item-1", title: "New title" }],
    ["update_item", { id: "item-1", section: "Intro", body: "New", expected_section_body: "Old" }],
    ["update_item", { id: "item-1", text_edit: { field: "body", start: 0, end: 3, expected_text: "Old", replacement_text: "New" } }],
    // Recoverable or owner-scoped: restores undo a deletion, unpublishing
    // narrows the audience, a named grant is the owner acting through their
    // own token, and a whole-body rewrite is recorded for revert.
    ["restore_item", { id: "item-1" }],
    ["restore_folder", { folder_id: "folder-1" }],
    ["set_item_status", { id: "item-1", status: "draft" }],
    ["set_access", { scope_type: "item", scope_id: "item-1", email: "reader@example.com", role: "viewer" }],
    ["revoke_access", { scope_type: "item", scope_id: "item-1", access_id: "share-1" }],
    ["update_item", { id: "item-1", body: "Replacement", if_match_hash: hash }],
    ["update_item", { id: "item-1", markdown: "# Replacement", if_match_hash: hash }],
  ] as Array<[string, Record<string, unknown>]>)("keeps ordinary %s direct", async (name, args) => {
    expect(await callTool(name, args, context)).toEqual({ content: [{ type: "text", text: "direct" }] });
    expect(mocks.execute).toHaveBeenCalledWith(name, args, context); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("stages exactly the destructive and publishing commands and advertises owner review", () => {
    const staged = WORKSPACE_TOOL_NAMES.filter((name) =>
      hostedToolNeedsProposal(name, { status: "published" }),
    );
    expect(staged.sort()).toEqual([
      "delete_folder", "delete_item", "delete_items", "empty_trash",
      "remove_item_asset", "retire_document_template", "set_item_status",
    ]);
    for (const name of staged) {
      expect(listTools().find((tool) => tool.name === name)?.description).toContain("owner review");
    }
    for (const name of ["restore_item", "restore_folder", "set_access", "revoke_access", "update_item"] as const) {
      expect(hostedToolNeedsProposal(name, { status: "draft" }), name).toBe(false);
    }
  });
  it.each([{ scopes: [] }, { scopes: ["read"] }, { scopes: ["sync", "read"] }, { scopes: ["sync", "read-only"] }])("rejects scope $scopes before staging", async ({ scopes }) => {
    expect((await callTool("empty_trash", {}, { authInfo: { ...context.authInfo!, scopes } })).isError).toBe(true);
    expect(mocks.getOwnedBlog).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("never substitutes an internal ID for the sign-in subject", async () => {
    expect((await callTool("empty_trash", {}, { authInfo: { ...context.authInfo!, extra: { userId: "user-1" } } })).isError).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects a nonowner even with a sync token", async () => {
    mocks.getBlogEditRecord.mockResolvedValue({ id: "blog-1", handle: "alpha", ownerId: "other-user" });
    expect((await callTool("empty_trash", {}, context)).isError).toBe(true); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each([
    ["empty_trash", { confirmed: true }],
    ["delete_item", { id: "item-1", actor: "owner", confirmed: true }],
  ] as Array<[string, Record<string, unknown>]>)("refuses invalid or self-confirmed %s", async (name, args) => {
    expect((await callTool(name, args, context)).isError).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("freezes only the target subtree, including item revisions", async () => {
    const { resolveConfirmationState } = await import("@/lib/ai/write-proposal-state.server");
    mocks.getFolders.mockResolvedValue([
      { id: "folder-1", path: "blog", name: "Blog" },
      { id: "child", path: "blog/ideas", name: "Ideas" },
      { id: "sibling", path: "blog-other", name: "Other" },
    ]);
    const item = { id: "item-1", revision: 1, title: "Idea", folderId: "child", status: "draft" };
    mocks.getAllPosts.mockResolvedValue([item]);
    const first = await resolveConfirmationState("alpha", "delete_folder", { folder_id: "folder-1" });
    expect(first.summary).toContain("2 folders and 1 item");
    mocks.getAllPosts.mockResolvedValue([item, { ...item, id: "other", folderId: "sibling" }]);
    expect(await resolveConfirmationState("alpha", "delete_folder", { folder_id: "folder-1" })).toEqual(first);
    mocks.getAllPosts.mockResolvedValue([{ ...item, revision: 2 }]);
    expect((await resolveConfirmationState("alpha", "delete_folder", { folder_id: "folder-1" })).fingerprint).not.toBe(first.fingerprint);
  });

  it("fails closed when persistence fails", async () => {
    mocks.batch.mockRejectedValue(new Error("private database detail"));
    const result = await callTool("empty_trash", {}, context);
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain("private database detail"); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["unknown_tool", "constructor", "toString"])("rejects unknown tool %s", async (name) => {
    await expect(callTool(name, {}, context)).rejects.toThrow("Unknown tool"); expect(mocks.execute).not.toHaveBeenCalled();
  });
});
