import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/content";

// The pool-shell save (blog owner / workspace full member) writes posts.body
// directly and is external to any live Yjs co-editing session, so it is guarded
// exactly like the sync and MCP write paths: refused while editors are live,
// and it retires the orphaned log after a write no live session owns. The Yjs
// participant (an item-share collaborator) goes down the content-patch branch
// and is never guarded here.

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getBlogEditAccess: vi.fn(),
  getPostById: vi.fn(),
  getUserIdBySub: vi.fn(async () => "user-uuid"),
  savePost: vi.fn(),
  savePostContentPatch: vi.fn(),
  resolveItemAccess: vi.fn(),
  recordAction: vi.fn(),
  recordSlugChanged: vi.fn(),
  hasActiveCoEditors: vi.fn(async () => false),
  reconcileCollabLogAfterExternalWrite: vi.fn(async () => {}),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/auth", () => ({ isAuthConfigured: true }));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));

vi.mock("@/lib/blog-edit-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blog-edit-auth")>()),
  getBlogEditAccess: mocks.getBlogEditAccess,
}));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  getPostById: mocks.getPostById,
  getUserIdBySub: mocks.getUserIdBySub,
  savePost: mocks.savePost,
  savePostContentPatch: mocks.savePostContentPatch,
}));

vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  resolveItemAccess: mocks.resolveItemAccess,
}));

vi.mock("@/lib/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit")>()),
  recordAction: mocks.recordAction,
  recordSlugChanged: mocks.recordSlugChanged,
}));

vi.mock("@/lib/collab", () => ({
  hasActiveCoEditors: mocks.hasActiveCoEditors,
  reconcileCollabLogAfterExternalWrite:
    mocks.reconcileCollabLogAfterExternalWrite,
}));

vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

const { saveEditablePostAction } = await import("@/app/editor/actions");

const HANDLE = "test-blog";
const POST_ID = "11111111-1111-4111-8111-111111111111";

function existingPost(patch: Partial<Post> = {}): Post {
  return {
    id: POST_ID,
    type: "article",
    slug: "draft",
    title: "Draft",
    excerpt: "",
    body: "Before",
    status: "draft",
    revision: 7,
    ...patch,
  } as Post;
}

const input = {
  id: POST_ID,
  title: "Draft",
  body: "After",
  status: "draft",
  slug: "draft",
};

describe("saveEditablePostAction co-editing guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPostById.mockResolvedValue(existingPost());
    mocks.savePost.mockResolvedValue(existingPost({ body: "After", revision: 8 }));
    mocks.savePostContentPatch.mockResolvedValue(
      existingPost({ body: "After", revision: 8 }),
    );
  });

  it("refuses a pool-shell owner save while editors are live co-editing", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({
      canEdit: true,
      isOwner: true,
      blogId: "blog-uuid",
      ownerId: "owner-uuid",
    });
    mocks.hasActiveCoEditors.mockResolvedValue(true);

    await expect(
      saveEditablePostAction(HANDLE, input, { revalidate: false }),
    ).rejects.toThrow(/co-edited/i);
    // The blind overwrite never reached the store, and there was no write to
    // reconcile.
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.reconcileCollabLogAfterExternalWrite).not.toHaveBeenCalled();
  });

  it("saves and retires the stale log when no editors are live", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({
      canEdit: true,
      isOwner: true,
      blogId: "blog-uuid",
      ownerId: "owner-uuid",
    });
    mocks.hasActiveCoEditors.mockResolvedValue(false);

    const saved = await saveEditablePostAction(HANDLE, input, {
      revalidate: false,
    });

    expect(saved.body).toBe("After");
    expect(mocks.savePost).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileCollabLogAfterExternalWrite).toHaveBeenCalledWith(
      POST_ID,
    );
  });

  it("never guards the Yjs participant (item-share collaborator) branch", async () => {
    // Not a blog editor, but shares grant content edit: this is the live Yjs
    // shell, so it must be allowed to materialize even while co-editing.
    mocks.getBlogEditAccess.mockResolvedValue({
      canEdit: false,
      isOwner: false,
      blogId: "blog-uuid",
      ownerId: "owner-uuid",
    });
    mocks.getCurrentUser.mockResolvedValue({ sub: "collab-sub" });
    mocks.resolveItemAccess.mockResolvedValue({
      canEditContent: true,
      userId: "collab-user",
    });
    mocks.hasActiveCoEditors.mockResolvedValue(true);

    await saveEditablePostAction(HANDLE, input, { revalidate: false });

    // The participant writes through the content-patch path and is not blocked;
    // its own live log must not be reconciled away.
    expect(mocks.savePostContentPatch).toHaveBeenCalledTimes(1);
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.reconcileCollabLogAfterExternalWrite).not.toHaveBeenCalled();
  });
});
