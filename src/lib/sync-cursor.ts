// The workspace change cursor behind GET /api/sync/v1/changes: `blogs.change_seq`,
// a durable per-workspace high-water-mark. An AFTER trigger on posts and folders
// bumps it to the row's `revision` on every insert or update, and `revision`
// comes from the shared `write_change_seq` sequence, so the cursor moves on EVERY
// mutation (present or future), values are globally unique and strictly
// increasing, and two changes in the same millisecond are distinct.
//
// Why a stored counter and not max(revision): max over surviving rows can FALL
// when a trashed row is hard-deleted (emptying Trash), so a soft-delete the
// client has not yet polled could be erased from the cursor and leave a
// permanent ghost. change_seq only ever increases, so a deletion the client has
// not seen always keeps the cursor ahead of the client and forces a resync.
//
// The cursor is opaque to clients; compare only by inequality.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function workspaceChangeCursor(handle: string): Promise<string> {
  if (!db) return "0";
  const rows = await db.execute<{ cursor: string | null }>(sql`
    select change_seq as cursor
      from blogs
     where handle = ${handle} and deleted_at is null
     limit 1
  `);
  const raw: unknown = rows.rows?.[0]?.cursor;
  if (raw === null || raw === undefined) return "0";
  // pg returns bigint as a string; keep it a decimal string end to end.
  return String(raw);
}
