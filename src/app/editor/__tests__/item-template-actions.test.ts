import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getBlog: vi.fn(),
  getDocumentTemplate: vi.fn(),
  getPostById: vi.fn(),
  savePost: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({ getBlogEditAccess: mocks.getBlogEditAccess }));
vi.mock("@/lib/store", () => ({
  getBlog: mocks.getBlog,
  getDocumentTemplate: mocks.getDocumentTemplate,
  getPostById: mocks.getPostById,
  savePost: mocks.savePost,
}));
vi.mock("@/lib/revalidate-blog", () => ({ revalidateBlogPaths: mocks.revalidateBlogPaths }));

import { applyItemTemplateAction } from "@/app/editor/item-template-actions";

const document = {
  schemaVersion: 1,
  content: { title: "Saved source", body: "Source text", fields: {
    commentary: "My view", excerpts: [{ excerpt: "Quoted line", source: "https://example.com" }],
  }, tags: ["research"], assets: [] },
  presentation: { template: { id: "texttext.bookmark", version: 1 }, theme: {} },
};

describe("applyItemTemplateAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: true, blogId: "blog-1", ownerId: "owner-1" });
    mocks.getBlog.mockResolvedValue({ handle: "writer" });
    mocks.getDocumentTemplate.mockResolvedValue({ id: "research", version: 2 });
    mocks.getPostById.mockResolvedValue({ id: "post-1", revision: 7, slug: "saved-source", visibility: "private", status: "draft", document });
    mocks.savePost.mockImplementation(async (_handle, post) => {
      const saved = { ...post, revision: 8 };
      mocks.getPostById.mockResolvedValue(saved);
      return saved;
    });
  });

  it("changes only the selected look while retaining source and annotations", async () => {
    expect(await applyItemTemplateAction("writer", "post-1", "research", 2, 7)).toMatchObject({ ok: true, revision: 8, document: { content: document.content, presentation: { template: { id: "research", version: 2 } } } });
    expect(mocks.savePost).toHaveBeenCalledWith("writer", expect.objectContaining({
      visibility: "private", status: "draft",
      document: {
        ...document,
        presentation: { ...document.presentation, template: { id: "research", version: 2 } },
      },
    }), expect.objectContaining({ expectedRevision: 7, preservePublishedAt: true }));
    expect(mocks.revalidateBlogPaths).toHaveBeenCalled();
  });

  it("refuses a preview based on an older revision", async () => {
    const result = await applyItemTemplateAction("writer", "post-1", "research", 2, 6);
    expect(result).toMatchObject({ ok: false, code: "conflict", revision: 7 });
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous response without another mutation", async () => {
    const first = await applyItemTemplateAction("writer", "post-1", "research", 2, 7);
    const retry = await applyItemTemplateAction("writer", "post-1", "research", 2, 7);
    expect(retry).toEqual(first);
    expect(mocks.savePost).toHaveBeenCalledTimes(1);
  });

  it("does not claim a save whose authoritative readback differs", async () => {
    mocks.savePost.mockImplementationOnce(async (_handle, post) => post);
    expect(await applyItemTemplateAction("writer", "post-1", "research", 2, 7)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("refuses read-only access and never saves", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false });
    expect(await applyItemTemplateAction("writer", "post-1", "research", 2, 7)).toMatchObject({ ok: false });
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("keeps content unchanged when the saved look is missing", async () => {
    mocks.getDocumentTemplate.mockResolvedValue(null);
    expect(await applyItemTemplateAction("writer", "post-1", "research", 2, 7)).toMatchObject({ ok: false });
    expect(mocks.savePost).not.toHaveBeenCalled();
  });
});
