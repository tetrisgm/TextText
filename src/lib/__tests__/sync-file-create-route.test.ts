import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blog, FileRepresentation, Post } from "@/lib/content";

const mocks = vi.hoisted(() => ({
  claimIdempotencyKey: vi.fn(),
  createDraft: vi.fn(),
  createDraftInFolder: vi.fn(),
  deletePost: vi.fn(),
  getPostById: vi.fn(),
  markCapturePending: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
  resolveIdempotencyKey: vi.fn(),
  savePost: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  resolveSyncWorkspace: vi.fn(),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  claimIdempotencyKey: mocks.claimIdempotencyKey,
  createDraft: mocks.createDraft,
  createDraftInFolder: mocks.createDraftInFolder,
  deletePost: mocks.deletePost,
  getPostById: mocks.getPostById,
  markCapturePending: mocks.markCapturePending,
  releaseIdempotencyKey: mocks.releaseIdempotencyKey,
  resolveIdempotencyKey: mocks.resolveIdempotencyKey,
  savePost: mocks.savePost,
}));

vi.mock("@/lib/permissions", () => ({
  resolveWorkspaceAccess: mocks.resolveWorkspaceAccess,
}));

vi.mock("@/app/api/sync/v1/auth", () => ({
  resolveSyncWorkspace: mocks.resolveSyncWorkspace,
}));

vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import { POST } from "@/app/api/sync/v1/files/route";

const blog: Blog = {
  handle: "sync-test",
  name: "Sync test",
  author: "Owner",
  cardStyle: "cover",
  homeLayout: "grid",
};

function draft(
  representation: FileRepresentation,
  type: Post["type"] = "article",
): Post {
  return {
    id: "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60",
    representation,
    type,
    slug: "untitled-sync",
    title: "",
    body: "",
    status: "draft",
    revision: 1,
  };
}

function createRequest(
  representation?: string,
  folderId?: string,
): Request {
  const headers = new Headers({ "Content-Type": "text/markdown" });
  if (representation !== undefined) {
    headers.set("Write-File-Representation", representation);
  }
  const suffix = folderId ? `?folder=${folderId}` : "";
  return new Request(`https://write.example/api/sync/v1/files${suffix}`, {
    method: "POST",
    headers,
    body: "---\ntitle: Imported\n---\n\nBody\n",
  });
}

describe("sync file POST representation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSyncWorkspace.mockResolvedValue({
      blog,
      userId: "owner-id",
    });
    mocks.resolveWorkspaceAccess.mockResolvedValue({ isOwner: true });
    mocks.createDraft.mockImplementation(
      (_handle: string, type: Post["type"], options: { representation: FileRepresentation }) =>
        Promise.resolve(draft(options.representation, type)),
    );
    mocks.createDraftInFolder.mockImplementation(
      (
        _handle: string,
        _folderId: string,
        options: { representation: FileRepresentation },
      ) => Promise.resolve(draft(options.representation, "note")),
    );
    mocks.savePost.mockImplementation((_handle: string, post: Post) =>
      Promise.resolve({ ...post, revision: 2 }),
    );
  });

  it("keeps a headerless legacy create as markdown", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(201);
    expect(mocks.createDraft).toHaveBeenCalledWith("sync-test", "article", {
      representation: "markdown",
    });
    await expect(response.json()).resolves.toMatchObject({
      item: {
        file: "posts/imported.md",
        representation: "markdown",
      },
    });
  });

  it("persists an explicit representation for folder-scoped creates", async () => {
    const response = await POST(createRequest("text", "notes-folder"));

    expect(response.status).toBe(201);
    expect(mocks.createDraftInFolder).toHaveBeenCalledWith(
      "sync-test",
      "notes-folder",
      { representation: "text" },
    );
    await expect(response.json()).resolves.toMatchObject({
      item: {
        file: "posts/imported.txt",
        kind: "note",
        representation: "text",
      },
    });
  });

  it("rejects an invalid representation before creating a placeholder", async () => {
    const response = await POST(createRequest("pdf"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "Write-File-Representation must be textbundle, markdown, or text",
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.createDraftInFolder).not.toHaveBeenCalled();
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
});
