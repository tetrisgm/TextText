import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * How many times the Home talks to the database.
 *
 * Against local Postgres a round trip is a fraction of a millisecond, so a
 * page can make fifty and still feel instant here while taking seconds in the
 * Mac app, where every one of them is an HTTPS request to another continent.
 * The count is the thing that has to be held, and it is invisible unless
 * something counts it.
 *
 * This caught the regression it now guards: channels had made a page ask for
 * its workspace ten times and its folders eight, and read every source in a
 * channel separately, which is how For You went to 27 statements and a
 * channel to 50. The budgets below are the measured numbers with room for a
 * small honest change, not aspirations. If one fails, the fix is almost never
 * to raise it: look for the same question being asked twice.
 */

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

/** What a page may spend. Measured 2026-09-18 at 15, 14 and 10. */
const BUDGET = { forYou: 20, channel: 20, latest: 15 };

describe.skipIf(!enabled)("the Home's round trips", () => {
  let db: typeof import("@/lib/db/client").db;
  let queriesIssued: typeof import("@/lib/db/client").queriesIssued;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let home: typeof import("@/lib/reading/home.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  const user = { sub: "", userId: "" };
  const now = new Date().toUTCString();
  const entry = (id: string, title: string) =>
    `<item><guid>${id}</guid><title>${title}</title><link>https://budget.example/${id}</link><description>Body of ${id}.</description><pubDate>${now}</pubDate></item>`;
  // Six sources in one channel: the shape that used to cost one pass each.
  const feeds: Record<string, string> = Object.fromEntries(
    ["a", "b", "c", "d", "e", "f"].map((key) => [
      `https://budget.example/${key}.xml`,
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Source ${key.toUpperCase()}</title><link>https://budget.example</link>${[1, 2, 3, 4, 5]
        .map((index) => entry(`${key}${index}`, `Story ${index} from ${key.toUpperCase()}`))
        .join("")}</channel></rss>`,
    ]),
  );
  const fetcher: typeof import("@/lib/reading/fetch.server").fetchFeedDocument = async (url) =>
    feeds[url]
      ? { kind: "ok", status: 200, body: feeds[url], contentType: "application/rss+xml", etag: null, lastModified: null, finalUrl: url }
      : { kind: "error", reason: "not_found", status: 404, detail: "gone" };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db, queriesIssued } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    home = await import("@/lib/reading/home.server");
    const connections = await import("@/lib/reading/connections.server");
    const ingest = await import("@/lib/reading/ingest.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `budget-test-${stamp}`;
    const [created] = await db
      .insert(schema.users)
      .values({ appleSub: handle, username: handle, email: `${handle}@example.invalid`, name: "Budget Test" })
      .returning({ id: schema.users.id });
    userId = created.id;
    user.sub = handle;
    user.userId = userId;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Budget Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
    for (const feed of Object.keys(feeds)) {
      const added = await connections.addFeedConnection({
        handle,
        parentFolderPath: "bookmarks",
        endpointUrl: feed,
        channel: "Technology",
        actor: { userId, actorType: "human" },
        fetcher,
      });
      await ingest.pollFeedConnection(added.connection.id, { fetcher, initial: true });
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

  const spent = async (run: () => Promise<unknown>): Promise<number> => {
    const before = queriesIssued();
    await run();
    return queriesIssued() - before;
  };

  it("QB-01: For You stays inside its budget", async () => {
    // Warm first: the first call of the process pays for things a page does
    // not, and the budget is about the steady state a person lives in.
    await home.readingHome({ handle, user });
    const count = await spent(() => home.readingHome({ handle, user }));
    expect(count, `For You spent ${count} round trips`).toBeLessThanOrEqual(BUDGET.forYou);
  });

  it("QB-02: a channel costs about what For You costs, however many sources it has", async () => {
    await home.readingHome({ handle, user, topic: "channel:Technology" });
    const count = await spent(() => home.readingHome({ handle, user, topic: "channel:Technology" }));
    expect(count, `the channel spent ${count} round trips across six sources`).toBeLessThanOrEqual(BUDGET.channel);
    // The point of the budget: six sources must not mean six passes.
    const forYou = await spent(() => home.readingHome({ handle, user }));
    expect(count).toBeLessThanOrEqual(forYou + 4);
  });

  it("QB-03: Latest is the cheapest of the three", async () => {
    await home.readingHome({ handle, user, mode: "latest" });
    const count = await spent(() => home.readingHome({ handle, user, mode: "latest" }));
    expect(count, `Latest spent ${count} round trips`).toBeLessThanOrEqual(BUDGET.latest);
  });

  it("QB-04: the channel returns only its own sources", async () => {
    const channel = await home.readingHome({ handle, user, topic: "channel:Technology" });
    expect(channel.units.length).toBeGreaterThan(0);
    expect(channel.topics.map((topic) => topic.label)).toContain("Technology");
    // Narrowing by folder must not drop items that belong.
    const all = await home.readingHome({ handle, user });
    expect(channel.considered).toBe(all.considered);
  });

  it("QB-05: a source uses the existing folder snapshot", async () => {
    const source = (await store.getFolders(handle)).find((folder) => folder.path.startsWith("bookmarks/"))!;
    const input = { handle, user, mode: "latest" as const, topic: `source:${source.path}` };
    const page = await home.readingHome(input);
    expect(page.units).toHaveLength(5);
    expect(page.units.every((unit) => unit.kind === "article" && unit.item.folderId === source.id)).toBe(true);
    const count = await spent(() => home.readingHome(input));
    const latest = await spent(() => home.readingHome({ handle, user, mode: "latest" }));
    expect(count, `the source spent ${count} round trips`).toBeLessThanOrEqual(latest);
  });
});
