import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachItemAsset: vi.fn(),
  createItemComment: vi.fn(),
  createSubfolder: vi.fn(),
  deletePostAtomic: vi.fn(),
  getAccessibleFolders: vi.fn(),
  getOwnedBlog: vi.fn(),
  getPostById: vi.fn(),
  getTrashedFolders: vi.fn(),
  hasActiveCoEditors: vi.fn(async () => false),
  importItemAssetFromUrl: vi.fn(),
  inviteScopeShare: vi.fn(),
  listItemAssetReferences: vi.fn(),
  listItemComments: vi.fn(),
  listScopeShares: vi.fn(),
  markCapturePending: vi.fn(),
  recordAction: vi.fn(),
  removeItemAssetReferences: vi.fn(),
  resolveItemAccess: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  restoreFolder: vi.fn(),
  revokeScopeShare: vi.fn(),
  savePost: vi.fn(),
  setItemCommentResolved: vi.fn(),
  trashFolder: vi.fn(),
  updateScopeShareRole: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/collab", () => ({
  hasActiveCoEditors: mocks.hasActiveCoEditors,
}));
vi.mock("@/lib/item-assets", () => ({
  attachItemAsset: mocks.attachItemAsset,
  importItemAssetFromUrl: mocks.importItemAssetFromUrl,
  listItemAssetReferences: mocks.listItemAssetReferences,
  removeItemAssetReferences: mocks.removeItemAssetReferences,
}));
vi.mock("@/lib/permissions", () => ({
  resolveFolderAccess: vi.fn(),
  resolveItemAccess: mocks.resolveItemAccess,
  resolveWorkspaceAccess: mocks.resolveWorkspaceAccess,
}));
vi.mock("@/lib/revalidate-blog", () => ({ revalidateBlogPaths: vi.fn() }));
vi.mock("@/lib/shares", () => ({
  inviteScopeShare: mocks.inviteScopeShare,
  listScopeShares: mocks.listScopeShares,
  revokeScopeShare: mocks.revokeScopeShare,
  updateScopeShareRole: mocks.updateScopeShareRole,
}));
vi.mock("@/lib/store", () => ({
  PostConflictError: class PostConflictError extends Error {},
  createItemComment: mocks.createItemComment,
  createDraftInFolder: vi.fn(),
  createSubfolder: mocks.createSubfolder,
  deletePost: vi.fn(),
  deletePostAtomic: mocks.deletePostAtomic,
  getAccessibleAllPostFiles: vi.fn(),
  getAccessibleFolderCounts: vi.fn(async () => ({})),
  getAccessibleFolderPostFiles: vi.fn(),
  getAccessibleFolders: mocks.getAccessibleFolders,
  getOwnedBlog: mocks.getOwnedBlog,
  getPostById: mocks.getPostById,
  getTrashedFolders: mocks.getTrashedFolders,
  getTrashedPosts: vi.fn(),
  listItemComments: mocks.listItemComments,
  markCapturePending: mocks.markCapturePending,
  movePostFile: vi.fn(),
  renameFolder: vi.fn(),
  restoreFolder: mocks.restoreFolder,
  restorePost: vi.fn(),
  savePost: mocks.savePost,
  savePostContentPatch: vi.fn(),
  setItemCommentResolved: mocks.setItemCommentResolved,
  trashFolder: mocks.trashFolder,
}));

import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";
import {
  registerWriteTools,
  resolveMcpScopeAccess,
  runWorkspaceToolForSession,
} from "@/lib/mcp/tools";

type Registration = {
  name: string;
  config: Record<string, unknown>;
  callback: (
    args: Record<string, unknown>,
    extra: { authInfo?: AuthInfo },
  ) => Promise<CallToolResult>;
};

function registrations(): Registration[] {
  const entries: Registration[] = [];
  const server = {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      callback: Registration["callback"],
    ) {
      entries.push({ name, config, callback });
    },
  } as unknown as McpServer;
  registerWriteTools(server);
  return entries;
}

function auth(scopes: string[]): { authInfo: AuthInfo } {
  return {
    authInfo: {
      token: "token",
      clientId: "user-1",
      scopes,
      extra: { userId: "user-1", sub: "sub-1" },
    },
  };
}

function toolText(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

describe("MCP workspace tool adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks does not drain a mockResolvedValueOnce queue, and the
    // title-only co-editing test intentionally never consumes its Once (the
    // body-unchanged guard short-circuits). Reset the co-editor mock outright so
    // no dangling Once leaks into a later test's default.
    mocks.hasActiveCoEditors.mockReset();
    mocks.hasActiveCoEditors.mockResolvedValue(false);
    mocks.getAccessibleFolders.mockResolvedValue([]);
    mocks.getTrashedFolders.mockResolvedValue([]);
    mocks.listItemAssetReferences.mockReturnValue([]);
    mocks.listItemComments.mockResolvedValue([]);
    mocks.listScopeShares.mockResolvedValue([]);
    mocks.recordAction.mockResolvedValue(undefined);
    mocks.getOwnedBlog.mockResolvedValue({
      handle: "local",
      name: "Local Workspace",
      author: "Writer",
      cardStyle: "cover",
      homeLayout: "grid",
    });
    mocks.resolveWorkspaceAccess.mockResolvedValue({
      role: "owner",
      canView: true,
      canEditContent: true,
      canManage: true,
      isOwner: true,
      userId: "user-1",
      blogId: "blog-1",
      workspaceRole: null,
    });
    mocks.resolveItemAccess.mockResolvedValue({
      role: "owner",
      canView: true,
      canEditContent: true,
      canManage: true,
      isOwner: true,
      userId: "user-1",
      blogId: "blog-1",
      workspaceRole: null,
    });
  });

  it("registers every shared definition with all current MCP annotations", () => {
    const entries = registrations();
    expect(entries.map((entry) => entry.name)).toEqual(WORKSPACE_TOOL_NAMES);
    for (const entry of entries) {
      const definition =
        WORKSPACE_TOOL_DEFINITIONS[
          entry.name as keyof typeof WORKSPACE_TOOL_DEFINITIONS
        ];
      expect(entry.config).toMatchObject({
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: {
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          idempotentHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
        },
      });
      expect(entry.config.annotations).toEqual(definition.annotations);
    }
  });

  it("denies every mutation to read scope before any store call", async () => {
    const entries = registrations();
    for (const name of WORKSPACE_TOOL_NAMES) {
      if (WORKSPACE_TOOL_DEFINITIONS[name].mutability !== "write") continue;
      const entry = entries.find((candidate) => candidate.name === name);
      expect(entry).toBeDefined();
      const result = await entry!.callback({}, auth(["read"]));
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("read-only");
    }
    expect(mocks.getOwnedBlog).not.toHaveBeenCalled();
    expect(mocks.createSubfolder).not.toHaveBeenCalled();
  });

  it("allows sync scope to invoke create_folder", async () => {
    mocks.createSubfolder.mockResolvedValue({
      id: "folder-1",
      name: "Ideas",
      path: "blog/ideas",
      mode: "blog",
      position: 0,
      parentId: "blog",
    });
    const createFolder = registrations().find(
      (entry) => entry.name === "create_folder",
    );
    const result = await createFolder!.callback(
      { parent_path: "blog", name: "Ideas" },
      auth(["sync"]),
    );
    expect(result.isError).not.toBe(true);
    expect(mocks.createSubfolder).toHaveBeenCalledWith("local", "blog", "Ideas");
    expect(mocks.recordAction).toHaveBeenCalledOnce();
  });

  it("runs a tool for an in-app session actor with full workspace capability", async () => {
    // The cloud assistant rung reuses the exact executor via a session actor.
    // Full-access scope is granted, so unlike a read-scoped MCP connection the
    // resolved access is editable; per-item sharing is still enforced downstream.
    const result = await runWorkspaceToolForSession(
      "get_workspace",
      {},
      { sub: "owner-sub", userId: "owner-uuid" },
    );
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({
      workspace: { handle: "local", name: "Local Workspace" },
      access: { canEdit: true },
    });
  });

  it("returns identity and safe capabilities to a read-scoped connection", async () => {
    const getWorkspace = registrations().find(
      (entry) => entry.name === "get_workspace",
    );
    const result = await getWorkspace!.callback({}, auth(["read"]));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({
      workspace: { handle: "local", name: "Local Workspace" },
      access: {
        scope: "read-only",
        grantedScopes: ["read"],
        canEdit: false,
        canManage: false,
      },
      capabilities: {
        folderModes: ["blog", "notes", "bookmarks"],
        scopes: { fullAccess: "sync", readOnly: expect.arrayContaining(["read"]) },
        permanentDeletion: false,
        memberManagement: true,
        accessManagement: true,
        comments: true,
        bookmarkRecapture: true,
        itemAssets: true,
      },
    });
  });

  it("guards sync writes by revision and audits successful mutations", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const post = {
      id,
      folderId: "blog",
      type: "article",
      slug: "draft",
      title: "Draft",
      excerpt: "",
      body: "Before",
      status: "draft",
      pinned: false,
      revision: 42,
    } as const;
    mocks.getPostById.mockResolvedValue(post);
    mocks.savePost.mockResolvedValue({ ...post, body: "After", revision: 43 });
    const updateItem = registrations().find(
      (entry) => entry.name === "update_item",
    );
    const result = await updateItem!.callback(
      { id, body: "After" },
      auth(["sync"]),
    );
    expect(result.isError).not.toBe(true);
    expect(mocks.savePost).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({ id, body: "After" }),
      { expectedRevision: 42 },
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "external_agent",
        actionName: "mcp.update_item",
        targetId: id,
      }),
    );
  });

  it("refuses a body overwrite while the item is being co-edited", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    mocks.getOwnedBlog.mockResolvedValue({ handle: "local", name: "Local Workspace" });
    mocks.resolveItemAccess.mockResolvedValue({ canView: true, canEditContent: true, isOwner: true });
    mocks.getPostById.mockResolvedValue({
      id,
      folderId: "blog",
      type: "article",
      slug: "draft",
      title: "Draft",
      excerpt: "",
      body: "Before",
      status: "draft",
      pinned: false,
      revision: 42,
    });
    mocks.hasActiveCoEditors.mockResolvedValueOnce(true);
    const updateItem = registrations().find((entry) => entry.name === "update_item");
    const result = await updateItem!.callback({ id, body: "After" }, auth(["sync"]));
    // A live session owns the body: refuse rather than clobber, never save.
    expect(result.isError).toBe(true);
    expect(toolText(result)).toMatch(/co-edited/i);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("writes a body change when no one is co-editing", async () => {
    const id = "66666666-6666-4666-8666-666666666666";
    mocks.getOwnedBlog.mockResolvedValue({ handle: "local", name: "Local Workspace" });
    mocks.resolveItemAccess.mockResolvedValue({ canView: true, canEditContent: true, isOwner: true });
    const post = {
      id,
      folderId: "blog",
      type: "article",
      slug: "draft",
      title: "Draft",
      excerpt: "",
      body: "Before",
      status: "draft",
      pinned: false,
      revision: 42,
    } as const;
    mocks.getPostById.mockResolvedValue(post);
    mocks.savePost.mockResolvedValue({ ...post, body: "After", revision: 43 });
    const updateItem = registrations().find((entry) => entry.name === "update_item");
    const result = await updateItem!.callback({ id, body: "After" }, auth(["sync"]));
    expect(result.isError).not.toBe(true);
    expect(mocks.savePost).toHaveBeenCalledTimes(1);
  });

  it("allows a title-only edit while co-edited (does not touch the body)", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    mocks.getOwnedBlog.mockResolvedValue({ handle: "local", name: "Local Workspace" });
    mocks.resolveItemAccess.mockResolvedValue({ canView: true, canEditContent: true, isOwner: true });
    const post = {
      id,
      folderId: "blog",
      type: "article",
      slug: "draft",
      title: "Draft",
      excerpt: "",
      body: "Body",
      status: "draft",
      pinned: false,
      revision: 42,
    } as const;
    mocks.getPostById.mockResolvedValue(post);
    mocks.savePost.mockResolvedValue({ ...post, title: "Renamed", revision: 43 });
    mocks.hasActiveCoEditors.mockResolvedValueOnce(true);
    const updateItem = registrations().find((entry) => entry.name === "update_item");
    const result = await updateItem!.callback({ id, title: "Renamed" }, auth(["sync"]));
    expect(result.isError).not.toBe(true);
    expect(mocks.savePost).toHaveBeenCalledTimes(1);
  });

  it("refuses append_to_item while the item is being co-edited", async () => {
    const id = "77777777-7777-4777-8777-777777777777";
    mocks.getOwnedBlog.mockResolvedValue({ handle: "local", name: "Local Workspace" });
    mocks.resolveItemAccess.mockResolvedValue({ canView: true, canEditContent: true, isOwner: true });
    mocks.getPostById.mockResolvedValue({
      id,
      folderId: "blog",
      type: "article",
      slug: "draft",
      title: "Draft",
      excerpt: "",
      body: "Before",
      status: "draft",
      pinned: false,
      revision: 42,
    });
    // Append always rewrites the whole body, so it must refuse unconditionally
    // while a live session owns the document.
    mocks.hasActiveCoEditors.mockResolvedValueOnce(true);
    const appendItem = registrations().find((entry) => entry.name === "append_to_item");
    const result = await appendItem!.callback(
      { id, markdown_fragment: "More text" },
      auth(["sync"]),
    );
    expect(result.isError).toBe(true);
    expect(toolText(result)).toMatch(/co-edited/i);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("appends when no one is co-editing", async () => {
    const id = "88888888-8888-4888-8888-888888888888";
    mocks.getOwnedBlog.mockResolvedValue({ handle: "local", name: "Local Workspace" });
    mocks.resolveItemAccess.mockResolvedValue({ canView: true, canEditContent: true, isOwner: true });
    const post = {
      id,
      folderId: "blog",
      type: "article",
      slug: "draft",
      title: "Draft",
      excerpt: "",
      body: "Before",
      status: "draft",
      pinned: false,
      revision: 42,
    } as const;
    mocks.getPostById.mockResolvedValue(post);
    mocks.savePost.mockResolvedValue({ ...post, body: "Before\n\nMore", revision: 43 });
    const appendItem = registrations().find((entry) => entry.name === "append_to_item");
    const result = await appendItem!.callback(
      { id, markdown_fragment: "More" },
      auth(["sync"]),
    );
    expect(result.isError).not.toBe(true);
    expect(mocks.savePost).toHaveBeenCalledTimes(1);
  });

  it("soft-deletes through the revision-guarded Trash operation", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    mocks.getPostById.mockResolvedValue({
      id,
      folderId: "blog",
      type: "article",
      slug: "old-draft",
      title: "Old draft",
      body: "Body",
      status: "draft",
      pinned: false,
      revision: 12,
    });
    const deleteItem = registrations().find(
      (entry) => entry.name === "delete_item",
    );
    const result = await deleteItem!.callback({ id }, auth(["sync"]));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(toolText(result))).toEqual({
      ok: true,
      id,
      trashed: true,
    });
    // The mcp.delete_item audit is folded into the delete's own transaction
    // (the 4th arg), not recorded as a separate best-effort write.
    expect(mocks.deletePostAtomic).toHaveBeenCalledWith(
      "local",
      id,
      12,
      expect.objectContaining({
        actionName: "mcp.delete_item",
        actorType: "external_agent",
        targetId: id,
      }),
    );
    expect(mocks.recordAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionName: "mcp.delete_item" }),
    );
  });

  it("moves a folder to Trash and restores it with adapter-owned audits", async () => {
    const folder = {
      id: "folder-ideas",
      name: "Ideas",
      path: "blog/ideas",
      mode: "blog",
      position: 1,
      parentId: "blog",
    };
    mocks.getAccessibleFolders.mockResolvedValue([folder]);
    mocks.getTrashedFolders.mockResolvedValue([folder]);

    const entries = registrations();
    const deleteFolder = entries.find((entry) => entry.name === "delete_folder");
    const restoreFolder = entries.find((entry) => entry.name === "restore_folder");
    const deleted = await deleteFolder!.callback(
      { folder_id: folder.id },
      auth(["sync"]),
    );
    const restored = await restoreFolder!.callback(
      { folder_id: folder.id },
      auth(["sync"]),
    );

    expect(deleted.isError).not.toBe(true);
    expect(restored.isError).not.toBe(true);
    expect(mocks.trashFolder).toHaveBeenCalledWith("local", folder.id);
    expect(mocks.restoreFolder).toHaveBeenCalledWith("local", folder.id);
    expect(mocks.recordAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorType: "external_agent",
        actionName: "mcp.delete_folder",
        targetType: "folder",
        targetId: folder.id,
      }),
    );
    expect(mocks.recordAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actorType: "external_agent",
        actionName: "mcp.restore_folder",
        targetType: "folder",
        targetId: folder.id,
      }),
    );
  });

  it("requires sync scope for access lists", async () => {
    const listAccess = registrations().find(
      (entry) => entry.name === "list_access",
    );
    const result = await listAccess!.callback(
      { scope_type: "workspace" },
      auth(["read"]),
    );

    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("read-only");
    expect(mocks.getOwnedBlog).not.toHaveBeenCalled();
    expect(mocks.listScopeShares).not.toHaveBeenCalled();
  });

  it("routes access management with external-agent audit context", async () => {
    const share = {
      id: "access-1",
      email: "editor@example.com",
      role: "member",
      accepted: false,
      createdAt: "2026-07-15T00:00:00.000Z",
    };
    mocks.listScopeShares.mockResolvedValue([share]);
    mocks.inviteScopeShare.mockResolvedValue(share);

    const entries = registrations();
    const listAccess = entries.find((entry) => entry.name === "list_access");
    const grantAccess = entries.find((entry) => entry.name === "grant_access");
    const setAccessRole = entries.find(
      (entry) => entry.name === "set_access_role",
    );
    const revokeAccess = entries.find(
      (entry) => entry.name === "revoke_access",
    );

    const listed = await listAccess!.callback(
      { scope_type: "workspace" },
      auth(["sync"]),
    );
    const granted = await grantAccess!.callback(
      {
        scope_type: "workspace",
        email: share.email,
        role: "member",
      },
      auth(["sync"]),
    );
    const changed = await setAccessRole!.callback(
      {
        scope_type: "workspace",
        access_id: share.id,
        role: "guest",
      },
      auth(["sync"]),
    );
    const revoked = await revokeAccess!.callback(
      { scope_type: "workspace", access_id: share.id },
      auth(["sync"]),
    );

    expect(
      [listed, granted, changed, revoked].every(
        (result) => result.isError !== true,
      ),
    ).toBe(true);
    expect(mocks.listScopeShares).toHaveBeenCalledWith("workspace", "blog-1");
    expect(mocks.inviteScopeShare).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "workspace",
        scopeId: "blog-1",
        email: share.email,
        role: "member",
        invitedBySub: "sub-1",
        actorType: "external_agent",
        actorUserId: "user-1",
        auditActionName: "mcp.grant_access",
      }),
    );
    expect(mocks.updateScopeShareRole).toHaveBeenCalledWith(
      expect.objectContaining({
        shareId: share.id,
        role: "guest",
        actorType: "external_agent",
        auditActionName: "mcp.set_access_role",
      }),
    );
    expect(mocks.revokeScopeShare).toHaveBeenCalledWith(
      "workspace",
      "blog-1",
      share.id,
      "sub-1",
      expect.objectContaining({
        actorType: "external_agent",
        actorUserId: "user-1",
        auditActionName: "mcp.revoke_access",
      }),
    );
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("lists, adds, and resolves comments with the expected audits", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const post = {
      id,
      folderId: "notes",
      type: "note",
      slug: "review",
      title: "Review",
      body: "Selected text",
      status: "draft",
      pinned: false,
      revision: 3,
    } as const;
    const comment = {
      id: "comment-1",
      itemId: id,
      body: "Clarify this",
      resolved: false,
    };
    mocks.getPostById.mockResolvedValue(post);
    mocks.listItemComments.mockResolvedValue([comment]);
    mocks.createItemComment.mockResolvedValue(comment);
    mocks.setItemCommentResolved.mockResolvedValue({
      ...comment,
      resolved: true,
    });

    const entries = registrations();
    const listComments = entries.find((entry) => entry.name === "list_comments");
    const addComment = entries.find((entry) => entry.name === "add_comment");
    const resolveComment = entries.find(
      (entry) => entry.name === "set_comment_resolved",
    );
    const listed = await listComments!.callback(
      { id, state: "open" },
      auth(["read"]),
    );
    const added = await addComment!.callback(
      {
        id,
        body: comment.body,
        anchor_field: "body",
        anchor_exact: "Selected text",
        anchor_start: 0,
        anchor_end: 13,
      },
      auth(["sync"]),
    );
    const resolved = await resolveComment!.callback(
      { id, comment_id: comment.id, resolved: true },
      auth(["sync"]),
    );

    expect(
      [listed, added, resolved].every((result) => result.isError !== true),
    ).toBe(true);
    expect(mocks.listItemComments).toHaveBeenCalledWith(id, {
      resolved: false,
    });
    expect(mocks.createItemComment).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: id,
        body: comment.body,
        anchor: {
          field: "body",
          exactQuote: "Selected text",
          start: 0,
          end: 13,
        },
      }),
      expect.objectContaining({ actorType: "external_agent" }),
    );
    expect(mocks.setItemCommentResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: id,
        commentId: comment.id,
        resolved: true,
        actor: expect.objectContaining({ actorType: "external_agent" }),
      }),
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "mcp.add_comment",
        targetId: id,
      }),
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "mcp.resolve_comment",
        targetId: id,
      }),
    );
  });

  it("queues bookmark recapture and audits the original URL", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    const post = {
      id,
      folderId: "bookmarks",
      type: "bookmark",
      slug: "example",
      title: "Example",
      body: "Saved",
      status: "draft",
      pinned: false,
      revision: 8,
      links: [{ label: "Original", href: "https://example.com/article" }],
    } as const;
    mocks.getPostById.mockResolvedValue(post);
    mocks.markCapturePending.mockResolvedValue({
      ...post,
      capture: {
        url: "https://example.com/article",
        status: "pending",
      },
    });
    const recapture = registrations().find(
      (entry) => entry.name === "recapture_bookmark",
    );
    const result = await recapture!.callback({ id }, auth(["sync"]));

    expect(result.isError).not.toBe(true);
    expect(mocks.markCapturePending).toHaveBeenCalledWith(
      "local",
      id,
      "https://example.com/article",
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "external_agent",
        actionName: "mcp.recapture_bookmark",
        targetId: id,
        inputSummary: "https://example.com/article",
      }),
    );
  });

  it("lists, adds, removes, and selects item cover assets", async () => {
    const id = "66666666-6666-4666-8666-666666666666";
    const assetUrl = "https://assets.example.com/cover.jpg";
    const sourceUrl = "https://images.example.com/cover.jpg";
    const post = {
      id,
      folderId: "blog",
      type: "article",
      slug: "with-assets",
      title: "With assets",
      body: "Body",
      status: "draft",
      pinned: false,
      revision: 5,
    } as const;
    const asset = {
      url: assetUrl,
      contentType: "image/jpeg",
      filename: "cover.jpg",
      sourceUrl,
      bytes: 2048,
    };
    mocks.getPostById.mockResolvedValue(post);
    mocks.listItemAssetReferences.mockReturnValue([
      { url: assetUrl, role: "body" },
    ]);
    mocks.importItemAssetFromUrl.mockResolvedValue(asset);
    mocks.attachItemAsset.mockReturnValue({ ...post, body: `Body\n\n![](${assetUrl})` });
    mocks.removeItemAssetReferences.mockReturnValue({
      changed: true,
      post: { ...post, body: "Body" },
    });
    mocks.savePost.mockImplementation(async (_handle, next) => ({
      ...next,
      revision: 6,
    }));

    const entries = registrations();
    const listAssets = entries.find(
      (entry) => entry.name === "list_item_assets",
    );
    const addAsset = entries.find((entry) => entry.name === "add_item_asset");
    const removeAsset = entries.find(
      (entry) => entry.name === "remove_item_asset",
    );
    const setCover = entries.find((entry) => entry.name === "set_item_cover");

    const listed = await listAssets!.callback({ id }, auth(["read"]));
    const added = await addAsset!.callback(
      {
        id,
        source_url: sourceUrl,
        placement: "body_end",
        alt_text: "Cover art",
      },
      auth(["sync"]),
    );
    const removed = await removeAsset!.callback(
      { id, asset_url: assetUrl },
      auth(["sync"]),
    );
    const covered = await setCover!.callback(
      {
        id,
        source: "url",
        url: assetUrl,
        caption: "Cover caption",
        height: 420,
      },
      auth(["sync"]),
    );

    expect(
      [listed, added, removed, covered].every(
        (result) => result.isError !== true,
      ),
    ).toBe(true);
    expect(mocks.importItemAssetFromUrl).toHaveBeenCalledWith({
      handle: "local",
      itemId: id,
      sourceUrl,
      media: "image-or-video",
    });
    expect(mocks.attachItemAsset).toHaveBeenCalledWith(
      post,
      asset,
      "body_end",
      { altText: "Cover art", caption: undefined },
    );
    expect(mocks.removeItemAssetReferences).toHaveBeenCalledWith(post, assetUrl);
    expect(mocks.savePost).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({
        cover: assetUrl,
        coverCaption: "Cover caption",
        coverHeight: 420,
      }),
      { expectedRevision: 5 },
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: "mcp.add_item_asset", targetId: id }),
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "mcp.remove_item_asset",
        targetId: id,
      }),
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: "mcp.set_item_cover", targetId: id }),
    );
  });

  it("never publishes a private note", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    mocks.getPostById.mockResolvedValue({
      id,
      folderId: "notes",
      type: "note",
      slug: "private-note",
      title: "Private note",
      body: "Private",
      status: "draft",
      pinned: false,
      revision: 7,
    });
    const setStatus = registrations().find(
      (entry) => entry.name === "set_item_status",
    );
    const result = await setStatus!.callback(
      { id, status: "published" },
      auth(["sync"]),
    );
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("always unlisted");
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("treats any read-only scope as dominant over sync", () => {
    expect(resolveMcpScopeAccess(["sync"])).toBe("full");
    expect(resolveMcpScopeAccess(["read"])).toBe("read-only");
    expect(resolveMcpScopeAccess(["sync", "read"])).toBe("read-only");
    expect(resolveMcpScopeAccess([])).toBe("none");
  });
});
