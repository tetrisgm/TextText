// Demo-mode coverage for the folder plumbing in store.ts: the DB-free paths
// only. DATABASE_URL is cleared before store.ts loads (dynamic imports below;
// a static import would hoist above the delete) so db/client resolves to the
// null client and the demo seed serves, even when the shell exports a real
// database URL.

import { describe, expect, it } from "vitest";

delete process.env.DATABASE_URL;

const { DEMO_BLOG, DEMO_POSTS } = await import("@/lib/demo");
const {
  ensureWorkspaceFolders,
  folderPathForPostType,
  getFolderCounts,
  getFolderPosts,
  getFolders,
} = await import("@/lib/store");

describe("folderPathForPostType", () => {
  it("maps blog kinds to blog and unlisted kinds to their folders", () => {
    expect(folderPathForPostType("article")).toBe("blog");
    expect(folderPathForPostType("project")).toBe("blog");
    expect(folderPathForPostType("talk")).toBe("blog");
    expect(folderPathForPostType("note")).toBe("notes");
    expect(folderPathForPostType("bookmark")).toBe("bookmarks");
  });
});

describe("ensureWorkspaceFolders (demo mode)", () => {
  it("returns the three system folders in position order", async () => {
    const folders = await ensureWorkspaceFolders("any-blog-id");
    expect(folders.map((f) => f.path)).toEqual(["blog", "notes", "bookmarks"]);
    expect(folders.map((f) => f.mode)).toEqual(["blog", "notes", "bookmarks"]);
    expect(folders.map((f) => f.position)).toEqual([0, 1, 2]);
    expect(folders.map((f) => f.name)).toEqual(["Blog", "Notes", "Bookmarks"]);
  });
});

describe("getFolders (demo mode)", () => {
  it("serves the three demo folders for the demo blog only", async () => {
    const folders = await getFolders(DEMO_BLOG.handle);
    expect(folders.map((f) => f.path)).toEqual(["blog", "notes", "bookmarks"]);
    expect(await getFolders("someone-else")).toEqual([]);
  });
});

describe("getFolderPosts (demo mode)", () => {
  it("scopes notes and bookmarks to their folders, always drafts", async () => {
    const notes = await getFolderPosts(DEMO_BLOG.handle, "notes");
    expect(notes.length).toBeGreaterThan(0);
    for (const post of notes) {
      expect(post.type).toBe("note");
      expect(post.status).toBe("draft");
    }

    const bookmarks = await getFolderPosts(DEMO_BLOG.handle, "bookmarks");
    expect(bookmarks.length).toBeGreaterThan(0);
    for (const post of bookmarks) {
      expect(post.type).toBe("bookmark");
      expect(post.status).toBe("draft");
      expect(post.links?.[0]?.href).toMatch(/^https?:\/\//);
    }
  });

  it("keeps the blog folder free of notes and bookmarks", async () => {
    const blogPosts = await getFolderPosts(DEMO_BLOG.handle, "blog");
    expect(blogPosts.length).toBeGreaterThan(0);
    for (const post of blogPosts) {
      expect(["article", "project", "talk"]).toContain(post.type);
    }
  });

  it("honors publishedOnly", async () => {
    const published = await getFolderPosts(DEMO_BLOG.handle, "blog", {
      publishedOnly: true,
    });
    for (const post of published) expect(post.status).toBe("published");
    // Notes are never published, so publishedOnly empties the folder.
    expect(
      await getFolderPosts(DEMO_BLOG.handle, "notes", { publishedOnly: true }),
    ).toEqual([]);
  });

  it("returns nothing for an unknown handle", async () => {
    expect(await getFolderPosts("someone-else", "blog")).toEqual([]);
  });
});

describe("getFolderCounts (demo mode)", () => {
  it("counts every demo post into exactly one folder", async () => {
    const counts = await getFolderCounts(DEMO_BLOG.handle);
    const expected: Record<string, number> = {};
    for (const post of DEMO_POSTS) {
      const path = folderPathForPostType(post.type);
      expected[path] = (expected[path] ?? 0) + 1;
    }
    expect(counts).toEqual(expected);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(DEMO_POSTS.length);
    expect(await getFolderCounts("someone-else")).toEqual({});
  });
});
