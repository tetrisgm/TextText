import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Against local Postgres only (npm run test:reading:db). Two scratch feeds
// whose headlines overlap, so the home page has something to group.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("home news against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let home: typeof import("@/lib/reading/home.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  const user = { sub: "", userId: "" };
  const now = new Date().toUTCString();
  const entry = (id: string, title: string, link: string, body: string, image?: string) =>
    `<item><guid>${id}</guid><title>${title}</title><link>${link}</link><description>${body}</description><pubDate>${now}</pubDate>${image ? `<enclosure url="${image}" type="image/jpeg" />` : ""}</item>`;
  const feeds: Record<string, string> = {
    "https://home.example/a.xml": `<?xml version="1.0"?><rss version="2.0"><channel><title>Wire</title><link>https://home.example</link>${entry("a1", "Apple unveils new MacBook Pro with M5 chip", "https://home.example/a/1", "Apple announced it.", "https://img.example/mbp.jpg")}${entry("a2", "A quiet afternoon in the garden", "https://home.example/a/2", "Nothing much.")}</channel></rss>`,
    "https://home.example/b.xml": `<?xml version="1.0"?><rss version="2.0"><channel><title>Daily</title><link>https://home.example</link>${entry("b1", "New MacBook Pro with M5 chip unveiled by Apple", "https://home.example/b/1", "Next week.")}</channel></rss>`,
  };
  const fetcher: typeof import("@/lib/reading/fetch.server").fetchFeedDocument = async (url) =>
    feeds[url] ? { kind: "ok", status: 200, body: feeds[url], contentType: "application/rss+xml", etag: null, lastModified: null, finalUrl: url } : { kind: "error", reason: "not_found", status: 404, detail: "gone" };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    home = await import("@/lib/reading/home.server");
    const connections = await import("@/lib/reading/connections.server");
    const ingest = await import("@/lib/reading/ingest.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `home-test-${stamp}`;
    const [created] = await db.insert(schema.users).values({ appleSub: handle, username: handle, email: `${handle}@example.invalid`, name: "Home Test" }).returning({ id: schema.users.id });
    userId = created.id;
    user.sub = handle;
    user.userId = userId;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Home Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    for (const feed of Object.keys(feeds)) {
      const added = await connections.addFeedConnection({ handle, parentFolderPath: "bookmarks", endpointUrl: feed, actor: { userId, actorType: "human" }, fetcher });
      await ingest.pollFeedConnection(added.connection.id, { fetcher, initial: true });
    }
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

  it("HM-01: For you groups the overlapping story, keeps the image, and lists the rest", async () => {
    const news = await home.readingHome({ handle, user });
    expect(news.mode).toBe("forYou");
    expect(news.modeLabel).toBe("Newest first");
    expect(news.units.map((unit) => unit.kind).sort()).toEqual(["article", "summary"]);
    const summary = news.units.find((unit) => unit.kind === "summary");
    if (!summary || summary.kind !== "summary") throw new Error("no summary");
    expect(summary.sources.sort()).toEqual(["Daily", "Wire"]);
    expect(summary.imageUrl).toBe("https://img.example/mbp.jpg");
    expect(summary.members).toHaveLength(2);
    expect(news.topics.map((topic) => topic.kind)).toEqual(["source", "source"]);
  });

  it("HM-02: Latest is every article on its own, and a source topic narrows both", async () => {
    const latest = await home.readingHome({ handle, user, mode: "latest" });
    expect(latest.units.every((unit) => unit.kind === "article")).toBe(true);
    expect(latest.units).toHaveLength(3);
    const wire = latest.topics.find((topic) => topic.label === "Wire")!;
    const narrowed = await home.readingHome({ handle, user, mode: "latest", topic: wire.id });
    expect(narrowed.topic).toBe(wire.id);
    expect(narrowed.units).toHaveLength(2);
    const paged = await home.readingHome({ handle, user, mode: "latest", limit: 2 });
    expect(paged.units).toHaveLength(2);
    expect(paged.nextOffset).toBe(2);
  });
  it("HM-03: publisher hiding also works before summaries have been materialized", async () => {
    const before = await home.readingHome({ handle, user, mode: "latest" });
    const wire = before.topics.find((topic) => topic.label === "Wire")!;
    const rule = await store.setReadingPreference({ userId, blogId, kind: "source_hidden", target: wire.detail!, label: "Wire", actor: { actorType: "human" } });
    const hidden = await home.readingHome({ handle, user });
    expect(hidden.units).toHaveLength(1);
    expect(hidden.units[0]).toMatchObject({ kind: "article", item: { publisherName: "Daily" } });
    const latestHidden = await home.readingHome({ handle, user, mode: "latest" });
    expect(latestHidden.units).toHaveLength(1);
    expect(latestHidden.units[0]).toMatchObject({ kind: "article", item: { publisherName: "Daily" } });
    await store.removeReadingPreference({ userId, blogId, id: rule.id, actor: { actorType: "human" } });
  });

  it("HM-04: Reading History is private, ordered by reading time, and paginates without repeats; Read Later includes only explicit saves", async () => {
    const { listReadingItems } = await import("@/lib/reading/list.server");
    const { setReadState, setKeep } = await import("@/lib/reading/retention.server");
    const scope = { folderPath: "", includeDescendants: true, state: "read" as const, dateBasis: "read" as const };
    const news = await home.readingHome({ handle, user, mode: "latest" });
    const [first, second] = news.units.map((unit) => unit.id);
    await setReadState({ handle, user, postIds: [first], read: true });
    await setReadState({ handle, user, postIds: [second], read: true });
    const recent = await listReadingItems({ handle, user, scope, limit: 1 });
    expect(recent.items.map((item) => item.id)).toEqual([second]);
    const older = await listReadingItems({ handle, user, scope, limit: 1, cursor: recent.nextCursor });
    expect(older.items.map((item) => item.id)).toEqual([first]);
    expect(older.nextCursor).toBeNull();
    expect((await listReadingItems({ handle, user: null, scope })).items).toEqual([]);
    await setKeep({ handle, postIds: [first], keep: true, actor: { userId, actorType: "human" } });
    await store.setPostStarred(handle, second, true);
    const saved = await listReadingItems({ handle, user, scope: { ...scope, state: "saved", dateBasis: "received" } });
    expect(saved.items.map((item) => item.id)).toEqual([first]);
    await setKeep({ handle, postIds: [first], keep: false, actor: { userId, actorType: "human" } });
    expect((await listReadingItems({ handle, user, scope: { ...scope, state: "saved" } })).items).toEqual([]);
  });

  it("includes manual bookmarks and explicit feed saves in the library, excluding notes and unsaved news", async () => {
    const { listReadingItems } = await import("@/lib/reading/list.server");
    const { setKeep } = await import("@/lib/reading/retention.server");
    const folders = await store.getFolders(handle);
    const bookmarkFolder = folders.find((folder) => folder.path === "bookmarks")!;
    const noteFolder = folders.find((folder) => folder.mode === "notes")!;
    const manual = await store.createDraftInFolder(handle, bookmarkFolder.id, { initial: { title: "Saved reference", type: "bookmark" } });
    const note = await store.createDraftInFolder(handle, noteFolder.id, { initial: { title: "My thought", type: "note" } });
    const news = await home.readingHome({ handle, user, mode: "latest" });
    const feedId = news.units.find((unit) => unit.kind === "article" && unit.item.origin === "feed")!.id;
    const scope = { folderPath: "", includeDescendants: true, state: "bookmarked" as const, dateBasis: "received" as const };
    expect((await listReadingItems({ handle, user, scope })).items.map((item) => item.id)).toEqual([manual.id]);
    await setKeep({ handle, postIds: [feedId], keep: true, actor: { userId, actorType: "human" } });
    const saved = await listReadingItems({ handle, user, scope });
    expect(saved.items.map((item) => item.id).sort()).toEqual([manual.id, feedId].sort());
    expect((await listReadingItems({ handle, user, scope: { ...scope, query: "saved reference" } })).items.map((item) => item.id)).toEqual([manual.id]);
    expect((await listReadingItems({ handle, user, scope: { ...scope, query: "saved reference", state: "saved" } })).items).toEqual([]);
    expect((await listReadingItems({ handle, user, scope: { ...scope, query: "saved reference", folderPath: noteFolder.path } })).items).toEqual([]);
    expect((await listReadingItems({ handle, user, scope: { ...scope, query: "%" } })).items).toEqual([]);
    expect((await listReadingItems({ handle, user: null, scope: { ...scope, query: "saved reference" } })).items).toEqual([]);
    const savedTimeline = await store.listWorkspaceTimeline({ handle, user, filter: "saved" });
    const savedEvent = savedTimeline.entries.find((entry) => entry.id === feedId)!;
    const holds = await db!.select().from(schema.retentionHolds).where(eq(schema.retentionHolds.postId, feedId));
    const keep = holds.find((hold) => hold.reason === "keep" && !hold.releasedAt)!;
    expect(savedEvent.at).toBe(keep.createdAt.toISOString());
    expect(saved.items.some((item) => item.id === note.id)).toBe(false);
    expect((await listReadingItems({ handle, user: null, scope })).items).toEqual([]);
    await setKeep({ handle, postIds: [feedId], keep: false, actor: { userId, actorType: "human" } });
    expect((await listReadingItems({ handle, user, scope })).items.map((item) => item.id)).toEqual([manual.id]);
  });
  it("pages the personal timeline with stable dates, filters, and permission checks", async () => {
    const folders = await store.getFolders(handle);
    const noteFolder = folders.find((folder) => folder.mode === "notes")!;
    const first = await store.createDraftInFolder(handle, noteFolder.id, { initial: { title: "Timeline first", type: "note" } });
    const second = await store.createDraftInFolder(handle, noteFolder.id, { initial: { title: "Timeline second", type: "note" } });
    const start = await store.listWorkspaceTimeline({ handle, user, filter: "writing", limit: 1 });
    expect(start.entries).toHaveLength(1);
    expect(start.nextCursor).not.toBeNull();
    const newer = await store.createDraftInFolder(handle, noteFolder.id, { initial: { title: "After snapshot", type: "note" } });
    const collected = [...start.entries];
    let cursor = start.nextCursor;
    let pages = 0;
    while (cursor && pages++ < 20) {
      const page = await store.listWorkspaceTimeline({ handle, user, filter: "writing", limit: 1, cursor });
      expect(page.snapshot).toBe(start.snapshot);
      collected.push(...page.entries);
      cursor = page.nextCursor;
    }
    expect(cursor, "pagination must terminate").toBeNull();
    expect(new Set(collected.map((entry) => entry.id)).size).toBe(collected.length);
    expect(collected.map((entry) => entry.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(collected.some((entry) => entry.id === newer.id)).toBe(false);
    const original = collected.find((entry) => entry.id === first.id)!;
    await db!.update(schema.posts).set({ updatedAt: new Date() }).where(eq(schema.posts.id, first.id!));
    const refreshed = await store.listWorkspaceTimeline({ handle, user, filter: "writing" });
    expect(refreshed.entries.find((entry) => entry.id === first.id)?.at).toBe(original.at);
    expect((await store.listWorkspaceTimeline({ handle, user: null })).entries).toEqual([]);
    const bookmarks = await store.listWorkspaceTimeline({ handle, user, filter: "saved" });
    expect(bookmarks.entries.length).toBeGreaterThan(0);
    expect(bookmarks.entries.every((entry) => entry.post.type === "bookmark" && entry.kind === "saved")).toBe(true);
    await expect(store.listWorkspaceTimeline({ handle, user, cursor: "invalid" })).rejects.toThrow("Invalid timeline cursor");
    await expect(store.listWorkspaceTimeline({ handle, user, filter: "saved", cursor: start.nextCursor })).rejects.toThrow("Invalid timeline cursor");
  });
  it("keeps mixed-folder content private and preserves identity when moved", async () => {
    const folders = await store.getFolders(handle);
    const notes = folders.find((folder) => folder.mode === "notes")!;
    const blog = folders.find((folder) => folder.path === "blog")!;
    for (const type of ["note", "article", "bookmark"] as const) {
      const item = await store.createDraftInFolder(handle, notes.id, {
        initial: { type, title: `Mixed ${type}`, body: "Keep this content intact." },
      });
      expect(item).toMatchObject({ type, folderId: notes.id, status: "draft", visibility: "private" });
      expect(item.document?.presentation.template.id).toBe(`texttext.${type}`);
      const moved = await store.movePostFile(handle, item.id!, { folderId: blog.id });
      expect(moved?.post).toMatchObject({ id: item.id, type, folderId: blog.id, visibility: "private", status: "draft", body: item.body });
      expect(moved?.post.document).toEqual(item.document);
      const audit = await db!.select().from(schema.actionAudit).where(eq(schema.actionAudit.targetId, item.id!));
      expect(audit.length).toBeGreaterThan(0);
    }
  });
});
