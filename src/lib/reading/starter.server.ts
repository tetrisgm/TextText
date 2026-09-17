import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { actionAudit } from "@/lib/db/schema";
import { recordAction, type AuditEntry } from "@/lib/audit";
import { getFolders } from "@/lib/store";
import { addFeedConnection, listFeedConnections } from "./connections.server";
import { STARTER_ACTION, STARTER_FEEDS, STARTER_STARTED, type StarterFeed } from "./starter-feeds";

/**
 * Giving a workspace its first sources, exactly once.
 *
 * The rule is the whole of it: a workspace that has never been given the
 * starter set, and follows nothing right now, gets it. A workspace that was
 * given it and then emptied is a workspace whose owner said no, and it is
 * never seeded again. The audit row is what remembers, so there is no new
 * column and no hidden setting: the decision is in the same ledger as every
 * other mutation.
 */

/** How many are followed in one pass, so a cold open is not a long wait. */
const BATCH = 6;
/**
 * Articles taken from each feed on the way in. Sixteen feeds at the usual
 * hundred would fill a free workspace's whole item allowance on the first
 * open and leave every later poll refusing to import. Eight each is a full
 * looking Home with room left for the person's own work.
 */
const STARTER_IMPORT = 8;

/**
 * One source per channel, then the next of each, and so on.
 *
 * The catalogue is written grouped by subject because that is how a person
 * reads it, but following it in that order gives the first batch entirely to
 * Technology, and a workspace opened before the rest arrive has five tabs
 * with nothing behind them. Round robin means every channel has an article
 * in it from the first pass.
 */
export function roundRobinByChannel(feeds: readonly StarterFeed[]): StarterFeed[] {
  const queues = new Map<string, StarterFeed[]>();
  for (const feed of feeds) {
    const queue = queues.get(feed.topic);
    if (queue) queue.push(feed);
    else queues.set(feed.topic, [feed]);
  }
  const out: StarterFeed[] = [];
  while (out.length < feeds.length) {
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

function requireDb() {
  if (!db) throw new Error("Starter sources need DATABASE_URL");
  return db;
}

async function ledgerHas(blogId: string, action: string): Promise<boolean> {
  const rows = await requireDb()
    .select({ id: actionAudit.id })
    .from(actionAudit)
    .where(and(eq(actionAudit.actionName, action), eq(actionAudit.targetId, blogId)))
    .limit(1);
  return rows.length > 0;
}

export async function starterWasApplied(blogId: string): Promise<boolean> {
  return ledgerHas(blogId, STARTER_ACTION);
}

/** Started and not finished: the tick carries it the rest of the way. */
export async function starterIsUnfinished(blogId: string): Promise<boolean> {
  if (await ledgerHas(blogId, STARTER_ACTION)) return false;
  return ledgerHas(blogId, STARTER_STARTED);
}

export type StarterOutcome =
  | { applied: false; reason: "already_applied" | "has_sources" | "no_folder" }
  | { applied: true; added: number; failed: number; remaining: number };

/**
 * Follow the starter set under the workspace's bookmarks root. Bounded per
 * call and safe to call again: `addFeedConnection` is idempotent on a feed's
 * identity, so a second pass adds what the first did not reach rather than
 * importing anything twice.
 */
export async function applyStarterFeeds(input: {
  handle: string;
  blogId: string;
  actor: { userId: string | null; actorType: AuditEntry["actorType"] };
  limit?: number;
}): Promise<StarterOutcome> {
  if (await starterWasApplied(input.blogId)) return { applied: false, reason: "already_applied" };
  const following = await listFeedConnections(input.handle);
  const started = await ledgerHas(input.blogId, STARTER_STARTED);
  // A workspace that follows something without having been started is one
  // whose owner chose those sources. Once started, its own half-finished set
  // is what the later passes continue.
  if (following.length > 0 && !started) return { applied: false, reason: "has_sources" };
  const folders = await getFolders(input.handle);
  const parent = folders.find((folder) => folder.mode === "bookmarks" && !folder.path.includes("/"));
  if (!parent) return { applied: false, reason: "no_folder" };

  // Matched on the folder name this seeding gave each feed, not on its
  // address: a feed that redirects (ArchDaily answers from FeedBurner) is
  // stored under the address it settled on, and comparing addresses made a
  // part-finished set look like somebody else's workspace.
  const followedNames = new Set(following.map((connection) => connection.folderName));
  const outstanding = roundRobinByChannel(STARTER_FEEDS.filter((feed) => !followedNames.has(feed.name)));
  const limit = Math.max(1, Math.min(STARTER_FEEDS.length, input.limit ?? BATCH));
  const pending = outstanding.slice(0, limit);
  if (!started) {
    await recordAction({
      actorUserId: input.actor.userId,
      actorType: input.actor.actorType,
      actionName: STARTER_STARTED,
      targetType: "workspace",
      targetId: input.blogId,
      inputSummary: String(STARTER_FEEDS.length),
    });
  }
  let added = 0;
  let failed = 0;
  for (const feed of pending) {
    try {
      await addFeedConnection({
        handle: input.handle,
        parentFolderPath: parent.path,
        endpointUrl: feed.url,
        name: feed.name,
        // The catalogue's topic IS the channel: a workspace opens with a
        // strip of subjects, not a strip of publisher names.
        channel: feed.topic,
        initialImportLimit: STARTER_IMPORT,
        actor: input.actor,
        // The same key every time, so a retried pass reopens the connection
        // it made rather than making a second one.
        idempotencyKey: `starter:${input.blogId}:${feed.url}`,
      });
      added += 1;
    } catch {
      // A publisher that is down today must not stop the other fifteen, and
      // must not stop the workspace being marked as started either: the
      // person can add it themselves, and would rather have the rest.
      failed += 1;
    }
  }
  const remaining = outstanding.length - pending.length;
  if (remaining === 0) {
    await recordAction({
      actorUserId: input.actor.userId,
      actorType: input.actor.actorType,
      actionName: STARTER_ACTION,
      targetType: "workspace",
      targetId: input.blogId,
      inputSummary: String(STARTER_FEEDS.length),
      outputSummary: `${added} followed, ${failed} unreachable`,
    });
  }
  return { applied: true, added, failed, remaining };
}
