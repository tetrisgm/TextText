import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  addItemAssetAction: vi.fn(),
  addItemCommentAction: vi.fn(),
  createSubfolderAction: vi.fn(),
  createWorkspacePostAction: vi.fn(),
  deleteEditablePostAction: vi.fn(),
  listItemAssetsAction: vi.fn(),
  listItemCommentsAction: vi.fn(),
  listScopeSharesAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  recaptureBookmarkAction: vi.fn(),
  renameFolderAction: vi.fn(),
  removeItemAssetAction: vi.fn(),
  replyItemCommentAction: vi.fn(),
  reopenItemCommentAction: vi.fn(),
  restoreEditablePostAction: vi.fn(),
  restoreFolderAction: vi.fn(),
  revokeScopeShareAction: vi.fn(),
  saveEditablePostAction: vi.fn(),
  setItemCoverAction: vi.fn(),
  shareScopeAction: vi.fn(),
  resolveItemCommentAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
  trashFolderAction: vi.fn(),
  toggleEditablePostPinnedAction: vi.fn(),
  updateScopeShareRoleAction: vi.fn(),
}));

vi.mock("@/app/editor/actions", () => actions);

import {
  WORKSPACE_AGENT_TOOL_DEFINITIONS,
  createWorkspaceAgentTools,
} from "@/lib/ai/agent-tools";
import { WORKSPACE_TOOL_NAMES } from "@/lib/ai/tools";
import type { WorkspacePoolPayload } from "@/lib/pool/types";

function workspacePool(): WorkspacePoolPayload {
  return {
    version: 1,
    blogId: "blog-1",
    fetchedAt: "2026-07-15T12:00:00.000Z",
    blog: {
      handle: "local",
      name: "Local Workspace",
      author: "Writer",
      cardStyle: "cover",
      homeLayout: "grid",
    },
    folders: [
      { id: "blog", name: "Blog", path: "blog", mode: "blog", position: 0 },
      {
        id: "notes",
        name: "Notes",
        path: "notes",
        mode: "notes",
        position: 1,
      },
    ],
    counts: { blog: 1, notes: 1 },
    posts: [
      {
        id: "post-1",
        blogId: "blog-1",
        folderId: "blog",
        type: "article",
        slug: "draft",
        title: "Draft",
        status: "draft",
        pinned: false,
        updatedAt: "2026-07-15T12:00:00.000Z",
      },
      {
        id: "note-1",
        blogId: "blog-1",
        folderId: "notes",
        type: "note",
        slug: "private-note",
        title: "Private note",
        status: "draft",
        pinned: false,
        updatedAt: "2026-07-15T12:00:00.000Z",
      },
    ],
    trashedPosts: [
      {
        id: "trash-1",
        blogId: "blog-1",
        folderId: "blog",
        type: "article",
        slug: "old-public-item",
        title: "Old public item",
        status: "published",
      },
      {
        id: "trash-note-1",
        blogId: "blog-1",
        folderId: "notes",
        type: "note",
        slug: "legacy-private-note",
        title: "Legacy private note",
        status: "published",
      },
    ],
    trashedFolders: [
      {
        id: "old-folder",
        name: "Old folder",
        path: "blog/old-folder",
        mode: "blog",
        parentId: "blog",
        position: 3,
      },
    ],
  };
}

describe("native workspace tool adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives names, schemas, and identity capabilities from the shared contract", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
    });

    expect(tools.toolNames).toEqual(WORKSPACE_TOOL_NAMES);
    expect(WORKSPACE_AGENT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(
      WORKSPACE_TOOL_NAMES,
    );
    await expect(tools.executor("get_workspace", {})).resolves.toMatchObject({
      workspace: { handle: "local", name: "Local Workspace" },
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

  it("normalizes the current native bridge's folder alias before validation", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
    });

    await expect(
      tools.executor("list_items", { folder: "notes}<glitched>" }),
    ).resolves.toMatchObject({
      folder_path: "notes",
      items: [{ id: "note-1", title: "Private note" }],
    });
  });

  it("fails closed for an audience-changing restore without confirmation", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
    });

    await expect(
      tools.executor("restore_item", { id: "trash-1" }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    expect(actions.restoreEditablePostAction).not.toHaveBeenCalled();
  });

  it("keeps notes private even after confirmed publication input", async () => {
    const confirmDestructive = vi.fn(async () => true);
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      confirmDestructive,
    });

    await expect(
      tools.executor("set_item_status", {
        id: "note-1",
        status: "published",
      }),
    ).rejects.toThrow("Notes and bookmarks are always unlisted");
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(actions.setEditablePostStatusAction).not.toHaveBeenCalled();
  });

  it("rejects an invalid published private item before restoring it", async () => {
    const confirmDestructive = vi.fn(async () => true);
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      confirmDestructive,
    });

    await expect(
      tools.executor("restore_item", { id: "trash-note-1" }),
    ).rejects.toThrow("must be unlisted before restoration");
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(actions.restoreEditablePostAction).not.toHaveBeenCalled();
  });

  it("routes access, comments, recapture, and assets through app actions", async () => {
    const current = workspacePool();
    current.posts.push({
      id: "bookmark-1",
      blogId: current.blogId,
      folderId: "notes",
      type: "bookmark",
      slug: "source",
      title: "Source",
      status: "draft",
    });
    actions.listScopeSharesAction.mockResolvedValue([{ id: "share-1" }]);
    actions.listItemCommentsAction.mockResolvedValue([
      { id: "comment-1", resolvedAt: null },
      { id: "comment-2", resolvedAt: "2026-07-15T13:00:00.000Z" },
    ]);
    actions.recaptureBookmarkAction.mockResolvedValue({
      id: "bookmark-1",
      type: "bookmark",
      slug: "source",
      title: "Source",
      status: "draft",
      captureStatus: "pending",
    });
    actions.listItemAssetsAction.mockResolvedValue([{ url: "https://assets.test/a.jpg" }]);
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: () => current,
    });

    await expect(
      tools.executor("list_access", { scope_type: "workspace" }),
    ).resolves.toMatchObject({ access: [{ id: "share-1" }] });
    await expect(
      tools.executor("list_comments", { id: "post-1", state: "open" }),
    ).resolves.toMatchObject({ comments: [{ id: "comment-1" }] });
    await expect(
      tools.executor("recapture_bookmark", { id: "bookmark-1" }),
    ).resolves.toMatchObject({ queued: true });
    await expect(
      tools.executor("list_item_assets", { id: "post-1" }),
    ).resolves.toMatchObject({
      assets: [{ url: "https://assets.test/a.jpg" }],
    });
  });

  it("requires confirmation before folder Trash and access mutations", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
    });

    await expect(
      tools.executor("delete_folder", { folder_id: "notes" }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    await expect(
      tools.executor("grant_access", {
        scope_type: "workspace",
        email: "reader@example.com",
        role: "guest",
      }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    expect(actions.trashFolderAction).not.toHaveBeenCalled();
    expect(actions.shareScopeAction).not.toHaveBeenCalled();
  });
});
