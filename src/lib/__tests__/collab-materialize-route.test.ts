import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  collabAccess: vi.fn(),
  hasActiveCoEditors: vi.fn(async () => true),
  getPostById: vi.fn(),
  getUserIdBySub: vi.fn(async () => "user-uuid"),
  savePostContentPatch: vi.fn(),
  getBlog: vi.fn(async () => null),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
  PostConflictError: class PostConflictError extends Error {},
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/collab", () => ({
  collabAccess: mocks.collabAccess,
  hasActiveCoEditors: mocks.hasActiveCoEditors,
}));
vi.mock("@/lib/store", () => ({
  getPostById: mocks.getPostById,
  getUserIdBySub: mocks.getUserIdBySub,
  savePostContentPatch: mocks.savePostContentPatch,
  getBlog: mocks.getBlog,
  PostConflictError: mocks.PostConflictError,
}));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import { POST } from "@/app/api/collab/[postId]/materialize/route";

const POST_ID = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";

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
    mocks.hasActiveCoEditors.mockResolvedValue(true);
    mocks.getPostById.mockResolvedValue({
      id: POST_ID,
      slug: "draft",
      title: "Draft",
      body: "Old body",
      revision: 12,
    });
    mocks.savePostContentPatch.mockResolvedValue({ id: POST_ID, body: "New body" });
  });

  it("refuses a viewer (or no access)", async () => {
    mocks.collabAccess.mockResolvedValue("viewer");
    const res = await POST(req({ handle: "demo-blog", body: "New body" }), ctx);
    expect(res.status).toBe(403);
    expect(mocks.savePostContentPatch).not.toHaveBeenCalled();
  });

  it("materializes a changed body for an editor", async () => {
    const res = await POST(req({ handle: "demo-blog", body: "New body" }), ctx);
    expect(res.status).toBe(200);
    // Revision-CAS'd against the revision we read, like every other body write.
    expect(mocks.savePostContentPatch).toHaveBeenCalledWith(
      "demo-blog",
      expect.objectContaining({ id: POST_ID }),
      { body: "New body" },
      { expectedRevision: 12 },
    );
    // Every mutation writes an audit row.
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: "collab.materialize", targetId: POST_ID }),
    );
  });

  it("skips (does not clobber) when the revision was superseded mid-flight", async () => {
    // A boundary-timed external write or a co-editor autosave bumped the revision
    // between our read and our write: the guarded UPDATE matches nothing.
    mocks.savePostContentPatch.mockRejectedValue(new mocks.PostConflictError());
    const res = await POST(req({ handle: "demo-blog", body: "New body" }), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBe("superseded");
    // No audit for a write that did not land.
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("skips (does not clobber) when no live session is present", async () => {
    // A tab frozen past the presence window then closed: an external write may
    // have landed, so a stale-body flush must not overwrite it.
    mocks.hasActiveCoEditors.mockResolvedValue(false);
    const res = await POST(req({ handle: "demo-blog", body: "New body" }), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.skipped).toBeTruthy();
    expect(mocks.savePostContentPatch).not.toHaveBeenCalled();
  });

  it("no-ops when the canonical body already matches", async () => {
    const res = await POST(req({ handle: "demo-blog", body: "Old body" }), ctx);
    const json = await res.json();
    expect(json.unchanged).toBe(true);
    expect(mocks.savePostContentPatch).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("rejects a missing handle or body", async () => {
    expect((await POST(req({ body: "New body" }), ctx)).status).toBe(400);
    expect((await POST(req({ handle: "demo-blog" }), ctx)).status).toBe(400);
    expect(mocks.savePostContentPatch).not.toHaveBeenCalled();
  });

  it("404s when the post is not in the given handle", async () => {
    mocks.getPostById.mockResolvedValue(null);
    const res = await POST(req({ handle: "wrong-blog", body: "New body" }), ctx);
    expect(res.status).toBe(404);
    expect(mocks.savePostContentPatch).not.toHaveBeenCalled();
  });
});
