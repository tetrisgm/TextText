import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { readingSavedSearches } from "@/lib/db/schema";
import type { AccessUser } from "@/lib/permissions";
import { recordAction, type AuditActorType } from "@/lib/audit";
import { workspaceIdForHandle } from "@/lib/store";
import { searchReading } from "./search.server";

/**
 * Saved searches: a query kept by name that reads like a feed. The unread
 * count is the search run with is:unread appended, bounded, so a saved
 * search costs one bounded query when its folder is opened and nothing
 * otherwise.
 */

export type SavedReadingSearch = {
  id: string;
  name: string;
  query: string;
  folderPath: string;
  /** Up to the bound; "50+" past it. */
  unread: number | null;
  unreadCapped: boolean;
};

const COUNT_BOUND = 50;

function requireDb() {
  if (!db) throw new Error("Saved searches need DATABASE_URL");
  return db;
}

export async function listSavedSearches(input: {
  handle: string;
  user: AccessUser | null;
  folderPath?: string | null;
  withCounts?: boolean;
}): Promise<SavedReadingSearch[]> {
  const blogId = await workspaceIdForHandle(input.handle);
  const rows = await requireDb()
    .select()
    .from(readingSavedSearches)
    .where(eq(readingSavedSearches.blogId, blogId))
    .orderBy(readingSavedSearches.createdAt);
  const visible = rows.filter(
    (row) => input.folderPath === undefined || input.folderPath === null || row.folderPath === "" || row.folderPath === input.folderPath || input.folderPath.startsWith(`${row.folderPath}/`) || row.folderPath.startsWith(`${input.folderPath}/`),
  );
  return Promise.all(
    visible.map(async (row) => {
      let unread: number | null = null;
      let unreadCapped = false;
      if (input.withCounts && input.user?.userId) {
        const report = await searchReading({
          handle: input.handle,
          user: input.user,
          query: `${row.query} is:unread`,
          scope: { folderPath: row.folderPath || null },
          limit: COUNT_BOUND,
          embedder: null,
        });
        unread = report.results.length;
        unreadCapped = report.results.length >= COUNT_BOUND;
      }
      return { id: row.id, name: row.name, query: row.query, folderPath: row.folderPath, unread, unreadCapped };
    }),
  );
}

export async function createSavedSearch(input: {
  handle: string;
  name: string;
  query: string;
  folderPath: string;
  actor: { userId: string | null; actorType: AuditActorType };
}): Promise<SavedReadingSearch> {
  const blogId = await workspaceIdForHandle(input.handle);
  const name = input.name.trim().slice(0, 80) || input.query.trim().slice(0, 80);
  const query = input.query.trim().slice(0, 500);
  if (!query) throw new Error("A saved search needs a query");
  const [row] = await requireDb()
    .insert(readingSavedSearches)
    .values({ blogId, name, query, folderPath: input.folderPath, createdById: input.actor.userId })
    .returning();
  await recordAction({
    actorUserId: input.actor.userId,
    actorType: input.actor.actorType,
    actionName: "reading.save_search",
    targetType: "folder",
    targetId: input.folderPath || null,
    inputSummary: query,
  });
  return { id: row.id, name: row.name, query: row.query, folderPath: row.folderPath, unread: null, unreadCapped: false };
}

export async function deleteSavedSearch(input: { handle: string; id: string; actor: { userId: string | null; actorType: AuditActorType } }): Promise<boolean> {
  const blogId = await workspaceIdForHandle(input.handle);
  const deleted = await requireDb()
    .delete(readingSavedSearches)
    .where(and(eq(readingSavedSearches.blogId, blogId), eq(readingSavedSearches.id, input.id)))
    .returning({ id: readingSavedSearches.id, query: readingSavedSearches.query });
  if (deleted.length === 0) return false;
  await recordAction({
    actorUserId: input.actor.userId,
    actorType: input.actor.actorType,
    actionName: "reading.delete_saved_search",
    targetType: "folder",
    inputSummary: deleted[0].query,
  });
  return true;
}
