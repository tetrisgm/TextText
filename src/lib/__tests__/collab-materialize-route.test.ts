import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  collabAccess: vi.fn(),
  colorForSub: vi.fn(() => "#112233"),
  markCollabMaterialized: vi.fn(),
  materializeCollabDocument: vi.fn(),
  getPostById: vi.fn(),
  getUserIdBySub: vi.fn(async () => "user-uuid"),
  savePost: vi.fn(),
  getBlog: vi.fn(async () => null),
  revalidateBlogPaths: vi.fn(),
  PostConflictError: class PostConflictError extends Error {},
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/collab", () => ({
  collabAccess: mocks.collabAccess,
  colorForSub: mocks.colorForSub,
  markCollabMaterialized: mocks.markCollabMaterialized,
  materializeCollabDocument: mocks.materializeCollabDocument,
}));
vi.mock("@/lib/store", () => ({
  getPostById: mocks.getPostById,
  getUserIdBySub: mocks.getUserIdBySub,
  savePost: mocks.savePost,
  getBlog: mocks.getBlog,
  resolveDocumentCapability: vi.fn(),
  PostConflictError: mocks.PostConflictError,
}));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import { POST } from "@/app/api/collab/[postId]/materialize/route";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const POST_ID = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const emptyDocument = emptyDocumentSnapshot();
const BASE_DOCUMENT = {
  ...emptyDocument,
  content: {
    ...emptyDocument.content,
    title: "Draft",
    body: "Old body",
  },
};

function req(bodyObj: unknown) {
  return new Request(`http://x/api/collab/${POST_ID}/materialize`, {
    method: "POST",
    body: JSON.stringify(bodyObj),
  });
}
const ctx = { params: Promise.resolve({ postId: POST_ID }) };

describe("POST /api/collab/[postId]/materialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ sub: "editor-sub", userId: "user-uuid" });
    mocks.collabAccess.mockResolvedValue("editor");
    mocks.markCollabMaterialized.mockResolvedValue(undefined);
    mocks.materializeCollabDocument.mockResolvedValue(null);
    mocks.getPostById.mockResolvedValue({
      id: POST_ID,
      slug: "draft",
      type: "article",
      title: "Draft",
      body: "Old body",
      revision: 12,
      document: BASE_DOCUMENT,
    });
    mocks.savePost.mockImplementation(async (_handle, post) => ({
      ...post,
      revision: 13,
    }));
  });

  it("refuses a viewer (or no access)", async () => {
    mocks.collabAccess.mockResolvedValue("viewer");
    const res = await POST(req({ handle: "demo-blog", body: "New body" }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("materializes a changed body for an editor", async () => {
    const res = await POST(req({ handle: "demo-blog", body: "New body" }), ctx);
    expect(res.status).toBe(200);
    // Revision-CAS'd against the revision we read, like every other body write.
    expect(mocks.savePost).toHaveBeenCalledWith(
      "demo-blog",
      expect.objectContaining({
        id: POST_ID,
        document: expect.objectContaining({
          content: expect.objectContaining({ body: "New body" }),
        }),
      }),
      expect.objectContaining({
        preservePublishedAt: true,
        expectedRevision: 12,
        audit: expect.objectContaining({
          actionName: "collab.materialize",
          targetId: POST_ID,
        }),
      }),
    );
    expect(mocks.markCollabMaterialized).toHaveBeenCalledWith(POST_ID, 13);
  });

  it("skips (does not clobber) when the revision was superseded mid-flight", async () => {
    // A boundary-timed external write or a co-editor autosave bumped the revision
    // between our read and our texttext: the guarded UPDATE matches nothing.
    mocks.savePost.mockRejectedValue(new mocks.PostConflictError());
    const res = await POST(req({ handle: "demo-blog", body: "New body" }), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe("superseded");
    expect(mocks.markCollabMaterialized).not.toHaveBeenCalled();
  });

  it("materializes the complete collaborative document", async () => {
    const document = {
      schemaVersion: 1,
      content: {
        title: "Collaborative title",
        subtitle: "Shared subtitle",
        body: "Shared body",
        tags: [],
        fields: {},
        assets: [],
      },
      presentation: {
        template: { id: "texttext.article", version: 1 },
        theme: {},
      },
    };
    mocks.materializeCollabDocument.mockResolvedValue(document);
    const res = await POST(req({ handle: "demo-blog", state: "encoded" }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.savePost).toHaveBeenCalledWith(
      "demo-blog",
      expect.objectContaining({ document }),
      expect.any(Object),
    );
  });

  it("no-ops when the canonical body already matches", async () => {
    const res = await POST(req({ handle: "demo-blog", body: "Old body" }), ctx);
    const json = await res.json();
    expect(json.unchanged).toBe(true);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("rejects a missing handle or body", async () => {
    expect((await POST(req({ body: "New body" }), ctx)).status).toBe(400);
    expect((await POST(req({ handle: "demo-blog" }), ctx)).status).toBe(400);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("404s when the post is not in the given handle", async () => {
    mocks.getPostById.mockResolvedValue(null);
    const res = await POST(req({ handle: "wrong-blog", body: "New body" }), ctx);
    expect(res.status).toBe(404);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });
});
