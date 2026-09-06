import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemComment } from "@/lib/store";

const mocks = vi.hoisted(() => ({
  createItemComment: vi.fn(),
  resolveDocumentCapability: vi.fn(),
  getCurrentUser: vi.fn(),
  getPostById: vi.fn(),
  getUserIdBySub: vi.fn(),
  listItemComments: vi.fn(),
  markCapturePending: vi.fn(),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
  resolveItemAccess: vi.fn(),
  setItemCommentResolved: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "valid-test-capability" }) })) }));
vi.mock("@/auth", () => ({ isAuthConfigured: true }));

vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  resolveItemAccess: mocks.resolveItemAccess,
}));

vi.mock("@/lib/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit")>()),
  recordAction: mocks.recordAction,
}));

vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  createItemComment: mocks.createItemComment,
  resolveDocumentCapability: mocks.resolveDocumentCapability,
  getPostById: mocks.getPostById,
  getUserIdBySub: mocks.getUserIdBySub,
  listItemComments: mocks.listItemComments,
  markCapturePending: mocks.markCapturePending,
  setItemCommentResolved: mocks.setItemCommentResolved,
}));

const {
  addItemCommentAction,
  listItemCommentsAction,
  recaptureBookmarkAction,
  reopenItemCommentAction,
  replyItemCommentAction,
  resolveItemCommentAction,
} = await import("@/app/editor/actions");

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function storedComment(patch: Partial<ItemComment> = {}): ItemComment {
  return {
    id: COMMENT_ID,
    itemId: ITEM_ID,
    parentId: null,
    body: "Review this paragraph",
    anchor: null,
    author: { actorUserId: USER_ID, actorType: "human" },
    authorName: "Alex",
    editedBy: null,
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveDocumentCapability.mockResolvedValue(null);
  mocks.getCurrentUser.mockResolvedValue({
    sub: "apple-sub",
    userId: USER_ID,
    name: "Alex Writer",
    email: "alex@example.com",
  });
  mocks.resolveItemAccess.mockResolvedValue({
    role: "editor",
    canView: true,
    canComment: true,
    canEditContent: true,
    canManage: false,
    isOwner: false,
    userId: USER_ID,
    blogId: "blog-1",
    workspaceRole: null,
  });
  mocks.listItemComments.mockResolvedValue([storedComment()]);
  mocks.createItemComment.mockResolvedValue(storedComment());
  mocks.setItemCommentResolved.mockResolvedValue(
    storedComment({ resolved: true, resolvedAt: "2026-07-15T12:05:00.000Z" }),
  );
  mocks.getPostById.mockResolvedValue({
    id: ITEM_ID,
    type: "bookmark",
    slug: "source",
    title: "Source",
    body: "",
    links: [{ label: "Original", href: "https://example.com/source" }],
    status: "published",
    pinned: false,
  });
  mocks.markCapturePending.mockResolvedValue({
    id: ITEM_ID,
    type: "bookmark",
    slug: "source",
    title: "Source",
    body: "",
    links: [{ label: "Original", href: "https://example.com/source" }],
    status: "published",
    pinned: false,
    captureStatus: "pending",
  });
});

describe("item comment actions", () => {
  it("refuses a comment from someone who can only view", async () => {
    mocks.resolveItemAccess.mockResolvedValue({
      canView: true,
      canComment: false,
      canEditContent: false,
      canManage: false,
      isOwner: false,
      blogId: "blog-1",
      userId: "viewer-1",
    });
    await expect(
      addItemCommentAction("demo", "post-1", "I can only read this"),
    ).rejects.toThrow(/cannot comment/i);
    expect(mocks.createItemComment).not.toHaveBeenCalled();
  });
  it("requires an authenticated user before resolving item access", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(listItemCommentsAction("writer", ITEM_ID)).rejects.toThrow(
      "Sign in to use comments",
    );
    expect(mocks.resolveItemAccess).not.toHaveBeenCalled();
  });

  it("allows a commenter to add a comment and records a human audit row", async () => {
    mocks.resolveItemAccess.mockResolvedValue({
      role: "commenter",
      canView: true,
      canComment: true,
      canEditContent: false,
      canManage: false,
      isOwner: false,
      userId: USER_ID,
      blogId: "blog-1",
      workspaceRole: null,
    });

    const comments = await addItemCommentAction(
      "writer",
      ITEM_ID,
      "  Please verify this.  ",
    );

    expect(mocks.createItemComment).toHaveBeenCalledWith(
      { itemId: ITEM_ID, body: "Please verify this.", anchor: null },
      {
        actorUserId: USER_ID,
        actorType: "human",
        actorName: "Alex Writer",
      },
    );
    expect(mocks.recordAction).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      actorType: "human",
      actionName: "comment.add",
      targetType: "item",
      targetId: ITEM_ID,
      inputSummary: "Please verify this.",
    });
    expect(comments[0]).toMatchObject({
      id: COMMENT_ID,
      authorName: "Alex",
      resolved: false,
    });
  });

  it("adds a reply to an existing root and records its parent in the audit", async () => {
    mocks.listItemComments
      .mockResolvedValueOnce([storedComment()])
      .mockResolvedValueOnce([
        storedComment(),
        storedComment({
          id: "44444444-4444-4444-8444-444444444444",
          parentId: COMMENT_ID,
          body: "Confirmed",
        }),
      ]);

    const comments = await replyItemCommentAction(
      "writer",
      ITEM_ID,
      COMMENT_ID,
      " Confirmed ",
    );

    expect(mocks.createItemComment).toHaveBeenCalledWith(
      { itemId: ITEM_ID, parentId: COMMENT_ID, body: "Confirmed" },
      expect.objectContaining({
        actorUserId: USER_ID,
        actorType: "human",
      }),
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "comment.reply",
        targetId: ITEM_ID,
        inputSummary: `${COMMENT_ID}: Confirmed`,
      }),
    );
    expect(comments).toHaveLength(2);
  });

  it("rejects nested replies before mutating or auditing", async () => {
    mocks.listItemComments.mockResolvedValue([
      storedComment(),
      storedComment({
        id: "44444444-4444-4444-8444-444444444444",
        parentId: COMMENT_ID,
      }),
    ]);

    await expect(
      replyItemCommentAction(
        "writer",
        ITEM_ID,
        "44444444-4444-4444-8444-444444444444",
        "Nested reply",
      ),
    ).rejects.toThrow("Comment thread not found");
    expect(mocks.createItemComment).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("requires edit permission to resolve and audits the state change", async () => {
    mocks.resolveItemAccess.mockResolvedValueOnce({
      role: "viewer",
      canView: true,
      canEditContent: false,
      canManage: false,
      isOwner: false,
      userId: USER_ID,
      blogId: "blog-1",
      workspaceRole: null,
    });
    await expect(
      resolveItemCommentAction("writer", ITEM_ID, COMMENT_ID),
    ).rejects.toThrow("You cannot resolve comments on this item");
    expect(mocks.setItemCommentResolved).not.toHaveBeenCalled();

    mocks.listItemComments
      .mockResolvedValueOnce([storedComment()])
      .mockResolvedValueOnce([
        storedComment({
          resolved: true,
          resolvedAt: "2026-07-15T12:05:00.000Z",
        }),
      ]);
    const comments = await resolveItemCommentAction(
      "writer",
      ITEM_ID,
      COMMENT_ID,
    );
    expect(mocks.setItemCommentResolved).toHaveBeenCalledWith(
      ITEM_ID,
      COMMENT_ID,
      true,
      {
        actorUserId: USER_ID,
        actorType: "human",
        actorName: "Alex Writer",
      },
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "comment.resolve",
        targetId: ITEM_ID,
        inputSummary: COMMENT_ID,
      }),
    );
    expect(comments[0].resolved).toBe(true);
  });

  it("reopens a resolved root and audits the state change", async () => {
    mocks.listItemComments
      .mockResolvedValueOnce([
        storedComment({
          resolved: true,
          resolvedAt: "2026-07-15T12:05:00.000Z",
        }),
      ])
      .mockResolvedValueOnce([storedComment()]);

    const comments = await reopenItemCommentAction(
      "writer",
      ITEM_ID,
      COMMENT_ID,
    );

    expect(mocks.setItemCommentResolved).toHaveBeenCalledWith(
      ITEM_ID,
      COMMENT_ID,
      false,
      expect.objectContaining({ actorUserId: USER_ID, actorType: "human" }),
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "comment.reopen",
        targetId: ITEM_ID,
      }),
    );
    expect(comments[0].resolved).toBe(false);
  });

  it("marks an owner bookmark capture pending and audits recapture", async () => {
    mocks.resolveItemAccess.mockResolvedValue({
      role: "owner",
      canView: true,
      canEditContent: true,
      canManage: true,
      isOwner: true,
      userId: USER_ID,
      blogId: "blog-1",
      workspaceRole: null,
    });

    const bookmark = await recaptureBookmarkAction("writer", ITEM_ID);

    expect(mocks.markCapturePending).toHaveBeenCalledWith(
      "writer",
      ITEM_ID,
      "https://example.com/source",
    );
    expect(mocks.recordAction).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      actorType: "human",
      actionName: "recapture_bookmark",
      targetType: "item",
      targetId: ITEM_ID,
      inputSummary: "https://example.com/source",
    });
    expect(mocks.revalidateBlogPaths).toHaveBeenCalled();
    expect(bookmark.captureStatus).toBe("pending");
  });

  it("does not let a non-owner queue bookmark recapture", async () => {
    await expect(recaptureBookmarkAction("writer", ITEM_ID)).rejects.toThrow(
      "Only the owner can recapture bookmarks",
    );
    expect(mocks.markCapturePending).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
});

it("round7: signed-in capability-only commenter can use promised comment access", async () => {
  mocks.resolveItemAccess.mockResolvedValue({ canView: false, canComment: false, userId: USER_ID });
  mocks.resolveDocumentCapability.mockResolvedValue({ id: "cap", itemId: ITEM_ID, role: "commenter" });
  await expect(addItemCommentAction("writer", ITEM_ID, "Review from access link")).resolves.toHaveLength(1);
});


describe("capability comment permissions", () => {
  beforeEach(() => {
    mocks.resolveItemAccess.mockResolvedValue({ canView: false, canComment: false, canEditContent: false });
  });
  it("attributes capability comments and replies to the signed-in account and audits both", async () => {
    mocks.resolveDocumentCapability.mockResolvedValue({ itemId: ITEM_ID, role: "commenter" });
    await addItemCommentAction("writer", ITEM_ID, "From my account");
    await replyItemCommentAction("writer", ITEM_ID, COMMENT_ID, "And my reply");
    expect(mocks.createItemComment).toHaveBeenCalledTimes(2);
    for (const call of mocks.createItemComment.mock.calls) {
      expect(call[1]).toEqual({ actorUserId: USER_ID, actorType: "human", actorName: "Alex Writer" });
    }
    expect(mocks.recordAction.mock.calls.map(([entry]) => entry.actionName)).toEqual(["comment.add", "comment.reply"]);
  });
  it("lets capability viewers read threads but not add, reply or resolve", async () => {
    mocks.resolveDocumentCapability.mockResolvedValue({ itemId: ITEM_ID, role: "viewer" });
    await expect(listItemCommentsAction("writer", ITEM_ID)).resolves.toHaveLength(1);
    await expect(addItemCommentAction("writer", ITEM_ID, "No")).rejects.toThrow("You cannot comment");
    await expect(replyItemCommentAction("writer", ITEM_ID, COMMENT_ID, "No")).rejects.toThrow("You cannot comment");
    await expect(resolveItemCommentAction("writer", ITEM_ID, COMMENT_ID)).rejects.toThrow("You cannot resolve");
    expect(mocks.createItemComment).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
  it("reserves resolution for editors and audits capability editor resolution", async () => {
    mocks.resolveDocumentCapability.mockResolvedValue({ itemId: ITEM_ID, role: "commenter" });
    await expect(resolveItemCommentAction("writer", ITEM_ID, COMMENT_ID)).rejects.toThrow("You cannot resolve");
    mocks.resolveDocumentCapability.mockResolvedValue({ itemId: ITEM_ID, role: "editor" });
    await resolveItemCommentAction("writer", ITEM_ID, COMMENT_ID);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: USER_ID, actionName: "comment.resolve" }));
  });
  it.each([null, { itemId: "another-item", role: "editor" }])("fails closed for absent, revoked or mismatched capability %j", async (capability) => {
    mocks.resolveDocumentCapability.mockResolvedValue(capability);
    await expect(addItemCommentAction("writer", ITEM_ID, "No")).rejects.toThrow("You cannot view comments");
    expect(mocks.createItemComment).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
  it("does not downgrade named editors when a viewer capability is present", async () => {
    mocks.resolveItemAccess.mockResolvedValue({ canView: true, canComment: true, canEditContent: true, userId: USER_ID });
    mocks.resolveDocumentCapability.mockResolvedValue({ itemId: ITEM_ID, role: "viewer" });
    await expect(resolveItemCommentAction("writer", ITEM_ID, COMMENT_ID)).resolves.toHaveLength(1);
  });
  it("refuses anonymous capability holders with the page's sign-in message", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.resolveDocumentCapability.mockResolvedValue({ itemId: ITEM_ID, role: "editor" });
    await expect(addItemCommentAction("writer", ITEM_ID, "No")).rejects.toThrow("Sign in to use comments");
    expect(mocks.createItemComment).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
});
