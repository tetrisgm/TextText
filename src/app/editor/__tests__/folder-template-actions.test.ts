import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { serializeTemplateLook } from "@/lib/presentation/template-library";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getFolderByPath: vi.fn(),
  getFolderPosts: vi.fn(),
  listDocumentTemplateLibrary: vi.fn(),
  duplicateDocumentTemplate: vi.fn(),
  importDocumentTemplate: vi.fn(),
  restoreDocumentTemplateVersion: vi.fn(),
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
  getFolderPosts: mocks.getFolderPosts,
  listDocumentTemplateLibrary: mocks.listDocumentTemplateLibrary,
  duplicateDocumentTemplate: mocks.duplicateDocumentTemplate,
  importDocumentTemplate: mocks.importDocumentTemplate,
  restoreDocumentTemplateVersion: mocks.restoreDocumentTemplateVersion,
  setFolderTemplate: mocks.setFolderTemplate,
  retemplateFolderItems: mocks.retemplateFolderItems,
}));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import {
  duplicateFolderLookAction,
  getFolderLookAction,
  importFolderLookAction,
  restoreFolderLookVersionAction,
} from "@/app/editor/folder-template-actions";

const article = requireBuiltinTemplate("texttext.article", 1);

describe("folder look lifecycle actions", () => {
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

  it("returns lifecycle metadata and the target impact", async () => {
    const result = await getFolderLookAction("Writer", "blog");
    expect(result.allowed).toBe(true);
    expect(result.templates).toEqual([article]);
    expect(result.targetItemCount).toBe(2);
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
