import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  updateWorkspaceItemType: vi.fn(),
  createWorkspaceItemType: vi.fn(),
  getDocumentTemplateAuthoringSource: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/presentation/item-type.server", () => ({
  createWorkspaceItemType: mocks.createWorkspaceItemType,
  updateWorkspaceItemType: mocks.updateWorkspaceItemType,
}));
vi.mock("@/lib/store", () => ({
  getDocumentTemplateAuthoringSource: mocks.getDocumentTemplateAuthoringSource,
}));

import {
  readItemTypeForEditAction,
  updateItemTypeAction,
} from "@/app/editor/item-type-actions";

const blueprint = {
  name: "Recipes",
  fields: [{ id: "cookTime", label: "Cook time", type: "number" }],
  collection: { layout: "cards" },
};

describe("reopening a look from the studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-1",
      ownerId: "owner-1",
    });
  });

  it("hands back the blueprint and the version it was read at", async () => {
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 3,
      source: { kind: "item-type-blueprint", blueprint },
    });
    const result = await readItemTypeForEditAction("shoku", "recipes-a1b2c3");
    expect(result).toMatchObject({ ok: true, version: 3, blueprint });
  });

  it("says a look was assembled rather than designed instead of inventing one", async () => {
    // Built-ins, duplicates, imports, restores, and looks saved from a
    // document. Opening an editor that silently starts from nothing would
    // look like the look had been wiped.
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 2,
      source: null,
    });
    const result = await readItemTypeForEditAction("shoku", "saved-look-9");
    expect(result).toMatchObject({ ok: true, version: 2, blueprint: null });
  });

  it("refuses someone who does not own the workspace", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false });
    expect(await readItemTypeForEditAction("shoku", "recipes-a1b2c3")).toMatchObject({
      ok: false,
    });
    expect(
      await updateItemTypeAction("shoku", "recipes-a1b2c3", 3, blueprint, true),
    ).toMatchObject({ ok: false });
    expect(mocks.updateWorkspaceItemType).not.toHaveBeenCalled();
  });

  it("passes the base version through so a stale edit is refused server side", async () => {
    mocks.updateWorkspaceItemType.mockResolvedValue({
      definition: { id: "recipes-a1b2c3", version: 4, name: "Recipes" },
      previousVersion: 3,
      applied: [{ path: "recipes", restyledItems: 7 }],
    });
    const result = await updateItemTypeAction(
      "shoku",
      "recipes-a1b2c3",
      3,
      blueprint,
      true,
    );
    expect(mocks.updateWorkspaceItemType).toHaveBeenCalledWith(
      expect.objectContaining({ baseVersion: 3, templateId: "recipes-a1b2c3" }),
    );
    expect(result).toMatchObject({
      ok: true,
      itemType: { version: 4 },
      applied: [{ path: "recipes", restyledItems: 7 }],
    });
  });

  it("reports the reason rather than a generic failure", async () => {
    mocks.updateWorkspaceItemType.mockRejectedValue(
      new Error("That item type has moved on: you edited version 3 and it is now at 5."),
    );
    expect(
      await updateItemTypeAction("shoku", "recipes-a1b2c3", 3, blueprint, true),
    ).toMatchObject({ ok: false, error: expect.stringContaining("moved on") });
  });

  it("refuses a missing or nonsense base version", async () => {
    for (const bad of [0, -1, 1.5, "three", null]) {
      expect(
        await updateItemTypeAction("shoku", "recipes-a1b2c3", bad, blueprint, true),
      ).toMatchObject({ ok: false });
    }
    expect(mocks.updateWorkspaceItemType).not.toHaveBeenCalled();
  });
});
