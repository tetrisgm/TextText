import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { sourceNoteMarkdown } from "@/lib/workspace/source-note";

// Against local Postgres only, opted in with TEXTTEXT_READING_DB_TEST=1 and
// DATABASE_URL loaded (npm run test:reading:db). Scratch workspace, removed in
// afterAll.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("retention holds and cleanup against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let connections: typeof import("@/lib/reading/connections.server");
  let ingest: typeof import("@/lib/reading/ingest.server");
  let retention: typeof import("@/lib/reading/retention.server");
  let list: typeof import("@/lib/reading/list.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  const user = { sub: "", userId: "", email: "", name: "Retention Test" };

  const feedUrl = "https://feeds.example/retention/rss.xml";
  const feedBody = rss([
    entry("r-star", "Starred one", "https://r.example/star", "<p>Star body.</p>", "Mon, 01 Sep 2026 10:00:00 GMT"),
    entry("r-comment", "Commented one", "https://r.example/comment", "<p>Comment body.</p>", "Mon, 01 Sep 2026 10:01:00 GMT"),
    entry("r-keep", "Kept one", "https://r.example/keep", "<p>Keep body.</p>", "Mon, 01 Sep 2026 10:02:00 GMT"),
    entry("r-ref", "Referenced one", "https://r.example/ref", "<p>Ref body.</p>", "Mon, 01 Sep 2026 10:03:00 GMT"),
    entry("r-edit", "Edited one", "https://r.example/edit", "<p>Edit body.</p>", "Mon, 01 Sep 2026 10:04:00 GMT"),
    entry("r-drop", "Dropped one", "https://r.example/drop", "<p>Drop body.</p>", "Mon, 01 Sep 2026 10:05:00 GMT"),
  ]);
  const fetcher: typeof import("@/lib/reading/fetch.server").fetchFeedDocument = async (url) => {
    if (url !== feedUrl) return { kind: "error", reason: "not_found", status: 404, detail: "gone" };
    return { kind: "ok", status: 200, body: feedBody, contentType: "application/rss+xml", etag: '"v1"', lastModified: null, finalUrl: url };
  };

  const byUrl = new Map<string, string>();
  let connectionId = "";

  async function activeHolds(postId: string): Promise<string[]> {
    const rows = await db!
      .select({ reason: schema.retentionHolds.reason })
      .from(schema.retentionHolds)
      .where(and(eq(schema.retentionHolds.postId, postId), isNull(schema.retentionHolds.releasedAt)));
    return rows.map((row) => row.reason).sort();
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    connections = await import("@/lib/reading/connections.server");
    ingest = await import("@/lib/reading/ingest.server");
    retention = await import("@/lib/reading/retention.server");
    list = await import("@/lib/reading/list.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `retention-test-${stamp}`;
    const [created] = await db
      .insert(schema.users)
      .values({ appleSub: `retention-test-${stamp}`, username: handle, email: `${handle}@example.invalid`, name: "Retention Test" })
      .returning({ id: schema.users.id });
    userId = created.id;
    user.sub = `retention-test-${stamp}`;
    user.userId = userId;
    user.email = `${handle}@example.invalid`;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Retention Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);

    const added = await connections.addFeedConnection({
      handle,
      parentFolderPath: "bookmarks",
      endpointUrl: feedUrl,
      actor: { userId, actorType: "human" },
      fetcher,
    });
    connectionId = added.connection.id;
    await ingest.pollFeedConnection(connectionId, { fetcher, initial: true });
    const posts = await db.select().from(schema.posts).where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed")));
    for (const post of posts) byUrl.set(String(post.document.content.fields.sourceUrl), post.id);
    expect(byUrl.size).toBe(6);
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

  it("RET-01: a star writes its hold with the same act, and unstarring releases only that hold", async () => {
    const id = byUrl.get("https://r.example/star")!;
    await store.setPostStarred(handle, id, true);
    expect(await activeHolds(id)).toEqual(["starred"]);
    await retention.setKeep({ handle, postIds: [id], keep: true, actor: { userId, actorType: "human" } });
    await store.setPostStarred(handle, id, false);
    expect(await activeHolds(id)).toEqual(["keep"]);
    await retention.setKeep({ handle, postIds: [id], keep: false, actor: { userId, actorType: "human" } });
    await store.setPostStarred(handle, id, true);
    expect(await activeHolds(id)).toEqual(["starred"]);
  });

  it("RET-02: a comment protects the item; removing the comment releases only its own hold", async () => {
    const id = byUrl.get("https://r.example/comment")!;
    const comment = await store.createItemComment({ itemId: id, body: "Worth a second look." }, { actorUserId: userId, actorType: "human", actorName: "Me" });
    expect(await activeHolds(id)).toEqual(["comment"]);
    await retention.setKeep({ handle, postIds: [id], keep: true, actor: { userId, actorType: "human" } });
    await store.deleteItemComment(id, comment.id, { actorUserId: userId, actorType: "human", actorName: "Me" });
    expect(await activeHolds(id)).toEqual(["keep"]);
    // Keep it commented for the sweep below.
    await retention.setKeep({ handle, postIds: [id], keep: false, actor: { userId, actorType: "human" } });
    await store.createItemComment({ itemId: id, body: "Still worth it." }, { actorUserId: userId, actorType: "human", actorName: "Me" });
    expect(await activeHolds(id)).toEqual(["comment"]);
  });

  it("RET-03: Keep is its own protection and shows in the Kept view", async () => {
    const id = byUrl.get("https://r.example/keep")!;
    await retention.setKeep({ handle, postIds: [id], keep: true, actor: { userId, actorType: "human" } });
    const page = await list.listReadingItems({
      handle,
      user,
      scope: { folderPath: "bookmarks", includeDescendants: true, state: "kept", dateBasis: "published" },
    });
    expect(page.items.map((item) => item.id)).toContain(id);
    expect(page.items.find((item) => item.id === id)?.keptReasons).toContain("keep");
  });

  it("RET-04: the preview finds links from the person's notes and their own edits without any hold", async () => {
    const refId = byUrl.get("https://r.example/ref")!;
    const editId = byUrl.get("https://r.example/edit")!;
    const refPost = await store.getPostById(handle, refId);
    const notesFolder = (await db!.select().from(schema.folders).where(and(eq(schema.folders.blogId, blogId), eq(schema.folders.path, "notes"))))[0];
    await store.createDraftInFolder(handle, notesFolder.id, {
      initial: { type: "note", title: "Reading notes", body: sourceNoteMarkdown("Ref body.", refPost!.title, "https://r.example/ref", refPost!.slug) },
      audit: { actorUserId: userId, actorType: "human", actionName: "test.create_note", targetType: "item" },
    });
    const editPost = await store.getPostById(handle, editId);
    await store.savePostContentPatch(handle, editPost!, { body: "Edit body.\n\nMy annotation." });

    const later = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    const preview = await retention.previewCleanup({ handle, now: later });
    const protectedById = new Map(preview.protected.map((item) => [item.postId, item.reason]));
    expect(protectedById.get(refId)).toBe("reference");
    expect(protectedById.get(editId)).toBe("manual_save");
    expect(preview.expiring.map((item) => item.postId)).toEqual([byUrl.get("https://r.example/drop")]);
    // Starred, commented, kept items never even reach the preview.
    for (const url of ["star", "comment", "keep"]) {
      expect(preview.expiring.map((item) => item.postId)).not.toContain(byUrl.get(`https://r.example/${url}`));
      expect(protectedById.has(byUrl.get(`https://r.example/${url}`)!)).toBe(false);
    }
  });

  it("RET-05: a dry run changes nothing; the sweep trashes the unprotected item and tombstones its receipt", async () => {
    const dropId = byUrl.get("https://r.example/drop")!;
    const later = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    const dry = await retention.runCleanup({ handle, actor: { userId, actorType: "human" }, dryRun: true, now: later });
    expect(dry).toMatchObject({ trashed: 1, protected: 2, dryRun: true });
    const stillLive = await db!.select({ deletedAt: schema.posts.deletedAt }).from(schema.posts).where(eq(schema.posts.id, dropId));
    expect(stillLive[0].deletedAt).toBeNull();

    const report = await retention.runCleanup({ handle, actor: { userId, actorType: "human" }, now: later });
    expect(report).toMatchObject({ trashed: 1, protected: 2, skipped: 0, dryRun: false });
    const trashed = await db!.select({ deletedAt: schema.posts.deletedAt }).from(schema.posts).where(eq(schema.posts.id, dropId));
    expect(trashed[0].deletedAt).not.toBeNull();
    const receipt = await db!.select().from(schema.feedReceipts).where(eq(schema.feedReceipts.postId, dropId));
    expect(receipt[0].status).toBe("expired");
    // Reasons the sweep found are now holds, visible in Kept.
    expect(await activeHolds(byUrl.get("https://r.example/ref")!)).toEqual(["reference"]);
    expect(await activeHolds(byUrl.get("https://r.example/edit")!)).toEqual(["manual_save"]);
    // Everything else is untouched and the next poll does not bring the item back.
    const poll = await ingest.pollFeedConnection(connectionId, { fetcher, now: later });
    expect(poll.suppressed).toBe(1);
    expect(poll.created).toBe(0);
    const live = await db!
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(eq(schema.posts.blogId, blogId), eq(schema.posts.origin, "feed"), isNull(schema.posts.deletedAt)));
    expect(live).toHaveLength(5);
  });

  it("OVER-01: the overview counts unread per source and a saved brief is a note of citations that protects them", async () => {
    const overview = await import("@/lib/reading/overview.server");
    const before = await overview.readingOverview({ handle, user });
    expect(before.sources).toHaveLength(1);
    expect(before.totals.items).toBe(5);
    expect(before.totals.unread).toBe(5);
    expect(before.latest.length).toBeGreaterThan(0);
    expect(before.latest.every((item) => !item.read)).toBe(true);

    const brief = await overview.saveReadingBrief({ handle, user, actor: { userId, actorType: "human" } });
    expect(brief.folderPath).toBe("notes");
    expect(brief.items).toBe(5);
    const note = await store.getPostById(handle, brief.id);
    expect(note?.type).toBe("note");
    expect(note?.title.startsWith("Reading brief, ")).toBe(true);
    for (const url of ["star", "comment", "keep", "ref", "edit"]) {
      const post = await store.getPostById(handle, byUrl.get(`https://r.example/${url}`)!);
      expect(note?.body).toContain(`[[${post!.slug}|`);
      expect(note?.body).toContain(`https://r.example/${url}`);
    }
    // Everything the brief links is now a reference the sweep respects.
    const later = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    const preview = await retention.previewCleanup({ handle, now: later });
    expect(preview.expiring).toEqual([]);
  });

  it("RET-02b: deleting a parent comment releases its replies' holds too", async () => {
    const id = byUrl.get("https://r.example/keep")!;
    const actor = { actorUserId: userId, actorType: "human" as const, actorName: "Me" };
    const parent = await store.createItemComment({ itemId: id, body: "Thread" }, actor);
    await store.createItemComment({ itemId: id, body: "Reply", parentId: parent.id }, actor);
    expect((await activeHolds(id)).filter((reason) => reason === "comment")).toHaveLength(2);
    await store.deleteItemComment(id, parent.id, actor);
    expect((await activeHolds(id)).filter((reason) => reason === "comment")).toHaveLength(0);
  });

  it("RET-06b: read state ignores ids outside the person's reach", async () => {
    const mine = byUrl.get("https://r.example/keep")!;
    const written = await retention.setReadState({ handle, user, postIds: [mine, crypto.randomUUID()], read: true });
    expect(written).toBe(1);
    const rows = await db!.select().from(schema.readingReadState).where(eq(schema.readingReadState.userId, userId));
    expect(rows.map((row) => row.postId)).toEqual([mine]);
    await retention.setReadState({ handle, user, postIds: [mine], read: false });
  });

  it("SET-01: retention changes re-lease passing articles and muted words stop new ones", async () => {
    const view = await connections.updateFeedConnectionSettings(handle, connectionId, { retentionDays: 0, mutedKeywords: ["Sponsored"] }, { userId, actorType: "human" });
    expect(view.effectiveRetentionDays).toBe(0);
    expect(view.mutedKeywords).toEqual(["sponsored"]);
    const receipts = await db!.select().from(schema.feedReceipts).where(and(eq(schema.feedReceipts.connectionId, connectionId), eq(schema.feedReceipts.status, "active")));
    expect(receipts.every((receipt) => receipt.expiresAt === null)).toBe(true);
    const back = await connections.updateFeedConnectionSettings(handle, connectionId, { retentionDays: 30 }, { userId, actorType: "human" });
    expect(back.effectiveRetentionDays).toBe(30);
    const released = await db!.select().from(schema.feedReceipts).where(and(eq(schema.feedReceipts.connectionId, connectionId), eq(schema.feedReceipts.status, "active")));
    expect(released.every((receipt) => receipt.expiresAt !== null)).toBe(true);
  });

  it("EXTRACT-01: the original page becomes the body when untouched, a source version only when edited", async () => {
    const extract = await import("@/lib/reading/extract.server");
    const page = `<html><body><article><h1>Kept one</h1>${Array.from({ length: 6 }, (_, i) => `<p>Full paragraph ${i} of the original article with more than enough words to be kept by the extractor.</p>`).join("")}</article></body></html>`;
    const fetcher: import("@/lib/reading/extract.server").ExtractFetcher = async () => ({ ok: true, html: page, status: 200 });
    const keepId = byUrl.get("https://r.example/keep")!;
    const applied = await extract.extractFullContent({ handle, postId: keepId, actor: { userId, actorType: "human" }, fetcher });
    expect(applied.outcome).toBe("applied");
    const post = await store.getPostById(handle, keepId);
    expect(post?.body).toContain("Full paragraph 0");
    const provenance = await db!.select().from(schema.readingProvenance).where(eq(schema.readingProvenance.postId, keepId));
    expect(provenance[0].availability).toBe("full");
    // The edited item keeps the person's words; the extraction is recorded, not applied.
    const editId = byUrl.get("https://r.example/edit")!;
    const recorded = await extract.extractFullContent({ handle, postId: editId, actor: { userId, actorType: "human" }, fetcher });
    expect(recorded.outcome).toBe("recorded");
    expect((await store.getPostById(handle, editId))?.body).toContain("My annotation");
    const versions = await db!.select().from(schema.readingSourceRevisions).where(eq(schema.readingSourceRevisions.postId, editId));
    expect(versions.some((version) => version.sourceHash.startsWith("extract:"))).toBe(true);
    // Neighbours in the source folder, newest first: keep (10:02) sits between comment (10:01) and ref (10:03).
    const list = await import("@/lib/reading/list.server");
    const around = await list.readingNeighbors({ handle, user, postId: keepId });
    expect(around.current?.id).toBe(keepId);
    expect(around.previous?.id).toBe(byUrl.get("https://r.example/ref"));
    expect(around.next?.id).toBe(byUrl.get("https://r.example/comment"));
  });

  it("DIGEST-01: an alert keeps its new matches, and the digest lists them first, once per day", async () => {
    const digest = await import("@/lib/reading/digest.server");
    const savedSearches = await import("@/lib/reading/saved-searches.server");
    const created = await savedSearches.createSavedSearch({ handle, name: "Commented", query: "Commented", folderPath: "", actor: { userId, actorType: "human" } });
    await savedSearches.setSavedSearchNotify({ handle, id: created.id, notify: true, actor: { userId, actorType: "human" } });
    await db!.update(schema.users).set({ email: `${handle}@example.invalid` }).where(eq(schema.users.id, userId));
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const mailer = async (message: { to: string; subject: string; text: string }) => {
      sent.push(message);
    };
    const first = await digest.sendReadingDigest({ blogId, mailer });
    expect(first.sent).toBe(true);
    expect(first.alerts.map((alert) => alert.name)).toEqual(["Commented"]);
    expect(sent[0].subject).toContain("Commented");
    expect(sent[0].text.startsWith("ALERT: Commented")).toBe(true);
    expect(sent[0].text).toContain("https://r.example/comment");
    const commentId = byUrl.get("https://r.example/comment")!;
    expect(await activeHolds(commentId)).toContain("keep");
    // Same day: nothing goes out twice.
    const again = await digest.sendReadingDigest({ blogId, mailer });
    expect(again.sent).toBe(false);
    expect(sent).toHaveLength(1);
    // The connection's cadence adapted to its quiet checks.
    const [connection] = await db!.select({ interval: schema.feedConnections.pollIntervalMinutes }).from(schema.feedConnections).where(eq(schema.feedConnections.id, connectionId));
    expect(connection.interval).toBeGreaterThanOrEqual(10);
  });

  it("RET-06: read state is the person's own and drives the Unread view", async () => {
    const id = byUrl.get("https://r.example/keep")!;
    await retention.setReadState({ handle, user, postIds: [id], read: true });
    const unread = await list.listReadingItems({
      handle,
      user,
      scope: { folderPath: "bookmarks", includeDescendants: true, state: "unread", dateBasis: "published" },
    });
    expect(unread.items.map((item) => item.id)).not.toContain(id);
    await retention.setReadState({ handle, user, postIds: [id], read: false });
    const again = await list.listReadingItems({
      handle,
      user,
      scope: { folderPath: "bookmarks", includeDescendants: true, state: "unread", dateBasis: "published" },
    });
    expect(again.items.map((item) => item.id)).toContain(id);
  });
});

function entry(id: string, title: string, link: string, html: string, pubDate: string): string {
  return `<item><guid isPermaLink="false">${id}</guid><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate>${
    html ? `<content:encoded><![CDATA[${html}]]></content:encoded>` : ""
  }</item>`;
}

function rss(items: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Retention Feed</title><link>https://r.example/</link>${items.join("")}</channel></rss>`;
}
