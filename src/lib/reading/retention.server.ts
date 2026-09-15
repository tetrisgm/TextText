import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, executeAtomicBatch } from "@/lib/db/client";
import {
  blogs,
  feedReceipts,
  posts,
  readingProvenance,
  readingReadState,
  readingSourceRevisions,
} from "@/lib/db/schema";
import { auditCteFrom, auditInsertQuery, type AuditActorType } from "@/lib/audit";
import { getPostSlugAliases, getWorkspaceWikiLinkSources, workspaceIdForHandle } from "@/lib/store";
import type { AccessUser } from "@/lib/permissions";
import { resolveReadingFolderIds } from "./list.server";
import { extractWikiLinks } from "@/lib/wikilinks";
import { durableHoldExistsSql, holdInsertQuery, holdReleaseQuery } from "./holds";
import { itemBody } from "./ingest.server";
import { enqueueReadingJob, type ReadingJobRow } from "./jobs.server";
import { readingFlags } from "./flags";

/**
 * Retention: what keeps an imported item, and what happens when nothing does.
 *
 * Protection is decided at the moment a person acts (see holds.ts). Cleanup
 * is decided here, later, in a bounded sweep that re-checks every reason an
 * item could still matter before it touches anything:
 *
 *   - a durable hold or a star (written with the act itself);
 *   - a link from another item, `[[...]]`, which is a use in the person's
 *     own work even though nothing was written at link time;
 *   - a body or title that differs from the last source revision, which is a
 *     person's edit even if no hold recorded it.
 *
 * The last two are found here rather than on the editor's save path, so
 * typing never pays for retention bookkeeping. An expired, unprotected item
 * moves to Trash through the same revision-guarded statement the store uses,
 * and its receipt becomes the tombstone that stops the next poll from
 * bringing it back. Nothing is hard-deleted.
 */

function requireDb() {
  if (!db) throw new Error("Reading retention needs DATABASE_URL");
  return db;
}

export type RetentionActor = { userId: string | null; actorType: AuditActorType };

export async function setKeep(input: {
  handle: string;
  postIds: string[];
  keep: boolean;
  actor: RetentionActor;
}): Promise<{ changed: number }> {
  const database = requireDb();
  const blogId = await workspaceIdForHandle(input.handle);
  if (input.postIds.length === 0) return { changed: 0 };
  const owned = await database
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.blogId, blogId), inArray(posts.id, input.postIds), isNull(posts.deletedAt)));
  if (owned.length === 0) return { changed: 0 };
  // Holds and their audit rows commit together; the writes are addressed by
  // id and always affect their row, which is what auditInsertQuery requires.
  await executeAtomicBatch((executor) =>
    owned.flatMap((row) => [
      input.keep
        ? holdInsertQuery(executor, { postId: row.id, blogId, reason: "keep", createdById: input.actor.userId })
        : holdReleaseQuery(executor, { postId: row.id, reason: "keep" }),
      auditInsertQuery(
        {
          actorUserId: input.actor.userId,
          actorType: input.actor.actorType,
          actionName: input.keep ? "reading.keep_item" : "reading.unkeep_item",
          targetType: "item",
          targetId: row.id,
        },
        executor,
      ),
    ]),
  );
  return { changed: owned.length };
}

/**
 * Per-person read state; never a workspace fact and never a reason to keep
 * or drop an item. Only items the person can see in this workspace are
 * written; anything else in the list is dropped, so a foreign id is neither
 * marked nor confirmed to exist.
 */
export async function setReadState(input: {
  handle: string;
  user: AccessUser;
  postIds: string[];
  read: boolean;
  now?: Date;
}): Promise<number> {
  const database = requireDb();
  const userId = input.user.userId;
  if (!userId || input.postIds.length === 0) return 0;
  const { blogId, folderIds } = await resolveReadingFolderIds({ handle: input.handle, user: input.user, folderPath: "", includeDescendants: true });
  if (folderIds.length === 0) return 0;
  const visible = await database
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.blogId, blogId), isNull(posts.deletedAt), inArray(posts.id, input.postIds), inArray(posts.folderId, folderIds)));
  if (visible.length === 0) return 0;
  const now = input.now ?? new Date();
  await database
    .insert(readingReadState)
    .values(visible.map((row) => ({ userId, postId: row.id, readAt: input.read ? now : null, updatedAt: now })))
    .onConflictDoUpdate({
      target: [readingReadState.userId, readingReadState.postId],
      set: { readAt: input.read ? now : null, updatedAt: now },
    });
  return visible.length;
}

/** Mark every live reading item in these folders read for one person. Bounded by the scope, one statement. */
export async function setReadStateForScope(input: { userId: string; blogId: string; folderIds: string[]; now?: Date }): Promise<number> {
  const database = requireDb();
  if (input.folderIds.length === 0) return 0;
  const now = input.now ?? new Date();
  const result = await database.execute(sql`
    insert into ${readingReadState} (user_id, post_id, read_at, updated_at)
    select ${input.userId}::uuid, p.id, ${now}, ${now}
    from ${posts} p
    where p.blog_id = ${input.blogId} and p.deleted_at is null and p.origin = 'feed'
      and p.folder_id in (${sql.join(input.folderIds.map((id) => sql`${id}::uuid`), sql`, `)})
    on conflict (user_id, post_id) do update set read_at = excluded.read_at, updated_at = excluded.updated_at
    returning post_id
  `);
  return result.rows.length;
}

export type CleanupCandidate = {
  postId: string;
  receiptId: string;
  title: string;
  slug: string;
  folderId: string | null;
  revision: number;
  expiresAt: Date;
};

export type CleanupPreview = {
  /** Items that would move to Trash now. */
  expiring: CleanupCandidate[];
  /** Expired items the sweep will keep, with the reason it found. */
  protected: Array<CleanupCandidate & { reason: "reference" | "manual_save" }>;
  /** True when more than `limit` items were due; run again to continue. */
  truncated: boolean;
};

const CLEANUP_BATCH = 200;

/**
 * Find expired, unprotected items without changing anything. Also used by
 * the sweep itself, so the preview and the run cannot disagree.
 */
export async function previewCleanup(input: {
  handle: string;
  now?: Date;
  limit?: number;
}): Promise<CleanupPreview> {
  const database = requireDb();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(CLEANUP_BATCH, input.limit ?? CLEANUP_BATCH));
  const blogId = await workspaceIdForHandle(input.handle);

  // Cheap SQL filters first: due, live, feed-origin, not starred, no durable
  // hold. Bounded to one batch plus one, so we can say whether more remain.
  const due = await database
    .select({
      postId: posts.id,
      receiptId: feedReceipts.id,
      title: posts.title,
      slug: posts.slug,
      folderId: posts.folderId,
      revision: posts.revision,
      expiresAt: feedReceipts.expiresAt,
      body: posts.body,
      permalink: readingProvenance.permalink,
      externalUrl: readingProvenance.externalUrl,
    })
    .from(feedReceipts)
    .innerJoin(posts, eq(posts.id, feedReceipts.postId))
    .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
    .where(
      and(
        eq(feedReceipts.blogId, blogId),
        // Detached feeds keep their receipts' policies; only a tombstone is out.
        inArray(feedReceipts.status, ["active", "detached"]),
        lt(feedReceipts.expiresAt, now),
        isNull(posts.deletedAt),
        eq(posts.origin, "feed"),
        eq(posts.starred, false),
        sql`not ${durableHoldExistsSql(sql`${posts.id}`)}`,
      ),
    )
    .orderBy(feedReceipts.expiresAt)
    .limit(limit + 1);
  const truncated = due.length > limit;
  const rows = due.slice(0, limit);
  if (rows.length === 0) return { expiring: [], protected: [], truncated: false };

  // Reasons the cheap filters cannot see. Both are computed once per sweep,
  // not per item.
  const referencedSlugs = await referencedCanonicalSlugs(input.handle);
  const ids = rows.map((row) => row.postId);
  const latestRevisions = await database
    .select({
      postId: readingSourceRevisions.postId,
      title: readingSourceRevisions.title,
      bodyMarkdown: readingSourceRevisions.bodyMarkdown,
      capturedAt: readingSourceRevisions.capturedAt,
    })
    .from(readingSourceRevisions)
    .where(inArray(readingSourceRevisions.postId, ids))
    .orderBy(desc(readingSourceRevisions.capturedAt));
  const latestByPost = new Map<string, { title: string; bodyMarkdown: string }>();
  for (const revision of latestRevisions) {
    if (!latestByPost.has(revision.postId)) latestByPost.set(revision.postId, revision);
  }

  const expiring: CleanupCandidate[] = [];
  const protectedItems: CleanupPreview["protected"] = [];
  for (const row of rows) {
    const candidate: CleanupCandidate = {
      postId: row.postId,
      receiptId: row.receiptId,
      title: row.title,
      slug: row.slug,
      folderId: row.folderId ?? null,
      revision: row.revision,
      expiresAt: row.expiresAt ?? now,
    };
    if (referencedSlugs.has(row.slug)) {
      protectedItems.push({ ...candidate, reason: "reference" });
      continue;
    }
    const source = latestByPost.get(row.postId);
    const untouched =
      !source ||
      ((row.title === source.title) &&
        (row.body === source.bodyMarkdown ||
          row.body === itemBody({ bodyMarkdown: source.bodyMarkdown, permalink: row.permalink, externalUrl: row.externalUrl })));
    if (!untouched) {
      protectedItems.push({ ...candidate, reason: "manual_save" });
      continue;
    }
    expiring.push(candidate);
  }
  return { expiring, protected: protectedItems, truncated };
}

async function referencedCanonicalSlugs(handle: string): Promise<Set<string>> {
  const [sources, aliases] = await Promise.all([getWorkspaceWikiLinkSources(handle), getPostSlugAliases(handle)]);
  const slugs = new Set<string>();
  for (const source of sources) {
    for (const link of extractWikiLinks(source.body)) {
      const canonical = aliases[link.target];
      if (canonical) slugs.add(canonical);
    }
  }
  return slugs;
}

export type CleanupReport = {
  trashed: number;
  protected: number;
  skipped: number;
  truncated: boolean;
  dryRun: boolean;
};

export async function runCleanup(input: {
  handle: string;
  actor: RetentionActor;
  dryRun?: boolean;
  now?: Date;
  limit?: number;
}): Promise<CleanupReport> {
  const database = requireDb();
  const now = input.now ?? new Date();
  const preview = await previewCleanup({ handle: input.handle, now, limit: input.limit });
  const blogId = await workspaceIdForHandle(input.handle);

  // Reasons found by the sweep become holds, so the Kept view and the next
  // sweep both see them without recomputing.
  if (!input.dryRun && preview.protected.length > 0) {
    await executeAtomicBatch((executor) =>
      preview.protected.flatMap((item) => [
        holdInsertQuery(executor, { postId: item.postId, blogId, reason: item.reason, createdById: null }),
        auditInsertQuery(
          {
            actorUserId: input.actor.userId,
            actorType: input.actor.actorType,
            actionName: "reading.protect_item",
            targetType: "item",
            targetId: item.postId,
            inputSummary: item.reason,
          },
          executor,
        ),
      ]),
    );
  }
  if (input.dryRun) {
    return {
      trashed: preview.expiring.length,
      protected: preview.protected.length,
      skipped: 0,
      truncated: preview.truncated,
      dryRun: true,
    };
  }

  let trashed = 0;
  let skipped = 0;
  for (const item of preview.expiring) {
    // Guarded on the revision the preview saw: an edit that lands between the
    // preview and this statement makes the guard miss, and the item stays.
    // The receipt flips with the row, in one statement, so a trashed item is
    // always a tombstone and a kept item never is.
    const auditCte = auditCteFrom(
      {
        actorUserId: input.actor.userId,
        actorType: input.actor.actorType,
        actionName: "reading.expire_item",
        targetType: "item",
        inputSummary: `retention ${item.expiresAt.toISOString()}`,
        outputSummary: item.title,
      },
      "changed",
      sql`changed.id::text`,
    );
    const result = await database.execute(sql`
      WITH changed AS (
        UPDATE ${posts} SET deleted_at = ${now}, updated_at = ${now}
        WHERE id = ${item.postId} AND blog_id = ${blogId}
          AND deleted_at IS NULL AND starred = false AND revision = ${item.revision}
          AND NOT ${durableHoldExistsSql(sql`${posts.id}`)}
        RETURNING id
      ), receipt AS (
        UPDATE ${feedReceipts} SET status = 'expired', expired_at = ${now}
        WHERE id = ${item.receiptId} AND EXISTS (SELECT 1 FROM changed)
        RETURNING id
      ), audit AS (${auditCte})
      SELECT id FROM changed
    `);
    if (result.rows.length > 0) trashed += 1;
    else skipped += 1;
  }
  return { trashed, protected: preview.protected.length, skipped, truncated: preview.truncated, dryRun: false };
}

/**
 * The unattended sweep. Off unless TEXTTEXT_READING_CLEANUP is set; an owner's
 * explicit preview or run never depends on the flag.
 */
export async function enqueueRetentionSweep(blogId: string, now = new Date()): Promise<boolean> {
  if (!readingFlags.automaticCleanup) return false;
  const day = now.toISOString().slice(0, 10);
  return enqueueReadingJob({ blogId, kind: "retention_enforce", opKey: `retention_enforce:${day}`, runAfter: now });
}

export async function runRetentionJob(job: ReadingJobRow): Promise<void> {
  const rows = await requireDb().select({ handle: blogs.handle }).from(blogs).where(eq(blogs.id, job.blogId)).limit(1);
  const handle = rows[0]?.handle;
  if (!handle) return;
  let report = await runCleanup({ handle, actor: { userId: null, actorType: "human" } });
  // Keep going in bounded batches; stop when a batch trashes nothing so a
  // wall of protected items cannot spin.
  while (report.truncated && report.trashed > 0) {
    report = await runCleanup({ handle, actor: { userId: null, actorType: "human" } });
  }
}
