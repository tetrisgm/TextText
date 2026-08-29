import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDocumentTemplateVersion: vi.fn(),
  getDocumentTemplateAuthoringSource: vi.fn(),
  getFolderByPath: vi.fn(),
  listFoldersUsingTemplate: vi.fn(),
  retemplateFolderItems: vi.fn(),
  setFolderTemplate: vi.fn(),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  createDocumentTemplateVersion: mocks.createDocumentTemplateVersion,
  getDocumentTemplateAuthoringSource: mocks.getDocumentTemplateAuthoringSource,
  getFolderByPath: mocks.getFolderByPath,
  listFoldersUsingTemplate: mocks.listFoldersUsingTemplate,
  retemplateFolderItems: mocks.retemplateFolderItems,
  setFolderTemplate: mocks.setFolderTemplate,
}));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import { updateWorkspaceItemType } from "@/lib/presentation/item-type.server";

const BLUEPRINT = {
  name: "Recipes",
  fields: [{ id: "cookTime", label: "Cook time", type: "number" as const }],
  collection: { layout: "cards" as const },
};

const actor = { userId: "u-1", sub: "sub-1", actorLabel: "test" } as never;

function call(overrides: Record<string, unknown> = {}) {
  return updateWorkspaceItemType({
    actor,
    baseVersion: 3,
    blogId: "blog-1",
    blueprint: BLUEPRINT,
    handle: "shoku",
    templateId: "recipes-a1b2c3",
    ...overrides,
  } as never);
}

describe("changing an item type that already exists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 3,
      source: null,
    });
    mocks.createDocumentTemplateVersion.mockImplementation(
      async ({ definition }: { definition: { id: string } }) => ({
        ...definition,
        version: 4,
      }),
    );
    mocks.listFoldersUsingTemplate.mockResolvedValue([
      { id: "f-1", path: "recipes", version: 3 },
    ]);
    mocks.retemplateFolderItems.mockResolvedValue({ changed: 7, remaining: 0 });
  });

  it("adds a version rather than changing the one documents are pinned to", async () => {
    const result = await call();
    expect(result.definition.version).toBe(4);
    expect(result.previousVersion).toBe(3);
    // Same id: a new version of the same look, not a new look beside it.
    expect(result.definition.id).toBe("recipes-a1b2c3");
  });

  it("lands the new version where the look is already worn", async () => {
    // A new immutable version is invisible on its own, because folders and
    // documents pin exact ones. An edit nobody can see is not an edit.
    const result = await call();
    expect(mocks.setFolderTemplate).toHaveBeenCalledWith("shoku", "f-1", {
      id: "recipes-a1b2c3",
      version: 4,
    });
    expect(result.applied).toEqual([{ path: "recipes", restyledItems: 7 }]);
  });

  it("refuses an edit made against a version that has moved on", async () => {
    // Two people editing the same base would otherwise both succeed and the
    // second would silently win a race neither knew about.
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 5,
      source: null,
    });
    await expect(call({ baseVersion: 3 })).rejects.toThrow(/moved on.*version 3.*now at 5/s);
    expect(mocks.createDocumentTemplateVersion).not.toHaveBeenCalled();
  });

  it("refuses to change a built-in", async () => {
    await expect(call({ templateId: "texttext.article" })).rejects.toThrow(
      /Built-in looks cannot be changed/,
    );
    expect(mocks.createDocumentTemplateVersion).not.toHaveBeenCalled();
  });

  it("says so when the type does not exist", async () => {
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue(null);
    await expect(call()).rejects.toThrow(/could not be found/);
  });

  it("can create a version without moving anyone onto it", async () => {
    const result = await call({ apply: false });
    expect(result.definition.version).toBe(4);
    expect(mocks.setFolderTemplate).not.toHaveBeenCalled();
    expect(result.applied).toEqual([]);
  });

  it("can apply to the folder without restyling what is already in it", async () => {
    const result = await call({ applyToExisting: false });
    expect(mocks.setFolderTemplate).toHaveBeenCalled();
    expect(mocks.retemplateFolderItems).not.toHaveBeenCalled();
    expect(result.applied).toEqual([{ path: "recipes", restyledItems: 0 }]);
  });

  it("stores the blueprint that compiled, not the one that arrived", async () => {
    // A cards layout with no fields to summarise, so normalising changes it.
    await call({
      blueprint: { name: "Runs", fields: [], collection: { layout: "calendar" } },
    });
    const stored = mocks.createDocumentTemplateVersion.mock.calls[0][0];
    expect(stored.authoringSource.kind).toBe("item-type-blueprint");
    expect(stored.authoringSource.blueprint.collection.layout).not.toBe("calendar");
  });
});
