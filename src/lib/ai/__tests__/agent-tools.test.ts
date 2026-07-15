import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createSubfolderAction: vi.fn(),
  createWorkspacePostAction: vi.fn(),
  deleteEditablePostAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  renameFolderAction: vi.fn(),
  restoreEditablePostAction: vi.fn(),
  saveEditablePostAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
  toggleEditablePostPinnedAction: vi.fn(),
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
        memberManagement: false,
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
});
