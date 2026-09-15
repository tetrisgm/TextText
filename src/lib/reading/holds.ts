import { sql, type SQL } from "drizzle-orm";
import { retentionHolds } from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";

/**
 * Retention holds: one row per reason a person gave for keeping an item.
 *
 * Holds are written in the same transaction as the act that creates them
 * (a star, a comment, a Keep) so protection never depends on a second save,
 * and each reason is released only by undoing that same act, so removing one
 * protection can never remove another. The query builders here take the
 * executor so the store can fold them into its own atomic batches; nothing in
 * this module reads or writes on its own.
 */

export const DURABLE_HOLD_REASONS = [
  "manual_save",
  "starred",
  "keep",
  "comment",
  "reference",
  "keep_summary",
  "used_in_work",
] as const;

export type DurableHoldReason = (typeof DURABLE_HOLD_REASONS)[number];
export type HoldReason = DurableHoldReason | "proposal_lease" | "processing_lease";

export type HoldKey = {
  postId: string;
  reason: HoldReason;
  /** The originating object (a comment id, a linking item id); "" for the item itself. */
  sourceId?: string;
};

export function holdInsertQuery(
  database: Database,
  hold: HoldKey & { blogId: string; createdById?: string | null; expiresAt?: Date | null },
) {
  return database
    .insert(retentionHolds)
    .values({
      postId: hold.postId,
      blogId: hold.blogId,
      reason: hold.reason,
      sourceId: hold.sourceId ?? "",
      createdById: hold.createdById ?? null,
      expiresAt: hold.expiresAt ?? null,
    })
    .onConflictDoNothing();
}

export function holdReleaseQuery(database: Database, hold: HoldKey, now = new Date()) {
  return database
    .update(retentionHolds)
    .set({ releasedAt: now })
    .where(
      sql`${retentionHolds.postId} = ${hold.postId} and ${retentionHolds.reason} = ${hold.reason} and ${retentionHolds.sourceId} = ${hold.sourceId ?? ""} and ${retentionHolds.releasedAt} is null`,
    );
}

/**
 * Raw fragments for the store's WITH ... CTE statements, where the hold has
 * to commit with a guarded insert it depends on.
 */
export function holdInsertCte(input: {
  postId: string;
  blogId: SQL;
  reason: HoldReason;
  sourceId: SQL;
  createdById: string | null;
  fromCte: string;
}): SQL {
  return sql`INSERT INTO ${retentionHolds} (post_id, blog_id, reason, source_id, created_by_id)
    SELECT ${input.postId}::uuid, ${input.blogId}, ${input.reason}, ${input.sourceId}, ${input.createdById}::uuid
    FROM ${sql.identifier(input.fromCte)}
    ON CONFLICT DO NOTHING`;
}

export const durableHoldExistsSql = (postIdColumn: SQL): SQL =>
  sql`exists (
    select 1 from ${retentionHolds}
    where ${retentionHolds.postId} = ${postIdColumn}
      and ${retentionHolds.releasedAt} is null
      and ${retentionHolds.reason} in (${sql.join(
        DURABLE_HOLD_REASONS.map((reason) => sql`${reason}`),
        sql`, `,
      )})
  )`;
