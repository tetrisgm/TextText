import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { serializeTemplateLook } from "@/lib/presentation/template-library";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getDocumentTemplate: vi.fn(),
  getDocumentTemplateAuthoringSource: vi.fn(),
  getFolderByPath: vi.fn(),
  getFolderPosts: vi.fn(),
  listDocumentTemplateLibrary: vi.fn(),
  duplicateDocumentTemplate: vi.fn(),
  importDocumentTemplate: vi.fn(),
  restoreDocumentTemplateVersion: vi.fn(),
  retireDocumentTemplate: vi.fn(),
  setFolderTemplate: vi.fn(),
  retemplateFolderItems: vi.fn(),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/store", () => ({
  getFolderByPath: mocks.getFolderByPath,
  getDocumentTemplate: mocks.getDocumentTemplate,
  getDocumentTemplateAuthoringSource: mocks.getDocumentTemplateAuthoringSource,
  getFolderPosts: mocks.getFolderPosts,
  listDocumentTemplateLibrary: mocks.listDocumentTemplateLibrary,
  duplicateDocumentTemplate: mocks.duplicateDocumentTemplate,
  importDocumentTemplate: mocks.importDocumentTemplate,
  restoreDocumentTemplateVersion: mocks.restoreDocumentTemplateVersion,
  retireDocumentTemplate: mocks.retireDocumentTemplate,
  setFolderTemplate: mocks.setFolderTemplate,
  retemplateFolderItems: mocks.retemplateFolderItems,
}));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import {
  duplicateFolderLookAction,
  exportTemplateLookAction,
  setFolderLookAction,
  getFolderLookAction,
  importFolderLookAction,
  restoreFolderLookVersionAction,
  retireFolderLookAction,
} from "@/app/editor/folder-template-actions";

const article = requireBuiltinTemplate("texttext.article", 1);

describe("folder look lifecycle actions", () => {
  it.each([undefined, null, false, "true"])("keeps existing documents when folder migration is not explicitly true (%s)", async (apply) => {
    mocks.getFolderByPath.mockResolvedValue({ id: "folder-id", path: "notes" });
    const result = await setFolderLookAction("shoku", "notes", article.id, 1, apply);
    expect(result).toEqual({ ok: true, changed: 0, beingEdited: 0, itemsLeft: 0 });
    expect(mocks.setFolderTemplate).toHaveBeenCalledWith("shoku", "folder-id", { id: article.id, version: 1 });
    expect(mocks.retemplateFolderItems).not.toHaveBeenCalled();
  });
  it("exports only an authorized exact version", async () => {
    mocks.getDocumentTemplate.mockResolvedValue(article);
    mocks.getDocumentTemplateAuthoringSource.mockResolvedValue(null);
    expect(await exportTemplateLookAction("shoku", article.id, 1)).toBe(serializeTemplateLook(article));
    expect(mocks.getDocumentTemplateAuthoringSource).toHaveBeenCalledWith("blog-id", article.id, 1);
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false });
    await expect(exportTemplateLookAction("shoku", article.id, 1)).rejects.toThrow("Only the workspace owner");
  });
  it("retires only an owner's custom type with an audit and no document mutation", async () => {
    mocks.retireDocumentTemplate.mockResolvedValue(true);
    expect(await retireFolderLookAction("shoku", "book-review")).toEqual({ ok: true });
    expect(mocks.retireDocumentTemplate).toHaveBeenCalledWith("blog-id", "book-review", {
      audit: expect.objectContaining({ actorUserId: "owner-id", actionName: "retire_document_template", targetId: "book-review" }),
    });
    expect(mocks.retemplateFolderItems).not.toHaveBeenCalled();
    expect(mocks.setFolderTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidateBlogPaths).toHaveBeenCalledWith({ handle: "shoku" });
  });
  it("rejects retirement for nonowners, built-ins and unavailable types", async () => {
    expect((await retireFolderLookAction("shoku", "texttext.note")).ok).toBe(false);
    expect(mocks.retireDocumentTemplate).not.toHaveBeenCalled();
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false });
    expect((await retireFolderLookAction("shoku", "book-review")).ok).toBe(false);
    expect(mocks.retireDocumentTemplate).not.toHaveBeenCalled();
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: true, blogId: "blog-id", ownerId: "owner-id" });
    mocks.retireDocumentTemplate.mockResolvedValue(false);
    expect((await retireFolderLookAction("shoku", "missing")).ok).toBe(false);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-id",
      ownerId: "owner-id",
    });
    mocks.getFolderByPath.mockResolvedValue({
      id: "folder-id",
      path: "blog",
      defaultTemplate: { id: article.id, version: article.version },
    });
    mocks.getFolderPosts.mockResolvedValue([{ id: "one" }, { id: "two" }]);
    mocks.listDocumentTemplateLibrary.mockResolvedValue([
      {
        definition: article,
        scope: "texttext",
        createdAt: null,
        versions: [{ definition: article, createdAt: null }],
        impact: { itemCount: 0, folderCount: 0, folderNames: [] },
      },
    ]);
    mocks.duplicateDocumentTemplate.mockResolvedValue({
      ...article,
      id: "article-remix-123",
      name: "Article remix",
    });
    mocks.importDocumentTemplate.mockResolvedValue({
      ...article,
      id: "article-import-123",
    });
    mocks.restoreDocumentTemplateVersion.mockResolvedValue({
      ...article,
      id: "article-remix-123",
      version: 4,
    });
  });

  it("returns lifecycle metadata without fetching folder document bodies", async () => {
    const result = await getFolderLookAction("Writer", "blog");
    expect(result.allowed).toBe(true);
    expect(result.templates).toEqual([article]);
    expect(mocks.getFolderPosts).not.toHaveBeenCalled();
    expect(mocks.listDocumentTemplateLibrary).toHaveBeenCalledWith(
      "blog-id",
      "owner-id",
    );
  });

  it("duplicates a selected version as a new personal look", async () => {
    const result = await duplicateFolderLookAction(
      "Writer",
      article.id,
      article.version,
      "Article remix",
    );
    expect(result).toMatchObject({ ok: true });
    expect(mocks.duplicateDocumentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        blogId: "blog-id",
        reference: { id: article.id, version: article.version },
        name: "Article remix",
        createdById: "owner-id",
      }),
    );
  });

  it("imports validated look JSON in an explicit mode", async () => {
    const result = await importFolderLookAction(
      "Writer",
      serializeTemplateLook(article),
      "new",
    );
    expect(result).toMatchObject({ ok: true });
    expect(mocks.importDocumentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "new", definition: article }),
    );
  });

  it("rejects malformed imports before the store", async () => {
    const result = await importFolderLookAction("Writer", "not json", "new");
    expect(result).toMatchObject({ ok: false, error: "That file is not valid JSON." });
    expect(mocks.importDocumentTemplate).not.toHaveBeenCalled();
  });

  it("restores history by creating a new immutable version", async () => {
    const result = await restoreFolderLookVersionAction(
      "Writer",
      "article-remix-123",
      2,
    );
    expect(result).toMatchObject({ ok: true, definition: { version: 4 } });
    expect(mocks.restoreDocumentTemplateVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: { id: "article-remix-123", version: 2 },
      }),
    );
  });

  it("refuses lifecycle mutations for non-owners", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false });
    const result = await duplicateFolderLookAction("writer", article.id, 1, "Copy");
    expect(result).toMatchObject({ ok: false });
    expect(mocks.duplicateDocumentTemplate).not.toHaveBeenCalled();
  });
});
