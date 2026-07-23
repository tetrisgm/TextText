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
import {
  documentSnapshotFromYDoc,
  encodeDocumentBaseline,
} from "@/lib/collab/document";
import { documentFromLegacyPost } from "@/lib/documents/legacy";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { resolveItemAccess, type AccessUser } from "@/lib/permissions";
import { getPostStoreContext } from "@/lib/store";

export type CollabRole = "editor" | "viewer";
export type CollabBaseline = {
  epoch: number;
  revision: number;
  update: string;
};

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
  capabilityRole: "viewer" | "commenter" | "editor" | null = null,
): Promise<CollabRole | null> {
  if (!db) return null;
  // A non-UUID postId would make the Postgres uuid cast throw; reject it as
  // "no access" (403) rather than letting it surface as a 500.
  if (!UUID_RE.test(postId)) return null;
  if (capabilityRole === "editor") return "editor";
  if (capabilityRole === "commenter" || capabilityRole === "viewer") {
    return "viewer";
  }
  if (!user) return null;
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

export async function getCollabBaseline(
  postId: string,
): Promise<CollabBaseline | null> {
  if (!db) return null;
  const rows = await db
    .select({
      epoch: collabState.epoch,
      revision: collabState.baselineRevision,
      update: collabState.baselineUpdate,
    })
    .from(collabState)
    .where(eq(collabState.postId, postId))
    .limit(1);
  const row = rows[0];
  if (!row || row.revision == null || !row.update) return null;
  return { epoch: row.epoch, revision: row.revision, update: row.update };
}

/**
 * Return the single server-owned Yjs baseline for the current epoch. A missing
 * baseline is created from the canonical document. If an out-of-band write
 * advanced posts.revision while no editor was live, the epoch rotates and the
 * new canonical document becomes the next baseline. The epoch CAS fences late
 * writers before old updates are swept.
 */
export async function prepareCollabBaseline(
  postId: string,
): Promise<CollabBaseline | null> {
  if (!db) return null;
  const context = await getPostStoreContext(postId);
  if (!context) return null;
  const revision = context.post.revision ?? 0;
  const snapshot =
    context.post.document ?? documentFromLegacyPost(context.post);
  const encoded = Buffer.from(
    encodeDocumentBaseline(snapshot, `${postId}:${revision}`),
  ).toString("base64");

  await db.execute(sql`
    INSERT INTO ${collabState} (
      post_id,
      epoch,
      baseline_update,
      baseline_revision,
      materialized_revision,
      updated_at
    )
    VALUES (
      ${postId}::uuid,
      0,
      ${encoded},
      ${revision},
      ${revision},
      now()
    )
    ON CONFLICT (post_id) DO NOTHING
  `);

  const stateRows = await db
    .select({
      epoch: collabState.epoch,
      baselineRevision: collabState.baselineRevision,
      baselineUpdate: collabState.baselineUpdate,
      materializedRevision: collabState.materializedRevision,
    })
    .from(collabState)
    .where(eq(collabState.postId, postId))
    .limit(1);
  const state = stateRows[0];
  if (!state) return null;

  const missingBaseline =
    state.baselineRevision == null || !state.baselineUpdate;
  const externallyStale =
    state.materializedRevision !== revision &&
    state.baselineRevision !== revision;
  if (missingBaseline || externallyStale) {
    const active = await hasActiveCoEditors(postId);
    if (missingBaseline || !active) {
      const result = await db.execute(sql`
        UPDATE ${collabState}
        SET epoch = collab_state.epoch + 1,
            baseline_update = ${encoded},
            baseline_revision = ${revision},
            materialized_revision = ${revision},
            updated_at = now()
        WHERE post_id = ${postId}::uuid
          AND epoch = ${state.epoch}
          AND (
            baseline_update IS NULL
            OR baseline_revision IS NULL
            OR (
              materialized_revision IS DISTINCT FROM ${revision}
              AND baseline_revision IS DISTINCT FROM ${revision}
            )
          )
        RETURNING epoch
      `);
      if (result.rows.length > 0) {
        await db.execute(sql`
          DELETE FROM ${collabUpdates}
          WHERE post_id = ${postId}::uuid
            AND epoch < (
              SELECT epoch FROM ${collabState}
              WHERE post_id = ${postId}::uuid
            )
        `);
      }
    }
  }

  return getCollabBaseline(postId);
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
    WHERE ${clientEpoch}::int = (
      SELECT epoch FROM ${collabState}
      WHERE post_id = ${postId}::uuid
        AND baseline_update IS NOT NULL
        AND baseline_revision IS NOT NULL
    )
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

// Compact the append log once it grows past this many rows. Compaction
// collapses the whole history into a single equivalent snapshot, so a new
// joiner fetches one row instead of thousands and storage stays bounded.
const COMPACT_THRESHOLD = 200;

function base64ToUpdate(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Rebuild the canonical document from the current Yjs generation. The caller
 * may include its complete local state so edits still queued in its durable
 * outbox participate in the merge. Yjs makes applying the same update twice
 * harmless, so a state already present in the relay does not duplicate text.
 */
export async function materializeCollabDocument(
  postId: string,
  currentStateBase64?: string,
): Promise<DocumentSnapshot | null> {
  if (!db) return null;
  const baseline = await prepareCollabBaseline(postId);
  if (!baseline) return null;
  const epoch = baseline.epoch;
  const rows = await db
    .select({ update: collabUpdates.update })
    .from(collabUpdates)
    .where(and(eq(collabUpdates.postId, postId), eq(collabUpdates.epoch, epoch)))
    .orderBy(asc(collabUpdates.seq));
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, base64ToUpdate(baseline.update));
    for (const row of rows) Y.applyUpdate(document, base64ToUpdate(row.update));
    if (currentStateBase64) {
      Y.applyUpdate(document, base64ToUpdate(currentStateBase64));
    }
    return documentSnapshotFromYDoc(document);
  } catch {
    return null;
  } finally {
    document.destroy();
  }
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

export type PresenceEntry = {
  clientId: string;
  userName: string;
  color: string;
  awareness: string | null;
};

function dedupePresenceRows(
  rows: Array<PresenceEntry & { updatedAt: Date }>,
): PresenceEntry[] {
  const people = new Map<string, PresenceEntry & { updatedAt: Date }>();
  for (const row of rows) {
    const existing = people.get(row.clientId);
    if (!existing || row.updatedAt.getTime() > existing.updatedAt.getTime()) {
      people.set(row.clientId, row);
    }
  }
  return Array.from(people.values())
    .sort((a, b) => a.userName.localeCompare(b.userName))
    .map(({ clientId, userName, color, awareness }) => ({
      clientId,
      userName,
      color,
      awareness,
    }));
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
      awareness: entry.awareness,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [collabPresence.postId, collabPresence.clientId],
      set: {
        userName: entry.userName,
        color: entry.color,
        awareness: entry.awareness,
        updatedAt: new Date(),
      },
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
      awareness: collabPresence.awareness,
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
