import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, readingProvenance } from "@/lib/db/schema";
import { getFolders, setPostStarred } from "@/lib/store";
import { addFeedConnection, detachFeedConnection, listFeedConnections, updateFeedConnectionSettings, type FeedConnectionView } from "./connections.server";
import { listReadingItems, resolveReadingFolderIds, type ReadingListItem } from "./list.server";
import { itemsByIds, markdownToHtmlLite, readerIdentity, readerItemNumber, readerItemPrefix, type ReaderIdentity } from "./reader-api.server";
import { setReadState } from "./retention.server";

/**
 * The Feedbin v2 API, for the clients that speak only Feedbin. Same
 * identity as the Reader surface (HTTP Basic, password = a TextText API
 * token, username ignored), same server functions, same rules. Feedbin ids
 * are integers: entries use the 52-bit id shared with the Reader surface,
 * feeds and subscriptions use the same scheme on the connection's UUID.
 */

function requireDb() {
  if (!db) throw new Error("The Feedbin API needs DATABASE_URL");
  return db;
}

export async function feedbinIdentity(request: Request): Promise<ReaderIdentity | null> {
  const header = request.headers.get("authorization") ?? "";
  const basic = header.match(/^Basic\s+(\S+)$/i);
  if (!basic) return readerIdentity(request);
  let decoded = "";
  try {
    decoded = Buffer.from(basic[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  const password = colon >= 0 ? decoded.slice(colon + 1) : decoded;
  return readerIdentity(new Request(request.url, { headers: { authorization: `Bearer ${password}` } }));
}

export function feedNumber(connectionId: string): number {
  return readerItemNumber(connectionId);
}

async function connectionByNumber(identity: ReaderIdentity, id: number | string): Promise<FeedConnectionView | null> {
  const prefix = readerItemPrefix(id);
  if (!prefix) return null;
  const connections = await listFeedConnections(identity.handle);
  return connections.find((connection) => connection.id.startsWith(prefix)) ?? null;
}

function iso(value: string | null | undefined): string {
  return value ? new Date(value).toISOString() : new Date(0).toISOString();
}

export async function subscriptions(identity: ReaderIdentity) {
  const connections = (await listFeedConnections(identity.handle)).filter((connection) => connection.state !== "detached");
  return connections.map((connection) => ({
    id: feedNumber(connection.id),
    created_at: connection.createdAt,
    feed_id: feedNumber(connection.id),
    title: connection.publisherTitle ?? connection.folderName,
    feed_url: connection.endpoint.startsWith("http") ? connection.endpoint : `https://${connection.endpoint}`,
    site_url: connection.siteUrl ?? "",
  }));
}

export async function feed(identity: ReaderIdentity, id: number | string) {
  const connection = await connectionByNumber(identity, id);
  if (!connection) return null;
  return {
    id: feedNumber(connection.id),
    title: connection.publisherTitle ?? connection.folderName,
    feed_url: connection.endpoint.startsWith("http") ? connection.endpoint : `https://${connection.endpoint}`,
    site_url: connection.siteUrl ?? "",
  };
}

/** Feedbin taggings: one tag per feed, the feed folder's parent. */
export async function taggings(identity: ReaderIdentity) {
  const connections = (await listFeedConnections(identity.handle)).filter((connection) => connection.state !== "detached");
  const folders = await getFolders(identity.handle);
  const nameByPath = new Map(folders.map((folder) => [folder.path, folder.name]));
  return connections.map((connection) => {
    const parts = connection.folderPath.split("/");
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : parts[0];
    return { id: feedNumber(connection.id), feed_id: feedNumber(connection.id), name: nameByPath.get(parentPath) ?? parentPath };
  });
}

export async function tags(identity: ReaderIdentity) {
  const rows = await taggings(identity);
  const names = [...new Set(rows.map((row) => row.name))];
  return names.map((name, index) => ({ id: index + 1, name }));
}

function entryOf(identity: ReaderIdentity, item: ReadingListItem, body: string | null, connectionNumber: number | null, extended: boolean) {
  return {
    id: readerItemNumber(item.id),
    feed_id: connectionNumber ?? readerItemNumber(item.folderId),
    title: item.title,
    author: item.authors[0] ?? null,
    summary: item.excerpt ?? "",
    content: markdownToHtmlLite(body ?? item.excerpt ?? ""),
    url: item.permalink ?? item.externalUrl ?? `https://texttext.app/t/${identity.handle}/${item.folderPath}/${item.slug}`,
    extracted_content_url: null,
    published: iso(item.publishedAt ?? item.receivedAt),
    created_at: iso(item.receivedAt),
    ...(extended ? { original: null, twitter_id: null, twitter_thread_ids: null, images: null, enclosure: null } : {}),
  };
}

export async function entries(
  identity: ReaderIdentity,
  params: URLSearchParams,
  feedId?: number | string,
): Promise<{ items: ReturnType<typeof entryOf>[]; nextPage: number | null }> {
  const perPage = Math.max(1, Math.min(100, Number(params.get("per_page") ?? 100) || 100));
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const extended = params.get("mode") === "extended";
  const ids = params.get("ids")?.split(",").map((value) => value.trim()).filter(Boolean) ?? null;
  let items: ReadingListItem[];
  let hasMore = false;
  if (ids && ids.length > 0) {
    items = await itemsByIds(identity, ids.slice(0, 100));
  } else {
    let folderPath = "";
    if (feedId !== undefined) {
      const connection = await connectionByNumber(identity, feedId);
      if (!connection) return { items: [], nextPage: null };
      folderPath = connection.folderPath;
    }
    const state = params.get("starred") === "true" ? "starred" : params.get("read") === "false" ? "unread" : "all";
    // Page by walking the keyset list: bounded, and page numbers stay small
    // because clients ask for recent pages first.
    let cursor: string | null = null;
    let collected: ReadingListItem[] = [];
    for (let current = 1; current <= page; current += 1) {
      const result = await listReadingItems({
        handle: identity.handle,
        user: identity.user,
        scope: { folderPath, includeDescendants: true, state, dateBasis: "published" },
        cursor,
        limit: perPage,
      });
      collected = result.items;
      cursor = result.nextCursor;
      hasMore = Boolean(cursor);
      if (!cursor && current < page) {
        collected = [];
        break;
      }
    }
    const since = params.get("since");
    items = since ? collected.filter((item) => new Date(item.receivedAt) >= new Date(since)) : collected;
  }
  const connections = await listFeedConnections(identity.handle);
  const numberByFolder = new Map(connections.map((connection) => [connection.folderId, feedNumber(connection.id)]));
  const bodies = new Map(
    items.length
      ? (
          await requireDb()
            .select({ id: posts.id, body: posts.body })
            .from(posts)
            .where(inArray(posts.id, items.map((item) => item.id)))
        ).map((row) => [row.id, row.body])
      : [],
  );
  return {
    items: items.map((item) => entryOf(identity, item, bodies.get(item.id) ?? null, numberByFolder.get(item.folderId) ?? null, extended)),
    nextPage: hasMore ? page + 1 : null,
  };
}

async function idsInScope(identity: ReaderIdentity, state: "unread" | "starred"): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | null = null;
  // Feedbin returns every id in one array; bounded here at ten pages of a hundred.
  for (let pass = 0; pass < 10; pass += 1) {
    const result = await listReadingItems({
      handle: identity.handle,
      user: identity.user,
      scope: { folderPath: "", includeDescendants: true, state, dateBasis: "published" },
      cursor,
      limit: 100,
    });
    ids.push(...result.items.map((item) => readerItemNumber(item.id)));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return ids;
}

export const unreadEntryIds = (identity: ReaderIdentity) => idsInScope(identity, "unread");
export const starredEntryIds = (identity: ReaderIdentity) => idsInScope(identity, "starred");

export async function setUnread(identity: ReaderIdentity, ids: Array<number | string>, unread: boolean): Promise<number[]> {
  const items = await itemsByIds(identity, ids);
  if (items.length === 0) return [];
  await setReadState({ handle: identity.handle, user: identity.user, postIds: items.map((item) => item.id), read: !unread });
  return items.map((item) => readerItemNumber(item.id));
}

export async function setStarred(identity: ReaderIdentity, ids: Array<number | string>, starred: boolean): Promise<number[]> {
  const items = await itemsByIds(identity, ids);
  for (const item of items) if (item.starred !== starred) await setPostStarred(identity.handle, item.id, starred);
  return items.map((item) => readerItemNumber(item.id));
}

export async function subscribe(identity: ReaderIdentity, feedUrl: string): Promise<{ status: 201 | 302 | 404; subscription?: Awaited<ReturnType<typeof subscriptions>>[number]; error?: string }> {
  const actor = { userId: identity.user.userId, actorType: "human" as const };
  const folders = await getFolders(identity.handle);
  const parent = folders.find((folder) => folder.mode === "bookmarks" && folder.path === "bookmarks") ?? folders.find((folder) => folder.mode === "bookmarks");
  if (!parent) return { status: 404, error: "No bookmarks folder" };
  try {
    const added = await addFeedConnection({ handle: identity.handle, parentFolderPath: parent.path, endpointUrl: feedUrl, actor });
    const list = await subscriptions(identity);
    const subscription = list.find((entry) => entry.id === feedNumber(added.connection.id));
    return { status: added.created ? 201 : 302, subscription };
  } catch (error) {
    return { status: 404, error: error instanceof Error ? error.message : "Could not subscribe" };
  }
}

export async function unsubscribe(identity: ReaderIdentity, id: number | string): Promise<boolean> {
  const connection = await connectionByNumber(identity, id);
  if (!connection) return false;
  await detachFeedConnection(identity.handle, connection.id, { userId: identity.user.userId, actorType: "human" }, { keepAllItems: true });
  return true;
}

export async function renameSubscription(identity: ReaderIdentity, id: number | string, title: string): Promise<boolean> {
  const connection = await connectionByNumber(identity, id);
  if (!connection) return false;
  await updateFeedConnectionSettings(identity.handle, connection.id, { name: title }, { userId: identity.user.userId, actorType: "human" });
  return true;
}

export async function unreadCountAll(identity: ReaderIdentity): Promise<number> {
  const { blogId, folderIds } = await resolveReadingFolderIds({ handle: identity.handle, user: identity.user, folderPath: "", includeDescendants: true });
  if (folderIds.length === 0) return 0;
  const rows = await requireDb()
    .select({ id: posts.id })
    .from(posts)
    .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
    .where(and(eq(posts.blogId, blogId), inArray(posts.folderId, folderIds), eq(posts.origin, "feed")))
    .limit(1);
  return rows.length;
}
