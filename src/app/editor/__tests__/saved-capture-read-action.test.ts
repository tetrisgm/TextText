import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getPostById: vi.fn(),
  resolveItemAccess: vi.fn(),
}));

vi.mock("@/auth", () => ({ isAuthConfigured: true }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", async (original) => ({
  ...(await original<typeof import("@/lib/permissions")>()),
  resolveItemAccess: mocks.resolveItemAccess,
}));
vi.mock("@/lib/store", async (original) => ({
  ...(await original<typeof import("@/lib/store")>()),
  getPostById: mocks.getPostById,
}));

import { getSavedCapturePostAction } from "../actions";

const itemId = "87b9fd02-4b19-48a1-86b4-d2315672ff43";

describe("saved capture exact read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ sub: "owner", userId: "owner-id" });
    mocks.resolveItemAccess.mockResolvedValue({ canView: true, blogId: "blog-id" });
    mocks.getPostById.mockResolvedValue({
      id: itemId,
      type: "note",
      slug: "editorial-proof-note",
      title: "Editorial proof note",
      body: "Saved text",
      status: "draft",
      visibility: "private",
      tags: [],
    });
  });

  it("returns the saved item's pool entry without loading the whole workspace", async () => {
    const saved = await getSavedCapturePostAction("visual-demo", itemId);
    expect(saved).toMatchObject({ id: itemId, blogId: "blog-id", title: "Editorial proof note" });
    expect(mocks.resolveItemAccess).toHaveBeenCalledWith({
      handle: "visual-demo",
      postId: itemId,
      user: { sub: "owner", userId: "owner-id" },
    });
    expect(mocks.getPostById).toHaveBeenCalledWith("visual-demo", itemId);
  });

  it("does not read an item outside the viewer's access", async () => {
    mocks.resolveItemAccess.mockResolvedValue({ canView: false, blogId: "blog-id" });
    expect(await getSavedCapturePostAction("visual-demo", itemId)).toBeNull();
    expect(mocks.getPostById).not.toHaveBeenCalled();
  });

  it("does not read without a signed-in viewer", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(getSavedCapturePostAction("visual-demo", itemId)).rejects.toThrow("Not signed in");
    expect(mocks.getPostById).not.toHaveBeenCalled();
  });
});
