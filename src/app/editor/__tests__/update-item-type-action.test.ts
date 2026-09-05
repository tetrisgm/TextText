import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  updateWorkspaceItemType: vi.fn(),
  createWorkspaceItemType: vi.fn(),
  getDocumentTemplateAuthoringSource: vi.fn(),
  listFoldersUsingTemplate: vi.fn(),
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
  listFoldersUsingTemplate: mocks.listFoldersUsingTemplate,
}));

import {
  readItemTypeForEditAction,
  readItemTypeUsagesAction,
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
      retired: false,
      state: "authored",
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
      retired: false,
      state: "assembled",
      source: null,
    });
    const result = await readItemTypeForEditAction("shoku", "saved-look-9");
    expect(result).toMatchObject({ ok: true, version: 2, blueprint: null, state: "assembled" });
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
  it.each([
    { mode: "version" },
    { mode: "folder", folderPath: "A" },
    { mode: "usages", folderPaths: ["A", "B"] },
  ])("passes the exact scope and full receipt through: %j", async (scope) => {
    const receipt = {
      applied: [{ path: "A", restyledItems: 1, itemsLeft: 3, itemsBeingEdited: 2 }],
      skipped: [{ path: "B", pinnedTo: 1 }], conflicted: [{ path: "C" }],
    };
    mocks.updateWorkspaceItemType.mockResolvedValue({ definition: { id: "recipes", version: 4, name: "Recipes" }, ...receipt });
    expect(await updateItemTypeAction("shoku", "recipes", 3, blueprint, false, scope)).toMatchObject({ ok: true, ...receipt });
    expect(mocks.updateWorkspaceItemType).toHaveBeenCalledWith(expect.objectContaining({ saveScope: scope, applyToExisting: false }));
  });

  it("does not widen an omitted scope to all folders", async () => {
    mocks.updateWorkspaceItemType.mockResolvedValue({ definition: { id: "recipes", version: 4, name: "Recipes" }, applied: [], skipped: [], conflicted: [] });
    await updateItemTypeAction("shoku", "recipes", 3, blueprint, true);
    expect(mocks.updateWorkspaceItemType).toHaveBeenCalledWith(expect.objectContaining({ saveScope: { mode: "version" } }));
  });

  it("rejects malformed scopes without calling the mutation", async () => {
    expect(await updateItemTypeAction("shoku", "recipes", 3, blueprint, true, { mode: "folder" })).toMatchObject({ ok: false });
    expect(mocks.updateWorkspaceItemType).not.toHaveBeenCalled();
  });

  it("lists only workspace-owned usage paths for review", async () => {
    mocks.listFoldersUsingTemplate.mockResolvedValue([{ id: "a", path: "A", version: 3 }]);
    expect(await readItemTypeUsagesAction(" Shoku ", "recipes")).toEqual({ ok: true, usages: [{ path: "A", version: 3 }] });
    expect(mocks.listFoldersUsingTemplate).toHaveBeenCalledWith("blog-1", "recipes");
    mocks.listFoldersUsingTemplate.mockClear();
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false, blogId: "blog-1" });
    expect(await readItemTypeUsagesAction("shoku", "recipes")).toMatchObject({ ok: false });
    expect(mocks.listFoldersUsingTemplate).not.toHaveBeenCalled();
  });

});
