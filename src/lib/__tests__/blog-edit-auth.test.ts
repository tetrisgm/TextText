import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getBlogEditRecord: vi.fn(),
  getCurrentUser: vi.fn(),
  getUserIdBySub: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({
  getBlogEditRecord: mocks.getBlogEditRecord,
  getUnclaimedBlogEditRecordsByIds: vi.fn(),
  getUserIdBySub: mocks.getUserIdBySub,
}));

import { getBlogEditAccess } from "@/lib/blog-edit-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBlogEditRecord.mockResolvedValue({
    id: "workspace-id",
    handle: "workspace",
    name: "Workspace",
    ownerId: "owner-id",
    editTokenHash: null,
  });
});

describe("getBlogEditAccess", () => {
  it("recognizes an owner through the stable user id", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      sub: "google:linked-provider-subject",
      userId: "owner-id",
    });

    await expect(getBlogEditAccess("workspace")).resolves.toMatchObject({
      canEdit: true,
      isOwner: true,
      ownerId: "owner-id",
    });
    expect(mocks.getUserIdBySub).not.toHaveBeenCalled();
  });

  it("resolves the stable user id for a session minted before userId claims", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      sub: "linked-provider-subject",
    });
    mocks.getUserIdBySub.mockResolvedValue("owner-id");

    await expect(getBlogEditAccess("workspace")).resolves.toMatchObject({
      canEdit: true,
      isOwner: true,
    });
    expect(mocks.getUserIdBySub).toHaveBeenCalledWith(
      "linked-provider-subject",
    );
  });

  it("does not grant ownership to a different stable user", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      sub: "different-provider-subject",
      userId: "different-user-id",
    });

    await expect(getBlogEditAccess("workspace")).resolves.toMatchObject({
      canEdit: false,
      isOwner: false,
    });
  });
});
