import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

// Against local Postgres only, opted in with TEXTTEXT_READING_DB_TEST=1
// (npm run test:reading:db). Seeds a scratch workspace with thousands of
// imported items by direct insert and proves the bounds the plan requires:
// the whole-workspace pool does not grow, and every reading query stays paged.
// The database test command runs this file after the concurrent durability
// suites, so their stress workloads do not become this suite's query latency.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);
const ITEMS = Number(process.env.TEXTTEXT_READING_SCALE_ITEMS ?? 5000);

describe.skipIf(!enabled)(`reading at scale (${ITEMS} imported items)`, () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let connections: typeof import("@/lib/reading/connections.server");
  let ingest: typeof import("@/lib/reading/ingest.server");
  let list: typeof import("@/lib/reading/list.server");
  let overview: typeof import("@/lib/reading/overview.server");
  let summaries: typeof import("@/lib/reading/summaries.server");
  let search: typeof import("@/lib/reading/search.server");
  let home: typeof import("@/lib/reading/home.server");
  let materialize: typeof import("@/lib/reading/summaries-materialize.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  let folderPath = "";
  let connectionId = "";
  const user = { sub: "", userId: "", email: "", name: "Scale Test" };
  const timings: Record<string, number> = {};

  async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const result = await run();
    timings[name] = Math.round(performance.now() - started);
    return result;
  }

  const feedUrl = "https://feeds.example/scale/rss.xml";
  const fetcher: typeof import("@/lib/reading/fetch.server").fetchFeedDocument = async (url) => {
    if (url !== feedUrl) return { kind: "error", reason: "not_found", status: 404, detail: "gone" };
    const body = `<?xml version="1.0"?><rss version="2.0"><channel><title>Scale Feed</title><link>https://scale.example/</link><item><guid isPermaLink="false">seed</guid><title>Seed article</title><link>https://scale.example/seed</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate><description>Seed body.</description></item></channel></rss>`;
    return { kind: "ok", status: 200, body, contentType: "application/rss+xml", etag: null, lastModified: null, finalUrl: url };
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    connections = await import("@/lib/reading/connections.server");
    ingest = await import("@/lib/reading/ingest.server");
    list = await import("@/lib/reading/list.server");
    overview = await import("@/lib/reading/overview.server");
    summaries = await import("@/lib/reading/summaries.server");
    search = await import("@/lib/reading/search.server");
    home = await import("@/lib/reading/home.server");
    materialize = await import("@/lib/reading/summaries-materialize.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `scale-reading-${stamp}`;
    const [created] = await db
      .insert(schema.users)
      .values({ appleSub: `scale-reading-${stamp}`, username: handle, email: `${handle}@example.invalid`, name: "Scale Test" })
      .returning({ id: schema.users.id });
    userId = created.id;
    user.sub = `scale-reading-${stamp}`;
    user.userId = userId;
    user.email = `${handle}@example.invalid`;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Scale Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    const added = await connections.addFeedConnection({ handle, parentFolderPath: "bookmarks", endpointUrl: feedUrl, actor: { userId, actorType: "human" }, fetcher });
    folderPath = added.folder.path;
    connectionId = added.connection.id;
    await ingest.pollFeedConnection(connectionId, { fetcher, initial: true });

    // One real imported item is the template; the rest are copies with their
    // own ids, slugs, titles, receipts and provenance, inserted in batches.
    const [seed] = await db.select().from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    const [seedReceipt] = await db.select().from(schema.feedReceipts).where(eq(schema.feedReceipts.postId, seed.id));
    const [seedProvenance] = await db.select().from(schema.readingProvenance).where(eq(schema.readingProvenance.postId, seed.id));
    const BATCH = 500;
    const started = performance.now();
    for (let offset = 0; offset < ITEMS; offset += BATCH) {
      const rows = Array.from({ length: Math.min(BATCH, ITEMS - offset) }, (_, index) => {
        const n = offset + index;
        const id = crypto.randomUUID();
        const createdAt = new Date(Date.UTC(2026, 8, 1) + n * 60_000);
        return {
          post: {
            id,
            blogId,
            folderId: seed.folderId,
            type: seed.type,
            slug: `scale-${n}`,
            title: `Scale article ${n} about topic ${n % 37}`,
            body: `Body ${n}. ${n % 5 === 0 ? "rollback " : ""}text of a synthetic article.`,
            document: { ...seed.document, content: { ...seed.document.content, title: `Scale article ${n}` } },
            visibility: seed.visibility,
            templateId: seed.templateId,
            templateVersion: seed.templateVersion,
            origin: "feed",
            createdAt,
            updatedAt: createdAt,
          },
          receipt: {
            connectionId,
            blogId,
            externalKey: `scale:${n}`,
            postId: id,
            firstImportedAt: createdAt,
            lastSeenAt: createdAt,
            contentHash: `h${n}`,
            expiresAt: seedReceipt.expiresAt,
            status: "active",
          },
          provenance: {
            ...seedProvenance,
            postId: id,
            publisherTitle: `Scale article ${n}`,
            permalink: `https://scale.example/${n}`,
            canonicalUrl: `https://scale.example/${n}`,
            publishedAt: createdAt,
            capturedAt: createdAt,
            updatedAt: createdAt,
          },
        };
      });
      await db.insert(schema.posts).values(rows.map((row) => row.post));
      await db.insert(schema.feedReceipts).values(rows.map((row) => row.receipt));
      await db.insert(schema.readingProvenance).values(rows.map((row) => row.provenance));
    }
    timings.seed = Math.round(performance.now() - started);
  }, 120_000);

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

  it("PERF-01: the whole-workspace pool does not grow with imported items", async () => {
    const pool = await timed("pool", () => store.getWorkspacePoolPosts(handle));
    expect(pool.filter((post) => post.origin === "feed")).toHaveLength(0);
    const counts = await store.getFolderCounts(handle);
    expect(counts[folderPath]).toBeGreaterThanOrEqual(ITEMS);
  });

  it("PERF-02: the folder list, summary, overview, Summaries, and search stay bounded", async () => {
    const page = await timed("firstPage", () =>
      list.listReadingItems({ handle, user, scope: { folderPath: "bookmarks", includeDescendants: true, state: "all", dateBasis: "published" }, limit: 40 }),
    );
    expect(page.items).toHaveLength(40);
    expect(page.nextCursor).not.toBeNull();
    const second = await timed("secondPage", () =>
      list.listReadingItems({ handle, user, scope: { folderPath: "bookmarks", includeDescendants: true, state: "all", dateBasis: "published" }, cursor: page.nextCursor, limit: 40 }),
    );
    expect(second.items).toHaveLength(40);
    expect(second.items[0].id).not.toBe(page.items[0].id);
    const unread = await timed("unreadPage", () =>
      list.listReadingItems({ handle, user, scope: { folderPath, includeDescendants: false, state: "unread", dateBasis: "received" }, limit: 40 }),
    );
    expect(unread.items).toHaveLength(40);
    const summary = await timed("summary", () => list.readingFolderSummary({ handle, user, folderPath: "bookmarks" }));
    expect(summary.itemCount).toBeGreaterThanOrEqual(ITEMS);
    const view = await timed("overview", () => overview.readingOverview({ handle, user }));
    expect(view.totals.items).toBeGreaterThanOrEqual(ITEMS);
    expect(view.latest.length).toBeLessThanOrEqual(8);
    const grouped = await timed("summaries", () => summaries.readingSummaries({ handle, user, folderPath: "bookmarks" }));
    expect(grouped.considered).toBeLessThanOrEqual(300);
    const found = await timed("search", () => search.searchReading({ handle, user, query: "rollback", embedder: null, limit: 20 }));
    expect(found.results).toHaveLength(20);
    // The Mac File Provider enumerates a folder through the sync manifest,
    // which lists every direct child. Imported items are ordinary posts to
    // it, so a large feed folder is exactly this call.
    const manifestPosts = await timed("syncManifestPosts", () =>
      store.getAccessibleFolderPostFiles(handle, folderPath, user, { exact: true }),
    );
    expect(manifestPosts.length).toBeGreaterThanOrEqual(ITEMS);
    console.log(`[reading scale] ${ITEMS} items: ${JSON.stringify(timings)}`);
    for (const [name, ms] of Object.entries(timings)) {
      if (name === "seed" || name === "syncManifestPosts") continue;
      expect(ms, `${name} took ${ms} ms`).toBeLessThan(2000);
    }
    // Not a budget the plan sets; recorded so the native cost is a number.
    expect(timings.syncManifestPosts, `sync manifest took ${timings.syncManifestPosts} ms`).toBeLessThan(10_000);
  });

  it("personal Home and Bookmarks stay bounded in a large feed workspace", async () => {
    const empty = await store.listWorkspaceTimeline({ handle, user, filter: "saved", limit: 7 });
    expect(empty.entries).toHaveLength(0);
    const candidates = await list.listReadingItems({ handle, user, scope: { folderPath: "", includeDescendants: true, state: "all", dateBasis: "received" }, limit: 15 });
    const retention = await import("@/lib/reading/retention.server");
    await retention.setKeep({ handle, postIds: candidates.items.map((item) => item.id), keep: true, actor: { userId, actorType: "human" } });
    const first = await timed("personalTimeline", () => store.listWorkspaceTimeline({ handle, user, filter: "saved", limit: 7 }));
    expect(first.entries).toHaveLength(7);
    expect(first.nextCursor).not.toBeNull();
    const second = await store.listWorkspaceTimeline({ handle, user, filter: "saved", limit: 7, cursor: first.nextCursor });
    expect(second.entries).toHaveLength(7);
    expect(new Set([...first.entries, ...second.entries].map((item) => item.id)).size).toBe(14);
    expect(first.entries.every((item) => !("body" in item.post))).toBe(true);
    const saved = await timed("bookmarkedLibrary", () => list.listReadingItems({ handle, user, scope: { folderPath: "", includeDescendants: true, state: "bookmarked", dateBasis: "received" }, limit: 7 }));
    expect(saved.items).toHaveLength(7);
    expect(saved.nextCursor).not.toBeNull();
    const searchScope = { folderPath: "", includeDescendants: true, state: "bookmarked" as const, dateBasis: "received" as const, query: "Scale article" };
    const found = await timed("bookmarkSearch", () => list.listReadingItems({ handle, user, scope: searchScope, limit: 7 }));
    expect(found.items).toHaveLength(7);
    const foundNext = await list.listReadingItems({ handle, user, scope: searchScope, cursor: found.nextCursor, limit: 7 });
    expect(foundNext.items).toHaveLength(7);
    expect(new Set([...found.items, ...foundNext.items].map((item) => item.id)).size).toBe(14);
    expect([...found.items, ...foundNext.items].every((item) => candidates.items.some((savedItem) => savedItem.id === item.id))).toBe(true);
    expect(timings.bookmarkSearch).toBeLessThan(2000);
    for (const name of ["personalTimeline", "bookmarkedLibrary"]) expect(timings[name], name).toBeLessThan(2000);
    console.log(`[personal workspace scale] ${ITEMS} items: ${JSON.stringify({ timelineMs: timings.personalTimeline, bookmarksMs: timings.bookmarkedLibrary })}`);
  });

  it("PERF-03: the home page's news is a bounded page whatever the corpus holds", async () => {
    const homeTimings: Record<string, number> = {};
    const clock = async <T,>(name: string, run: () => Promise<T>): Promise<T> => {
      const started = performance.now();
      const result = await run();
      homeTimings[name] = Math.round(performance.now() - started);
      return result;
    };
    const report = await clock("materialize", () => materialize.materializeSummaries({ blogId, handle, writeTexts: false }));
    expect(report.topics).toBeGreaterThanOrEqual(1);
    const forYou = await clock("forYouCold", () => home.readingHome({ handle, user }));
    expect(forYou.units.length).toBeLessThanOrEqual(20);
    expect(forYou.considered).toBeLessThanOrEqual(300);
    expect(forYou.snapshot).toBeTruthy();
    await clock("forYouWarm", () => home.readingHome({ handle, user }));
    // The fixture's items are dated at the start of the month; a clock set
    // just after them puts the whole considered window inside the
    // seven-day candidate range, which is the expensive case.
    const windowed = await clock("forYouRanked", () => home.readingHome({ handle, user, now: new Date("2026-09-02T12:00:00Z") }));
    expect(windowed.units).toHaveLength(20);
    expect(windowed.units.every((unit) => unit.reasons.length > 0)).toBe(true);
    const second = await clock("forYouPage2", () => home.readingHome({ handle, user, offset: 20 }));
    expect(second.units.length).toBeLessThanOrEqual(20);
    const latest = await clock("latest", () => home.readingHome({ handle, user, mode: "latest" }));
    expect(latest.units).toHaveLength(20);
    const source = forYou.topics.find((topic) => topic.kind === "source")!;
    const scoped = await clock("sourceTopic", () => home.readingHome({ handle, user, mode: "latest", topic: source.id }));
    expect(scoped.units.length).toBeLessThanOrEqual(20);
    const payload = JSON.stringify(forYou).length;
    console.log(`[home scale] ${ITEMS} items: ${JSON.stringify({ ...homeTimings, payloadBytes: payload })}`);
    for (const [name, ms] of Object.entries(homeTimings)) {
      if (name === "materialize") continue;
      expect(ms, `${name} took ${ms} ms`).toBeLessThan(2000);
    }
    expect(homeTimings.materialize, `materialize took ${homeTimings.materialize} ms`).toBeLessThan(10_000);
    expect(payload).toBeLessThan(200_000);
  });
});
