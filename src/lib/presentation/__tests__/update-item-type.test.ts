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
      retired: false,
      state: "authored",
      source: { kind: "item-type-blueprint", schemaVersion: 1, compilerVersion: 1, blueprint: BLUEPRINT },
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
    mocks.retemplateFolderItems.mockResolvedValue({ changed: 7, contested: 0, remaining: 0 });
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
    expect(result.applied).toEqual([
      { path: "recipes", restyledItems: 7, itemsLeft: 0, itemsBeingEdited: 0 },
    ]);
  });

  it("refuses an edit made against a version that has moved on", async () => {
    // Two people editing the same base would otherwise both succeed and the
    // second would silently win a race neither knew about.
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 5,
      retired: false,
      state: "authored",
      source: { kind: "item-type-blueprint", schemaVersion: 1, compilerVersion: 1, blueprint: BLUEPRINT },
    });
    await expect(call({ baseVersion: 3 })).rejects.toThrow(/moved on.*version 3.*now at 5/s);
    expect(mocks.createDocumentTemplateVersion).not.toHaveBeenCalled();
  });


  it("refuses a look that was never designed from a blueprint", async () => {
    // The source was fetched and never read, so an imported, duplicated or
    // saved-from-a-document look could be replaced wholesale by a blueprint
    // that had nothing to do with it, under the same id and name. The docs and
    // the tool description both said this was impossible.
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 3,
      retired: false,
      state: "assembled",
      source: null,
    });
    await expect(call()).rejects.toThrow(/not designed from a blueprint/);
    expect(mocks.createDocumentTemplateVersion).not.toHaveBeenCalled();
  });

  it("insists on the exact successor version rather than whatever is next", async () => {
    // Checking the version and then letting the insert pick its own number is
    // not compare-and-swap: two editors who both read 3 can both pass the
    // check, and the later insert lands on top of a version it never saw.
    await call({ baseVersion: 3 });
    expect(mocks.createDocumentTemplateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ expectedNextVersion: 4 }),
    );
  });

  it("leaves a folder deliberately pinned to an older version alone", async () => {
    // Sharing an id is not consent to be moved. Pinning is how a folder says
    // it wants the look it already has.
    mocks.listFoldersUsingTemplate.mockResolvedValue([
      { id: "f-1", path: "recipes", version: 3 },
      { id: "f-2", path: "archive/recipes", version: 1 },
    ]);
    const result = await call();
    expect(result.applied.map((entry) => entry.path)).toEqual(["recipes"]);
    expect(result.skipped).toEqual([{ path: "archive/recipes", pinnedTo: 1 }]);
    expect(mocks.setFolderTemplate).toHaveBeenCalledTimes(1);
  });

  it("reports the items left alone because someone was editing them", async () => {
    // The revision guard leaves a contested item with its old look rather than
    // overwriting what was being typed. Not saying so would be the same silent
    // half-finish in a different disguise.
    mocks.retemplateFolderItems.mockResolvedValue({
      changed: 4,
      contested: 2,
      remaining: 0,
    });
    const result = await call();
    expect(result.applied[0].itemsBeingEdited).toBe(2);
  });

  it("reports the items a restyling pass did not reach", async () => {
    // Restyling stops at a bounded number per pass. Reporting only what
    // changed turns a half-finished folder into a finished one.
    // 497 changed and 3 contested is 500 attempted, which is the page. The
    // earlier fixture said 500 changed AND 3 contested, describing 503 items
    // in a 500-item pass: a number that cannot happen, asserted as if it had.
    mocks.retemplateFolderItems.mockResolvedValue({ changed: 497, contested: 3, remaining: 215 });
    const result = await call();
    expect(result.applied).toEqual([
      { path: "recipes", restyledItems: 497, itemsLeft: 215, itemsBeingEdited: 3 },
    ]);
  });

  it("says the compiler moved on rather than calling a designed look assembled", async () => {
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 3,
      retired: false,
      state: "needs-migration",
      source: null,
    });
    await expect(call()).rejects.toThrow(/older version of the designer/);
  });

  it("leaves a retired look retired instead of putting it back", async () => {
    // Editing one would create a fresh unretired version and return it to the
    // pickers, which is not what "change this" means and not what retiring it
    // meant either.
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue({
      version: 3,
      retired: true,
      state: "authored",
      source: { kind: "item-type-blueprint", schemaVersion: 1, compilerVersion: 1, blueprint: BLUEPRINT },
    });
    await expect(call()).rejects.toThrow(/retired/);
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
    expect(result.applied).toEqual([
      { path: "recipes", restyledItems: 0, itemsLeft: 0, itemsBeingEdited: 0 },
    ]);
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
