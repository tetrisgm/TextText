import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { blogs, users } from "@/lib/db/schema";
import { recordAction } from "@/lib/audit";
import { dispatchNotification, type NotificationFetch } from "@/lib/notifications/dispatch.server";
import { rootDomainUrl } from "@/lib/site-url";
import { blogWorkspacePostPath } from "@/lib/public-paths";
import { holdInsertQuery } from "./holds";
import { listReadingItems, type ReadingListItem } from "./list.server";
import { alertingSearches } from "./saved-searches.server";
import { searchReading } from "./search.server";

/**
 * The daily digest: one email to the owner with what arrived in the last
 * day, alerts first. Alerts are saved searches with notify on; every new
 * match is kept (a hold, so cleanup never takes it) and listed at the top.
 * The rest is grouped by source. Built from the data, never generated, so
 * every line is a link to an article and to its original.
 *
 * Sent once per calendar day per workspace, at the owner's chosen UTC hour,
 * by whichever cron pass first sees that hour; the day stamp on the blog
 * row is the idempotency key.
 */

export type DigestMailer = (message: { to: string; subject: string; text: string }) => Promise<void>;

export type DigestReport = {
  handle: string;
  to: string | null;
  alerts: Array<{ name: string; items: ReadingListItem[] }>;
  articles: number;
  sent: boolean;
  reason?: "no_email" | "nothing_new" | "mailer_unavailable";
};

const MAX_ARTICLES = 60;

function requireDb() {
  if (!db) throw new Error("Digests need DATABASE_URL");
  return db;
}

async function defaultMailer(message: { to: string; subject: string; text: string }): Promise<void> {
  const server = process.env.AUTH_EMAIL_SERVER;
  const from = process.env.AUTH_EMAIL_FROM ?? "TextText <noreply@TextText.app>";
  if (!server) throw new Error("mailer_unavailable");
  const { createTransport } = await import("nodemailer");
  await createTransport(server).sendMail({ ...message, from });
}

/** Keep every new match of an alerting search and return them, per search. */
export async function applyAlerts(input: { handle: string; blogId: string; ownerId: string; since: Date }): Promise<Array<{ name: string; items: ReadingListItem[] }>> {
  const database = requireDb();
  const user = { sub: null, userId: input.ownerId };
  const results: Array<{ name: string; items: ReadingListItem[] }> = [];
  for (const search of await alertingSearches(input.blogId)) {
    const report = await searchReading({ handle: input.handle, user, query: search.query, scope: { folderPath: search.folderPath || null }, limit: 50, embedder: null });
    if (report.results.length === 0) continue;
    const page = await listReadingItems({
      handle: input.handle,
      user,
      scope: { folderPath: search.folderPath || "", includeDescendants: true, state: "all", dateBasis: "received", ids: report.results.map((result) => result.id) },
      limit: 50,
    });
    const fresh = page.items.filter((item) => item.origin === "feed" && new Date(item.receivedAt) >= input.since);
    if (fresh.length === 0) continue;
    for (const item of fresh) {
      if (!item.keptReasons.includes("keep")) {
        await holdInsertQuery(database, { postId: item.id, blogId: input.blogId, reason: "keep", sourceId: `alert:${search.id}`, createdById: null });
      }
    }
    results.push({ name: search.name, items: fresh });
  }
  return results;
}

export function digestText(input: {
  origin: string;
  blog: { handle: string; username?: string; name: string };
  alerts: Array<{ name: string; items: ReadingListItem[] }>;
  articles: ReadingListItem[];
}): string {
  const lines: string[] = [];
  const link = (item: ReadingListItem) => `${input.origin}${blogWorkspacePostPath(input.blog, item.folderPath, { slug: item.slug })}`;
  for (const alert of input.alerts) {
    lines.push(`ALERT: ${alert.name}`);
    for (const item of alert.items) {
      lines.push(`- ${item.title} (${item.publisherName ?? item.sourceFolderName})`);
      lines.push(`  ${link(item)}`);
      if (item.permalink) lines.push(`  original: ${item.permalink}`);
    }
    lines.push("");
  }
  const bySource = new Map<string, ReadingListItem[]>();
  for (const item of input.articles) {
    const key = item.publisherName ?? item.sourceFolderName;
    bySource.set(key, [...(bySource.get(key) ?? []), item]);
  }
  lines.push(`${input.articles.length} ${input.articles.length === 1 ? "article" : "articles"} from ${bySource.size} ${bySource.size === 1 ? "source" : "sources"} in the last day.`);
  lines.push("");
  for (const [source, items] of bySource) {
    lines.push(source.toUpperCase());
    for (const item of items) {
      lines.push(`- ${item.title}`);
      lines.push(`  ${link(item)}`);
    }
    lines.push("");
  }
  lines.push(`Kept articles stay; the rest pass through on each feed's schedule. Manage sources: ${input.origin}/t/${input.blog.handle}`);
  return lines.join("\n");
}

export async function sendReadingDigest(input: { blogId: string; now?: Date; mailer?: DigestMailer; force?: boolean; notifier?: NotificationFetch }): Promise<DigestReport> {
  const database = requireDb();
  const now = input.now ?? new Date();
  const [row] = await database
    .select({ handle: blogs.handle, username: users.username, name: blogs.name, ownerId: blogs.ownerId, email: users.email, sentOn: blogs.readingDigestSentOn })
    .from(blogs)
    .innerJoin(users, eq(users.id, blogs.ownerId))
    .where(and(eq(blogs.id, input.blogId), isNull(blogs.deletedAt)))
    .limit(1);
  if (!row || !row.ownerId) return { handle: "", to: null, alerts: [], articles: 0, sent: false, reason: "no_email" };
  const day = now.toISOString().slice(0, 10);
  if (!input.force && row.sentOn === day) return { handle: row.handle, to: row.email, alerts: [], articles: 0, sent: false, reason: "nothing_new" };
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const alerts = await applyAlerts({ handle: row.handle, blogId: input.blogId, ownerId: row.ownerId, since });
  const page = await listReadingItems({
    handle: row.handle,
    user: { sub: null, userId: row.ownerId },
    scope: { folderPath: "", includeDescendants: true, state: "all", dateBasis: "received" },
    limit: MAX_ARTICLES,
  });
  const alertIds = new Set(alerts.flatMap((alert) => alert.items.map((item) => item.id)));
  const articles = page.items.filter((item) => item.origin === "feed" && new Date(item.receivedAt) >= since && !alertIds.has(item.id));
  // Stamp the day first so two cron passes in the same hour send once.
  await database
    .update(blogs)
    .set({ readingDigestSentOn: day })
    .where(and(eq(blogs.id, input.blogId), input.force ? sql`true` : sql`coalesce(${blogs.readingDigestSentOn}, '') <> ${day}`));
  if (alerts.length === 0 && articles.length === 0) return { handle: row.handle, to: row.email, alerts, articles: 0, sent: false, reason: "nothing_new" };
  const origin = rootDomainUrl().toString().replace(/\/$/, "");
  const text = digestText({ origin, blog: { handle: row.handle, username: row.username ?? undefined, name: row.name }, alerts, articles });
  const subject = alerts.length > 0 ? `Reading: ${alerts.map((alert) => alert.name).join(", ")} and ${articles.length} more` : `Reading: ${articles.length} new ${articles.length === 1 ? "article" : "articles"}`;
  // The workspace's own channels get the same news alongside email: one
  // digest event, and one event per alert so a channel can subscribe to
  // alerts alone. A channel failing never touches the email.
  const workspace = { handle: row.handle, name: row.name };
  const itemOf = (item: ReadingListItem) => ({ title: item.title, url: item.permalink ?? item.externalUrl ?? null, source: item.publisherName ?? item.sourceFolderName ?? null });
  const manage = `${origin}/t/${row.handle}`;
  const notified = await dispatchNotification({
    blogId: input.blogId,
    fetcher: input.notifier,
    message: { event: "reading.digest", title: subject, body: text, url: manage, workspace, items: [...alerts.flatMap((alert) => alert.items), ...articles].slice(0, 50).map(itemOf) },
  });
  for (const alert of alerts) {
    await dispatchNotification({
      blogId: input.blogId,
      fetcher: input.notifier,
      message: { event: "reading.alert", title: `${alert.name}: ${alert.items.length} new`, body: alert.items.map((item) => `- ${item.title}`).join("\n"), url: manage, workspace, items: alert.items.slice(0, 50).map(itemOf) },
    });
  }
  if (!row.email) {
    return { handle: row.handle, to: null, alerts, articles: articles.length, sent: notified.some((delivery) => delivery.ok), reason: notified.some((delivery) => delivery.ok) ? undefined : "no_email" };
  }
  try {
    await (input.mailer ?? defaultMailer)({ to: row.email, subject, text });
  } catch (error) {
    if (error instanceof Error && error.message === "mailer_unavailable") {
      return { handle: row.handle, to: row.email, alerts, articles: articles.length, sent: false, reason: "mailer_unavailable" };
    }
    throw error;
  }
  await recordAction({ actorUserId: null, actorType: "human", actionName: "reading.send_digest", targetType: "workspace", targetId: row.handle, outputSummary: `${articles.length} articles, ${alerts.length} alerts` });
  return { handle: row.handle, to: row.email, alerts, articles: articles.length, sent: true };
}

/**
 * Whether this workspace's digest is due: its hour has passed today and
 * nothing has been sent today. There is no scheduler; the app's own tick
 * asks this on the requests it already serves, so the digest goes out the
 * first time the workspace is touched after its hour.
 */
export async function digestDue(blogId: string, now = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const [row] = await requireDb()
    .select({ hour: blogs.readingDigestHour, sentOn: blogs.readingDigestSentOn })
    .from(blogs)
    .where(and(eq(blogs.id, blogId), isNull(blogs.deletedAt)))
    .limit(1);
  if (!row || row.hour === null) return false;
  return now.getUTCHours() >= row.hour && row.sentOn !== day;
}

export async function readingDigestSetting(blogId: string): Promise<{ hour: number | null; sentOn: string | null }> {
  const [row] = await requireDb().select({ hour: blogs.readingDigestHour, sentOn: blogs.readingDigestSentOn }).from(blogs).where(eq(blogs.id, blogId)).limit(1);
  return { hour: row?.hour ?? null, sentOn: row?.sentOn ?? null };
}

export async function setReadingDigestHour(input: { blogId: string; hour: number | null; actor: { userId: string | null } }): Promise<void> {
  const hour = input.hour === null ? null : Math.max(0, Math.min(23, Math.trunc(input.hour)));
  await requireDb().update(blogs).set({ readingDigestHour: hour }).where(eq(blogs.id, input.blogId));
  await recordAction({ actorUserId: input.actor.userId, actorType: "human", actionName: "reading.set_digest_hour", targetType: "workspace", inputSummary: hour === null ? "off" : `${hour}:00 UTC` });
}
