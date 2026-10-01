import { afterEach, describe, expect, it, vi } from "vitest";
import { groupVaultCommentThreads, parseVaultCommentsPage, vaultCommentCapabilities, watchVaultComments, type VaultComment } from "./vault-comments";
import type { VaultAccess } from "./shared-vaults";

const rootId = "36f4bd35-6e4c-48dc-a482-0fb885258b6d";
const replyId = "f5b9f142-42cf-427f-9d51-39e1ab7e7b4e";
const comment: VaultComment = { id: rootId, parentId: null, body: "Please check this section.",
  authorUserId: "user-one", authorName: "Amira", authorActorType: "human",
  createdAt: "2026-09-30T19:00:00.000Z", updatedAt: "2026-09-30T19:00:00.000Z",
  resolvedAt: null, resolvedByUserId: null, resolvedByActorType: null };
const scoped: VaultAccess = { fullAccess: false, isOwner: false, canEditContent: false,
  canComment: false, canManageShares: false, grants: [
    { scopeType: "folder", scopeKey: "Shared", role: "commenter" },
    { scopeType: "item", scopeKey: "editor-item", role: "editor" },
  ] };

describe("file-vault comments presentation", () => {
  it("parses the bounded page and groups replies under their root", () => {
    const page = parseVaultCommentsPage({ comments: [comment, { ...comment, id: replyId, parentId: rootId,
      authorName: "Ramine", body: "Updated." }], nextCursor: null, revision: "revision" });
    expect(groupVaultCommentThreads(page.comments)).toEqual([{ root: comment, replies: [page.comments[1]] }]);
  });

  it("rejects malformed and oversized comment responses", () => {
    expect(() => parseVaultCommentsPage({ comments: [{ ...comment, body: "" }], nextCursor: null, revision: "revision" })).toThrow();
    expect(() => parseVaultCommentsPage({ comments: [comment], nextCursor: "not-a-uuid", revision: "revision" })).toThrow();
    expect(() => parseVaultCommentsPage({ comments: Array(101).fill(comment), nextCursor: null, revision: "revision" })).toThrow();
  });

  it("uses item and folder grants without granting sibling access", () => {
    expect(vaultCommentCapabilities(scoped, "reader-item", "Shared/Note.textpack"))
      .toEqual({ canComment: true, canResolve: false });
    expect(vaultCommentCapabilities(scoped, "reader-item", "SharedMore/Note.textpack"))
      .toEqual({ canComment: false, canResolve: false });
    expect(vaultCommentCapabilities(scoped, "editor-item", "Other/Note.textpack"))
      .toEqual({ canComment: true, canResolve: true });
    expect(vaultCommentCapabilities({ ...scoped, fullAccess: true, canComment: true }, "any", "Other/Note.textpack"))
      .toEqual({ canComment: true, canResolve: false });
  });

  it("refreshes only while visible and idle, then removes timers and listeners", async () => {
    vi.useFakeTimers();
    const win = new EventTarget();
    const doc = new EventTarget();
    let visibility: DocumentVisibilityState = "hidden";
    let busy = false;
    Object.defineProperty(doc, "visibilityState", { get: () => visibility });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = watchVaultComments(win as unknown as Window, doc as unknown as Document, () => busy, refresh);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).not.toHaveBeenCalled();
    visibility = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    busy = true;
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    busy = false;
    win.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

afterEach(() => vi.useRealTimers());
