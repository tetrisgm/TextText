import { describe, expect, it } from "vitest";
import {
  createOptimisticWorkspacePost,
  createWorkspaceItemIdentityRegistry,
  mergeCreatedWorkspacePost,
  nextWorkspacePostAfterDelete,
  shouldAutofocusWorkspacePostEditor,
  shouldOpenWorkspacePostInEdit,
} from "@/components/workspace/useLocalWorkspaceInteraction";
import { NO_COVER_VALUE } from "@/lib/cover";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";

function workspacePool(): WorkspacePoolPayload {
  return {
    version: 1,
    blogId: "blog-1",
    fetchedAt: "2026-07-14T12:00:00.000Z",
    blog: {
      handle: "local",
      name: "Local",
      author: "Writer",
      tagline: "",
      homeLayout: "grid",
    },
    folders: [
      { id: "blog", name: "Blog", path: "blog", mode: "blog", position: 0 },
      {
        id: "notes",
        name: "Notes",
        path: "notes",
        mode: "notes",
        position: 1,
      },
      {
        id: "bookmarks",
        name: "Bookmarks",
        path: "bookmarks",
        mode: "bookmarks",
        position: 2,
      },
    ],
    posts: [],
    counts: {},
    templates: [],
  };
}

function post(
  patch: Partial<WorkspacePoolPost> = {},
): WorkspacePoolPost {
  return {
    id: "post-1",
    blogId: "blog-1",
    type: "article",
    slug: "post-1",
    title: "Post",
    status: "draft",
    pinned: false,
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...patch,
  };
}

describe("local workspace optimistic creation", () => {
  it("returns distinct visible placeholders for creations in the same tick", () => {
    const pool = workspacePool();
    const now = Date.parse("2026-07-14T12:00:00.000Z");
    const first = createOptimisticWorkspacePost(
      pool,
      { type: "article", folderPath: "blog" },
      now,
    );
    const second = createOptimisticWorkspacePost(
      pool,
      { type: "article", folderPath: "blog" },
      now,
    );
    const bookmark = createOptimisticWorkspacePost(
      pool,
      {
        type: "bookmark",
        folderPath: "bookmarks",
        url: "example.com/story",
      },
      now,
    );
    const blankBookmark = createOptimisticWorkspacePost(
      pool,
      { type: "bookmark", folderPath: "bookmarks", blank: true },
      now,
    );

    expect(
      new Set([first.id, second.id, bookmark.id, blankBookmark.id]),
    ).toHaveLength(4);
    expect(first).toMatchObject({
      folderId: "blog",
      title: "",
      wordCount: 0,
    });
    expect(bookmark).toMatchObject({
      folderId: "bookmarks",
      captureStatus: "pending",
      capture: { url: "https://example.com/story" },
      title: "example.com",
    });
    expect(blankBookmark).toMatchObject({
      folderId: "bookmarks",
      type: "bookmark",
      title: "",
    });
    expect(blankBookmark.capture).toBeUndefined();
  });

  it("shows pasted content and the selected look before the server responds", () => {
    const optimistic = createOptimisticWorkspacePost(
      workspacePool(),
      {
        type: "article",
        folderPath: "blog",
        title: "A captured answer",
        body: "The answer body is available immediately.",
        template: { id: "texttext.project", version: 1 },
      },
      Date.parse("2026-07-14T12:00:00.000Z"),
    );

    expect(optimistic).toMatchObject({
      folderId: "blog",
      title: "A captured answer",
      template: { id: "texttext.project", version: 1 },
      wordCount: 6,
      document: {
        content: {
          title: "A captured answer",
          body: "The answer body is available immediately.",
        },
      },
    });
  });

  it("keeps the logical item and editor key stable across server identity", () => {
    const pool = workspacePool();
    const temporary = createOptimisticWorkspacePost(
      pool,
      { type: "note", folderPath: "notes" },
      Date.parse("2026-07-14T12:00:00.000Z"),
    );
    const saved = post({
      id: "saved-note",
      type: "note",
      folderId: "notes",
      title: "",
    });
    const identity = createWorkspaceItemIdentityRegistry();
    const keyBeforeSave = identity.stableKey(temporary.id);

    identity.reconcile(temporary.id, saved.id);
    const reconciledPool = { ...pool, posts: [saved] };

    expect(identity.resolvePost(reconciledPool, temporary.id)).toBe(saved);
    expect(identity.currentId(keyBeforeSave)).toBe(saved.id);
    expect(identity.stableKey(saved.id)).toBe(keyBeforeSave);
    expect(identity.stableKey(temporary.id)).toBe(keyBeforeSave);
  });

  it("adopts server identity without replacing the live local draft", () => {
    const saved = post({
      id: "saved-article",
      folderId: "blog",
      slug: "server-slug",
      title: "Untitled",
      excerpt: "Server excerpt",
      updatedAt: "2026-07-14T12:00:00.000Z",
    });
    const optimistic = post({
      id: "optimistic-article-1",
      slug: "untitled-local",
      title: "",
      excerpt: "",
      updatedAt: "2026-07-14T12:00:01.000Z",
    });

    expect(mergeCreatedWorkspacePost(saved, optimistic)).toMatchObject({
      id: "saved-article",
      folderId: "blog",
      slug: "server-slug",
      title: "",
      excerpt: "",
      updatedAt: "2026-07-14T12:00:01.000Z",
    });
  });
});

describe("local workspace direct edit routing", () => {
  it("opens notes and truly empty posts directly in edit", () => {
    expect(
      shouldOpenWorkspacePostInEdit(
        post({ type: "note", title: "Existing note", wordCount: 20 }),
        "Existing body",
      ),
    ).toBe(true);
    expect(
      shouldOpenWorkspacePostInEdit(
        post({
          title: "Untitled",
          excerpt: "",
          wordCount: 20,
          cover: NO_COVER_VALUE,
        }),
        "  \n",
      ),
    ).toBe(true);
    expect(
      shouldOpenWorkspacePostInEdit(
        post({ title: "", excerpt: "", wordCount: undefined }),
        "",
      ),
    ).toBe(true);
  });

  it("keeps posts with reader content and bookmarks in read mode", () => {
    expect(
      shouldOpenWorkspacePostInEdit(
        post({ title: "", excerpt: "", wordCount: 3 }),
        "Already written",
      ),
    ).toBe(false);
    expect(
      shouldOpenWorkspacePostInEdit(
        post({ title: "Untitled", cover: "https://example.com/cover.jpg" }),
        "",
      ),
    ).toBe(false);
    expect(
      shouldOpenWorkspacePostInEdit(
        post({ type: "bookmark", title: "" }),
        "",
      ),
    ).toBe(false);
  });

  it("never focuses an editor field just because an item opened", () => {
    expect(shouldAutofocusWorkspacePostEditor({ type: "note" })).toBe(false);
    expect(shouldAutofocusWorkspacePostEditor({ type: "article" })).toBe(false);
    expect(shouldAutofocusWorkspacePostEditor({ type: "bookmark" })).toBe(false);
  });
});

describe("local workspace optimistic deletion", () => {
  it("selects the following sibling before removing the current item", () => {
    const pool = workspacePool();
    pool.posts = [
      post({ id: "first", slug: "first", folderId: "blog" }),
      post({ id: "second", slug: "second", folderId: "blog" }),
      post({ id: "third", slug: "third", folderId: "blog" }),
    ];

    expect(nextWorkspacePostAfterDelete(pool, "second", "blog")?.id).toBe(
      "third",
    );
    expect(nextWorkspacePostAfterDelete(pool, "third", "blog")).toBeNull();
  });
});
