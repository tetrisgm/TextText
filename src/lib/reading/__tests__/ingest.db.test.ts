import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

// Against local Postgres only, opted in with TEXTTEXT_READING_DB_TEST=1 and
// DATABASE_URL loaded (npm run test:reading:db). Every row this creates lives
// in a scratch workspace that is removed in afterAll, so the development
// workspace is never touched.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("feed ingestion against Postgres (P1 vertical slice)", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let connections: typeof import("@/lib/reading/connections.server");
  let ingest: typeof import("@/lib/reading/ingest.server");
  let jobs: typeof import("@/lib/reading/jobs.server");
  let list: typeof import("@/lib/reading/list.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  const user = { sub: "", userId: "", email: "", name: "Reading Test" };

  // The fixture feed. Bodies are served by a fake fetcher, never the network:
  // the SSRF gate refuses loopback by design and gets no bypass for a test.
  const feedUrl = "https://feeds.example/browser/rss.xml";
  let feedBody = rss([
    entry("a-1", "Actions proposal", "https://browser.example/a1", "<p>First body about <b>actions</b>.</p>", "Mon, 01 Sep 2026 10:00:00 GMT"),
    entry("a-2", "Rollback explained", "https://browser.example/a2", "<p>Second body about rollback.</p>", "Tue, 02 Sep 2026 10:00:00 GMT"),
    entry("a-3", "Third post", "https://browser.example/a3", "", "Wed, 03 Sep 2026 10:00:00 GMT"),
  ]);
  let fetchCount = 0;
  let serve304 = false;
  let pollTime = 0;
  // Successive scheduled polls happen after the connection's one-minute claim.
  // Advance only this fixture's clock so the tests exercise ingestion, not a
  // real-time wait or the manual-refresh bypass.
  const nextPollTime = () => new Date(pollTime = Math.max(Date.now(), pollTime) + 60_001);
  let serveError: null | { reason: "server_error" | "auth_required"; status: number } = null;
  const fetcher: typeof import("@/lib/reading/fetch.server").fetchFeedDocument = async (url) => {
    fetchCount += 1;
    if (url !== feedUrl) return { kind: "error", reason: "not_found", status: 404, detail: "gone" };
    if (serveError) return { kind: "error", reason: serveError.reason, status: serveError.status, detail: "fixture" };
    if (serve304) return { kind: "not_modified" };
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
    jobs = await import("@/lib/reading/jobs.server");
    list = await import("@/lib/reading/list.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `reading-test-${stamp}`;
    const [created] = await db
      .insert(schema.users)
      .values({ appleSub: `reading-test-${stamp}`, username: handle, email: `${handle}@example.invalid`, name: "Reading Test" })
      .returning({ id: schema.users.id });
    userId = created.id;
    user.sub = `reading-test-${stamp}`;
    user.userId = userId;
    user.email = `${handle}@example.invalid`;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Reading Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
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

  let connectionId = "";
  let sourceFolderPath = "";

  it("FOLD-01: adding a feed creates a source folder under Bookmarks and queues the import", async () => {
    const result = await connections.addFeedConnection({
      handle,
      parentFolderPath: "bookmarks",
      endpointUrl: feedUrl,
      actor: { userId, actorType: "human" },
      fetcher,
    });
    expect(result.created).toBe(true);
    expect(result.folder.mode).toBe("bookmarks");
    expect(result.folder.path.startsWith("bookmarks/")).toBe(true);
    expect(result.connection.endpoint).toBe("feeds.example/browser/rss.xml");
    expect(result.connection.health).toBe("checking");
    connectionId = result.connection.id;
    sourceFolderPath = result.folder.path;
    const open = await jobs.readingJobCounts(blogId);
    expect(open.queued).toBe(1);
  });

  it("SRC-02: adding the same feed again opens the existing folder instead of duplicating", async () => {
    const again = await connections.addFeedConnection({
      handle,
      parentFolderPath: "bookmarks",
      endpointUrl: `${feedUrl}?utm_source=twice`,
      actor: { userId, actorType: "human" },
      fetcher,
    });
    // utm parameters are not identity, so this is the same subscription.
    expect(again.created).toBe(false);
    expect(again.folder.path).toBe(sourceFolderPath);
  });

  it("ITEM-01: the initial poll creates ordinary bookmark items with provenance and leases", async () => {
    const report = await jobs.runReadingJobs({
      executors: { poll_feed: (job) => ingest.runPollFeedJob(job, fetcher) },
      blogId,
      limit: 5,
    });
    expect(report.done).toBe(1);
    const posts = await db!
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    expect(posts).toHaveLength(3);
    // Every receipt was claimed first and then completed with its item.
    const claimed = await db!.select().from(schema.feedReceipts).where(eq(schema.feedReceipts.connectionId, connectionId));
    expect(claimed).toHaveLength(3);
    expect(claimed.every((receipt) => receipt.postId !== null)).toBe(true);
    for (const post of posts) {
      expect(post.type).toBe("bookmark");
      expect(post.visibility).toBe("private");
      expect(post.status).toBe("draft");
      expect(post.document.content.fields.sourceUrl).toMatch(/^https:\/\/browser\.example\/a[123]$/);
      expect(post.templateId).toBe("texttext.bookmark");
    }
    const first = posts.find((post) => post.title === "Actions proposal")!;
    expect(first.body).toBe("First body about **actions**.");
    const metadataOnly = posts.find((post) => post.title === "Third post")!;
    expect(metadataOnly.body).toBe("[Read the original](https://browser.example/a3)");

    const provenance = await db!.select().from(schema.readingProvenance).where(eq(schema.readingProvenance.blogId, blogId));
    expect(provenance).toHaveLength(3);
    expect(provenance.find((row) => row.postId === first.id)?.availability).toBe("full");
    expect(provenance.find((row) => row.postId === metadataOnly.id)?.availability).toBe("metadata");
    expect(provenance.find((row) => row.postId === first.id)?.publishedAt?.toISOString()).toBe("2026-09-01T10:00:00.000Z");

    const receipts = await db!.select().from(schema.feedReceipts).where(eq(schema.feedReceipts.connectionId, connectionId));
    expect(receipts).toHaveLength(3);
    for (const receipt of receipts) {
      expect(receipt.status).toBe("active");
      expect(receipt.expiresAt).not.toBeNull();
      const days = (receipt.expiresAt!.getTime() - receipt.firstImportedAt.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(90);
    }
    const connection = await connections.feedConnectionById(handle, connectionId);
    expect(connection?.health).toBe("healthy");
    expect(connection?.etag).toBe('"v1"');
  });

  it("PERF-02: imported items stay out of the whole-workspace pool but remain reachable everywhere else", async () => {
    const pool = await store.getWorkspacePoolPosts(handle);
    expect(pool.filter((post) => post.origin === "feed")).toHaveLength(0);
    const everything = await store.getAllPosts(handle);
    expect(everything.filter((post) => post.origin === "feed")).toHaveLength(3);
    const byId = await store.getPostById(handle, everything.find((post) => post.origin === "feed")!.id!);
    expect(byId?.origin).toBe("feed");
    const counts = await store.getFolderCounts(handle);
    expect(counts[sourceFolderPath]).toBe(3);
  });

  it("ING-02: another scheduled poll yields inside the one-minute claim", async () => {
    const connection = await connections.feedConnectionById(handle, connectionId);
    const before = fetchCount;
    const report = await ingest.pollFeedConnection(connectionId, {
      fetcher, now: new Date(connection!.lastCheckedAt!.getTime() + 30_000),
    });
    expect(report.outcome).toBe("skipped");
    expect(report.detail).toBe("Another check is running");
    expect(fetchCount).toBe(before);
  });

  it("ING-03: polling again is idempotent, and a 304 is a successful check", async () => {
    const before = fetchCount;
    const unchanged = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    expect(unchanged.outcome).toBe("no_new_items");
    expect(unchanged.created).toBe(0);
    expect(unchanged.unchanged).toBe(3);
    serve304 = true;
    const notModified = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    serve304 = false;
    expect(notModified.outcome).toBe("not_modified");
    expect(fetchCount).toBe(before + 2);
    const posts = await db!.select({ id: schema.posts.id }).from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    expect(posts).toHaveLength(3);
  });

  it("FOLD-02: the parent aggregates its descendants and the source folder narrows to its own items", async () => {
    const parent = await list.listReadingItems({
      handle,
      user,
      scope: { folderPath: "bookmarks", includeDescendants: true, state: "all", dateBasis: "published" },
    });
    expect(parent.items.map((item) => item.title)).toEqual(["Third post", "Rollback explained", "Actions proposal"]);
    expect(parent.items[0].sourceFolderName).toBe("Browser Notes");
    expect(parent.items[0].read).toBe(false);
    expect(parent.items[0].kept).toBe(false);
    const direct = await list.listReadingItems({
      handle,
      user,
      scope: { folderPath: "bookmarks", includeDescendants: false, state: "all", dateBasis: "published" },
    });
    expect(direct.items).toHaveLength(0);
    const source = await list.listReadingItems({
      handle,
      user,
      scope: { folderPath: sourceFolderPath, includeDescendants: true, state: "all", dateBasis: "published" },
      limit: 2,
    });
    expect(source.items).toHaveLength(2);
    expect(source.nextCursor).not.toBeNull();
    const rest = await list.listReadingItems({
      handle,
      user,
      scope: { folderPath: sourceFolderPath, includeDescendants: true, state: "all", dateBasis: "published" },
      limit: 2,
      cursor: source.nextCursor,
    });
    expect(rest.items.map((item) => item.title)).toEqual(["Actions proposal"]);
    expect(rest.nextCursor).toBeNull();
    const summary = await list.readingFolderSummary({ handle, user, folderPath: "bookmarks" });
    expect(summary.sourceCount).toBe(1);
    expect(summary.itemCount).toBe(3);
    expect(summary.unreadCount).toBe(3);
  });

  it("REV-01: a changed source updates an untouched item and records a revision", async () => {
    feedBody = rss([
      entry("a-1", "Actions proposal (updated)", "https://browser.example/a1", "<p>First body, corrected.</p>", "Mon, 01 Sep 2026 10:00:00 GMT"),
      entry("a-2", "Rollback explained", "https://browser.example/a2", "<p>Second body about rollback.</p>", "Tue, 02 Sep 2026 10:00:00 GMT"),
      entry("a-3", "Third post", "https://browser.example/a3", "", "Wed, 03 Sep 2026 10:00:00 GMT"),
    ]);
    const report = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    expect(report.updated).toBe(1);
    const posts = await db!.select().from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    const first = posts.find((post) => post.document.content.fields.sourceUrl === "https://browser.example/a1")!;
    expect(first.title).toBe("Actions proposal (updated)");
    expect(first.body).toBe("First body, corrected.");
    const revisions = await db!.select().from(schema.readingSourceRevisions).where(eq(schema.readingSourceRevisions.postId, first.id));
    expect(revisions).toHaveLength(2);
  });

  it("REV-02: a person's edit is never overwritten by a later source change", async () => {
    const posts = await db!.select().from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    const second = posts.find((post) => post.document.content.fields.sourceUrl === "https://browser.example/a2")!;
    const mine = await store.getPostById(handle, second.id);
    await store.savePostContentPatch(handle, mine!, { body: "My own annotated copy." });
    feedBody = rss([
      entry("a-1", "Actions proposal (updated)", "https://browser.example/a1", "<p>First body, corrected.</p>", "Mon, 01 Sep 2026 10:00:00 GMT"),
      entry("a-2", "Rollback explained, revised", "https://browser.example/a2", "<p>Publisher rewrote this.</p>", "Tue, 02 Sep 2026 10:00:00 GMT"),
      entry("a-3", "Third post", "https://browser.example/a3", "", "Wed, 03 Sep 2026 10:00:00 GMT"),
    ]);
    const report = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    expect(report.updated).toBe(1);
    const after = await store.getPostById(handle, second.id);
    expect(after?.body).toBe("My own annotated copy.");
    expect(after?.title).toBe("Rollback explained");
    const revisions = await db!.select().from(schema.readingSourceRevisions).where(eq(schema.readingSourceRevisions.postId, second.id));
    expect(revisions).toHaveLength(2);
  });

  it("LIFE-07: an expired receipt is a tombstone the next poll does not resurrect", async () => {
    const posts = await db!.select().from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    const third = posts.find((post) => post.document.content.fields.sourceUrl === "https://browser.example/a3")!;
    await db!.update(schema.posts).set({ deletedAt: new Date() }).where(eq(schema.posts.id, third.id));
    await db!
      .update(schema.feedReceipts)
      .set({ status: "expired", expiredAt: new Date() })
      .where(eq(schema.feedReceipts.postId, third.id));
    const report = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    expect(report.suppressed).toBe(1);
    expect(report.created).toBe(0);
    const live = await db!
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed"), isNull(schema.posts.deletedAt)));
    expect(live).toHaveLength(2);
    expect(live.map((row) => row.id)).not.toContain(third.id);
  });

  it("SRC-05: fetch failures set health and back off without touching items", async () => {
    serveError = { reason: "server_error", status: 503 };
    const report = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    serveError = null;
    expect(report.outcome).toBe("error");
    expect(report.health).toBe("failing");
    const connection = await connections.feedConnectionById(handle, connectionId);
    expect(connection?.consecutiveFailures).toBe(1);
    expect(connection?.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    serveError = { reason: "auth_required", status: 401 };
    const authed = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    serveError = null;
    expect(authed.health).toBe("auth_required");
  });

  it("SRC-06: pausing stops polling and detaching leaves items in an ordinary folder", async () => {
    const paused = await connections.setFeedConnectionState(handle, connectionId, "paused", { userId, actorType: "human" });
    expect(paused.state).toBe("paused");
    const skipped = await ingest.pollFeedConnection(connectionId, { fetcher, now: nextPollTime() });
    expect(skipped.outcome).toBe("skipped");
    const detached = await connections.detachFeedConnection(handle, connectionId, { userId, actorType: "human" });
    expect(detached.state).toBe("detached");
    const remaining = await db!
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    expect(remaining.length).toBeGreaterThan(0);
    const receipts = await db!.select().from(schema.feedReceipts).where(eq(schema.feedReceipts.connectionId, connectionId));
    expect(receipts.every((receipt) => receipt.status !== "active")).toBe(true);
    // Detached: the folder can follow a feed again, as a new connection.
    const readded = await connections.addFeedConnection({
      handle,
      parentFolderPath: "bookmarks",
      endpointUrl: feedUrl,
      actor: { userId, actorType: "human" },
      fetcher,
    });
    expect(readded.created).toBe(true);
    expect(readded.folder.path).not.toBe(sourceFolderPath);
  });
});

function entry(id: string, title: string, link: string, html: string, pubDate: string): string {
  return `<item><guid isPermaLink="false">${id}</guid><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate>${
    html ? `<content:encoded><![CDATA[${html}]]></content:encoded>` : ""
  }</item>`;
}

function rss(items: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Browser Notes</title><link>https://browser.example/</link>${items.join("")}</channel></rss>`;
}
