import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  createWorkspaceItemType: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/presentation/item-type.server", () => ({
  createWorkspaceItemType: mocks.createWorkspaceItemType,
}));

import { createItemTypeAction } from "@/app/editor/item-type-actions";

const blueprint = {
  name: "Notes",
  fields: [],
  item: { shape: "note", showBody: true, showMetadata: true, showTags: false },
  collection: {
    layout: "list",
    columns: 1,
    summaryFields: [],
    sortBy: "updatedAt",
    sortDirection: "desc",
  },
  theme: {},
};

describe("createItemTypeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-id",
      ownerId: "owner-id",
    });
    mocks.createWorkspaceItemType.mockResolvedValue({
      definition: { id: "notes-123", version: 1, name: "Notes" },
      folder: { id: "folder-id", path: "notes", restyledItems: 7 },
    });
  });

  it("saves through the shared mutation path and applies the destination folder", async () => {
    const result = await createItemTypeAction("Writer", blueprint, "notes", true);
    expect(result).toEqual({
      ok: true,
      itemType: { id: "notes-123", version: 1, name: "Notes" },
      folder: { path: "notes", restyledItems: 7 },
    });
    expect(mocks.createWorkspaceItemType).toHaveBeenCalledWith(
      expect.objectContaining({
        applyToExisting: true,
        blogId: "blog-id",
        createdById: "owner-id",
        folderPath: "notes",
        handle: "writer",
      }),
    );
  });

  it("refuses non-owners before mutation", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: false,
      blogId: "blog-id",
      ownerId: "other-id",
    });
    const result = await createItemTypeAction("writer", blueprint, "notes", true);
    expect(result).toMatchObject({ ok: false });
    expect(mocks.createWorkspaceItemType).not.toHaveBeenCalled();
  });

  it("rejects malformed blueprints before mutation", async () => {
    const result = await createItemTypeAction("writer", { name: "Broken" }, "", true);
    expect(result).toMatchObject({ ok: false });
    expect(mocks.createWorkspaceItemType).not.toHaveBeenCalled();
  });
});
