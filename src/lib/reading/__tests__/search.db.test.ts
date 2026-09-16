import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Embedder } from "../embeddings.server";

// Against local Postgres only, opted in with TEXTTEXT_READING_DB_TEST=1
// (npm run test:reading:db). Scratch workspace, removed in afterAll.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

/**
 * A deterministic stand-in for a provider: a text maps to a unit vector in a
 * tiny concept space, so "semantic" neighbours are chosen by shared concepts
 * rather than shared words. This proves the retrieval path (index, store,
 * dot product in SQL, fusion) without a network or a key.
 */
const CONCEPTS = ["rollback", "deploy", "gpu", "driver", "oil", "market", "serre", "math"];
const SYNONYMS: Record<string, string> = { revert: "rollback", undo: "rollback", release: "deploy", graphics: "gpu", petroleum: "oil", crude: "oil", mathematician: "math", algebra: "math" };
const fakeEmbedder: Embedder = {
  model: "fake-concepts",
  dims: CONCEPTS.length,
  async embed(texts) {
    return texts.map((text) => {
      const words = text.toLowerCase().split(/[^a-z0-9]+/).map((word) => SYNONYMS[word] ?? word);
      const vector = CONCEPTS.map((concept) => words.filter((word) => word === concept).length);
      const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map((value) => value / length);
    });
  },
};

describe.skipIf(!enabled)("reading search against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let connections: typeof import("@/lib/reading/connections.server");
  let ingest: typeof import("@/lib/reading/ingest.server");
  let embeddings: typeof import("@/lib/reading/embeddings.server");
  let search: typeof import("@/lib/reading/search.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  const user = { sub: "", userId: "", email: "", name: "Search Test" };
  let sourceFolderPath = "";

  const feedUrl = "https://feeds.example/search/rss.xml";
  const feedBody = rss([
    entry("s-1", "Rollback explained", "https://s.example/1", "<p>How a deploy is reverted safely.</p>", "Mon, 01 Sep 2026 10:00:00 GMT"),
    entry("s-2", "Building a GPU driver", "https://s.example/2", "<p>Graphics work on a small machine.</p>", "Mon, 01 Sep 2026 10:01:00 GMT"),
    entry("s-3", "Oil market buffer", "https://s.example/3", "<p>Crude supply and demand.</p>", "Mon, 01 Sep 2026 10:02:00 GMT"),
    entry("s-4", "Serre at 100", "https://s.example/4", "<p>A mathematician's century.</p>", "Mon, 01 Sep 2026 10:03:00 GMT"),
  ]);
  const fetcher: typeof import("@/lib/reading/fetch.server").fetchFeedDocument = async (url) => {
    if (url !== feedUrl) return { kind: "error", reason: "not_found", status: 404, detail: "gone" };
    return { kind: "ok", status: 200, body: feedBody, contentType: "application/rss+xml", etag: '"v1"', lastModified: null, finalUrl: url };
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    connections = await import("@/lib/reading/connections.server");
    ingest = await import("@/lib/reading/ingest.server");
    embeddings = await import("@/lib/reading/embeddings.server");
    search = await import("@/lib/reading/search.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `search-test-${stamp}`;
    const [created] = await db
      .insert(schema.users)
      .values({ appleSub: `search-test-${stamp}`, username: handle, email: `${handle}@example.invalid`, name: "Search Test" })
      .returning({ id: schema.users.id });
    userId = created.id;
    user.sub = `search-test-${stamp}`;
    user.userId = userId;
    user.email = `${handle}@example.invalid`;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Search Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    const added = await connections.addFeedConnection({
      handle,
      parentFolderPath: "bookmarks",
      endpointUrl: feedUrl,
      actor: { userId, actorType: "human" },
      fetcher,
    });
    sourceFolderPath = added.folder.path;
    await ingest.pollFeedConnection(added.connection.id, { fetcher, initial: true });
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.readingJobs).where(eq(schema.readingJobs.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.feedConnections).where(eq(schema.feedConnections.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("SEARCH-01: lexical search works with no embeddings and says so", async () => {
    const report = await search.searchReading({ handle, user, query: "rollback", embedder: null });
    expect(report.semantic).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ title: "Rollback explained", match: "lexical", origin: "feed", permalink: "https://s.example/1" });
    expect(report.results[0].folderPath).toBe(sourceFolderPath);
    expect(report.results[0].snippet).toContain("reverted");
  });

  it("SEARCH-02: indexing is idempotent on text and stores unit vectors", async () => {
    const posts = await db!.select({ id: schema.posts.id }).from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    for (const post of posts) expect(await embeddings.indexPost(post.id, fakeEmbedder)).toBe("indexed");
    expect(await embeddings.indexPost(posts[0].id, fakeEmbedder)).toBe("unchanged");
    const rows = await db!.select().from(schema.readingEmbeddings).where(eq(schema.readingEmbeddings.blogId, blogId));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.dims).toBe(CONCEPTS.length);
      const length = Math.sqrt(row.vector.reduce((sum, value) => sum + value * value, 0));
      expect(length).toBeCloseTo(1, 5);
    }
  });

  it("SEARCH-02b: pending indexing embeds in one batch and skips unchanged text", async () => {
    let calls = 0;
    const counting: Embedder = { ...fakeEmbedder, embed: (texts) => (calls += 1, fakeEmbedder.embed(texts)) };
    await db!.delete(schema.readingEmbeddings).where(eq(schema.readingEmbeddings.blogId, blogId));
    const first = await embeddings.indexPendingPosts(blogId, counting);
    expect(first).toEqual({ indexed: 4, remaining: false });
    expect(calls).toBe(1);
    // Touch one post so it is selected again; its text is unchanged, so no call.
    const [post] = await db!.select({ id: schema.posts.id }).from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed"))).limit(1);
    await db!.update(schema.posts).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(schema.posts.id, post.id));
    const second = await embeddings.indexPendingPosts(blogId, counting);
    expect(second).toEqual({ indexed: 0, remaining: false });
    expect(calls).toBe(1);
    const third = await embeddings.indexPendingPosts(blogId, counting);
    expect(third.indexed).toBe(0);
  });

  it("SEARCH-03: meaning finds what words miss, and a result found both ways leads", async () => {
    // "undo a release" shares no word with "Rollback explained" but the same concepts.
    const semanticOnly = await search.searchReading({ handle, user, query: "undo a release", embedder: fakeEmbedder });
    expect(semanticOnly.semantic).toBe(true);
    expect(semanticOnly.unembedded).toBe(0);
    expect(semanticOnly.results[0]).toMatchObject({ title: "Rollback explained", match: "semantic" });

    const both = await search.searchReading({ handle, user, query: "rollback revert", embedder: fakeEmbedder });
    expect(both.results[0]).toMatchObject({ title: "Rollback explained", match: "both" });
  });

  it("DEDUPE-01: the same article from a second feed shows once, and only the copy received first", async () => {
    const list = await import("@/lib/reading/list.server");
    const second = await connections.addFeedConnection({
      handle,
      parentFolderPath: "bookmarks",
      endpointUrl: "https://feeds.example/search/mirror.xml",
      actor: { userId, actorType: "human" },
      fetcher: async (url) =>
        url === "https://feeds.example/search/mirror.xml"
          ? {
              kind: "ok",
              status: 200,
              body: rss([entry("m-1", "Rollback explained (mirror)", "https://s.example/1?utm_source=mirror", "<p>Mirror copy.</p>", "Mon, 01 Sep 2026 11:00:00 GMT")]),
              contentType: "application/rss+xml",
              etag: null,
              lastModified: null,
              finalUrl: url,
            }
          : { kind: "error", reason: "not_found", status: 404, detail: "gone" },
    });
    await ingest.pollFeedConnection(second.connection.id, {
      initial: true,
      fetcher: async (url) => ({
        kind: "ok",
        status: 200,
        body: rss([entry("m-1", "Rollback explained (mirror)", "https://s.example/1?utm_source=mirror", "<p>Mirror copy.</p>", "Mon, 01 Sep 2026 11:00:00 GMT")]),
        contentType: "application/rss+xml",
        etag: null,
        lastModified: null,
        finalUrl: url,
      }),
    });
    const all = await db!.select({ id: schema.posts.id }).from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    expect(all).toHaveLength(5);
    const page = await list.listReadingItems({ handle, user, scope: { folderPath: "bookmarks", includeDescendants: true, state: "all", dateBasis: "published" } });
    expect(page.items).toHaveLength(4);
    expect(page.items.map((item) => item.title)).toContain("Rollback explained");
    expect(page.items.map((item) => item.title)).not.toContain("Rollback explained (mirror)");
    const summary = await list.readingFolderSummary({ handle, user, folderPath: "bookmarks" });
    expect(summary.itemCount).toBe(4);
    // Decided at import for the workspace: the later copy is hidden everywhere,
    // including its own folder; the article is read where it first arrived.
    const mirror = await list.listReadingItems({ handle, user, scope: { folderPath: second.folder.path, includeDescendants: true, state: "all", dateBasis: "published" } });
    expect(mirror.items).toEqual([]);
  });

  it("OPS-01: operators narrow by feed, read state, date, and star; saved searches count unread", async () => {
    const retention = await import("@/lib/reading/retention.server");
    const savedSearches = await import("@/lib/reading/saved-searches.server");
    const feedOnly = await search.searchReading({ handle, user, query: "feed:Search", embedder: null });
    expect(feedOnly.results.length).toBe(4);
    const mirrorOnly = await search.searchReading({ handle, user, query: 'feed:"Search Feed" is:unread', embedder: null });
    expect(mirrorOnly.results.length).toBe(4);
    const gpu = mirrorOnly.results.find((result) => result.title.includes("GPU"))!;
    await retention.setReadState({ handle, user, postIds: [gpu.id], read: true });
    const unread = await search.searchReading({ handle, user, query: "is:unread", embedder: null });
    expect(unread.results.map((result) => result.title)).not.toContain("Building a GPU driver");
    expect(unread.results.length).toBe(3);
    const dated = await search.searchReading({ handle, user, query: "after:2026-09-02", embedder: null });
    expect(dated.results).toEqual([]);
    const before = await search.searchReading({ handle, user, query: "before:2026-09-02 rollback", embedder: null });
    expect(before.results.map((result) => result.title)).toEqual(["Rollback explained"]);
    await store.setPostStarred(handle, gpu.id, true);
    const starred = await search.searchReading({ handle, user, query: "is:starred", embedder: null });
    expect(starred.results.map((result) => result.id)).toEqual([gpu.id]);

    const created = await savedSearches.createSavedSearch({ handle, name: "Rollbacks", query: "rollback", folderPath: "", actor: { userId, actorType: "human" } });
    const listed = await savedSearches.listSavedSearches({ handle, user, folderPath: "bookmarks", withCounts: true });
    expect(listed.map((entry) => entry.name)).toContain("Rollbacks");
    expect(listed.find((entry) => entry.id === created.id)?.unread).toBe(1);
    expect(await savedSearches.deleteSavedSearch({ handle, id: created.id, actor: { userId, actorType: "human" } })).toBe(true);
  });

  it("SEARCH-04: a folder scope narrows results and an unreadable scope returns nothing", async () => {
    const scoped = await search.searchReading({ handle, user, query: "gpu", scope: { folderPath: sourceFolderPath }, embedder: null });
    expect(scoped.results.map((result) => result.title)).toEqual(["Building a GPU driver"]);
    const elsewhere = await search.searchReading({ handle, user, query: "gpu", scope: { folderPath: "notes" }, embedder: null });
    expect(elsewhere.results).toEqual([]);
    const stranger = await search.searchReading({ handle, user: null, query: "gpu", embedder: null });
    expect(stranger.results).toEqual([]);
  });
});

function entry(id: string, title: string, link: string, html: string, pubDate: string): string {
  return `<item><guid isPermaLink="false">${id}</guid><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate>${
    html ? `<content:encoded><![CDATA[${html}]]></content:encoded>` : ""
  }</item>`;
}

function rss(items: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Search Feed</title><link>https://s.example/</link>${items.join("")}</channel></rss>`;
}
