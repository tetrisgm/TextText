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
import { blogs, collabPresence, collabUpdates, posts } from "@/lib/db/schema";
import { getUserIdBySub } from "@/lib/store";
import { postShareRoleFor } from "@/lib/shares";
import type { ShareUser } from "@/lib/shares";

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
  user: ShareUser | null,
  postId: string,
): Promise<CollabRole | null> {
  if (!db || !user) return null;
  // A non-UUID postId would make the Postgres uuid cast throw; reject it as
  // "no access" (403) rather than letting it surface as a 500.
  if (!UUID_RE.test(postId)) return null;
  const rows = await db
    .select({ ownerId: blogs.ownerId })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(and(eq(posts.id, postId), sql`${posts.deletedAt} is null`))
    .limit(1);
  const post = rows[0];
  if (!post) return null;
  if (post.ownerId) {
    const userId = await getUserIdBySub(user.sub);
    if (userId && userId === post.ownerId) return "editor";
  }
  const shareRole = await postShareRoleFor(user, postId);
  return shareRole; // "editor" | "viewer" | null
}

/** Append one Yjs update (base64) and return its seq. */
export async function appendCollabUpdate(
  postId: string,
  updateBase64: string,
): Promise<number> {
  if (!db) throw new Error("collab needs a database");
  const inserted = await db
    .insert(collabUpdates)
    .values({ postId, update: updateBase64 })
    .returning({ seq: collabUpdates.seq });
  return inserted[0].seq;
}

/** Updates for a post with seq greater than `since`, in order. */
export async function collabUpdatesSince(
  postId: string,
  since: number,
): Promise<Array<{ seq: number; update: string }>> {
  if (!db) return [];
  return db
    .select({ seq: collabUpdates.seq, update: collabUpdates.update })
    .from(collabUpdates)
    .where(and(eq(collabUpdates.postId, postId), gt(collabUpdates.seq, since)))
    .orderBy(asc(collabUpdates.seq))
    .limit(500);
}

/** The highest seq stored for a post (0 if none). */
export async function latestCollabSeq(postId: string): Promise<number> {
  if (!db) return 0;
  const rows = await db
    .select({ seq: collabUpdates.seq })
    .from(collabUpdates)
    .where(eq(collabUpdates.postId, postId))
    .orderBy(sql`${collabUpdates.seq} desc`)
    .limit(1);
  return rows[0]?.seq ?? 0;
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
  const rows = await db
    .select({ seq: collabUpdates.seq, update: collabUpdates.update })
    .from(collabUpdates)
    .where(eq(collabUpdates.postId, postId))
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
  await db.insert(collabUpdates).values({ postId, update: snapshot });
  // Delete ONLY what we merged. Safety depends on every append being a single
  // atomic statement (INSERT ... RETURNING via neon-http): that guarantees no
  // row exists with seq <= maxSeq that was not in the read set. If appends are
  // ever wrapped in a multi-statement transaction, seq allocation could run
  // ahead of commit and this delete could remove an un-merged row.
  await db
    .delete(collabUpdates)
    .where(and(eq(collabUpdates.postId, postId), lte(collabUpdates.seq, maxSeq)));
}

export type PresenceEntry = { clientId: string; userName: string; color: string };

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

export async function activePresence(postId: string): Promise<PresenceEntry[]> {
  if (!db) return [];
  const cutoff = new Date(Date.now() - PRESENCE_STALE_MS);
  const rows = await db
    .select({
      clientId: collabPresence.clientId,
      userName: collabPresence.userName,
      color: collabPresence.color,
    })
    .from(collabPresence)
    .where(
      and(
        eq(collabPresence.postId, postId),
        gt(collabPresence.updatedAt, cutoff),
      ),
    );
  return rows;
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
