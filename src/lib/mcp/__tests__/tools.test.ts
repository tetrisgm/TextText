import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSubfolder: vi.fn(),
  deletePostAtomic: vi.fn(),
  getOwnedBlog: vi.fn(),
  getPostById: vi.fn(),
  recordAction: vi.fn(),
  resolveItemAccess: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  savePost: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/permissions", () => ({
  resolveFolderAccess: vi.fn(),
  resolveItemAccess: mocks.resolveItemAccess,
  resolveWorkspaceAccess: mocks.resolveWorkspaceAccess,
}));
vi.mock("@/lib/revalidate-blog", () => ({ revalidateBlogPaths: vi.fn() }));
vi.mock("@/lib/store", () => ({
  PostConflictError: class PostConflictError extends Error {},
  createDraftInFolder: vi.fn(),
  createSubfolder: mocks.createSubfolder,
  deletePost: vi.fn(),
  deletePostAtomic: mocks.deletePostAtomic,
  getAccessibleAllPostFiles: vi.fn(),
  getAccessibleFolderCounts: vi.fn(async () => ({})),
  getAccessibleFolderPostFiles: vi.fn(),
  getAccessibleFolders: vi.fn(async () => []),
  getOwnedBlog: mocks.getOwnedBlog,
  getPostById: mocks.getPostById,
  getTrashedPosts: vi.fn(),
  movePostFile: vi.fn(),
  renameFolder: vi.fn(),
  restorePost: vi.fn(),
  savePost: mocks.savePost,
  savePostContentPatch: vi.fn(),
}));

import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";
import { registerWriteTools, resolveMcpScopeAccess } from "@/lib/mcp/tools";

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
        memberManagement: false,
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
    expect(mocks.deletePostAtomic).toHaveBeenCalledWith("local", id, 12);
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "mcp.delete_item",
        targetId: id,
      }),
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
