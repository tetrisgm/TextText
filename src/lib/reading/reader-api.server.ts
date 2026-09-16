import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, readingProvenance } from "@/lib/db/schema";
import { resolveApiToken } from "@/lib/api-tokens";
import type { AccessUser } from "@/lib/permissions";
import { getFolders, getOwnedBlog, setPostStarred, workspaceIdForHandle } from "@/lib/store";
import {
  addFeedConnection,
  detachFeedConnection,
  feedConnectionById,
  listFeedConnections,
  updateFeedConnectionSettings,
  type FeedConnectionView,
} from "./connections.server";
import { listReadingItems, readingFolderSummary, resolveReadingFolderIds, type ReadingListItem, type ReadingScope } from "./list.server";
import { setReadState, setReadStateForScope } from "./retention.server";

/**
 * The Google Reader API, as the clients that outlived Reader still speak it
 * (NetNewsWire, Reeder, Unread, and the FreshRSS-compatible family). Enough
 * of it to sync: sign in, list subscriptions and labels, unread counts, item
 * ids with continuation, item contents, read and star edits, mark all read,
 * and subscribe/unsubscribe/rename.
 *
 * Identity is a TextText API token entered as the password (the email is
 * ignored); the token names the workspace. Items keep TextText's rules: what
 * a client reads or stars is the same read state and star the app shows,
 * and nothing here can publish, delete, or reach another workspace.
 *
 * Item ids: Reader wants 64-bit numbers. The first sixteen hex digits of an
 * item's UUID are the number; the reverse lookup is a prefix match on the id.
 */

export type ReaderIdentity = { handle: string; blogId: string; user: AccessUser & { userId: string }; token: string };

const READ = "user/-/state/com.google/read";
const STARRED = "user/-/state/com.google/starred";
const READING_LIST = "user/-/state/com.google/reading-list";

function requireDb() {
  if (!db) throw new Error("The Reader API needs DATABASE_URL");
  return db;
}

/**
 * Fifty-two bits of the UUID (thirteen hex digits): small enough to survive
 * JSON numbers in Feedbin-style clients (IEEE doubles carry 53 bits) and
 * signed 64-bit parsing in Reader-style ones. The Reader tag form pads to
 * sixteen hex digits as the protocol expects.
 */
const ID_HEX_DIGITS = 13;

export function readerItemShortHex(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, ID_HEX_DIGITS).toLowerCase();
}

export function readerItemHex(uuid: string): string {
  return readerItemShortHex(uuid).padStart(16, "0");
}

export function readerItemLongId(uuid: string): string {
  return BigInt(`0x${readerItemShortHex(uuid)}`).toString();
}

/** The same id as a JSON-safe number, for the Feedbin surface. */
export function readerItemNumber(uuid: string): number {
  return Number(BigInt(`0x${readerItemShortHex(uuid)}`));
}

/** Accepts the decimal form, the hex form, or the full tag URI; returns a UUID prefix for lookup. */
export function readerItemPrefix(id: string | number): string | null {
  let hex = String(id).trim();
  const tag = hex.match(/reader\/item\/([0-9a-fA-F]{16})$/);
  if (tag) hex = tag[1];
  else if (/^\d+$/.test(hex)) {
    try {
      hex = BigInt(hex).toString(16).padStart(16, "0");
    } catch {
      return null;
    }
  }
  if (!/^[0-9a-fA-F]{13,16}$/.test(hex)) return null;
  const short = hex.toLowerCase().padStart(16, "0").slice(16 - ID_HEX_DIGITS);
  return `${short.slice(0, 8)}-${short.slice(8, 12)}-${short.slice(12, 13)}`;
}

export async function readerIdentity(request: Request, tokenFromBody?: string | null): Promise<ReaderIdentity | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^GoogleLogin\s+auth=(\S+)$/i) ?? header.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1] ?? tokenFromBody ?? null;
  if (!token) return null;
  const identity = await resolveApiToken(`Bearer ${token}`);
  if (!identity) return null;
  const blog = await getOwnedBlog(identity.sub);
  if (!blog) return null;
  const blogId = await workspaceIdForHandle(blog.handle);
  return { handle: blog.handle, blogId, user: { sub: identity.sub, userId: identity.userId }, token };
}

export async function clientLogin(password: string): Promise<{ auth: string } | null> {
  const identity = await resolveApiToken(`Bearer ${password}`);
  if (!identity) return null;
  const blog = await getOwnedBlog(identity.sub);
  return blog ? { auth: password } : null;
}

function labelFor(connection: FeedConnectionView): string {
  const parts = connection.folderPath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : parts[0];
}

export async function subscriptionList(identity: ReaderIdentity) {
  const connections = (await listFeedConnections(identity.handle)).filter((connection) => connection.state !== "detached");
  const folders = await getFolders(identity.handle);
  const nameByPath = new Map(folders.map((folder) => [folder.path, folder.name]));
  return {
    subscriptions: connections.map((connection) => {
      const labelPath = labelFor(connection);
      return {
        id: `feed/${connection.id}`,
        title: connection.publisherTitle ?? connection.folderName,
        categories: [{ id: `user/-/label/${labelPath}`, label: nameByPath.get(labelPath) ?? labelPath }],
        url: connection.endpoint,
        htmlUrl: connection.siteUrl ?? "",
        iconUrl: "",
      };
    }),
  };
}

export async function tagList(identity: ReaderIdentity) {
  const connections = (await listFeedConnections(identity.handle)).filter((connection) => connection.state !== "detached");
  const labels = [...new Set(connections.map(labelFor))];
  return { tags: [{ id: STARRED }, ...labels.map((label) => ({ id: `user/-/label/${label}`, type: "folder" }))] };
}

export async function unreadCount(identity: ReaderIdentity) {
  const connections = (await listFeedConnections(identity.handle)).filter((connection) => connection.state !== "detached");
  const counts: Array<{ id: string; count: number; newestItemTimestampUsec: string }> = [];
  let total = 0;
  const byLabel = new Map<string, number>();
  for (const connection of connections) {
    const summary = await readingFolderSummary({ handle: identity.handle, user: identity.user, folderPath: connection.folderPath });
    const unread = summary.unreadCount ?? 0;
    total += unread;
    const label = labelFor(connection);
    byLabel.set(label, (byLabel.get(label) ?? 0) + unread);
    counts.push({ id: `feed/${connection.id}`, count: unread, newestItemTimestampUsec: String((summary.lastSuccessAt ? new Date(summary.lastSuccessAt).getTime() : Date.now()) * 1000) });
  }
  for (const [label, count] of byLabel) counts.push({ id: `user/-/label/${label}`, count, newestItemTimestampUsec: String(Date.now() * 1000) });
  counts.push({ id: READING_LIST, count: total, newestItemTimestampUsec: String(Date.now() * 1000) });
  return { max: 10000, unreadcounts: counts };
}

type StreamQuery = { folderPath: string; state: ReadingScope["state"]; direction: "newest" | "oldest" };

async function streamScope(identity: ReaderIdentity, stream: string | null, exclude: string | null, order: string | null): Promise<StreamQuery | null> {
  let folderPath = "";
  let state: ReadingScope["state"] = "all";
  if (stream?.startsWith("feed/")) {
    const connection = await feedConnectionById(identity.handle, stream.slice("feed/".length));
    if (!connection) return null;
    const folders = await getFolders(identity.handle);
    folderPath = folders.find((folder) => folder.id === connection.folderId)?.path ?? "";
    if (!folderPath) return null;
  } else if (stream?.startsWith("user/-/label/")) {
    folderPath = stream.slice("user/-/label/".length);
  } else if (stream === STARRED) {
    state = "starred";
  } else if (stream === READ) {
    state = "all";
  }
  if (exclude === READ) state = "unread";
  return { folderPath, state, direction: order === "o" ? "oldest" : "newest" };
}

export async function streamItemIds(identity: ReaderIdentity, params: URLSearchParams) {
  const scope = await streamScope(identity, params.get("s"), params.get("xt"), params.get("r"));
  if (!scope) return { itemRefs: [] };
  const limit = Math.max(1, Math.min(1000, Number(params.get("n") ?? 1000) || 1000));
  const page = await listReadingItems({
    handle: identity.handle,
    user: identity.user,
    scope: { folderPath: scope.folderPath, includeDescendants: true, state: scope.state, dateBasis: "published", direction: scope.direction },
    cursor: params.get("c"),
    limit: Math.min(100, limit),
  });
  const olderThan = params.get("ot") ? Number(params.get("ot")) * 1000 : null;
  const connections = await listFeedConnections(identity.handle);
  const streamByFolder = new Map(connections.map((connection) => [connection.folderId, `feed/${connection.id}`]));
  const refs = page.items
    .filter((item) => olderThan === null || new Date(item.publishedAt ?? item.receivedAt).getTime() >= olderThan)
    .map((item) => ({
      id: readerItemLongId(item.id),
      directStreamIds: [streamByFolder.get(item.folderId) ?? `feed/${item.folderId}`],
      timestampUsec: String(new Date(item.publishedAt ?? item.receivedAt).getTime() * 1000),
    }));
  return { itemRefs: refs, ...(page.nextCursor ? { continuation: page.nextCursor } : {}) };
}

export async function itemsByIds(identity: ReaderIdentity, ids: Array<string | number>): Promise<ReadingListItem[]> {
  const prefixes = ids.map(readerItemPrefix).filter((prefix): prefix is string => Boolean(prefix)).slice(0, 200);
  if (prefixes.length === 0) return [];
  const rows = await requireDb()
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.blogId, identity.blogId), isNull(posts.deletedAt), sql`${sql.join(prefixes.map((prefix) => sql`${posts.id}::text like ${`${prefix}%`}`), sql` or `)}`));
  if (rows.length === 0) return [];
  const page = await listReadingItems({
    handle: identity.handle,
    user: identity.user,
    scope: { folderPath: "", includeDescendants: true, state: "all", dateBasis: "published", ids: rows.map((row) => row.id) },
    limit: 100,
  });
  return page.items;
}

export async function streamContents(identity: ReaderIdentity, params: URLSearchParams, ids: string[] | null, origin: string) {
  let items: ReadingListItem[];
  let continuation: string | null = null;
  if (ids && ids.length > 0) {
    items = await itemsByIds(identity, ids);
  } else {
    const scope = await streamScope(identity, params.get("s"), params.get("xt"), params.get("r"));
    if (!scope) return { id: params.get("s") ?? READING_LIST, updated: Math.floor(Date.now() / 1000), items: [] };
    const page = await listReadingItems({
      handle: identity.handle,
      user: identity.user,
      scope: { folderPath: scope.folderPath, includeDescendants: true, state: scope.state, dateBasis: "published", direction: scope.direction },
      cursor: params.get("c"),
      limit: Math.min(100, Math.max(1, Number(params.get("n") ?? 50) || 50)),
    });
    items = page.items;
    continuation = page.nextCursor;
  }
  const bodies = new Map(
    (
      await requireDb()
        .select({ id: posts.id, body: posts.body, connectionId: readingProvenance.connectionId })
        .from(posts)
        .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
        .where(inArray(posts.id, items.map((item) => item.id)))
    ).map((row) => [row.id, row]),
  );
  return {
    id: params.get("s") ?? READING_LIST,
    updated: Math.floor(Date.now() / 1000),
    ...(continuation ? { continuation } : {}),
    items: items.map((item) => {
      const row = bodies.get(item.id);
      const published = Math.floor(new Date(item.publishedAt ?? item.receivedAt).getTime() / 1000);
      const categories = [READING_LIST, ...(item.read ? [READ] : []), ...(item.starred ? [STARRED] : []), `user/-/label/${item.folderPath.split("/").slice(0, -1).join("/") || item.folderPath}`];
      return {
        id: `tag:google.com,2005:reader/item/${readerItemHex(item.id)}`,
        crawlTimeMsec: String(new Date(item.receivedAt).getTime()),
        timestampUsec: String(new Date(item.publishedAt ?? item.receivedAt).getTime() * 1000),
        published,
        updated: published,
        title: item.title,
        canonical: item.permalink ? [{ href: item.permalink }] : [],
        alternate: [{ href: item.permalink ?? `${origin}/t/${identity.handle}/${item.folderPath}/${item.slug}`, type: "text/html" }],
        categories,
        origin: { streamId: `feed/${row?.connectionId ?? item.folderId}`, title: item.publisherName ?? item.sourceFolderName, htmlUrl: "" },
        summary: { direction: "ltr", content: markdownToHtmlLite(row?.body ?? item.excerpt ?? "") },
        author: item.authors[0] ?? "",
      };
    }),
  };
}

/** Enough HTML for a reader client: paragraphs, headings, links, emphasis, images. */
export function markdownToHtmlLite(markdown: string): string {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (text: string) =>
    escape(text)
      .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const heading = block.match(/^(#{1,6})\s+(.*)$/);
      if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
      if (block.startsWith("> ")) return `<blockquote><p>${inline(block.replace(/^> ?/gm, ""))}</p></blockquote>`;
      if (/^[-*] /m.test(block)) return `<ul>${block.split("\n").map((line) => `<li>${inline(line.replace(/^[-*] /, ""))}</li>`).join("")}</ul>`;
      return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

export async function editTag(identity: ReaderIdentity, ids: string[], add: string[], remove: string[]): Promise<void> {
  const items = await itemsByIds(identity, ids);
  if (items.length === 0) return;
  const postIds = items.map((item) => item.id);
  if (add.includes(READ)) await setReadState({ handle: identity.handle, user: identity.user, postIds, read: true });
  if (remove.includes(READ)) await setReadState({ handle: identity.handle, user: identity.user, postIds, read: false });
  if (add.includes(STARRED)) for (const item of items) if (!item.starred) await setPostStarred(identity.handle, item.id, true);
  if (remove.includes(STARRED)) for (const item of items) if (item.starred) await setPostStarred(identity.handle, item.id, false);
}

export async function markAllAsRead(identity: ReaderIdentity, stream: string | null): Promise<number> {
  const scope = await streamScope(identity, stream, null, null);
  if (!scope) return 0;
  const { blogId, folderIds } = await resolveReadingFolderIds({ handle: identity.handle, user: identity.user, folderPath: scope.folderPath, includeDescendants: true });
  return setReadStateForScope({ userId: identity.user.userId, blogId, folderIds });
}

export async function editSubscription(identity: ReaderIdentity, params: URLSearchParams): Promise<{ ok: true; streamId?: string } | { ok: false; error: string }> {
  const action = params.get("ac");
  const actor = { userId: identity.user.userId, actorType: "human" as const };
  if (action === "subscribe" || params.has("quickadd")) {
    const raw = params.get("quickadd") ?? params.get("s") ?? "";
    const url = raw.replace(/^feed\//, "");
    const label = params.get("a")?.replace(/^user\/-\/label\//, "") ?? "";
    const folders = await getFolders(identity.handle);
    const parent = folders.find((folder) => folder.mode === "bookmarks" && (folder.path === label || folder.name === label)) ?? folders.find((folder) => folder.mode === "bookmarks" && folder.path === "bookmarks") ?? folders.find((folder) => folder.mode === "bookmarks");
    if (!parent) return { ok: false, error: "No bookmarks folder to add the feed to" };
    try {
      const added = await addFeedConnection({ handle: identity.handle, parentFolderPath: parent.path, endpointUrl: url, name: params.get("t"), actor });
      return { ok: true, streamId: `feed/${added.connection.id}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not subscribe" };
    }
  }
  const id = (params.get("s") ?? "").replace(/^feed\//, "");
  if (!id) return { ok: false, error: "Missing stream" };
  if (action === "unsubscribe") {
    await detachFeedConnection(identity.handle, id, actor, { keepAllItems: true });
    return { ok: true };
  }
  if (action === "edit") {
    const title = params.get("t");
    if (title) await updateFeedConnectionSettings(identity.handle, id, { name: title }, actor);
    return { ok: true };
  }
  return { ok: false, error: "Unknown action" };
}
