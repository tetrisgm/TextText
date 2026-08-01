import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emptyTrash: vi.fn(),
  deletePost: vi.fn(),
  getBlog: vi.fn(),
  getBlogEditAccess: vi.fn(),
  getPostById: vi.fn(),
  permanentlyDeleteFolder: vi.fn(),
  permanentlyDeletePost: vi.fn(),
  recordAction: vi.fn(),
  restoreFolder: vi.fn(),
  restorePost: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));
vi.mock("@/lib/store", () => ({
  deletePost: mocks.deletePost,
  emptyTrash: mocks.emptyTrash,
  getBlog: mocks.getBlog,
  getPostById: mocks.getPostById,
  permanentlyDeleteFolder: mocks.permanentlyDeleteFolder,
  permanentlyDeletePost: mocks.permanentlyDeletePost,
  restoreFolder: mocks.restoreFolder,
  restorePost: mocks.restorePost,
}));

import { POST } from "@/app/api/workspace/trash/route";

function request(body: unknown) {
  return new Request("https://TextText.app/api/workspace/trash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBlogEditAccess.mockResolvedValue({
    canEdit: true,
    isOwner: true,
    ownerId: "owner-1",
  });
  mocks.getBlog.mockResolvedValue({ handle: "space" });
});

describe("workspace Trash API", () => {
  it("empties Trash through a stable route and audits the mutation", async () => {
    mocks.emptyTrash.mockResolvedValue(46);

    const response = await POST(
      request({ operation: "empty", handle: "space" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, removed: 46 });
    expect(mocks.emptyTrash).toHaveBeenCalledWith("space");
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "empty_trash",
        inputSummary: "46 items",
      }),
    );
    expect(mocks.revalidateBlogPaths).toHaveBeenCalledWith({ handle: "space" });
  });

  it("supports every item and folder Trash operation", async () => {
    mocks.restorePost.mockResolvedValue({ title: "Restored" });
    const operations = [
      ["restore-post", mocks.restorePost],
      ["restore-folder", mocks.restoreFolder],
      ["delete-post", mocks.permanentlyDeletePost],
      ["delete-folder", mocks.permanentlyDeleteFolder],
    ] as const;

    for (const [operation, mutation] of operations) {
      const response = await POST(
        request({ operation, handle: "space", targetId: "target-1" }),
      );
      expect(response.status).toBe(200);
      expect(mutation).toHaveBeenCalledWith("space", "target-1");
    }
  });

  it("moves every selected item to Trash through one stable request", async () => {
    const posts = Array.from({ length: 4 }, (_, index) => ({
      id: `post-${index + 1}`,
      title: `Post ${index + 1}`,
    }));
    mocks.getPostById.mockImplementation(
      async (_handle: string, postId: string) =>
        posts.find((post) => post.id === postId) ?? null,
    );

    const response = await POST(
      request({
        operation: "trash-posts",
        handle: "space",
        targetIds: posts.map((post) => post.id),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, removed: 4 });
    expect(mocks.deletePost).toHaveBeenCalledTimes(4);
    expect(mocks.deletePost.mock.calls.map((call) => call[1])).toEqual(
      posts.map((post) => post.id),
    );
    expect(mocks.recordAction).toHaveBeenCalledTimes(4);
  });

  it("fails closed when the workspace is not editable", async () => {
    mocks.getBlogEditAccess.mockResolvedValueOnce({ canEdit: false });
    const response = await POST(
      request({ operation: "empty", handle: "space" }),
    );
    expect(response.status).toBe(404);
    expect(mocks.emptyTrash).not.toHaveBeenCalled();
  });
});
