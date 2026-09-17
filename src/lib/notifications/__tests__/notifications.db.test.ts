import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// Against local Postgres only (npm run test:reading:db). Deliveries go to an
// in-memory fetcher; nothing leaves the machine.
const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("notification channels against Postgres", () => {
  let db: typeof import("@/lib/db/client").db;
  let schema: typeof import("@/lib/db/schema");
  let store: typeof import("@/lib/store");
  let dispatch: typeof import("@/lib/notifications/dispatch.server");
  let digest: typeof import("@/lib/reading/digest.server");
  let saved: typeof import("@/lib/reading/saved-searches.server");
  let userId = "";
  let blogId = "";
  let handle = "";
  const actor = { userId: "", actorType: "human" as const };
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher: import("@/lib/notifications/dispatch.server").NotificationFetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (url.includes("broken")) return new Response("nope", { status: 500 });
    return new Response("{}", { status: 200 });
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    ({ db } = await import("@/lib/db/client"));
    schema = await import("@/lib/db/schema");
    store = await import("@/lib/store");
    dispatch = await import("@/lib/notifications/dispatch.server");
    digest = await import("@/lib/reading/digest.server");
    saved = await import("@/lib/reading/saved-searches.server");
    if (!db) throw new Error("no db");
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    handle = `notify-test-${stamp}`;
    const [created] = await db.insert(schema.users).values({ appleSub: `notify-test-${stamp}`, username: handle, email: `${handle}@example.invalid`, name: "Notify Test" }).returning({ id: schema.users.id });
    userId = created.id;
    actor.userId = userId;
    const [blog] = await db.insert(schema.blogs).values({ handle, name: "Notify Test", ownerId: userId }).returning({ id: schema.blogs.id });
    blogId = blog.id;
    await store.ensureWorkspaceFolders(blogId);
  });

  afterAll(async () => {
    if (!db || !blogId) return;
    await db.delete(schema.notificationChannels).where(eq(schema.notificationChannels.blogId, blogId));
    await db.delete(schema.readingSavedSearches).where(eq(schema.readingSavedSearches.blogId, blogId));
    await db.delete(schema.readingJobs).where(eq(schema.readingJobs.blogId, blogId));
    await db.delete(schema.posts).where(eq(schema.posts.blogId, blogId));
    await db.delete(schema.feedConnections).where(eq(schema.feedConnections.blogId, blogId));
    await db.delete(schema.folders).where(eq(schema.folders.blogId, blogId));
    await db.delete(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    await db.delete(schema.actionAudit).where(sql`${schema.actionAudit.targetId} in (${blogId}, ${handle})`);
    await db.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("NT-01: channels are added with a label, refused twice, and audited", async () => {
    const one = await store.addNotificationChannel({ blogId, kind: "apprise", url: "ntfy://notify-test", label: "Phone", actor });
    expect(one.enabled).toBe(true);
    await store.addNotificationChannel({ blogId, kind: "webhook", url: "https://hooks.example/broken", label: "Broken hook", events: ["reading.alert"], actor });
    await expect(store.addNotificationChannel({ blogId, kind: "apprise", url: "ntfy://notify-test", label: "Again", actor })).rejects.toThrow("already");
    expect((await store.listNotificationChannels(blogId)).map((channel) => channel.label)).toEqual(["Phone", "Broken hook"]);
    const audits = await db!.select({ name: schema.actionAudit.actionName }).from(schema.actionAudit).where(eq(schema.actionAudit.actorUserId, userId));
    expect(audits.map((row) => row.name)).toEqual(["notifications.add_channel", "notifications.add_channel"]);
  });

  it("NT-02: dispatch reaches the channels that want the event, records each outcome, and one failure stops nothing", async () => {
    sent.length = 0;
    const deliveries = await dispatch.dispatchNotification({ blogId, fetcher, message: { event: "reading.digest", title: "T", body: "B", workspace: { handle, name: "Notify Test" } } });
    expect(deliveries.map((delivery) => [delivery.label, delivery.ok])).toEqual([["Phone", true]]);
    expect(sent[0].url).toBe("https://ntfy.sh");
    const alerts = await dispatch.dispatchNotification({ blogId, fetcher, message: { event: "reading.alert", title: "T", body: "B", workspace: { handle, name: "Notify Test" } } });
    expect(alerts.map((delivery) => [delivery.label, delivery.ok])).toEqual([["Phone", true], ["Broken hook", false]]);
    const channels = await store.listNotificationChannels(blogId);
    expect(channels.find((channel) => channel.label === "Broken hook")?.lastStatus).toBe("failed");
    expect(channels.find((channel) => channel.label === "Broken hook")?.lastDetail).toContain("500");
    const paused = channels.find((channel) => channel.label === "Phone")!;
    await store.updateNotificationChannel({ blogId, channelId: paused.id, enabled: false, actor });
    const quiet = await dispatch.dispatchNotification({ blogId, fetcher, message: { event: "reading.digest", title: "T", body: "B", workspace: { handle, name: "Notify Test" } } });
    expect(quiet).toEqual([]);
    await store.updateNotificationChannel({ blogId, channelId: paused.id, enabled: true, actor });
  });

  it("NT-03: the digest goes to channels alongside email, with one event per alert", async () => {
    const folders = await store.getFolders(handle);
    const bookmarks = folders.find((folder) => folder.mode === "bookmarks")!;
    const connections = await import("@/lib/reading/connections.server");
    const ingest = await import("@/lib/reading/ingest.server");
    const feedUrl = "https://feeds.example/notify/rss.xml";
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Notify Feed</title><link>https://n.example</link>
      <item><guid>n-1</guid><title>Rust ships a thing</title><link>https://n.example/1</link><description>Rust body.</description><pubDate>${new Date().toUTCString()}</pubDate></item>
      <item><guid>n-2</guid><title>Weather is fine</title><link>https://n.example/2</link><description>Sky.</description><pubDate>${new Date().toUTCString()}</pubDate></item>
      </channel></rss>`;
    const feedFetcher: typeof import("@/lib/reading/fetch.server").fetchFeedDocument = async () => ({ kind: "ok", status: 200, body: feed, contentType: "application/rss+xml", etag: null, lastModified: null, finalUrl: feedUrl });
    const added = await connections.addFeedConnection({ handle, parentFolderPath: bookmarks.path, endpointUrl: feedUrl, actor, fetcher: feedFetcher });
    await ingest.pollFeedConnection(added.connection.id, { fetcher: feedFetcher, initial: true });
    const search = await saved.createSavedSearch({ handle, name: "Rust", query: "rust", folderPath: "", actor });
    await saved.setSavedSearchNotify({ handle, id: search.id, notify: true, actor });
    sent.length = 0;
    const mails: string[] = [];
    const report = await digest.sendReadingDigest({ blogId, force: true, notifier: fetcher, mailer: async (message) => void mails.push(message.subject) });
    expect(report.sent).toBe(true);
    expect(mails).toHaveLength(1);
    const events = sent.map((entry) => entry.body);
    // Phone (all events) gets digest + alert; Broken hook (alerts only) gets the alert.
    expect(sent.filter((entry) => entry.url === "https://ntfy.sh")).toHaveLength(2);
    expect(sent.filter((entry) => entry.url.includes("broken"))).toHaveLength(1);
    const hook = sent.find((entry) => entry.url.includes("broken"))!.body as { event: string; items: Array<{ title: string }> };
    expect(hook.event).toBe("reading.alert");
    expect(hook.items.map((item) => item.title)).toEqual(["Rust ships a thing"]);
    expect(events.length).toBe(3);
  });
});
