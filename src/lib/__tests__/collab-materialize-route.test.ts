import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  collabAccess: vi.fn(),
  colorForSub: vi.fn(() => "#112233"),
  CollabEpochConflictError: class CollabEpochConflictError extends Error {},
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
  CollabEpochConflictError: mocks.CollabEpochConflictError,
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

function streamedReq(byteCount: number) {
  const encoder = new TextEncoder();
  let remaining = byteCount;
  return new Request(`http://x/api/collab/${POST_ID}/materialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      pull(controller) {
        if (remaining === 0) {
          controller.close();
          return;
        }
        const size = Math.min(remaining, 64 * 1024);
        remaining -= size;
        controller.enqueue(encoder.encode("x".repeat(size)));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
const ctx = { params: Promise.resolve({ postId: POST_ID }) };

describe("POST /api/collab/[postId]/materialize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ sub: "editor-sub", userId: "user-uuid" });
    mocks.collabAccess.mockResolvedValue("editor");
    mocks.materializeCollabDocument.mockResolvedValue({
      ...BASE_DOCUMENT, content: { ...BASE_DOCUMENT.content, body: "New body" },
    });
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
    const res = await POST(req({ handle: "demo-blog", state: "encoded", epoch: 7 }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("materializes a changed body for an editor", async () => {
    const res = await POST(req({ handle: "demo-blog", state: "encoded", epoch: 7 }), ctx);
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
        expectedCollabEpoch: 7,
        audit: expect.objectContaining({
          actionName: "collab.materialize",
          targetId: POST_ID,
        }),
      }),
    );
    expect(mocks.materializeCollabDocument).toHaveBeenCalledWith(POST_ID, "encoded", 7);
  });

  it("rejects a save superseded between epoch validation and persistence", async () => {
    // A boundary-timed external write or a co-editor autosave bumped the revision
    // between our read and our texttext: the guarded UPDATE matches nothing.
    mocks.savePost.mockRejectedValue(new mocks.PostConflictError());
    const res = await POST(req({ handle: "demo-blog", state: "encoded", epoch: 7 }), ctx);
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.retired).toBe(true);
    expect(mocks.revalidateBlogPaths).not.toHaveBeenCalled();
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
    const res = await POST(req({ handle: "demo-blog", state: "encoded", epoch: 7 }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.savePost).toHaveBeenCalledWith(
      "demo-blog",
      expect.objectContaining({ document }),
      expect.any(Object),
    );
  });

  it("no-ops when the canonical body already matches", async () => {
    mocks.materializeCollabDocument.mockResolvedValue(BASE_DOCUMENT);
    const res = await POST(req({ handle: "demo-blog", state: "encoded", epoch: 7 }), ctx);
    const json = await res.json();
    expect(json.unchanged).toBe(true);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("rejects a missing handle or state", async () => {
    expect((await POST(req({ state: "encoded", epoch: 7 }), ctx)).status).toBe(400);
    expect((await POST(req({ handle: "demo-blog", epoch: 7 }), ctx)).status).toBe(400);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized materialization before loading the post", async () => {
    const request = req({ handle: "demo-blog", state: "encoded", epoch: 7 });
    request.headers.set("content-length", String(8 * 1024 * 1024 + 1));

    const response = await POST(request, ctx);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getPostById).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized materialization without Content-Length", async () => {
    const response = await POST(streamedReq(8 * 1024 * 1024 + 1), ctx);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getPostById).not.toHaveBeenCalled();
  });

  it("404s when the post is not in the given handle", async () => {
    mocks.getPostById.mockResolvedValue(null);
    const res = await POST(req({ handle: "wrong-blog", state: "encoded", epoch: 7 }), ctx);
    expect(res.status).toBe(404);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });
});


describe("materialization epoch boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ sub: "editor-sub", userId: "user-uuid" });
    mocks.collabAccess.mockResolvedValue("editor");
    mocks.getPostById.mockResolvedValue({ id: POST_ID, document: BASE_DOCUMENT, revision: 12 });
  });

  it.each([undefined, null, -1, 1.5, "7", Number.MAX_SAFE_INTEGER + 1])(
    "rejects missing or invalid epoch %s before loading or merging", async (epoch) => {
      const response = await POST(req({ handle: "demo-blog", state: "encoded", epoch }), ctx);
      expect(response.status).toBe(409);
      expect(mocks.getPostById).not.toHaveBeenCalled();
      expect(mocks.materializeCollabDocument).not.toHaveBeenCalled();
      expect(mocks.savePost).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale epoch without saving, auditing or acknowledging", async () => {
    mocks.materializeCollabDocument.mockRejectedValue(new mocks.CollabEpochConflictError());
    const response = await POST(req({ handle: "demo-blog", state: "retired state", epoch: 6 }), ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ retired: true });
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.revalidateBlogPaths).not.toHaveBeenCalled();
  });

  it("does not use raw body as an unfenced fallback", async () => {
    expect((await POST(req({ handle: "demo-blog", body: "Retired" }), ctx)).status).toBe(409);
    expect((await POST(req({ handle: "demo-blog", body: "Retired", epoch: 7 }), ctx)).status).toBe(400);
    expect(mocks.materializeCollabDocument).not.toHaveBeenCalled();
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("does not acknowledge or fall back when state cannot be reconstructed", async () => {
    mocks.materializeCollabDocument.mockResolvedValue(null);
    const response = await POST(req({ handle: "demo-blog", state: "broken", epoch: 7 }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.savePost).not.toHaveBeenCalled();
  });
});
