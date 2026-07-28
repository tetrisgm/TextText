import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORKSPACE_AGENT_TOOL_DEFINITIONS,
  createWorkspaceAgentTools,
  workspaceAgentToolNamesForView,
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
    templates: [],
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
        scopes: {
          fullAccess: "sync",
          readOnly: expect.arrayContaining(["read"]),
        },
        permanentDeletion: false,
        memberManagement: true,
        accessManagement: true,
        comments: true,
        bookmarkRecapture: true,
        itemAssets: true,
      },
    });
  });

  it("keeps creation at folder level and narrows an open item to requested actions", () => {
    expect(workspaceAgentToolNamesForView({ level: "section" })).toEqual([
      "get_workspace",
      "list_folders",
      "create_item",
    ]);
    const itemTools = workspaceAgentToolNamesForView(
      {
        level: "post",
        folderPath: "blog",
        postId: "post-1",
      },
      "Make this into a haiku",
    );
    expect(itemTools).toContain("update_item");
    expect(itemTools).toContain("append_to_item");
    expect(itemTools).not.toContain("read_item");
    expect(itemTools).not.toContain("create_item");
    expect(itemTools).not.toContain("create_folder");
    expect(itemTools).not.toContain("delete_folder");
    expect(itemTools).not.toContain("delete_item");
    expect(itemTools).not.toContain("set_access");
  });

  it("keeps styled workspace creation small enough for constrained providers", () => {
    expect(
      workspaceAgentToolNamesForView(
        { level: "workspace" },
        "Create an article with a Medium-style editorial look",
      ),
    ).toEqual([
      "get_workspace",
      "list_folders",
      "list_document_templates",
      "customize_document_template",
      "set_item_template",
      "create_item",
    ]);
  });

  it("adds only prompt-relevant tools for an open item", () => {
    const itemTools = workspaceAgentToolNamesForView(
      {
        level: "post",
        folderPath: "bookmarks",
        postId: "post-1",
      },
      "Recapture this bookmark and change its cover image",
    );

    expect(itemTools).toEqual([
      "update_item",
      "append_to_item",
      "add_item_asset",
      "remove_item_asset",
      "recapture_bookmark",
    ]);
  });

  it("describes references to the open item as edits, not creation", () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
    });

    expect(
      tools.describeContext({ level: "post", postId: "post-1" }),
    ).toContain('"add a section" modify this item');
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

  it("defaults root requests to Blog and creates every requested post", async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({
        item: {
          id: "new-1",
          title: "The top 10 NES games",
          status: "draft",
        },
      })
      .mockResolvedValueOnce({
        item: {
          id: "new-2",
          title: "Chipzel and modern chiptunes",
          status: "draft",
        },
      });
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      executeTool,
      refreshPool: async () => {},
    });

    await expect(
      tools.executor(
        "create_item",
        {
          kind: "article",
          title: "The top 10 NES games",
          body: "Complete NES article",
        },
        "root-request",
      ),
    ).resolves.toMatchObject({
      id: "new-1",
      folder_path: "blog",
      status: "draft",
    });
    await expect(
      tools.executor(
        "create_item",
        {
          kind: "article",
          title: "Chipzel and modern chiptunes",
          body: "Complete chiptunes article",
        },
        "root-request",
      ),
    ).resolves.toMatchObject({
      id: "new-2",
      folder_path: "blog",
      status: "draft",
    });

    expect(executeTool).toHaveBeenNthCalledWith(1, "create_item", {
      folder_path: "blog",
      kind: "article",
      title: "The top 10 NES games",
      body: "Complete NES article",
    });
    expect(executeTool).toHaveBeenNthCalledWith(2, "create_item", {
      folder_path: "blog",
      kind: "article",
      title: "Chipzel and modern chiptunes",
      body: "Complete chiptunes article",
    });
    expect(tools.describeContext({ level: "root" })).toContain(
      'Blog folder at path "blog"',
    );
  });

  it("repairs a native create call that supplied a body without a title", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      item: {
        id: "new-1",
        title: "A complete draft",
        status: "draft",
      },
    });
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      executeTool,
      refreshPool: async () => {},
    });

    await expect(
      tools.executor("create_item", {
        body: "# A complete draft\n\nFinished body.",
        kind: "article",
      }),
    ).resolves.toMatchObject({ id: "new-1" });

    expect(executeTool).toHaveBeenCalledWith("create_item", {
      body: "# A complete draft\n\nFinished body.",
      folder_path: "blog",
      kind: "article",
      title: "A complete draft",
    });
  });

  it("fails closed for an audience-changing restore without confirmation", async () => {
    const executeTool = vi.fn();
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      executeTool,
    });

    await expect(
      tools.executor("restore_item", { id: "trash-1" }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("keeps notes private even after confirmed publication input", async () => {
    const confirmDestructive = vi.fn(async () => true);
    const executeTool = vi.fn();
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      confirmDestructive,
      executeTool,
    });

    await expect(
      tools.executor("set_item_status", {
        id: "note-1",
        status: "published",
      }),
    ).rejects.toThrow("Notes and bookmarks are always unlisted");
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("rejects an invalid published private item before restoring it", async () => {
    const confirmDestructive = vi.fn(async () => true);
    const executeTool = vi.fn();
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      confirmDestructive,
      executeTool,
    });

    await expect(
      tools.executor("restore_item", { id: "trash-note-1" }),
    ).rejects.toThrow("must be unlisted before restoration");
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("routes access, comments, recapture, and assets through stable commands", async () => {
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
    const executeTool = vi.fn(async (name: string) => {
      if (name === "list_access") return { access: [{ id: "share-1" }] };
      if (name === "list_comments") {
        return { comments: [{ id: "comment-1", resolvedAt: null }] };
      }
      if (name === "recapture_bookmark") {
        return { ok: true, queued: true, id: "bookmark-1" };
      }
      if (name === "read_item") {
        return { assets: [{ url: "https://assets.test/a.jpg" }] };
      }
      return {};
    });
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: () => current,
      executeTool,
      refreshPool: async () => {},
      readItemText: async (id) => {
        const post = current.posts.find((candidate) => candidate.id === id)!;
        return {
          title: post.title,
          excerpt: post.excerpt ?? "",
          body: "Body",
          tags: post.tags ?? [],
        };
      },
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
      tools.executor("read_item", { id: "post-1" }),
    ).resolves.toMatchObject({
      assets: [{ url: "https://assets.test/a.jpg" }],
    });
  });

  it("requires confirmation before folder Trash and access mutations", async () => {
    const executeTool = vi.fn();
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      executeTool,
    });

    await expect(
      tools.executor("delete_folder", { folder_id: "notes" }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    await expect(
      tools.executor("set_access", {
        scope_type: "workspace",
        email: "reader@example.com",
        role: "guest",
      }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    expect(executeTool).not.toHaveBeenCalled();
  });
});
