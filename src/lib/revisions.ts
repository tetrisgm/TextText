import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { postRevisions } from "@/lib/db/schema";
import type { AuditActorType } from "@/lib/audit";
import type { DocumentSnapshot } from "@/lib/documents/model";

/**
 * Document history: the versions writes replaced.
 *
 * The rule this file exists to enforce is one sentence: nothing may replace a
 * document's text without first writing that text down, in the same statement.
 * A save, a collaborative materialization, a file the Mac pushed, an agent
 * edit, a baseline rotation: each of them supersedes a version, and each of
 * them lands a row here as part of the statement that does it, so a write that
 * commits cannot leave the version it destroyed unrecorded.
 *
 * Bounded so an autosave does not become a database. An ordinary write records
 * at most one version every COALESCE_MINUTES per writer, where a writer is the
 * action, the kind of actor, and the person. Two things are never coalesced
 * away: a write that replaces existing text, measured as the span between the
 * common prefix and suffix rather than as a net shrink, and a write a caller
 * marks as forced. That is the whole difference between a history and a safety
 * net.
 *
 * Retention keeps the newest KEEP_RECENT versions of an item plus the
 * KEEP_LARGEST largest ones, so a long session of deletions cannot evict the
 * full version someone came here for. Both bounds are approximate by a row or
 * two: the prune is a sibling CTE of the insert and shares its snapshot, so it
 * cannot see the version just recorded.
 */

const COALESCE_MINUTES = 2;
/** Newest versions kept per item. */
const KEEP_RECENT = 180;
/** Largest versions kept per item, whatever their age. */
const KEEP_LARGEST = 20;
/** A document this short has nothing worth protecting from a replacement. */
const REPLACED_FLOOR = 1;

export type RevisionWriter = {
  /** The action that superseded the version, e.g. "save_document" or "collab.rotate". */
  action: string;
  /** "system" is the server acting on its own, such as a baseline rotation. */
  actorType: AuditActorType;
  actorUserId?: string | null;
};

export type SupersededVersion = {
  blogId: string;
  revision: number | null;
  document: DocumentSnapshot;
  title: string | null;
  body: string;
};

export function bodyOf(document: DocumentSnapshot | null | undefined): string {
  const body = (document as { content?: { body?: unknown } } | null | undefined)?.content?.body;
  return typeof body === "string" ? body : "";
}

/**
 * How much of the old text this write replaces: the span left once the shared
 * opening and ending are removed. Ordinary typing replaces nothing, however
 * long the insertion; a truncation, a select-all-paste, and a same length
 * rewrite all replace a lot, and none of those may be coalesced away.
 */
export function replacedLength(previous: string, next: string): number {
  const shortest = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < shortest && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  return Math.max(0, previous.length - prefix - suffix);
}

function isForced(previous: SupersededVersion, nextBody: string, force?: boolean): boolean {
  if (force) return true;
  if (previous.revision === null) return true;
  return replacedLength(previous.body, nextBody) > REPLACED_FLOOR;
}

/** One writer is one action, by one kind of actor, by one person. */
function sameWriterRecently(writer: RevisionWriter, postId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${postRevisions} recent
    WHERE recent.post_id = ${postId}
      AND recent.superseded_by_action = ${writer.action}
      AND recent.superseded_by_actor_type = ${writer.actorType}
      AND recent.superseded_by_actor_user_id IS NOT DISTINCT FROM ${writer.actorUserId ?? null}::uuid
      AND recent.created_at > now() - interval '${sql.raw(String(COALESCE_MINUTES))} minutes'
  )`;
}

/**
 * The INSERT that records one superseded version, for folding into the same
 * statement as the write that supersedes it. `fromCte` must name a CTE with
 * one row per landed write carrying `id` and `revision`; a guarded write that
 * matched nothing therefore records nothing, exactly like the audit CTE.
 */
export function revisionCteFrom(input: {
  previous: SupersededVersion;
  nextBody: string;
  writer: RevisionWriter;
  fromCte: string;
  /** Records regardless of the window, for a change the body does not show. */
  force?: boolean;
}): SQL {
  const { previous, nextBody, writer } = input;
  const bodyLength = previous.body.length;
  const shrankBy = Math.max(0, bodyLength - nextBody.length);
  const forced = isForced(previous, nextBody, input.force);
  const source = sql.identifier(input.fromCte);
  return sql`INSERT INTO ${postRevisions}
      (post_id, blog_id, revision, document, title, body_length, shrank_by,
       superseded_by_revision, superseded_by_action, superseded_by_actor_type, superseded_by_actor_user_id)
    SELECT ${source}.id, ${previous.blogId}::uuid, ${previous.revision}, ${JSON.stringify(previous.document)}::jsonb,
           ${previous.title}, ${bodyLength}, ${shrankBy},
           ${source}.revision, ${writer.action}, ${writer.actorType}, ${writer.actorUserId ?? null}::uuid
    FROM ${source}
    WHERE ${forced} OR NOT ${sameWriterRecently(writer, sql`${source}.id`)}`;
}

/**
 * Keeps the newest versions and the largest ones, in the same statement.
 * Without the size half, a session of deletions records a version every few
 * seconds and evicts the full document it exists to protect.
 */
export function revisionPruneCteFrom(fromCte: string): SQL {
  const source = sql.identifier(fromCte);
  return sql`DELETE FROM ${postRevisions}
    WHERE post_id IN (SELECT id FROM ${source})
      AND id NOT IN (
        SELECT id FROM (
          (SELECT recent.id FROM ${postRevisions} recent
            WHERE recent.post_id IN (SELECT id FROM ${source})
            ORDER BY recent.created_at DESC
            LIMIT ${KEEP_RECENT})
          UNION
          (SELECT largest.id FROM ${postRevisions} largest
            WHERE largest.post_id IN (SELECT id FROM ${source})
            ORDER BY largest.body_length DESC, largest.created_at DESC
            LIMIT ${KEEP_LARGEST})
        ) kept
      )`;
}

export type PostRevisionSummary = {
  id: string;
  revision: number | null;
  title: string | null;
  bodyLength: number;
  shrankBy: number;
  action: string;
  actorType: string;
  actorUserId: string | null;
  createdAt: string;
  /** The first line or so of the stored version, for recognising it. */
  preview: string;
};

function previewOf(document: DocumentSnapshot): string {
  return bodyOf(document).replace(/\s+/g, " ").trim().slice(0, 160);
}

export const MAX_LISTED_REVISIONS = KEEP_RECENT + KEEP_LARGEST;

export async function listPostRevisions(postId: string, limit = MAX_LISTED_REVISIONS): Promise<PostRevisionSummary[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(postRevisions)
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.createdAt))
    .limit(Math.max(1, Math.min(MAX_LISTED_REVISIONS, limit)));
  return rows.map((row) => ({
    id: row.id,
    revision: row.revision,
    title: row.title,
    bodyLength: row.bodyLength,
    shrankBy: row.shrankBy,
    action: row.supersededByAction,
    actorType: row.supersededByActorType,
    actorUserId: row.supersededByActorUserId,
    createdAt: row.createdAt.toISOString(),
    preview: previewOf(row.document),
  }));
}

export async function getPostRevision(postId: string, revisionId: string): Promise<{ id: string; document: DocumentSnapshot; title: string | null; createdAt: string } | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(postRevisions)
    .where(and(eq(postRevisions.postId, postId), eq(postRevisions.id, revisionId)))
    .limit(1);
  const row = rows[0];
  return row ? { id: row.id, document: row.document, title: row.title, createdAt: row.createdAt.toISOString() } : null;
}

/**
 * Records a version that no post write supersedes, such as a retired
 * collaborative session. Same window and same retention as the folded CTE, and
 * an exact repeat inside the window is dropped, so two cold opens racing the
 * same rotation leave one row rather than two copies of one lost session.
 */
export async function recordSupersededVersion(input: {
  postId: string;
  previous: SupersededVersion;
  nextBody: string;
  writer: RevisionWriter;
  force?: boolean;
}): Promise<boolean> {
  if (!db) return false;
  const { previous, writer } = input;
  const bodyLength = previous.body.length;
  const forced = isForced(previous, input.nextBody, input.force);
  const postId = sql`${input.postId}::uuid`;
  const result = await db.execute(sql`
    WITH recorded AS (
      INSERT INTO ${postRevisions}
        (post_id, blog_id, revision, document, title, body_length, shrank_by,
         superseded_by_revision, superseded_by_action, superseded_by_actor_type, superseded_by_actor_user_id)
      SELECT ${postId}, ${previous.blogId}::uuid, ${previous.revision}, ${JSON.stringify(previous.document)}::jsonb,
             ${previous.title}, ${bodyLength}, ${Math.max(0, bodyLength - input.nextBody.length)},
             NULL, ${writer.action}, ${writer.actorType}, ${writer.actorUserId ?? null}::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM ${postRevisions} duplicate
        WHERE duplicate.post_id = ${postId}
          AND duplicate.superseded_by_action = ${writer.action}
          AND duplicate.superseded_by_actor_type = ${writer.actorType}
          AND duplicate.superseded_by_actor_user_id IS NOT DISTINCT FROM ${writer.actorUserId ?? null}::uuid
          AND duplicate.revision IS NOT DISTINCT FROM ${previous.revision}
          AND duplicate.body_length = ${bodyLength}
          AND duplicate.created_at > now() - interval '${sql.raw(String(COALESCE_MINUTES))} minutes'
      )
      AND (${forced} OR NOT ${sameWriterRecently(writer, postId)})
      RETURNING id
    ), pruned AS (
      DELETE FROM ${postRevisions}
      WHERE post_id = ${postId}
        AND id NOT IN (
          SELECT id FROM (
            (SELECT recent.id FROM ${postRevisions} recent
              WHERE recent.post_id = ${postId}
              ORDER BY recent.created_at DESC
              LIMIT ${KEEP_RECENT})
            UNION
            (SELECT largest.id FROM ${postRevisions} largest
              WHERE largest.post_id = ${postId}
              ORDER BY largest.body_length DESC, largest.created_at DESC
              LIMIT ${KEEP_LARGEST})
          ) kept
        )
    )
    SELECT id FROM recorded
  `);
  return result.rows.length > 0;
}
