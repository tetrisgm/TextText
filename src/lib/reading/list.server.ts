import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { DURABLE_HOLD_REASONS } from "./holds";
import { db } from "@/lib/db/client";
import {
  feedConnections,
  feedReceipts,
  folders,
  posts,
  readingProvenance,
  readingReadState,
  retentionHolds,
} from "@/lib/db/schema";
import { accessibleFolderIdsForUser, type AccessUser } from "@/lib/permissions";
import { getFolders, workspaceIdForHandle } from "@/lib/store";
import { subtreeFolderIds } from "./connections.server";

/**
 * The reading list: bounded pages of imported articles for a folder scope.
 *
 * This is the only way reading views get their rows. It never returns the
 * whole corpus; it returns one page, ordered by the publisher's date with
 * the item id as a tiebreak, with an opaque cursor for the next page. The
 * scope is the intersection of the requested subtree, what the requesting
 * person may see, and what is still live.
 */

export type ReadingScope = {
  folderPath: string;
  includeDescendants: boolean;
  state: "all" | "unread" | "kept";
  dateBasis: "published" | "received";
  /** Newest first unless asked; oldest first is how Reader people catch up. */
  direction?: "newest" | "oldest";
};

export type ReadingListItem = {
  id: string;
  origin: "manual" | "feed";
  title: string;
  publisherTitle: string;
  publisherName: string | null;
  folderId: string;
  folderPath: string;
  sourceFolderName: string;
  permalink: string | null;
  externalUrl: string | null;
  publishedAt: string | null;
  receivedAt: string;
  availability: "full" | "excerpt" | "metadata";
  excerpt: string | null;
  authors: string[];
  read: boolean;
  starred: boolean;
  /** At least one durable protection; never a lease. */
  kept: boolean;
  keptReasons: string[];
  expiresAt: string | null;
  slug: string;
};

export type ReadingListPage = {
  items: ReadingListItem[];
  nextCursor: string | null;
  scope: ReadingScope & { folderIds: number };
  /** Fingerprint of the resolved scope: same folders, same principal. */
  scopeFingerprint: string;
};

const MAX_PAGE = 100;

/** Later copies of the same canonical link are hidden; the first one shows. */
const notDuplicateSql = () => isNull(readingProvenance.duplicateOfPostId);
const DURABLE_HOLDS = DURABLE_HOLD_REASONS;

function requireDb() {
  if (!db) throw new Error("Reading lists need DATABASE_URL");
  return db;
}

type Cursor = { at: string; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string") return null;
    if (Number.isNaN(new Date(parsed.at).getTime())) return null;
    return { at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}

/** The folder ids a reading query may touch: subtree ∩ accessible. */
export async function resolveReadingFolderIds(input: {
  handle: string;
  user: AccessUser | null;
  folderPath: string;
  includeDescendants: boolean;
}): Promise<{ blogId: string; folderIds: string[] }> {
  const blogId = await workspaceIdForHandle(input.handle);
  const allFolders = await getFolders(input.handle);
  const accessible = await accessibleFolderIdsForUser(input.handle, input.user);
  // "" means every folder the person can see: the workspace-wide views.
  if (input.folderPath === "") {
    const all = allFolders.map((folder) => folder.id);
    return { blogId, folderIds: accessible === "all" ? all : all.filter((id) => accessible.has(id)) };
  }
  const target = allFolders.find((folder) => folder.path === input.folderPath);
  if (!target) return { blogId, folderIds: [] };
  const subtree = input.includeDescendants ? await subtreeFolderIds(blogId, target.path) : [target.id];
  const folderIds = accessible === "all" ? subtree : subtree.filter((id) => accessible.has(id));
  return { blogId, folderIds };
}

export async function listReadingItems(input: {
  handle: string;
  user: AccessUser | null;
  scope: ReadingScope;
  cursor?: string | null;
  limit?: number;
}): Promise<ReadingListPage> {
  const database = requireDb();
  const limit = Math.max(1, Math.min(MAX_PAGE, Math.trunc(input.limit ?? 40)));
  const { blogId, folderIds } = await resolveReadingFolderIds({
    handle: input.handle,
    user: input.user,
    folderPath: input.scope.folderPath,
    includeDescendants: input.scope.includeDescendants,
  });
  const userId = input.user?.userId ?? null;
  const fingerprint = sha(`${blogId}|${userId ?? "anon"}|${[...folderIds].sort().join(",")}|${input.scope.state}|${input.scope.dateBasis}|${input.scope.direction ?? "newest"}`);
  if (folderIds.length === 0) {
    return { items: [], nextCursor: null, scope: { ...input.scope, folderIds: 0 }, scopeFingerprint: fingerprint };
  }

  const orderExpr =
    input.scope.dateBasis === "published"
      ? sql<Date>`coalesce(${readingProvenance.publishedAt}, ${posts.createdAt})`
      : sql<Date>`${posts.createdAt}`;
  const cursor = decodeCursor(input.cursor);
  const readJoin = userId
    ? and(eq(readingReadState.postId, posts.id), eq(readingReadState.userId, userId))
    : sql`false`;
  const keptSubquery = sql<string[]>`(
    select coalesce(array_agg(distinct ${retentionHolds.reason}), '{}')
    from ${retentionHolds}
    where ${retentionHolds.postId} = ${posts.id}
      and ${retentionHolds.releasedAt} is null
      and ${retentionHolds.reason} in (${sql.join(DURABLE_HOLDS.map((reason) => sql`${reason}`), sql`, `)})
  )`;

  const rows = await database
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      excerpt: posts.excerpt,
      folderId: posts.folderId,
      folderPath: folders.path,
      folderName: folders.name,
      starred: posts.starred,
      createdAt: posts.createdAt,
      origin: posts.origin,
      publisherTitle: readingProvenance.publisherTitle,
      publisherName: readingProvenance.publisherName,
      permalink: readingProvenance.permalink,
      externalUrl: readingProvenance.externalUrl,
      publishedAt: readingProvenance.publishedAt,
      availability: readingProvenance.availability,
      authors: readingProvenance.authors,
      readAt: readingReadState.readAt,
      keptReasons: keptSubquery,
      expiresAt: sql<Date | null>`(
        select ${feedReceipts.expiresAt} from ${feedReceipts}
        where ${feedReceipts.postId} = ${posts.id} and ${feedReceipts.status} = 'active'
        order by ${feedReceipts.expiresAt} desc nulls first limit 1
      )`,
      orderAt: orderExpr,
    })
    .from(posts)
    .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
    .innerJoin(folders, eq(folders.id, posts.folderId))
    .leftJoin(readingReadState, readJoin)
    .where(
      and(
        eq(posts.blogId, blogId),
        isNull(posts.deletedAt),
        inArray(posts.folderId, folderIds),
        notDuplicateSql(),
        input.scope.state === "unread" ? isNull(readingReadState.readAt) : undefined,
        input.scope.state === "kept"
          ? or(
              sql`${posts.origin} <> 'feed'`,
              eq(posts.starred, true),
              sql`exists (select 1 from ${retentionHolds} where ${retentionHolds.postId} = ${posts.id} and ${retentionHolds.releasedAt} is null and ${retentionHolds.reason} in (${sql.join(DURABLE_HOLDS.map((reason) => sql`${reason}`), sql`, `)}))`,
            )
          : undefined,
        cursor
          ? input.scope.direction === "oldest"
            ? sql`(${orderExpr}, ${posts.id}) > (${new Date(cursor.at)}::timestamp, ${cursor.id}::uuid)`
            : sql`(${orderExpr}, ${posts.id}) < (${new Date(cursor.at)}::timestamp, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(
      ...(input.scope.direction === "oldest" ? [asc(orderExpr), asc(posts.id)] : [desc(orderExpr), desc(posts.id)]),
    )
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ at: new Date(last.orderAt).toISOString(), id: last.id })
      : null;
  return {
    items: page.map((row) => ({
      id: row.id,
      origin: row.origin === "feed" ? "feed" : "manual",
      title: row.title || row.publisherTitle || "Untitled",
      publisherTitle: row.publisherTitle ?? row.title,
      publisherName: row.publisherName,
      folderId: row.folderId,
      folderPath: row.folderPath,
      sourceFolderName: row.folderName,
      permalink: row.permalink,
      externalUrl: row.externalUrl,
      publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
      receivedAt: new Date(row.createdAt).toISOString(),
      availability: (row.availability ?? "full") as ReadingListItem["availability"],
      excerpt: row.excerpt ?? null,
      authors: row.authors ?? [],
      read: row.readAt !== null && row.readAt !== undefined,
      starred: row.starred,
      // A hand-saved bookmark is durable by definition; it never expires.
      kept: row.origin !== "feed" || row.starred || (row.keptReasons ?? []).length > 0,
      keptReasons: [
        ...(row.origin !== "feed" ? ["manual_save"] : []),
        ...(row.starred ? ["starred"] : []),
        ...(row.keptReasons ?? []).filter((reason) => reason !== "starred"),
      ],
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      slug: row.slug,
    })),
    nextCursor,
    scope: { ...input.scope, folderIds: folderIds.length },
    scopeFingerprint: fingerprint,
  };
}

export type ReadingFolderSummary = {
  folderPath: string;
  sourceCount: number;
  itemCount: number;
  unreadCount: number | null;
  health: Array<{ folderPath: string; health: string; detail: string | null; lastSuccessAt: string | null }>;
  lastSuccessAt: string | null;
  isSourceFolder: boolean;
};

/** Header numbers for a folder's reading view, in one round trip each. */
export async function readingFolderSummary(input: {
  handle: string;
  user: AccessUser | null;
  folderPath: string;
}): Promise<ReadingFolderSummary> {
  const database = requireDb();
  const { blogId, folderIds } = await resolveReadingFolderIds({
    handle: input.handle,
    user: input.user,
    folderPath: input.folderPath,
    includeDescendants: true,
  });
  const empty: ReadingFolderSummary = {
    folderPath: input.folderPath,
    sourceCount: 0,
    itemCount: 0,
    unreadCount: null,
    health: [],
    lastSuccessAt: null,
    isSourceFolder: false,
  };
  if (folderIds.length === 0) return empty;
  const userId = input.user?.userId ?? null;
  const [connections, counts] = await Promise.all([
    database
      .select({
        folderId: feedConnections.folderId,
        folderPath: folders.path,
        health: feedConnections.health,
        detail: feedConnections.healthDetail,
        lastSuccessAt: feedConnections.lastSuccessAt,
      })
      .from(feedConnections)
      .innerJoin(folders, eq(folders.id, feedConnections.folderId))
      .where(
        and(
          eq(feedConnections.blogId, blogId),
          inArray(feedConnections.folderId, folderIds),
          isNull(feedConnections.deletedAt),
          sql`${feedConnections.state} <> 'detached'`,
        ),
      ),
    database
      .select({
        total: sql<number>`count(*)::int`,
        unread: userId
          ? sql<number>`count(*) filter (where not exists (
              select 1 from ${readingReadState}
              where ${readingReadState.postId} = ${posts.id}
                and ${readingReadState.userId} = ${userId}
                and ${readingReadState.readAt} is not null
            ))::int`
          : sql<number>`0`,
      })
      .from(posts)
      .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
      .where(
        and(
          eq(posts.blogId, blogId),
          isNull(posts.deletedAt),
          inArray(posts.folderId, folderIds),
          notDuplicateSql(),
        ),
      ),
  ]);
  const target = folderIds[0];
  return {
    folderPath: input.folderPath,
    sourceCount: connections.length,
    itemCount: counts[0]?.total ?? 0,
    unreadCount: userId ? (counts[0]?.unread ?? 0) : null,
    health: connections.map((row) => ({
      folderPath: row.folderPath,
      health: row.health,
      detail: row.detail,
      lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
    })),
    lastSuccessAt:
      connections
        .map((row) => row.lastSuccessAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0]
        ?.toISOString() ?? null,
    isSourceFolder: connections.some((row) => row.folderId === target && row.folderPath === input.folderPath),
  };
}

function sha(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16);
}
