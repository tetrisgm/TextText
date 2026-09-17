import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The restore is the one place in the product that deliberately replaces a
 * document with an older one. It has to defend the same things every other
 * out-of-band writer defends, or it becomes the way text disappears.
 */

const { FakeConflict } = vi.hoisted(() => ({ FakeConflict: class FakeConflict extends Error {} }));

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getPostById: vi.fn(),
  savePost: vi.fn(),
  getBlog: vi.fn(),
  getUserIdBySub: vi.fn(),
  getCurrentUser: vi.fn(),
  applyLiveDocumentMutation: vi.fn(),
  materializeCollabDocument: vi.fn(),
  markCollabMaterialized: vi.fn(),
  getPostStoreContext: vi.fn(),
  savePostContentPatch: vi.fn(),
  getPostRevision: vi.fn(),
  listPostRevisions: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({ getBlogEditAccess: mocks.getBlogEditAccess }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/collab", () => ({
  applyLiveDocumentMutation: mocks.applyLiveDocumentMutation,
  materializeCollabDocument: mocks.materializeCollabDocument,
  markCollabMaterialized: mocks.markCollabMaterialized,
}));
vi.mock("@/lib/revalidate-blog", () => ({ revalidateBlogPaths: mocks.revalidateBlogPaths }));
vi.mock("@/lib/store", () => ({
  getPostById: mocks.getPostById,
  savePost: mocks.savePost,
  savePostContentPatch: mocks.savePostContentPatch,
  getPostStoreContext: mocks.getPostStoreContext,
  getBlog: mocks.getBlog,
  getUserIdBySub: mocks.getUserIdBySub,
  PostConflictError: FakeConflict,
}));
vi.mock("@/lib/revisions", () => ({
  getPostRevision: mocks.getPostRevision,
  listPostRevisions: mocks.listPostRevisions,
  MAX_LISTED_REVISIONS: 200,
}));

import { GET, POST } from "@/app/api/workspace/history/route";

const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const versionId = "1c5f7b63-9d2e-4f4b-8c8f-3e6f9b2d4a71";
const snapshot = {
  schemaVersion: 1,
  content: { title: "Older", body: "The older body", subtitle: undefined, tags: [], assets: [], fields: {} as Record<string, unknown> },
  presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
};
const post = { id: postId, slug: "note", revision: 42, document: snapshot };

function restoreRequest(body: object) {
  return new Request("https://texttext.example/api/workspace/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("workspace history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({ canEdit: true, blogId: "blog-id" });
    mocks.getPostById.mockResolvedValue(post);
    mocks.getCurrentUser.mockResolvedValue({ sub: "apple-sub" });
    mocks.getUserIdBySub.mockResolvedValue("user-id");
    mocks.applyLiveDocumentMutation.mockResolvedValue({ snapshot, auditRecorded: true, applied: true, epoch: 3, seq: 9 });
    mocks.materializeCollabDocument.mockResolvedValue(snapshot);
    mocks.getPostStoreContext.mockResolvedValue({ handle: "me", post: { ...post } });
    mocks.getPostRevision.mockResolvedValue({ id: versionId, document: snapshot, title: "Older", createdAt: "2026-09-16T10:00:00.000Z" });
    mocks.savePost.mockResolvedValue({ ...post, revision: 43 });
    mocks.getBlog.mockResolvedValue({ handle: "me" });
    mocks.listPostRevisions.mockResolvedValue([]);
  });

  it("answers a malformed item id with 404, not a database error", async () => {
    const response = await GET(new Request("https://texttext.example/api/workspace/history?handle=me&id=not-a-uuid"));
    expect(response.status).toBe(404);
    expect(mocks.getPostById).not.toHaveBeenCalled();
  });

  it("offers every version it keeps, not the first fifty", async () => {
    await GET(new Request(`https://texttext.example/api/workspace/history?handle=me&id=${postId}`));
    expect(mocks.listPostRevisions).toHaveBeenCalledWith(postId, 200);
  });

  it("puts the version into the live document, so an open tab receives it", async () => {
    // A raw write behind an open session's back is undone by its next
    // autosave, and the tab that asked for the restore is usually that session.
    const response = await POST(restoreRequest({ handle: "me", id: postId, versionId }));
    expect(response.status).toBe(200);
    expect(mocks.applyLiveDocumentMutation).toHaveBeenCalledWith(
      postId,
      expect.objectContaining({ body: "The older body", title: "Older" }),
      expect.objectContaining({ actionName: "restore_revision" }),
    );
  });

  it("clears a field the restored version does not have", async () => {
    mocks.getPostById.mockResolvedValue({
      ...post,
      document: { ...snapshot, content: { ...snapshot.content, fields: { sourceLabel: "The Paper" } } },
    });
    await POST(restoreRequest({ handle: "me", id: postId, versionId }));
    expect(mocks.applyLiveDocumentMutation.mock.calls[0][1].fields).toEqual({ sourceLabel: null });
  });

  it("guards the restore on the revision it was offered against", async () => {
    const response = await POST(restoreRequest({ handle: "me", id: postId, versionId }));
    expect(response.status).toBe(200);
    expect(mocks.savePost).toHaveBeenCalledWith("me", expect.any(Object), expect.objectContaining({ expectedRevision: 42 }));
    expect(mocks.markCollabMaterialized).toHaveBeenCalled();
  });

  it("answers a lost race with 409 rather than 500", async () => {
    mocks.savePost.mockRejectedValue(new FakeConflict());
    const response = await POST(restoreRequest({ handle: "me", id: postId, versionId }));
    expect(response.status).toBe(409);
  });
});
