import { describe, expect, it } from "vitest";
import { DEMO_POSTS } from "@/lib/demo";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { legacyProjectionFromDocument } from "@/lib/documents/legacy";
import { resolveDocumentVisibility } from "@/lib/documents/visibility";
import {
  adjacentPublishedPostsForPool,
  poolPostsForFolder,
} from "@/lib/pool/selectors";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";

function post(
  id: string,
  folderId: string,
  visibility: WorkspacePoolPost["visibility"],
): WorkspacePoolPost {
  return {
    id,
    blogId: "blog-1",
    folderId,
    visibility,
    type: "article",
    slug: id,
    title: id,
    status: "published",
    pinned: false,
  };
}

function pool(posts: WorkspacePoolPost[]): WorkspacePoolPayload {
  return {
    version: 1,
    blogId: "blog-1",
    blog: {
      handle: "writer",
      name: "Writer",
      author: "Writer",
      tagline: "",
      cardStyle: "cover",
      homeLayout: "grid",
    },
    folders: [
      {
        id: "folder-blog",
        name: "Writing",
        path: "blog",
        mode: "blog",
        position: 0,
      },
      {
        id: "folder-nested",
        name: "Research",
        path: "blog/research",
        mode: "blog",
        position: 1,
      },
    ],
    counts: {},
    posts,
    trashedPosts: [],
    trashedFolders: [],
    sharedEntries: [],
    templates: [],
    initialBodies: [],
    fetchedAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("unified document boundaries", () => {
  it("keeps presentation out of compatibility type projection", () => {
    const document = emptyDocumentSnapshot({
      id: "workspace.custom-look",
      version: 7,
    });
    expect(legacyProjectionFromDocument(document)).not.toHaveProperty("type");
  });

  it("fails closed when visibility is missing", () => {
    expect(
      resolveDocumentVisibility({ compatibilityType: "article" }),
    ).toBe("private");
  });

  it("keeps notes and bookmarks private even when public is requested", () => {
    expect(
      resolveDocumentVisibility({
        requested: "public",
        compatibilityType: "note",
      }),
    ).toBe("private");
    expect(
      resolveDocumentVisibility({
        requested: "public",
        compatibilityType: "bookmark",
      }),
    ).toBe("private");
  });

  it("uses folder membership rather than presentation kind for containers", () => {
    const data = pool([
      post("root", "folder-blog", "private"),
      { ...post("nested", "folder-nested", "private"), type: "note" },
    ]);
    expect(poolPostsForFolder(data, "blog").map((item) => item.id)).toEqual([
      "root",
      "nested",
    ]);
  });

  it("only includes explicitly public documents in public adjacency", () => {
    const data = pool([
      post("legacy-status-only", "folder-blog", "private"),
      { ...post("public-draft", "folder-blog", "public"), status: "draft" },
      post("public", "folder-blog", "public"),
      { ...post("public-note", "folder-blog", "public"), type: "note" },
    ]);
    expect(adjacentPublishedPostsForPool(data, "public")).toEqual({
      previous: null,
      next: null,
    });
  });

  it("gives every demo document explicit fail-closed visibility", () => {
    expect(DEMO_POSTS.every((item) => item.visibility !== undefined)).toBe(true);
    expect(
      DEMO_POSTS.filter((item) => item.status === "published").every(
        (item) => item.visibility === "public",
      ),
    ).toBe(true);
    expect(
      DEMO_POSTS.filter(
        (item) => item.type === "note" || item.type === "bookmark",
      ).every((item) => item.visibility === "private"),
    ).toBe(true);
  });
});
