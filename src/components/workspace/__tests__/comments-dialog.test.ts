import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ItemCommentView } from "@/app/editor/actions";

vi.mock("@/app/editor/actions", () => ({
  addItemCommentAction: vi.fn(),
  listItemCommentsAction: vi.fn(),
  reopenItemCommentAction: vi.fn(),
  replyItemCommentAction: vi.fn(),
  resolveItemCommentAction: vi.fn(),
}));

vi.mock("@/components/keyboard/CommandLayer", () => ({
  useEscapeLayer: () => {},
}));

const { CommentsDialog, groupCommentThreads } = await import(
  "@/components/workspace/CommentsDialog"
);

function comment(
  id: string,
  patch: Partial<ItemCommentView> = {},
): ItemCommentView {
  return {
    id,
    parentId: null,
    body: `Comment ${id}`,
    authorName: "Taylor",
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    resolved: false,
    resolvedAt: null,
    anchor: null,
    ...patch,
  };
}

describe("comments dialog", () => {
  it("groups replies under their root in chronological order", () => {
    const threads = groupCommentThreads([
      comment("reply-2", {
        parentId: "root",
        createdAt: "2026-07-15T12:03:00.000Z",
      }),
      comment("resolved", {
        resolved: true,
        resolvedAt: "2026-07-15T12:04:00.000Z",
        createdAt: "2026-07-15T12:04:00.000Z",
      }),
      comment("root"),
      comment("reply-1", {
        parentId: "root",
        createdAt: "2026-07-15T12:02:00.000Z",
      }),
    ]);

    expect(threads.map((thread) => thread.root.id)).toEqual([
      "root",
      "resolved",
    ]);
    expect(threads[0].replies.map((reply) => reply.id)).toEqual([
      "reply-1",
      "reply-2",
    ]);
  });

  it("renders the Apple-style panel controls and composer", () => {
    const html = renderToStaticMarkup(
      React.createElement(CommentsDialog, {
        canResolve: true,
        handle: "writer",
        open: true,
        postId: "post-1",
        postTitle: "Draft title",
        onClose: () => {},
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Draft title");
    expect(html).toContain('aria-label="Comment status"');
    expect(html).toContain('aria-label="Add a comment"');
    expect(html).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"');
    expect(html).toContain(">Open <");
    expect(html).toContain(">Resolved <");
  });
});
