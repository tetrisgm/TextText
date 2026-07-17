import { describe, expect, it } from "vitest";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { starredPoolPosts } from "@/lib/pool/selectors";
import { STARRED_FOLDER_PATH } from "@/lib/workspace-paths";

describe("Starred workspace location", () => {
  it("lists personal stars across folders in most-recent order", () => {
    const pool = {
      posts: [
        {
          id: "note-1",
          blogId: "blog-1",
          folderId: "notes-folder",
          type: "note",
          slug: "note-1",
          title: "Note",
          status: "draft",
          starred: true,
          updatedAt: "2026-07-15T10:00:00.000Z",
        },
        {
          id: "article-1",
          blogId: "blog-1",
          folderId: "blog-folder",
          type: "article",
          slug: "article-1",
          title: "Article",
          status: "published",
          starred: true,
          updatedAt: "2026-07-16T10:00:00.000Z",
        },
        {
          id: "bookmark-1",
          blogId: "blog-1",
          folderId: "bookmark-folder",
          type: "bookmark",
          slug: "bookmark-1",
          title: "Bookmark",
          status: "draft",
          starred: false,
        },
      ],
    } satisfies Pick<WorkspacePoolPayload, "posts">;

    expect(STARRED_FOLDER_PATH).toBe("__starred__");
    expect(starredPoolPosts(pool).map((post) => post.id)).toEqual([
      "article-1",
      "note-1",
    ]);
    expect(starredPoolPosts(pool).every((post) => post.starred)).toBe(true);
  });
});
