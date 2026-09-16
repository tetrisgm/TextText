import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  blogs,
  feedConnections,
  feedReceipts,
  posts,
  readingProvenance,
  readingSourceRevisions,
} from "@/lib/db/schema";
import { recordAction } from "@/lib/audit";
import {
  countAllPosts,
  createDraftInFolder,
  getFolderById,
  getOwnerPlan,
  getPostById,
  PostConflictError,
  savePostContentPatch,
} from "@/lib/store";
import { cleanPlanTier, planLimits } from "@/lib/product-limits";
import { slugify } from "@/lib/post-edit-draft";
import { enqueueIndexItem } from "./embeddings.server";
import { canonicalizeUrl, endpointKey, sha256, usableFeedDate } from "./feed-identity";
import { fetchFeedDocument, type FeedFetchOutcome } from "./fetch.server";
import { FeedParseError, parseFeed, type NormalizedEntry, type NormalizedFeed } from "./feed-parse";
import type { FeedConnectionRow } from "./connections.server";
import type { ReadingJobRow } from "./jobs.server";

/**
 * Importing: one poll of one connection, in bounded batches, idempotent.
 *
 * A poll fetches conditionally, parses, and for every entry decides one of
 * four things by the receipt ledger: never seen (create an ordinary item),
 * seen and unchanged (touch lastSeenAt), seen and changed (record a source
 * revision, and update the item only when nobody has edited it), or expired
 * (the tombstone wins; the entry is not resurrected). Malformed entries are
 * skipped and counted; earlier successes are never rolled back by a later
 * failure.
 */

export const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000;
const FAILURE_BACKOFF_MS = [5, 15, 60, 240, 720].map((minutes) => minutes * 60 * 1000);
const NORMALIZATION_VERSION = 1;
const MAX_ITEMS_PER_POLL = 200;

/** How a feed document is obtained. Production uses the SSRF-gated fetch;
 * tests supply fixture documents, because that gate rejects loopback servers
 * by design and must not grow a bypass for the sake of a test. */
export type FeedDocumentFetcher = typeof fetchFeedDocument;

export type PollReport = {
  connectionId: string;
  outcome: "imported" | "not_modified" | "no_new_items" | "error" | "skipped";
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  suppressed: number;
  skipped: number;
  health: string;
  detail: string | null;
};

function requireDb() {
  if (!db) throw new Error("Feed import needs DATABASE_URL");
  return db;
}

function healthFor(fetch: FeedFetchOutcome): { health: string; detail: string } {
  if (fetch.kind !== "error") return { health: "healthy", detail: "" };
  switch (fetch.reason) {
    case "auth_required":
      return { health: "auth_required", detail: fetch.detail };
    case "rate_limited":
      return { health: "rate_limited", detail: fetch.detail };
    case "not_found":
      return { health: "moved", detail: fetch.detail };
    case "blocked":
    case "too_large":
      return { health: "unsupported", detail: fetch.detail };
    default:
      return { health: "failing", detail: fetch.detail };
  }
}

function isMuted(entry: NormalizedEntry, mutedKeywords: readonly string[]): boolean {
  if (mutedKeywords.length === 0) return false;
  const haystack = `${entry.title}\n${entry.bodyText}`.toLocaleLowerCase();
  return mutedKeywords.some((word) => word && haystack.includes(word.toLocaleLowerCase()));
}

function contentHashFor(entry: NormalizedEntry): string {
  return sha256(
    `${NORMALIZATION_VERSION}\n${entry.title}\n${entry.bodyText}\n${entry.permalink ?? ""}\n${entry.externalUrl ?? ""}`,
  );
}

function retentionExpiry(
  firstImportedAt: Date,
  connection: Pick<FeedConnectionRow, "retentionDays">,
  workspaceDefaultDays: number,
): Date | null {
  const days = connection.retentionDays ?? workspaceDefaultDays;
  if (days <= 0) return null;
  return new Date(firstImportedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The body an untouched imported item carries; exported so cleanup can tell a person's edit from source text. */
export function itemBody(entry: Pick<NormalizedEntry, "bodyMarkdown" | "permalink" | "externalUrl">): string {
  if (entry.bodyMarkdown) return entry.bodyMarkdown;
  // Metadata-only entries still get a body a reader can act on: the link.
  const target = entry.permalink ?? entry.externalUrl;
  return target ? `[Read the original](${target})` : "";
}

async function handleFor(blogId: string): Promise<string> {
  const rows = await requireDb().select({ handle: blogs.handle }).from(blogs).where(eq(blogs.id, blogId)).limit(1);
  if (!rows[0]) throw new Error("Workspace not found");
  return rows[0].handle;
}

async function workspaceRetentionDays(blogId: string): Promise<number> {
  const rows = await requireDb()
    .select({ days: blogs.readingRetentionDays })
    .from(blogs)
    .where(eq(blogs.id, blogId))
    .limit(1);
  return rows[0]?.days ?? 90;
}

type EntryDecision = "created" | "updated" | "unchanged" | "suppressed" | "skipped";

async function importEntry(input: {
  handle: string;
  connection: FeedConnectionRow;
  entry: NormalizedEntry;
  feed: NormalizedFeed;
  now: Date;
  workspaceDefaultDays: number;
  publisherName: string;
}): Promise<EntryDecision> {
  const { entry, connection, now } = input;
  const database = requireDb();
  const contentHash = contentHashFor(entry);
  const existing = await database
    .select()
    .from(feedReceipts)
    .where(and(eq(feedReceipts.connectionId, connection.id), eq(feedReceipts.externalKey, entry.externalKey)))
    .limit(1);
  const receipt = existing[0];

  if (receipt) {
    if (receipt.status === "expired") {
      // The tombstone. Seeing the entry again is not a reason to bring it back.
      await database.update(feedReceipts).set({ lastSeenAt: now }).where(eq(feedReceipts.id, receipt.id));
      return "suppressed";
    }
    if (!receipt.postId) {
      // A receipt without its item: an earlier import stopped between the
      // two writes. Finish it now instead of leaving the entry unreachable.
      return materializeEntry({ ...input, receiptId: receipt.id, contentHash });
    }
    if (receipt.contentHash === contentHash) {
      await database.update(feedReceipts).set({ lastSeenAt: now }).where(eq(feedReceipts.id, receipt.id));
      return "unchanged";
    }
    return applySourceRevision({ ...input, receipt, contentHash });
  }

  // The receipt is claimed first, so the same entry can never become two
  // items: a concurrent poll loses on the unique index before anything is
  // visible, and a crash after this point leaves a receipt the next poll
  // completes rather than an orphan item it would duplicate.
  const claimed = await database
    .insert(feedReceipts)
    .values({
      connectionId: connection.id,
      blogId: connection.blogId,
      externalKey: entry.externalKey,
      postId: null,
      firstImportedAt: now,
      lastSeenAt: now,
      contentHash,
      expiresAt: retentionExpiry(now, connection, input.workspaceDefaultDays),
      status: "active",
    })
    .onConflictDoNothing({ target: [feedReceipts.connectionId, feedReceipts.externalKey] })
    .returning({ id: feedReceipts.id });
  if (claimed.length === 0) return "unchanged";
  return materializeEntry({ ...input, receiptId: claimed[0].id, contentHash });
}

/** Create the item for a claimed receipt, then its provenance and first revision. */
async function materializeEntry(input: {
  handle: string;
  connection: FeedConnectionRow;
  entry: NormalizedEntry;
  feed: NormalizedFeed;
  now: Date;
  publisherName: string;
  receiptId: string;
  contentHash: string;
}): Promise<EntryDecision> {
  const { entry, connection, now, contentHash } = input;
  const database = requireDb();
  // An ordinary item, through the store, with the same validation,
  // projection and audit as anything a person creates.
  const publishedAt = usableFeedDate(entry.publishedAt, now);
  const sourceUpdatedAt = usableFeedDate(entry.updatedAt, now);
  const permalink = entry.permalink ?? entry.externalUrl;
  const post = await createDraftInFolder(input.handle, connection.folderId, {
    origin: "feed",
    initial: {
      type: "bookmark",
      slug: slugify(entry.title, `item-${Date.now().toString(36)}`),
      title: entry.title,
      excerpt: entry.excerpt ?? undefined,
      body: itemBody(entry),
      links: permalink ? [{ label: input.publisherName, href: permalink }] : undefined,
      tags: [],
    },
    audit: {
      actorUserId: connection.createdById,
      actorType: "human",
      actionName: "reading.import_item",
      targetType: "item",
      inputSummary: `${input.feed.format} ${entry.externalKey}`.slice(0, 300),
      outputSummary: `${entry.availability} · ${input.publisherName}`,
    },
  });
  if (!post.id) throw new Error("Imported item has no id");
  await database
    .update(feedReceipts)
    .set({ postId: post.id, contentHash, lastSeenAt: now })
    .where(eq(feedReceipts.id, input.receiptId));
  // The same article from another feed: point at the copy that arrived
  // first so lists show one. Decided once here, so no list pays for it.
  const canonicalUrl = canonicalizeUrl(entry.permalink ?? entry.externalUrl);
  const earlier = canonicalUrl
    ? await database
        .select({ id: posts.id })
        .from(readingProvenance)
        .innerJoin(posts, eq(posts.id, readingProvenance.postId))
        .where(
          and(
            eq(readingProvenance.blogId, connection.blogId),
            eq(readingProvenance.canonicalUrl, canonicalUrl),
            isNull(readingProvenance.duplicateOfPostId),
            isNull(posts.deletedAt),
            eq(posts.origin, "feed"),
            sql`${posts.id} <> ${post.id}::uuid`,
          ),
        )
        .orderBy(posts.createdAt, posts.id)
        .limit(1)
    : [];
  await database
    .insert(readingProvenance)
    .values({
      postId: post.id,
      blogId: connection.blogId,
      connectionId: connection.id,
      publisherTitle: entry.title,
      publisherName: input.publisherName,
      authors: entry.authors,
      permalink: entry.permalink,
      externalUrl: entry.externalUrl,
      canonicalUrl,
      duplicateOfPostId: earlier[0]?.id ?? null,
      publishedAt,
      sourceUpdatedAt,
      availability: entry.availability,
      language: entry.language,
      sourceHash: contentHash,
      normalizationVersion: NORMALIZATION_VERSION,
      capturedAt: now,
      revisionCount: 1,
      updatedAt: now,
    })
    .onConflictDoNothing();
  await database
    .insert(readingSourceRevisions)
    .values({
      postId: post.id,
      sourceHash: contentHash,
      title: entry.title,
      bodyMarkdown: entry.bodyMarkdown,
      availability: entry.availability,
      capturedAt: now,
    })
    .onConflictDoNothing();
  await enqueueIndexItem(connection.blogId, post.id);
  return "created";
}

/**
 * The publisher changed an entry we already hold. The new version is always
 * recorded as a revision; the item's displayed body follows it only while the
 * item still shows the previous source version untouched. A person's edit
 * wins, and the newer source waits as a revision they can review.
 */
async function applySourceRevision(input: {
  handle: string;
  connection: FeedConnectionRow;
  entry: NormalizedEntry;
  now: Date;
  receipt: typeof feedReceipts.$inferSelect;
  contentHash: string;
}): Promise<EntryDecision> {
  const { entry, receipt, now, contentHash } = input;
  const database = requireDb();
  if (!receipt.postId) return "unchanged";
  const post = await getPostById(input.handle, receipt.postId);
  if (!post || !post.id) {
    await database.update(feedReceipts).set({ lastSeenAt: now }).where(eq(feedReceipts.id, receipt.id));
    return "unchanged";
  }
  await database
    .insert(readingSourceRevisions)
    .values({
      postId: post.id,
      sourceHash: contentHash,
      title: entry.title,
      bodyMarkdown: entry.bodyMarkdown,
      availability: entry.availability,
      capturedAt: now,
    })
    .onConflictDoNothing();

  const provenance = await database
    .select()
    .from(readingProvenance)
    .where(eq(readingProvenance.postId, post.id))
    .limit(1);
  const previousSource = provenance[0]
    ? await database
        .select({ title: readingSourceRevisions.title, body: readingSourceRevisions.bodyMarkdown })
        .from(readingSourceRevisions)
        .where(
          and(
            eq(readingSourceRevisions.postId, post.id),
            eq(readingSourceRevisions.sourceHash, provenance[0].sourceHash),
          ),
        )
        .limit(1)
    : [];
  const untouched =
    previousSource[0] !== undefined &&
    post.title === previousSource[0].title &&
    (post.body === previousSource[0].body || post.body === itemBody({ ...entry, bodyMarkdown: previousSource[0].body }));

  let applied = untouched;
  if (untouched) {
    // Guarded on the revision we compared against: an edit that lands between
    // the read and this write makes the save miss, and the edit wins.
    try {
      await savePostContentPatch(
      input.handle,
      post,
      { title: entry.title, body: itemBody(entry) },
      {
        expectedRevision: post.revision,
        audit: {
          actorUserId: input.connection.createdById,
          actorType: "human",
          actionName: "reading.apply_source_revision",
          targetType: "item",
          targetId: post.id,
          inputSummary: contentHash.slice(0, 16),
        },
      },
    );
    } catch (error) {
      if (!(error instanceof PostConflictError)) throw error;
      applied = false;
    }
  }
  await database
    .update(readingProvenance)
    .set({
      publisherTitle: entry.title,
      sourceUpdatedAt: usableFeedDate(entry.updatedAt, now),
      availability: entry.availability,
      ...(applied ? { sourceHash: contentHash } : {}),
      revisionCount: sql`${readingProvenance.revisionCount} + 1`,
      updatedAt: now,
    })
    .where(eq(readingProvenance.postId, post.id));
  await database
    .update(feedReceipts)
    .set({ lastSeenAt: now, contentHash: applied ? contentHash : receipt.contentHash })
    .where(eq(feedReceipts.id, receipt.id));
  if (applied) await enqueueIndexItem(input.connection.blogId, post.id);
  return "updated";
}

/**
 * Poll one connection now. Safe to call repeatedly; every effect is keyed.
 */
export async function pollFeedConnection(
  connectionId: string,
  options: { now?: Date; initial?: boolean; manual?: boolean; fetcher?: FeedDocumentFetcher } = {},
): Promise<PollReport> {
  const fetcher = options.fetcher ?? fetchFeedDocument;
  const database = requireDb();
  const now = options.now ?? new Date();
  const rows = await database
    .select()
    .from(feedConnections)
    .where(eq(feedConnections.id, connectionId))
    .limit(1);
  const connection = rows[0];
  const base: PollReport = {
    connectionId,
    outcome: "skipped",
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    suppressed: 0,
    skipped: 0,
    health: connection?.health ?? "disabled",
    detail: null,
  };
  if (!connection || connection.deletedAt || connection.state !== "active") return base;

  // One poll per connection at a time. The claim is the row itself: a poll
  // that started in the last minute is still running, so this one yields.
  const claimed = await database
    .update(feedConnections)
    .set({ lastCheckedAt: now })
    .where(
      and(
        eq(feedConnections.id, connection.id),
        or(isNull(feedConnections.lastCheckedAt), sql`${feedConnections.lastCheckedAt} < ${new Date(now.getTime() - 60_000)}`),
      ),
    )
    .returning({ id: feedConnections.id });
  if (claimed.length === 0 && !options.manual) return { ...base, detail: "Another check is running" };

  const handle = await handleFor(connection.blogId);
  const folder = await getFolderById(handle, connection.folderId);
  if (!folder) {
    await database
      .update(feedConnections)
      .set({ health: "disabled", healthDetail: "Its folder is gone", state: "paused", updatedAt: now })
      .where(eq(feedConnections.id, connection.id));
    return { ...base, health: "disabled", detail: "Its folder is gone" };
  }

  const fetched = await fetcher(connection.endpointUrl, {
    etag: connection.etag,
    lastModified: connection.lastModified,
  });
  if (fetched.kind === "not_modified") {
    await database
      .update(feedConnections)
      .set({
        health: "healthy",
        healthDetail: null,
        consecutiveFailures: 0,
        lastCheckedAt: now,
        lastSuccessAt: now,
        nextCheckAt: new Date(now.getTime() + DEFAULT_POLL_INTERVAL_MS),
        updatedAt: now,
      })
      .where(eq(feedConnections.id, connection.id));
    return { ...base, outcome: "not_modified", health: "healthy" };
  }
  if (fetched.kind === "error") {
    const failures = connection.consecutiveFailures + 1;
    const backoff = FAILURE_BACKOFF_MS[Math.min(failures, FAILURE_BACKOFF_MS.length) - 1];
    const status = healthFor(fetched);
    await database
      .update(feedConnections)
      .set({
        health: status.health,
        healthDetail: status.detail,
        consecutiveFailures: failures,
        lastCheckedAt: now,
        nextCheckAt: new Date(now.getTime() + backoff),
        updatedAt: now,
      })
      .where(eq(feedConnections.id, connection.id));
    return { ...base, outcome: "error", health: status.health, detail: status.detail };
  }

  let feed: NormalizedFeed;
  try {
    feed = parseFeed(fetched.body, fetched.contentType);
  } catch (error) {
    const detail = error instanceof FeedParseError ? error.message : "The feed could not be read";
    const failures = connection.consecutiveFailures + 1;
    await database
      .update(feedConnections)
      .set({
        health: error instanceof FeedParseError && error.code === "unsupported" ? "unsupported" : "degraded",
        healthDetail: detail,
        consecutiveFailures: failures,
        lastCheckedAt: now,
        nextCheckAt: new Date(now.getTime() + FAILURE_BACKOFF_MS[Math.min(failures, FAILURE_BACKOFF_MS.length) - 1]),
        updatedAt: now,
      })
      .where(eq(feedConnections.id, connection.id));
    return { ...base, outcome: "error", health: "degraded", detail };
  }

  // Budget: the workspace's plan cap and the connection's own limits.
  const tier = cleanPlanTier(await getOwnerPlan(handle));
  const remainingCapacity = Math.max(0, planLimits(tier).maxPosts - (await countAllPosts(handle)));
  const firstImport = !connection.lastImportAt;
  const perPoll = Math.min(
    MAX_ITEMS_PER_POLL,
    firstImport ? connection.initialImportLimit : MAX_ITEMS_PER_POLL,
  );
  const workspaceDefaultDays = await workspaceRetentionDays(connection.blogId);
  const publisherName = connection.publisherTitle ?? feed.title;

  // Newest first so a bounded first import takes the latest entries.
  const ordered = [...feed.entries].sort((a, b) => {
    const at = usableFeedDate(a.publishedAt, now)?.getTime() ?? 0;
    const bt = usableFeedDate(b.publishedAt, now)?.getTime() ?? 0;
    return bt - at;
  });

  const report: PollReport = { ...base, outcome: "no_new_items", fetched: feed.entries.length, health: "healthy" };
  let createdBudget = Math.min(perPoll, remainingCapacity);
  for (const entry of ordered) {
    try {
      // Existing entries are always reconciled; only new items spend budget.
      const seen = await database
        .select({ id: feedReceipts.id })
        .from(feedReceipts)
        .where(and(eq(feedReceipts.connectionId, connection.id), eq(feedReceipts.externalKey, entry.externalKey)))
        .limit(1);
      if (seen.length === 0 && createdBudget <= 0) {
        report.skipped += 1;
        continue;
      }
      // Muted words stop an entry at the door; one already here is not
      // pulled back out, and a word unmuted later lets the next poll take it.
      if (seen.length === 0 && isMuted(entry, connection.mutedKeywords ?? [])) {
        report.suppressed += 1;
        continue;
      }
      const decision = await importEntry({
        handle,
        connection,
        entry,
        feed,
        now,
        workspaceDefaultDays,
        publisherName,
      });
      if (decision === "created") {
        report.created += 1;
        createdBudget -= 1;
      } else if (decision === "updated") report.updated += 1;
      else if (decision === "unchanged") report.unchanged += 1;
      else if (decision === "suppressed") report.suppressed += 1;
      else report.skipped += 1;
    } catch (error) {
      // One bad entry does not stop the poll or undo the good ones.
      report.skipped += 1;
      report.detail = error instanceof Error ? error.message : String(error);
    }
  }
  if (report.created > 0 || report.updated > 0) report.outcome = "imported";

  const capReached = remainingCapacity === 0 && report.skipped > 0;
  await database
    .update(feedConnections)
    .set({
      health: capReached ? "disabled" : report.skipped > 0 && report.detail ? "degraded" : "healthy",
      healthDetail: capReached
        ? "This workspace reached its item limit; new articles are not imported"
        : report.detail && report.skipped > 0
          ? `${report.skipped} entries could not be imported`
          : null,
      feedFormat: feed.format,
      // A check that landed somewhere else followed a redirect. Remember the
      // new address so the owner can adopt it; nothing changes on its own.
      movedToUrl: endpointKey(fetched.finalUrl) !== endpointKey(connection.endpointUrl) ? fetched.finalUrl : connection.movedToUrl,
      publisherTitle: connection.publisherTitle ?? feed.title,
      siteUrl: connection.siteUrl ?? feed.siteUrl,
      // A conditional fetch would hide the entries that failed or were
      // deferred this time behind a 304, so validators advance only when
      // every entry in the document was reconciled.
      etag: report.skipped === 0 ? fetched.etag : null,
      lastModified: report.skipped === 0 ? fetched.lastModified : null,
      consecutiveFailures: 0,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastImportAt: report.created > 0 || firstImport ? now : connection.lastImportAt,
      nextCheckAt: new Date(now.getTime() + DEFAULT_POLL_INTERVAL_MS),
      updatedAt: now,
    })
    .where(eq(feedConnections.id, connection.id));

  if (report.created > 0) {
    await recordAction({
      actorUserId: connection.createdById,
      actorType: "human",
      actionName: options.initial ? "reading.initial_import" : "reading.poll_import",
      targetType: "folder",
      targetId: connection.folderId,
      outputSummary: `${report.created} new, ${report.updated} updated, ${report.suppressed} suppressed`,
    });
  }
  return report;
}

/** Executor for the poll_feed job kind. */
export async function runPollFeedJob(job: ReadingJobRow, fetcher?: FeedDocumentFetcher): Promise<void> {
  const connectionId = String(job.payload.connectionId ?? "");
  if (!connectionId) throw new Error("poll_feed job has no connectionId");
  const report = await pollFeedConnection(connectionId, {
    initial: job.payload.initial === true,
    manual: job.payload.manual === true,
    fetcher,
  });
  if (report.outcome === "error") {
    // Let the job's own retry/backoff handle transient failures; a permanent
    // health state (auth, moved, unsupported) is recorded on the connection
    // and does not need the queue to keep trying.
    if (["failing", "rate_limited", "degraded"].includes(report.health)) {
      throw new Error(report.detail ?? report.health);
    }
  }
}

/**
 * Queue polls for every active connection whose check is due. Called by the
 * tick route; bounded by the connection count of one workspace.
 */
export async function enqueueDueFeedPolls(
  blogId: string,
  enqueue: (input: { blogId: string; kind: "poll_feed"; opKey: string; payload: Record<string, unknown> }) => Promise<boolean>,
  now = new Date(),
): Promise<number> {
  const handle = await handleFor(blogId);
  const due = await requireDb()
    .select({ id: feedConnections.id })
    .from(feedConnections)
    .where(
      and(
        eq(feedConnections.blogId, blogId),
        eq(feedConnections.state, "active"),
        sql`${feedConnections.deletedAt} is null`,
        sql`(${feedConnections.nextCheckAt} is null or ${feedConnections.nextCheckAt} <= ${now})`,
      ),
    )
    .limit(200);
  let queued = 0;
  for (const row of due) {
    if (
      await enqueue({
        blogId,
        kind: "poll_feed",
        opKey: `poll_feed:${row.id}:due`,
        payload: { connectionId: row.id, handle },
      })
    ) {
      queued += 1;
    }
  }
  return queued;
}

/** Item ids under a set of source folders, for tests and previews. */
export async function feedItemIdsInFolders(blogId: string, folderIds: string[]): Promise<string[]> {
  if (folderIds.length === 0) return [];
  const rows = await requireDb()
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.blogId, blogId),
        eq(posts.origin, "feed"),
        inArray(posts.folderId, folderIds),
        sql`${posts.deletedAt} is null`,
      ),
    );
  return rows.map((row) => row.id);
}
