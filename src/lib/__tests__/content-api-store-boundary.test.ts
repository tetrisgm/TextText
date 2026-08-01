import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getPostStoreContext: vi.fn(),
  resolveItemAccess: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({
  getPostStoreContext: mocks.getPostStoreContext,
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...original, resolveItemAccess: mocks.resolveItemAccess };
});

import { GET as getBody } from "@/app/api/post/[id]/body/route";
import { GET as getCaptureStatus } from "@/app/api/items/[id]/capture-status/route";

const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const context = { params: Promise.resolve({ id: postId }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "owner-sub" });
  mocks.resolveItemAccess.mockResolvedValue({ canView: true, isOwner: true });
  mocks.getPostStoreContext.mockResolvedValue({
    blogId: "blog-id",
    handle: "workspace",
    post: {
      id: postId,
      type: "bookmark",
      slug: "saved-link",
      title: "Saved link",
      body: "Private body",
      status: "draft",
      captureStatus: "captured",
      capture: { url: "https://example.com" },
      cover: "https://example.com/cover.jpg",
      updatedAt: "2026-07-17T10:00:00.000Z",
      wordCount: 2,
    },
  });
});

describe("content API store boundary", () => {
  it("loads an owner body through the content store", async () => {
    const response = await getBody(
      new Request(`https://texttext.example/api/post/${postId}/body`),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.getPostStoreContext).toHaveBeenCalledWith(postId);
    await expect(response.json()).resolves.toMatchObject({
      blogId: "blog-id",
      postId,
      body: "Private body",
      updatedAt: "2026-07-17T10:00:00.000Z",
    });
  });

  it("loads visible bookmark capture state through the content store", async () => {
    const response = await getCaptureStatus(
      new Request(`https://texttext.example/api/items/${postId}/capture-status`),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.getPostStoreContext).toHaveBeenCalledWith(postId);
    await expect(response.json()).resolves.toMatchObject({
      captureStatus: "captured",
      capture: { url: "https://example.com" },
      wordCount: 2,
    });
  });
});
