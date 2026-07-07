// The workspace change cursor behind GET /api/sync/v1/changes: the newest
// touch timestamp across everything the sync tree mirrors (posts and
// folders, including soft-deletes, which SET deleted_at and therefore always
// advance the cursor). No schema or bump-site is needed: any mutation path,
// present or future, moves updated_at/deleted_at or it did not change the
// row at all.
//
// The cursor is an opaque string to clients (ISO timestamp with ms). Clients
// long-poll with their last cursor; a strictly newer server cursor means
// "run a sync pass". Millisecond ties are resolved by the next poll cycle,
// worst case one wait interval late, never missed forever.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function workspaceChangeCursor(handle: string): Promise<string> {
  if (!db) return "0";
  const rows = await db.execute<{ cursor: string | null }>(sql`
    select greatest(
      (select max(greatest(p.updated_at, coalesce(p.deleted_at, p.updated_at)))
         from posts p join blogs b on p.blog_id = b.id
        where b.handle = ${handle} and b.deleted_at is null),
      (select max(greatest(f.updated_at, coalesce(f.deleted_at, f.updated_at)))
         from folders f join blogs b on f.blog_id = b.id
        where b.handle = ${handle} and b.deleted_at is null)
    ) as cursor
  `);
  const raw: unknown = rows.rows?.[0]?.cursor;
  if (!raw) return "0";
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? "0" : date.toISOString();
}
