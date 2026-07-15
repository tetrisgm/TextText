import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blog, Post } from "@/lib/content";
import { renderSyncFile } from "@/app/api/sync/v1/sync";
import { sanitizePostSlug } from "@/lib/post-slug";

const mocks = vi.hoisted(() => ({
  PostConflictError: class PostConflictError extends Error {},
  deletePostAtomic: vi.fn(),
  getPostById: vi.fn(),
  getFolderById: vi.fn(),
  movePostFile: vi.fn(),
  resolveItemAccess: vi.fn(),
  resolveSyncWorkspace: vi.fn(),
  recordAction: vi.fn(),
  recordSlugChanged: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  deletePostAtomic: mocks.deletePostAtomic,
  folderPathForPostType: (type: string) =>
    type === "note" ? "notes" : type === "bookmark" ? "bookmarks" : "blog",
  getFolderById: mocks.getFolderById,
  getPostById: mocks.getPostById,
  markCapturePending: vi.fn(),
  movePostFile: mocks.movePostFile,
  PostConflictError: mocks.PostConflictError,
  savePost: vi.fn(),
  savePostContentPatch: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  resolveItemAccess: mocks.resolveItemAccess,
}));

vi.mock("@/app/api/sync/v1/auth", () => ({
  resolveSyncWorkspace: mocks.resolveSyncWorkspace,
}));

vi.mock("@/lib/audit", () => ({
  recordAction: mocks.recordAction,
  recordSlugChanged: mocks.recordSlugChanged,
}));

vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import { DELETE, PATCH, PUT } from "@/app/api/sync/v1/files/[postId]/route";

const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const blog: Blog = {
  handle: "sync-test",
  name: "Sync test",
  author: "Owner",
  cardStyle: "cover",
  homeLayout: "grid",
};
const post: Post = {
  id: postId,
  type: "article",
  slug: "stable-url",
  title: "Question??",
  body: "Body",
  status: "draft",
  revision: 42,
};

function patchRequest(
  body: object,
  ifMatch: string | null = `"${renderSyncFile(blog, post).hash}"`,
  header = "If-Match",
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (ifMatch) headers.set(header, ifMatch);
  return new Request(`https://write.example/api/sync/v1/files/${postId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

function mutationRequest(
  method: "DELETE" | "PUT",
  ifMatch: string | null,
): Request {
  const headers = new Headers();
  if (ifMatch) headers.set("If-Match", ifMatch);
  if (method === "PUT") headers.set("Content-Type", "text/markdown");
  return new Request(`https://write.example/api/sync/v1/files/${postId}`, {
    method,
    headers,
    body: method === "PUT" ? "---\ntype: article\n---\n\nBody" : undefined,
  });
}

describe("sync file PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSyncWorkspace.mockResolvedValue({ blog, userId: "owner-id" });
    mocks.getPostById.mockResolvedValue(post);
    mocks.resolveItemAccess.mockResolvedValue({
      canView: true,
      canEditContent: true,
      isOwner: true,
    });
  });

  it("requires If-Match before changing metadata", async () => {
    const response = await PATCH(patchRequest({ title: "Changed" }, null), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(428);
    expect(mocks.movePostFile).not.toHaveBeenCalled();
  });

  it("rejects If-Match wildcard instead of accepting an unknown base", async () => {
    const response = await PATCH(patchRequest({ title: "Changed" }, "*"), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(412);
    expect(mocks.movePostFile).not.toHaveBeenCalled();
  });

  it("accepts the scoped validator header used through Vercel", async () => {
    mocks.movePostFile.mockResolvedValue({
      post: { ...post, title: "Changed", revision: 43 },
      changed: true,
      previousSlug: post.slug,
    });

    const response = await PATCH(
      patchRequest(
        { title: "Changed" },
        `"${renderSyncFile(blog, post).hash}"`,
        "X-Write-If-Match",
      ),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.movePostFile).toHaveBeenCalledWith(
      blog.handle,
      postId,
      {
        folderId: undefined,
        slug: undefined,
        title: "Changed",
        expectedRevision: post.revision,
      },
      // The sync.patch_file audit is now folded into the move's own
      // transaction rather than recorded as a separate best-effort write.
      expect.objectContaining({
        actionName: "sync.patch_file",
        actorType: "external_agent",
        targetType: "item",
        targetId: postId,
      }),
    );
  });

  it("rejects a wildcard content PUT instead of accepting an unknown base", async () => {
    const response = await PUT(mutationRequest("PUT", "*"), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(412);
  });

  it("rejects a stale validator after a newer folder move", async () => {
    mocks.getPostById.mockResolvedValue({
      ...post,
      folderId: "ac7a6dbd-d0a8-4581-8451-2790370f1a2e",
      revision: 43,
    });

    const response = await PATCH(patchRequest({ title: "Stale title" }), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(412);
    expect(mocks.movePostFile).not.toHaveBeenCalled();
  });

  it("maps an atomic revision race to a stale-write response", async () => {
    mocks.movePostFile.mockRejectedValue(new mocks.PostConflictError());

    const response = await PATCH(patchRequest({ title: "Racing title" }), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(412);
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("does not audit or revalidate a no-op", async () => {
    mocks.movePostFile.mockResolvedValue({
      post,
      changed: false,
      previousSlug: post.slug,
    });

    const response = await PATCH(patchRequest({ title: post.title }), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.recordAction).not.toHaveBeenCalled();
    expect(mocks.recordSlugChanged).not.toHaveBeenCalled();
    expect(mocks.revalidateBlogPaths).not.toHaveBeenCalled();
  });

  it("passes the exact folder id, sanitizes only the slug, and preserves title", async () => {
    const targetFolderId = "92529e34-b532-43a5-8351-0ab4f2be2244";
    const unsafeSlug = `Drafts/What??#part%2Fchild\u0000${"X".repeat(100)}`;
    const safeSlug = sanitizePostSlug(unsafeSlug, post.slug);
    mocks.getFolderById.mockResolvedValue({
      id: targetFolderId,
      name: "Renamed folder",
      path: "blog/mutable-path",
      mode: "blog",
      position: 1,
    });
    const renamed = {
      ...post,
      folderId: targetFolderId,
      slug: safeSlug,
      title: "What??",
      revision: (post.revision ?? 0) + 1,
    };
    mocks.movePostFile.mockResolvedValue({
      post: renamed,
      changed: true,
      previousSlug: post.slug,
    });

    const response = await PATCH(
      patchRequest({
        folder: targetFolderId,
        slug: unsafeSlug,
        title: renamed.title,
      }),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      item: { slug: safeSlug, title: "What??" },
    });
    expect(safeSlug).toHaveLength(80);
    expect(safeSlug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(mocks.getFolderById).toHaveBeenCalledWith(
      blog.handle,
      targetFolderId,
    );
    expect(mocks.movePostFile).toHaveBeenCalledWith(
      blog.handle,
      postId,
      {
        folderId: targetFolderId,
        slug: safeSlug,
        title: "What??",
        expectedRevision: post.revision,
      },
      expect.objectContaining({ actionName: "sync.patch_file", targetId: postId }),
    );
    // The sync.patch_file audit is folded into movePostFile now; only the
    // secondary slug-change annotation remains a separate best-effort write.
    expect(mocks.recordAction).not.toHaveBeenCalled();
    expect(mocks.recordSlugChanged).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateBlogPaths).toHaveBeenCalledTimes(1);
  });
});

describe("sync file DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSyncWorkspace.mockResolvedValue({ blog, userId: "owner-id" });
    mocks.getPostById.mockResolvedValue(post);
    mocks.resolveItemAccess.mockResolvedValue({
      canView: true,
      canEditContent: true,
      isOwner: true,
    });
  });

  it("requires If-Match before deleting", async () => {
    const response = await DELETE(mutationRequest("DELETE", null), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(428);
    expect(mocks.deletePostAtomic).not.toHaveBeenCalled();
  });

  it("rejects a wildcard delete instead of accepting an unknown base", async () => {
    const response = await DELETE(mutationRequest("DELETE", "*"), {
      params: Promise.resolve({ postId }),
    });

    expect(response.status).toBe(412);
    expect(mocks.deletePostAtomic).not.toHaveBeenCalled();
  });

  it("deletes with the exact file hash and atomic row revision", async () => {
    mocks.deletePostAtomic.mockResolvedValue(undefined);
    const response = await DELETE(
      mutationRequest("DELETE", `"${renderSyncFile(blog, post).hash}"`),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(204);
    // The sync.delete_file audit is folded into the delete's transaction (the
    // 4th arg), so no separate best-effort recordAction is issued.
    expect(mocks.deletePostAtomic).toHaveBeenCalledWith(
      blog.handle,
      postId,
      post.revision,
      expect.objectContaining({
        actionName: "sync.delete_file",
        actorType: "external_agent",
        targetType: "item",
        targetId: postId,
      }),
    );
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("maps an atomic delete race to a stale-write response", async () => {
    mocks.deletePostAtomic.mockRejectedValue(new mocks.PostConflictError());
    const response = await DELETE(
      mutationRequest("DELETE", `"${renderSyncFile(blog, post).hash}"`),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(412);
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
});
