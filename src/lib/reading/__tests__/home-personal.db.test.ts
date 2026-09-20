import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Against local Postgres only (npm run test:reading:db). Materialized
// Summaries, identity across a member joining, and one person's seen,
// hidden, and preference state through the same read model Home uses.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("home personalization against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let home: typeof import("@/lib/reading/home.server");
  let materialize: typeof import("@/lib/reading/summaries-materialize.server");
  let ingest: typeof import("@/lib/reading/ingest.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  const user = { sub: "", userId: "" };
  const connectionIds: string[] = [];
  const now = new Date().toUTCString();
  const entry = (id: string, title: string, link: string, body: string) => `<item><guid>${id}</guid><title>${title}</title><link>${link}</link><description>${body}</description><pubDate>${now}</pubDate></item>`;
  const feeds: Record<string, string> = {
    "https://personal.example/a.xml": `<?xml version="1.0"?><rss version="2.0"><channel><title>Wire</title><link>https://personal.example</link>${entry("a1", "Apple unveils new MacBook Pro with M5 chip", "https://personal.example/a/1", "Apple.")}${entry("a2", "Garden club meets on Sunday for the harvest", "https://personal.example/a/2", "Tomatoes.")}</channel></rss>`,
    "https://personal.example/b.xml": `<?xml version="1.0"?><rss version="2.0"><channel><title>Daily</title><link>https://personal.example</link>${entry("b1", "New MacBook Pro with M5 chip unveiled by Apple", "https://personal.example/b/1", "Next week.")}</channel></rss>`,
    "https://personal.example/c.xml": `<?xml version="1.0"?><rss version="2.0"><channel><title>Post</title><link>https://personal.example</link>${entry("c1", "Apple's new MacBook Pro M5 chip unveiled", "https://personal.example/c/1", "Third take.")}</channel></rss>`,
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
    materialize = await import("@/lib/reading/summaries-materialize.server");
    ingest = await import("@/lib/reading/ingest.server");
    const connections = await import("@/lib/reading/connections.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `personal-test-${stamp}`;
    const [created] = await db.insert(schema.users).values({ appleSub: handle, username: handle, email: `${handle}@example.invalid`, name: "Personal Test" }).returning({ id: schema.users.id });
    userId = created.id;
    user.sub = handle;
    user.userId = userId;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Personal Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    for (const feed of Object.keys(feeds)) {
      const added = await connections.addFeedConnection({ handle, parentFolderPath: "bookmarks", endpointUrl: feed, actor: { userId, actorType: "human" }, fetcher });
      connectionIds.push(added.connection.id);
      // The third source arrives later, in HP-01, so a member can join.
      if (!feed.endsWith("/c.xml")) await ingest.pollFeedConnection(added.connection.id, { fetcher, initial: true });
    }
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.readingPreferences).where(eq(schema.readingPreferences.blogId, blogId));
    await db.delete(schema.readingSummaries).where(eq(schema.readingSummaries.blogId, blogId));
    await db.delete(schema.readingTopics).where(eq(schema.readingTopics.blogId, blogId));
    await db.delete(schema.readingJobs).where(eq(schema.readingJobs.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.feedConnections).where(eq(schema.feedConnections.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("HP-01: materializing is idempotent and keeps a Summary's id while a member joins, bumping only the revision", async () => {
    const first = await materialize.materializeSummaries({ blogId, handle, writeTexts: false });
    expect(first).toMatchObject({ summaries: 1, created: 1 });
    expect((await materialize.materializeSummaries({ blogId, handle, writeTexts: false })).created).toBe(0);
    const [before] = await db!.select().from(schema.readingSummaries).where(eq(schema.readingSummaries.blogId, blogId));
    expect(before.memberIds).toHaveLength(2);
    expect(before.coverageRevision).toBe(1);
    // A third source joins the same story.
    await ingest.pollFeedConnection(connectionIds[2], { fetcher, initial: true });
    const third = await materialize.materializeSummaries({ blogId, handle, writeTexts: false });
    expect(third).toMatchObject({ created: 0, revised: 1, retired: 0 });
    const [after] = await db!.select().from(schema.readingSummaries).where(eq(schema.readingSummaries.blogId, blogId));
    expect(after.id).toBe(before.id);
    expect(after.stableKey).toBe(before.stableKey);
    expect(after.memberIds).toHaveLength(3);
    expect(after.coverageRevision).toBe(2);
    expect(after.sourceNames.sort()).toEqual(["Daily", "Post", "Wire"]);
  });

  it("HP-02: For you ranks from the table, names its reasons, and reports new coverage against the seen watermark", async () => {
    const news = await home.readingHome({ handle, user });
    expect(news.modeLabel).toBe("Ranked by freshness and coverage");
    expect(news.snapshot).toBeTruthy();
    const summary = news.units.find((unit) => unit.kind === "summary");
    if (!summary || summary.kind !== "summary") throw new Error("no summary");
    expect(summary.summaryId).toBeTruthy();
    expect(summary.reasons.map((reason) => reason.name)).toEqual(["fresh", "several sources"]);
    expect(summary.seenRevision).toBe(0);
    await store.markSummariesSeen({ userId, blogId, seen: [{ summaryId: summary.summaryId!, revision: 1 }] });
    const seen = await home.readingHome({ handle, user });
    const again = seen.units.find((unit) => unit.kind === "summary");
    if (!again || again.kind !== "summary") throw new Error("no summary");
    expect(again.seenRevision).toBe(1);
    expect(again.coverageRevision).toBe(2);
    expect(again.reasons.map((reason) => reason.name)).toContain("new coverage");
    // A stale acknowledgment never lowers the watermark.
    await store.markSummariesSeen({ userId, blogId, seen: [{ summaryId: summary.summaryId!, revision: 2 }] });
    await store.markSummariesSeen({ userId, blogId, seen: [{ summaryId: summary.summaryId!, revision: 1 }] });
    const state = await store.listSummaryState(userId, [summary.summaryId!]);
    expect(state.get(summary.summaryId!)?.seenRevision).toBe(2);
    // Seeing reads nothing.
    const members = await db!.select({ id: schema.readingReadState.postId }).from(schema.readingReadState).where(eq(schema.readingReadState.userId, userId));
    expect(members).toHaveLength(0);
  });

  it("HP-03: hiding removes the Summary from For you only, and its articles stay in Latest", async () => {
    const news = await home.readingHome({ handle, user });
    const summary = news.units.find((unit) => unit.kind === "summary");
    if (!summary || summary.kind !== "summary") throw new Error("no summary");
    await store.setSummaryHidden({ userId, blogId, summaryId: summary.summaryId!, hidden: true, actor: { actorType: "human" } });
    const hidden = await home.readingHome({ handle, user });
    expect(hidden.units.some((unit) => unit.kind === "summary")).toBe(false);
    expect(hidden.units.some((unit) => unit.kind === "article" && unit.item.title.includes("MacBook"))).toBe(false);
    expect(hidden.hiddenCount).toBe(1);
    const latest = await home.readingHome({ handle, user, mode: "latest" });
    expect(latest.units.filter((unit) => unit.kind === "article" && unit.item.title.includes("MacBook"))).toHaveLength(3);
    // Another person sees it still.
    const other = await home.readingHome({ handle, user: null });
    expect(other.hiddenCount).toBe(0);
    await store.setSummaryHidden({ userId, blogId, summaryId: summary.summaryId!, hidden: false, actor: { actorType: "human" } });
    expect((await home.readingHome({ handle, user })).units.some((unit) => unit.kind === "summary")).toBe(true);
  });

  it("HP-04: a source reduction demotes without removing, a more and a less replace each other, and reset clears everything", async () => {
    const wireFolder = (await home.readingHome({ handle, user })).topics.find((topic) => topic.label === "Wire")!;
    const rule = await store.setReadingPreference({ userId, blogId, kind: "source_less", target: wireFolder.detail!, label: "Wire", actor: { actorType: "human" } });
    const demoted = await home.readingHome({ handle, user });
    expect(demoted.modeLabel).toBe("Ranked with your preferences");
    const garden = demoted.units.find((unit) => unit.kind === "article" && unit.item.title.includes("Garden"));
    expect(garden).toBeTruthy();
    expect(garden!.reasons.map((reason) => reason.name)).toContain("less of this");
    expect(garden!.reasons.find((reason) => reason.name === "less of this")?.value).toBe(-2);
    const summary = demoted.units.find((unit) => unit.kind === "summary");
    // Mixed-source: reduced by Wire's share of three sources, not removed.
    expect(summary).toBeTruthy();
    expect(summary!.reasons.find((reason) => reason.name === "less of this")?.value).toBe(-0.67);
    expect(demoted.units.map((unit) => unit.kind).sort()).toEqual(["article", "summary"]);
    await store.setReadingPreference({ userId, blogId, kind: "topic_more", target: wireFolder.id, label: "Wire", actor: { actorType: "human" } });
    await store.setReadingPreference({ userId, blogId, kind: "topic_less", target: wireFolder.id, label: "Wire", actor: { actorType: "human" } });
    const rules = await store.listReadingPreferences(userId, blogId);
    expect(rules.map((entry) => entry.kind).sort()).toEqual(["source_less", "topic_less"]);
    expect(await store.removeReadingPreference({ userId, blogId, id: rule.id, actor: { actorType: "human" } })).toBe(true);
    const cleared = await store.clearReadingPreferences({ userId, blogId, actor: { actorType: "human" } });
    expect(cleared.rules).toBe(1);
    expect((await home.readingHome({ handle, user })).modeLabel).toBe("Ranked by freshness and coverage");
    const audits = await db!.select({ name: schema.actionAudit.actionName }).from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    expect(audits.map((row) => row.name)).toEqual(expect.arrayContaining(["reading.set_preference", "reading.remove_preference", "reading.clear_preferences", "reading.hide_summary", "reading.unhide_summary"]));
  });
  it("HP-05: hiding a publisher filters every member and headline, stays personal, and can be undone", async () => {
    const before = await home.readingHome({ handle, user });
    const summary = before.units.find((unit) => unit.kind === "summary");
    if (!summary || summary.kind !== "summary") throw new Error("no summary");
    const path = summary.members.find((member) => member.publisherName === "Wire")!.folderPath;
    const rule = await store.setReadingPreference({ userId, blogId, kind: "source_hidden", target: path, label: "Wire", actor: { actorType: "human" } });
    const hidden = await home.readingHome({ handle, user });
    const members = (news: typeof hidden) => [...news.units, ...news.headlines].flatMap((unit) => unit.kind === "article" ? [unit.item] : unit.members);
    expect(members(hidden).some((item) => item.folderPath === path)).toBe(false);
    expect(members(hidden).length).toBeGreaterThan(0);
    expect(members(await home.readingHome({ handle, user, mode: "latest" })).some((item) => item.folderPath === path)).toBe(false);
    expect(members(await home.readingHome({ handle, user: null }))).toEqual([]);
    expect(await store.listReadingPreferences("00000000-0000-4000-8000-000000000001", blogId)).toEqual([]);
    await store.removeReadingPreference({ userId, blogId, id: rule.id, actor: { actorType: "human" } });
    expect(members(await home.readingHome({ handle, user })).some((item) => item.folderPath === path)).toBe(true);
  });

  it("HP-06: hiding an article does not hide the publisher's other reporting", async () => {
    const latest = await home.readingHome({ handle, user, mode: "latest" });
    const garden = latest.units.find((unit) => unit.kind === "article" && unit.item.title.includes("Garden"))!;
    const rule = await store.setReadingPreference({ userId, blogId, kind: "article_hidden", target: garden.id, label: "Garden", actor: { actorType: "human" } });
    const hidden = await home.readingHome({ handle, user });
    expect(hidden.units.some((unit) => unit.id === garden.id)).toBe(false);
    expect(hidden.units.some((unit) => unit.kind === "summary" && unit.sources.includes("Wire"))).toBe(true);
    await store.removeReadingPreference({ userId, blogId, id: rule.id, actor: { actorType: "human" } });
  });

});
