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
 * at most one version every COALESCE_MINUTES per writer, and the newest
 * KEEP_PER_POST versions of an item are retained. Two things are never
 * coalesced away: a write that shortens the document, and a write by a
 * different kind of actor than the last one recorded. That is the whole
 * difference between a history and a safety net.
 */

const COALESCE_MINUTES = 2;
const KEEP_PER_POST = 200;
/** A document this short has nothing worth protecting from a shrink. */
const SHRINK_FLOOR = 1;

export type RevisionWriter = {
  /** The action that superseded the version, e.g. "save_document" or "collab.rotate". */
  action: string;
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
}): SQL {
  const { previous, nextBody, writer } = input;
  const bodyLength = previous.body.length;
  const shrankBy = Math.max(0, bodyLength - nextBody.length);
  // Always record a shrink, and always record when a different kind of writer
  // takes over; otherwise keep one version per writer per window.
  const forced = (shrankBy > 0 && bodyLength > SHRINK_FLOOR) || previous.revision === null;
  const source = sql.identifier(input.fromCte);
  return sql`INSERT INTO ${postRevisions}
      (post_id, blog_id, revision, document, title, body_length, shrank_by,
       superseded_by_revision, superseded_by_action, superseded_by_actor_type, superseded_by_actor_user_id)
    SELECT ${source}.id, ${previous.blogId}::uuid, ${previous.revision}, ${JSON.stringify(previous.document)}::jsonb,
           ${previous.title}, ${bodyLength}, ${shrankBy},
           ${source}.revision, ${writer.action}, ${writer.actorType}, ${writer.actorUserId ?? null}::uuid
    FROM ${source}
    WHERE ${forced} OR NOT EXISTS (
      SELECT 1 FROM ${postRevisions} recent
      WHERE recent.post_id = ${source}.id
        AND recent.superseded_by_action = ${writer.action}
        AND recent.superseded_by_actor_type = ${writer.actorType}
        AND recent.created_at > now() - interval '${sql.raw(String(COALESCE_MINUTES))} minutes'
    )`;
}

/** Drops the oldest versions of the item this write touched, in the same statement. */
export function revisionPruneCteFrom(fromCte: string): SQL {
  const source = sql.identifier(fromCte);
  return sql`DELETE FROM ${postRevisions}
    WHERE post_id IN (SELECT id FROM ${source})
      AND created_at < (
        SELECT created_at FROM ${postRevisions} keep
        WHERE keep.post_id IN (SELECT id FROM ${source})
        ORDER BY keep.created_at DESC
        OFFSET ${KEEP_PER_POST} LIMIT 1
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

export async function listPostRevisions(postId: string, limit = 50): Promise<PostRevisionSummary[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(postRevisions)
    .where(eq(postRevisions.postId, postId))
    .orderBy(desc(postRevisions.createdAt))
    .limit(Math.max(1, Math.min(200, limit)));
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

/** Records a version that no post write supersedes, such as a retired collaborative session. */
export async function recordSupersededVersion(input: {
  postId: string;
  previous: SupersededVersion;
  nextBody: string;
  writer: RevisionWriter;
}): Promise<boolean> {
  if (!db) return false;
  const bodyLength = input.previous.body.length;
  const rows = await db
    .insert(postRevisions)
    .values({
      postId: input.postId,
      blogId: input.previous.blogId,
      revision: input.previous.revision,
      document: input.previous.document,
      title: input.previous.title,
      bodyLength,
      shrankBy: Math.max(0, bodyLength - input.nextBody.length),
      supersededByRevision: null,
      supersededByAction: input.writer.action,
      supersededByActorType: input.writer.actorType,
      supersededByActorUserId: input.writer.actorUserId ?? null,
    })
    .returning({ id: postRevisions.id });
  return rows.length > 0;
}
