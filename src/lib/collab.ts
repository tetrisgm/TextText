// Realtime co-editing server core: the Yjs update relay and presence, plus
// the authorization gate. Transport is HTTP long-poll over an append log
// (collab_updates) keyed by a monotonic seq, so co-editing needs no websocket
// server and rides the same serverless model as the sync change cursor.
//
// Authorization mirrors item sharing exactly: the post's blog owner and any
// "editor" collaborator may PUSH updates; a "viewer" collaborator may READ
// (follow along) but not push. Everyone else is refused. Guests (cookie-only
// edit of an unclaimed blog) are solo and never enter collab.

import { and, asc, eq, gt, lt, lte, sql } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "@/lib/db/client";
import {
  blogs,
  collabPresence,
  collabState,
  collabUpdates,
  posts,
} from "@/lib/db/schema";
import { resolveItemAccess, type AccessUser } from "@/lib/permissions";

export type CollabRole = "editor" | "viewer";

// A stable, pleasant cursor color per identity (deterministic so a person
// keeps the same color across sessions and devices).
const PRESENCE_COLORS = [
  "#e0567a", "#e08a3c", "#d6a900", "#5aa02c",
  "#2ca39a", "#3c7de0", "#6a5ae0", "#b05ae0",
];

export function colorForSub(sub: string): string {
  let hash = 0;
  for (let i = 0; i < sub.length; i++) hash = (hash * 31 + sub.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

/** Presence rows older than this are treated as gone. */
export const PRESENCE_STALE_MS = 15_000;

/**
 * The caller's collab role on a post, or null. Owners and editor
 * collaborators get "editor"; viewer collaborators get "viewer".
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function collabAccess(
  user: AccessUser | null,
  postId: string,
): Promise<CollabRole | null> {
  if (!db || !user) return null;
  // A non-UUID postId would make the Postgres uuid cast throw; reject it as
  // "no access" (403) rather than letting it surface as a 500.
  if (!UUID_RE.test(postId)) return null;
  const rows = await db
    .select({ handle: blogs.handle })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(and(eq(posts.id, postId), sql`${posts.deletedAt} is null`))
    .limit(1);
  const post = rows[0];
  if (!post) return null;
  const access = await resolveItemAccess({ handle: post.handle, postId, user });
  if (access.canEditContent) return "editor";
  if (access.canView) return "viewer";
  return null;
}

/** The post's current revision (the sync CAS token), or null if gone. */
export async function getPostRevision(postId: string): Promise<number | null> {
  if (!db) return null;
  const rows = await db
    .select({ revision: posts.revision })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  return rows[0]?.revision ?? null;
}

/** The current log generation for a post (0 when it has no collab_state row). */
export async function getCollabEpoch(postId: string): Promise<number> {
  if (!db) return 0;
  const rows = await db
    .select({ epoch: collabState.epoch })
    .from(collabState)
    .where(eq(collabState.postId, postId))
    .limit(1);
  return rows[0]?.epoch ?? 0;
}

/**
 * Append one Yjs update, FENCED on the epoch the client caught up under. The
 * insert lands iff `clientEpoch` still equals the post's current generation
 * (one atomic statement), so an offline/lapsed editor whose retained edits flush
 * after the log was retired is rejected rather than merged into the new epoch
 * over an external write. Returns the new seq, or `retired` when fenced out.
 */
export async function appendCollabUpdate(
  postId: string,
  updateBase64: string,
  clientEpoch: number,
): Promise<{ seq: number } | { retired: true }> {
  if (!db) throw new Error("collab needs a database");
  const result = await db.execute(sql`
    INSERT INTO ${collabUpdates} (post_id, "update", epoch)
    SELECT ${postId}::uuid, ${updateBase64}, ${clientEpoch}::int
    WHERE ${clientEpoch}::int = COALESCE(
      (SELECT epoch FROM ${collabState} WHERE post_id = ${postId}::uuid), 0)
    RETURNING seq
  `);
  // A row means the fence matched and the append landed. `seq` is a bigserial,
  // which neon-http returns as a string, so coerce rather than type-check.
  const raw = (result.rows[0] as { seq?: number | string } | undefined)?.seq;
  return raw != null ? { seq: Number(raw) } : { retired: true };
}

/** Updates for a post's CURRENT generation with seq greater than `since`. */
export async function collabUpdatesSince(
  postId: string,
  since: number,
  epoch: number,
): Promise<Array<{ seq: number; update: string }>> {
  if (!db) return [];
  return db
    .select({ seq: collabUpdates.seq, update: collabUpdates.update })
    .from(collabUpdates)
    .where(
      and(
        eq(collabUpdates.postId, postId),
        eq(collabUpdates.epoch, epoch),
        gt(collabUpdates.seq, since),
      ),
    )
    .orderBy(asc(collabUpdates.seq))
    .limit(500);
}

/** The highest seq stored for a post's current generation (0 if none). */
export async function latestCollabSeq(
  postId: string,
  epoch: number,
): Promise<number> {
  if (!db) return 0;
  const rows = await db
    .select({ seq: collabUpdates.seq })
    .from(collabUpdates)
    .where(and(eq(collabUpdates.postId, postId), eq(collabUpdates.epoch, epoch)))
    .orderBy(sql`${collabUpdates.seq} desc`)
    .limit(1);
  return rows[0]?.seq ?? 0;
}

/**
 * Record that a collab autosave / session-end materialize wrote `revision` into
 * posts.body. Monotonic and epoch-untouched: it only advances the provenance
 * marker so the catch-up staleness check (posts.revision vs this) does not fire
 * for a body the live session itself produced.
 */
export async function markCollabMaterialized(
  postId: string,
  revision: number,
): Promise<void> {
  if (!db) return;
  await db.execute(sql`
    INSERT INTO ${collabState} (post_id, epoch, materialized_revision, updated_at)
    VALUES (${postId}::uuid, 0, ${revision}, now())
    ON CONFLICT (post_id) DO UPDATE
      SET materialized_revision =
            GREATEST(COALESCE(collab_state.materialized_revision, 0), ${revision}),
          updated_at = now()
  `);
}

/**
 * Retire a post's log generation when it is safe AND stale, so the next editor
 * reseeds from the authoritative posts.body instead of replaying a log left
 * stale between sessions (hole 2). Safe = no live co-editors. Stale = no
 * collab_state, or its materialized_revision is null or behind the current
 * posts.revision (an external write happened since the log last materialized).
 * Returns true when it retired, so the caller serves an empty log and the client
 * reseeds.
 *
 * There is NO quiescence delay on purpose: external writes become allowed the
 * moment presence goes stale (hasActiveCoEditors=false), so any delay before
 * retiring leaves a window in which a new joiner REPLAYS the stale log and
 * clobbers that external write. Retiring the instant it is stale-and-idle closes
 * that window; a lapsed editor that resumes and flushes retained edits is
 * rejected by the append epoch fence, so no delay is needed for its safety.
 *
 * The bump is a single-writer upsert CAS: it INSERTs epoch 1 when there is no
 * row (existing/backfill posts) or bumps `epoch + 1` guarded on the read epoch,
 * and in BOTH cases records `materialized_revision = postRevision` so the next
 * open is not stale (no reseed loop). Concurrent opens: one wins, the other's
 * CAS misses harmlessly and the epoch is still advanced.
 */
export async function retireStaleCollabEpoch(
  postId: string,
  postRevision: number,
): Promise<boolean> {
  if (!db) return false;
  if (await hasActiveCoEditors(postId)) return false;
  // This path has already proved the post idle. Sweep only ghosts well beyond
  // the live-presence window, retaining the existing 4x safety margin.
  await db
    .delete(collabPresence)
    .where(
      and(
        eq(collabPresence.postId, postId),
        lt(collabPresence.updatedAt, new Date(Date.now() - PRESENCE_STALE_MS * 4)),
      ),
    );
  const rows = await db
    .select({
      epoch: collabState.epoch,
      materializedRevision: collabState.materializedRevision,
    })
    .from(collabState)
    .where(eq(collabState.postId, postId))
    .limit(1);
  const cur = rows[0];
  const stale =
    !cur ||
    cur.materializedRevision == null ||
    cur.materializedRevision !== postRevision;
  const readEpoch = cur?.epoch ?? 0;
  let retired = false;
  if (stale) {
    await db.execute(sql`
      INSERT INTO ${collabState} (post_id, epoch, materialized_revision, updated_at)
      VALUES (${postId}::uuid, 1, ${postRevision}, now())
      ON CONFLICT (post_id) DO UPDATE
        SET epoch = collab_state.epoch + 1,
            materialized_revision = ${postRevision},
            updated_at = now()
        WHERE collab_state.epoch = ${readEpoch}
    `);
    retired = true;
  } else {
    // A materialized, idle current log is reconstructible from posts.body. Do
    // not delete it in place: rotate the epoch with the same single-writer CAS
    // used above, so a lapsed writer is fenced before the old generation is
    // swept. The live posts.revision comparison closes the read-to-delete race,
    // and EXISTS avoids pointless epoch churn when there is no log to clean.
    const result = await db.execute(sql`
      UPDATE ${collabState}
      SET epoch = collab_state.epoch + 1,
          updated_at = now()
      WHERE post_id = ${postId}::uuid
        AND epoch = ${readEpoch}
        AND materialized_revision = ${postRevision}
        AND EXISTS (
          SELECT 1 FROM ${posts}
          WHERE id = ${postId}::uuid
            AND revision = collab_state.materialized_revision
        )
        AND EXISTS (
          SELECT 1 FROM ${collabUpdates}
          WHERE post_id = ${postId}::uuid
            AND epoch = ${readEpoch}
        )
      RETURNING epoch
    `);
    retired = result.rows.length > 0;
  }
  // Storage sweep: rows from retired epochs are dead forever. The relay only
  // serves the CURRENT epoch and the append fence rejects stale writers, so
  // nothing can ever read or extend an older epoch's rows; deleting them is
  // race-free at any time after the bump. The subquery (not our read epoch)
  // keeps this correct even when a concurrent retire won the CAS.
  await db.execute(sql`
    DELETE FROM ${collabUpdates}
    WHERE post_id = ${postId}::uuid
      AND epoch < COALESCE(
        (SELECT epoch FROM ${collabState} WHERE post_id = ${postId}::uuid), 0)
  `);
  return retired;
}

// Compact the append log once it grows past this many rows. Compaction
// collapses the whole history into a single equivalent snapshot, so a new
// joiner fetches one row instead of thousands and storage stays bounded.
const COMPACT_THRESHOLD = 200;

function base64ToUpdate(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Collapse a post's update log into one snapshot when it has grown large.
 *
 * Correctness under concurrent edits: we merge only the rows we READ (seq
 * <= maxSeq at read time) into the snapshot, insert it as a NEW row (whose
 * seq is therefore greater than maxSeq), and delete ONLY rows with seq <=
 * maxSeq. Any update that arrives during compaction gets a seq greater than
 * maxSeq, so it is never deleted and never lost; it simply stays a separate
 * row alongside the snapshot. Applying the snapshot is idempotent for a
 * client that already had some of that history (Yjs updates are
 * commutative), so existing and new clients both still converge.
 */
export async function maybeCompactCollab(postId: string): Promise<void> {
  if (!db) return;
  // Compaction stays within the CURRENT generation: a retired epoch's rows are
  // already ignored by the relay, so they are never merged or served.
  const epoch = await getCollabEpoch(postId);
  const rows = await db
    .select({ seq: collabUpdates.seq, update: collabUpdates.update })
    .from(collabUpdates)
    .where(and(eq(collabUpdates.postId, postId), eq(collabUpdates.epoch, epoch)))
    .orderBy(asc(collabUpdates.seq));
  if (rows.length < COMPACT_THRESHOLD) return;

  const maxSeq = rows[rows.length - 1].seq;
  let snapshot: string;
  try {
    const merged = Y.mergeUpdates(rows.map((r) => base64ToUpdate(r.update)));
    snapshot = Buffer.from(merged).toString("base64");
  } catch {
    // A merge failure must never drop history; leave the log as-is.
    return;
  }
  await db.insert(collabUpdates).values({ postId, update: snapshot, epoch });
  // Delete ONLY what we merged, within this epoch. Safety depends on every
  // append being a single atomic statement (the fenced INSERT ... RETURNING via
  // neon-http): no row exists with seq <= maxSeq in this epoch that was not in
  // the read set.
  await db
    .delete(collabUpdates)
    .where(
      and(
        eq(collabUpdates.postId, postId),
        eq(collabUpdates.epoch, epoch),
        lte(collabUpdates.seq, maxSeq),
      ),
    );
}

export type PresenceEntry = { clientId: string; userName: string; color: string };

function presencePersonKey(entry: Pick<PresenceEntry, "clientId" | "userName">): string {
  return entry.userName.trim().toLocaleLowerCase() || entry.clientId;
}

function dedupePresenceRows(
  rows: Array<PresenceEntry & { updatedAt: Date }>,
): PresenceEntry[] {
  const people = new Map<string, PresenceEntry & { updatedAt: Date }>();
  for (const row of rows) {
    const key = presencePersonKey(row);
    const existing = people.get(key);
    if (!existing || row.updatedAt.getTime() > existing.updatedAt.getTime()) {
      people.set(key, row);
    }
  }
  return Array.from(people.values())
    .sort((a, b) => a.userName.localeCompare(b.userName))
    .map(({ clientId, userName, color }) => ({ clientId, userName, color }));
}

/** Heartbeat this client's presence and return everyone currently active. */
export async function upsertPresence(
  postId: string,
  entry: PresenceEntry,
): Promise<PresenceEntry[]> {
  if (!db) return [];
  await db
    .insert(collabPresence)
    .values({
      postId,
      clientId: entry.clientId,
      userName: entry.userName,
      color: entry.color,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [collabPresence.postId, collabPresence.clientId],
      set: { userName: entry.userName, color: entry.color, updatedAt: new Date() },
    });
  // Opportunistic cleanup: a tab that closed without a clean leave leaves a
  // stale row. Drop rows for this post well past the active window so the
  // table never accumulates ghosts.
  await db
    .delete(collabPresence)
    .where(
      and(
        eq(collabPresence.postId, postId),
        lt(collabPresence.updatedAt, new Date(Date.now() - PRESENCE_STALE_MS * 4)),
      ),
    );
  return activePresence(postId);
}

/**
 * True while at least one editor is actively co-editing this post (a presence
 * heartbeat within the stale window). The canonical `posts.body` and the live
 * Yjs document are separate write paths bridged only by the editor's own
 * autosave, with NO store -> Yjs path, so an external raw body overwrite (a
 * Finder/sync PUT or an MCP update) made during a live session would be
 * silently discarded by the next co-editor autosave. Callers use this to refuse
 * such a write with a conflict instead of losing it.
 */
export async function hasActiveCoEditors(postId: string): Promise<boolean> {
  if (!db) return false;
  return (await activePresence(postId)).length > 0;
}

export async function activePresence(postId: string): Promise<PresenceEntry[]> {
  if (!db) return [];
  const cutoff = new Date(Date.now() - PRESENCE_STALE_MS);
  const rows = await db
    .select({
      clientId: collabPresence.clientId,
      userName: collabPresence.userName,
      color: collabPresence.color,
      updatedAt: collabPresence.updatedAt,
    })
    .from(collabPresence)
    .where(
      and(
        eq(collabPresence.postId, postId),
        gt(collabPresence.updatedAt, cutoff),
      ),
    );
  return dedupePresenceRows(rows);
}

export async function removePresence(
  postId: string,
  clientId: string,
): Promise<void> {
  if (!db) return;
  await db
    .delete(collabPresence)
    .where(
      and(
        eq(collabPresence.postId, postId),
        eq(collabPresence.clientId, clientId),
      ),
    );
}

// NOTE: an earlier revision retired the append log after an external body write
// (resetCollabLog + reconcileCollabLogAfterExternalWrite). An adversarial review
// showed an unbounded delete is unsafe: it can drop a co-editor's final edits
// that posts.body never absorbed (the autosave cannot flush on tab close) and
// can corrupt a still-live-but-stale-presence session's log (orphaned deltas,
// no snapshot preserved, unlike maybeCompactCollab). Retiring a stale log needs
// a materialization/staleness marker so the next open prefers posts.body
// without deleting; that is tracked as a follow-up. The live-session write guard
// (hasActiveCoEditors, consulted by the editor/sync/MCP write paths) stays.
