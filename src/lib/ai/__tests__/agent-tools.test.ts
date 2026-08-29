import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORKSPACE_AGENT_TOOL_DEFINITIONS,
  createWorkspaceAgentTools,
  type WorkspaceAgentToolsOptions,
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

  it("opens the exact local item without waiting for a server round trip", async () => {
    const openItem = vi.fn();
    const executeTool = vi.fn();
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      openItem,
      executeTool,
    });

    await expect(
      tools.executor("open_item", { id: "note-1", mode: "edit" }),
    ).resolves.toMatchObject({
      ok: true,
      id: "note-1",
      title: "Private note",
      folder_path: "notes",
      mode: "edit",
    });
    expect(openItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-1", folderId: "notes" }),
      "edit",
    );
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("names no folder, so the workspace's one rule places the item", async () => {
    // This adapter used to answer "where does an unplaced item go" with its own
    // copy of the rule, and because it ran first the executor's rule never got
    // a say on this lane: a note nobody placed was addressed to Blog, whose
    // mode refuses notes. The kind goes through untouched now, and the one
    // command surface every client calls decides the destination.
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({
        item: { id: "note-new", title: "Project requirements", status: "draft" },
      })
      .mockResolvedValueOnce({
        item: { id: "post-new", title: "An essay", status: "draft" },
      });
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      executeTool,
      refreshPool: async () => {},
    });

    await tools.executor(
      "create_item",
      { kind: "note", title: "Project requirements" },
      "root-request",
    );
    await tools.executor(
      "create_item",
      { kind: "article", title: "An essay" },
      "root-request",
    );

    expect(executeTool).toHaveBeenNthCalledWith(1, "create_item", {
      kind: "note",
      title: "Project requirements",
    });
    expect(executeTool).toHaveBeenNthCalledWith(2, "create_item", {
      kind: "article",
      title: "An essay",
    });
  });

  it("does not invent a destination for a kind whose folder is missing", async () => {
    // This workspace has no bookmarks folder. Deciding that here is how the two
    // copies of the rule came to disagree in the first place, so the request
    // goes through as asked and the executor answers it. Naming the missing
    // folder is now the executor's job, and its test pins that message.
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ item: { id: "b-1", title: "Read later" } });
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      executeTool,
      refreshPool: async () => {},
    });

    await tools.executor(
      "create_item",
      { kind: "bookmark", title: "Read later" },
      "root-request",
    );

    expect(executeTool).toHaveBeenCalledWith("create_item", {
      kind: "bookmark",
      title: "Read later",
    });
  });

  it("still obeys a folder the caller named, whatever the kind", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      item: { id: "kept", title: "Filed by hand", status: "draft" },
    });
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      executeTool,
      refreshPool: async () => {},
    });

    await tools.executor(
      "create_item",
      { kind: "note", title: "Filed by hand", folder_path: "notes" },
      "root-request",
    );

    expect(executeTool).toHaveBeenCalledWith("create_item", {
      folder_path: "notes",
      kind: "note",
      title: "Filed by hand",
    });
  });

  it("reports the destination the workspace chose, and creates every requested post", async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({
        receipt: { saved_to: "blog" },
        item: {
          id: "new-1",
          title: "The top 10 NES games",
          status: "draft",
        },
      })
      .mockResolvedValueOnce({
        receipt: { saved_to: "blog" },
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

    // No folder_path: the caller named none, so the executor places it and
    // says where in its receipt.
    expect(executeTool).toHaveBeenNthCalledWith(1, "create_item", {
      kind: "article",
      title: "The top 10 NES games",
      body: "Complete NES article",
    });
    expect(executeTool).toHaveBeenNthCalledWith(2, "create_item", {
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
      kind: "article",
      title: "A complete draft",
    });
  });

  it("passes quick capture through without forcing it into Blog", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      item: {
        id: "note-2",
        title: "A thought worth keeping",
        status: "draft",
      },
      receipt: {
        item_id: "note-2",
        kind: "note",
        saved_to: "notes",
        title: "A thought worth keeping",
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
        capture: "A thought worth keeping",
        idempotency_key: "capture:thought-1",
      }),
    ).resolves.toMatchObject({
      folder_path: "notes",
      id: "note-2",
      title: "A thought worth keeping",
    });
    expect(executeTool).toHaveBeenCalledWith("create_item", {
      capture: "A thought worth keeping",
      idempotency_key: "capture:thought-1",
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
      hash: null,
      assets: [{ url: "https://assets.test/a.jpg" }],
    });
  });

  it("returns the persisted hash instead of hashing an unsynced open draft", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      readItemText: vi.fn(async () => ({
        title: "Unsynced title",
        excerpt: "",
        body: "Unsynced local body",
        tags: [],
      })),
      executeTool: vi.fn(async () => ({
        item: { id: "post-1", hash: "sha256:persisted" },
      })),
    });

    await expect(
      tools.executor("read_item", { id: "post-1" }),
    ).resolves.toMatchObject({
      title: "Unsynced title",
      body: "Unsynced local body",
      hash: "sha256:persisted",
    });
  });

  it("reports an open-draft edit as queued until sync is acknowledged", async () => {
    const applyItemPatch = vi.fn(async () => ({
      synced: false,
      queued: true,
    }));
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      readItemText: vi.fn(async () => ({
        title: "Draft",
        excerpt: "",
        body: "Persisted body",
        tags: [],
      })),
      applyItemPatch,
    });

    await expect(
      tools.executor("update_item", { id: "post-1", title: "Queued title" }),
    ).resolves.toMatchObject({
      ok: false,
      queued: true,
      sync_status: "queued_locally",
    });
  });

  it("propagates authorization and conflict failures from draft sync", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      readItemText: vi.fn(async () => ({
        title: "Draft",
        excerpt: "",
        body: "Persisted body",
        tags: [],
      })),
      applyItemPatch: vi.fn(async () => {
        throw new Error("Conflict: You cannot edit this item.");
      }),
    });

    await expect(
      tools.executor("update_item", { id: "post-1", title: "Rejected" }),
    ).rejects.toThrow("Conflict: You cannot edit this item.");
  });

  it("keeps guarded section edits on the authoritative command path", async () => {
    const applyItemPatch = vi.fn(async () => ({ synced: true }));
    const executeTool = vi.fn(async () => ({
      item: { id: "post-1", title: "Draft" },
    }));
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      readItemText: vi.fn(async () => ({
        title: "Draft",
        excerpt: "",
        body: "# Draft\n\n## Pricing\n\nTen dollars.",
        tags: [],
      })),
      applyItemPatch,
      executeTool,
    });

    await expect(
      tools.executor("update_item", {
        id: "post-1",
        section: "Pricing",
        expected_section_body: "Ten dollars.",
        body: "Twenty dollars.",
      }),
    ).resolves.toMatchObject({ ok: true, id: "post-1" });

    expect(applyItemPatch).not.toHaveBeenCalled();
    expect(executeTool).toHaveBeenCalledWith("update_item", {
      id: "post-1",
      section: "Pricing",
      expected_section_body: "Ten dollars.",
      body: "Twenty dollars.",
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

describe("external agent presence signalling", () => {
  const actor = { connectionName: "codex-cli", clientName: "codex-cli" };

  beforeEach(() => vi.clearAllMocks());

  function toolsWithSignal(
    signalAgentActivity: WorkspaceAgentToolsOptions["signalAgentActivity"],
  ) {
    return createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      openItem: vi.fn(),
      readItemText: vi.fn(async () => ({
        title: "Draft",
        excerpt: "",
        body: "Existing body",
        tags: [],
      })),
      applyItemPatch: vi.fn(async () => ({ synced: true })),
      executeTool: vi.fn(async () => ({ item: { title: "Draft" } })),
      signalAgentActivity,
    });
  }

  it("announces the agent before opening an item", async () => {
    const order: string[] = [];
    const signalAgentActivity = vi.fn(async () => {
      order.push("signal");
    });
    const openItem = vi.fn(async () => {
      order.push("open");
    });
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      openItem,
      signalAgentActivity,
    });

    await tools.executor("open_item", { id: "post-1" }, "agent-request", actor);

    expect(signalAgentActivity).toHaveBeenCalledWith(
      "post-1",
      { kind: "open", field: "body" },
      actor,
    );
    // Presence must land BEFORE navigation so the agent is already visible.
    expect(order).toEqual(["signal", "open"]);
  });

  it("puts the cursor on the field an update changes", async () => {
    const signalAgentActivity = vi.fn();
    const tools = toolsWithSignal(signalAgentActivity);

    await tools.executor(
      "update_item",
      { id: "post-1", body: "New body", if_match_hash: "sha256:read" },
      "agent-request",
      actor,
    );
    expect(signalAgentActivity).toHaveBeenLastCalledWith(
      "post-1",
      { kind: "edit", field: "body" },
      actor,
    );

    await tools.executor(
      "update_item",
      { id: "post-1", title: "New title" },
      "agent-request",
      actor,
    );
    expect(signalAgentActivity).toHaveBeenLastCalledWith(
      "post-1",
      { kind: "edit", field: "title" },
      actor,
    );

    await tools.executor(
      "update_item",
      { id: "post-1", excerpt: "New subtitle" },
      "agent-request",
      actor,
    );
    expect(signalAgentActivity).toHaveBeenLastCalledWith(
      "post-1",
      { kind: "edit", field: "subtitle" },
      actor,
    );
  });

  it("prefers the body when an update changes several fields", async () => {
    const signalAgentActivity = vi.fn();
    const tools = toolsWithSignal(signalAgentActivity);

    await tools.executor(
      "update_item",
      {
        id: "post-1",
        title: "New title",
        body: "New body",
        if_match_hash: "sha256:read",
      },
      "agent-request",
      actor,
    );

    expect(signalAgentActivity).toHaveBeenLastCalledWith(
      "post-1",
      { kind: "edit", field: "body" },
      actor,
    );
  });

  it("announces the agent before appending", async () => {
    const signalAgentActivity = vi.fn();
    const tools = toolsWithSignal(signalAgentActivity);

    await tools.executor(
      "append_to_item",
      { id: "post-1", markdown_fragment: "More" },
      "agent-request",
      actor,
    );

    expect(signalAgentActivity).toHaveBeenCalledWith(
      "post-1",
      { kind: "edit", field: "body" },
      actor,
    );
  });

  it("still applies the edit when presence reporting fails", async () => {
    const signalAgentActivity = vi.fn(async () => {
      throw new Error("presence route unavailable");
    });
    const applyItemPatch = vi.fn(async () => ({ synced: true }));
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      readItemText: vi.fn(async () => ({
        title: "Draft",
        excerpt: "",
        body: "Existing body",
        tags: [],
      })),
      applyItemPatch,
      executeTool: vi.fn(async () => ({ item: { title: "Draft" } })),
      signalAgentActivity,
    });

    await expect(
      tools.executor(
        "append_to_item",
        { id: "post-1", markdown_fragment: "More" },
        "agent-request",
        actor,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(applyItemPatch).toHaveBeenCalled();
  });

  it("does not signal presence for the person at the keyboard", async () => {
    const signalAgentActivity = vi.fn();
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: workspacePool,
      openItem: vi.fn(),
      signalAgentActivity,
    });

    await tools.executor("open_item", { id: "post-1" });

    expect(signalAgentActivity).not.toHaveBeenCalled();
  });
});
