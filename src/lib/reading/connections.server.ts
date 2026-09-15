import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { blogs, feedConnections, feedReceipts, folders, posts, readingProvenance } from "@/lib/db/schema";
import { recordAction, type AuditEntry } from "@/lib/audit";
import type { Folder } from "@/lib/content";
import { createSubfolder, getFolders, workspaceIdForHandle } from "@/lib/store";
import { endpointKey, redactedEndpoint } from "./feed-identity";
import { readingFlags } from "./flags";
import { cancelOpenReadingJobs, enqueueReadingJob } from "./jobs.server";
import { fetchFeedDocument } from "./fetch.server";
import { parseFeed } from "./feed-parse";

/**
 * Feed connections: the lifecycle of a source folder's subscription.
 *
 * A connection is what makes an ordinary bookmarks-mode subfolder a source.
 * Adding one creates the folder; pausing stops polling; detaching turns the
 * folder back into an ordinary folder and leaves every item where it is.
 * Nothing here deletes content: deleting is the folder's own flow, with its
 * own preview and role checks.
 */

export type FeedConnectionRow = typeof feedConnections.$inferSelect;

export type FeedConnectionView = {
  id: string;
  folderId: string;
  folderPath: string;
  folderName: string;
  /** Host and path only; never the token. */
  endpoint: string;
  format: string | null;
  publisherTitle: string | null;
  siteUrl: string | null;
  state: "active" | "paused" | "detached";
  health: string;
  healthDetail: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastImportAt: string | null;
  nextCheckAt: string | null;
  retentionDays: number | null;
  effectiveRetentionDays: number;
  itemCount: number;
  createdAt: string;
};

export class FeedConnectionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "disabled"
      | "invalid_url"
      | "wrong_mode"
      | "no_parent"
      | "not_a_feed"
      | "unreachable"
      | "not_found"
      | "conflict",
  ) {
    super(message);
    this.name = "FeedConnectionError";
  }
}

function requireDb() {
  if (!db) throw new Error("Feed connections need DATABASE_URL");
  return db;
}

async function blogRetentionDefault(blogId: string): Promise<number> {
  const rows = await requireDb()
    .select({ days: blogs.readingRetentionDays })
    .from(blogs)
    .where(eq(blogs.id, blogId))
    .limit(1);
  return rows[0]?.days ?? 90;
}

export function connectionView(
  row: FeedConnectionRow,
  folder: Pick<Folder, "path" | "name">,
  itemCount: number,
  defaultRetentionDays: number,
): FeedConnectionView {
  const iso = (value: Date | null) => (value ? value.toISOString() : null);
  return {
    id: row.id,
    folderId: row.folderId,
    folderPath: folder.path,
    folderName: folder.name,
    endpoint: redactedEndpoint(row.endpointUrl),
    format: row.feedFormat,
    publisherTitle: row.publisherTitle,
    siteUrl: row.siteUrl,
    state: row.state as FeedConnectionView["state"],
    health: row.health,
    healthDetail: row.healthDetail,
    lastCheckedAt: iso(row.lastCheckedAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastImportAt: iso(row.lastImportAt),
    nextCheckAt: iso(row.nextCheckAt),
    retentionDays: row.retentionDays,
    effectiveRetentionDays: row.retentionDays ?? defaultRetentionDays,
    itemCount,
    createdAt: row.createdAt.toISOString(),
  };
}

async function itemCountsByFolder(blogId: string, folderIds: string[]): Promise<Map<string, number>> {
  if (folderIds.length === 0) return new Map();
  const rows = await requireDb()
    .select({ folderId: posts.folderId, count: sql<number>`count(*)::int` })
    .from(posts)
    .where(
      and(
        eq(posts.blogId, blogId),
        eq(posts.origin, "feed"),
        inArray(posts.folderId, folderIds),
        isNull(posts.deletedAt),
      ),
    )
    .groupBy(posts.folderId);
  return new Map(rows.map((row) => [row.folderId, row.count]));
}

/**
 * The real endpoints, for the owner's OPML export only. Views never carry
 * them because a feed address can embed a token; the export is the one place
 * the owner asks for the address back.
 */
export async function feedEndpointsForOwner(
  handle: string,
): Promise<Array<{ id: string; endpointUrl: string; siteUrl: string | null; publisherTitle: string | null; folderPath: string; folderName: string }>> {
  const blogId = await workspaceIdForHandle(handle);
  const [rows, allFolders] = await Promise.all([
    requireDb()
      .select()
      .from(feedConnections)
      .where(and(eq(feedConnections.blogId, blogId), isNull(feedConnections.deletedAt), sql`${feedConnections.state} <> 'detached'`))
      .orderBy(desc(feedConnections.createdAt)),
    getFolders(handle),
  ]);
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]));
  return rows.flatMap((row) => {
    const folder = folderById.get(row.folderId);
    if (!folder) return [];
    return [{ id: row.id, endpointUrl: row.endpointUrl, siteUrl: row.siteUrl, publisherTitle: row.publisherTitle, folderPath: folder.path, folderName: folder.name }];
  });
}

export async function listFeedConnections(handle: string): Promise<FeedConnectionView[]> {
  const blogId = await workspaceIdForHandle(handle);
  const [rows, allFolders, defaultRetention] = await Promise.all([
    requireDb()
      .select()
      .from(feedConnections)
      .where(and(eq(feedConnections.blogId, blogId), isNull(feedConnections.deletedAt)))
      .orderBy(desc(feedConnections.createdAt)),
    getFolders(handle),
    blogRetentionDefault(blogId),
  ]);
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]));
  const counts = await itemCountsByFolder(blogId, rows.map((row) => row.folderId));
  return rows.flatMap((row) => {
    const folder = folderById.get(row.folderId);
    if (!folder) return [];
    return [connectionView(row, folder, counts.get(row.folderId) ?? 0, defaultRetention)];
  });
}

export async function feedConnectionById(handle: string, id: string): Promise<FeedConnectionRow | null> {
  const blogId = await workspaceIdForHandle(handle);
  const rows = await requireDb()
    .select()
    .from(feedConnections)
    .where(and(eq(feedConnections.id, id), eq(feedConnections.blogId, blogId), isNull(feedConnections.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Connections whose source folder is the folder or lies under it. */
export async function feedConnectionsUnderFolder(
  handle: string,
  folderPath: string,
): Promise<FeedConnectionView[]> {
  const all = await listFeedConnections(handle);
  return all.filter(
    (connection) =>
      connection.folderPath === folderPath || connection.folderPath.startsWith(`${folderPath}/`),
  );
}

export type AddFeedInput = {
  handle: string;
  /** Path of the compatible parent; must be bookmarks mode. */
  parentFolderPath: string;
  endpointUrl: string;
  /** Overrides the feed's own title as the folder name. */
  name?: string | null;
  retentionDays?: number | null;
  initialImportLimit?: number | null;
  actor: { userId: string | null; actorType: AuditEntry["actorType"] };
  /** Retrying a call with the same key returns the same connection. */
  idempotencyKey?: string | null;
  /** Tests supply fixture documents; production leaves this unset. */
  fetcher?: typeof fetchFeedDocument;
};

export type AddFeedResult = {
  connection: FeedConnectionView;
  folder: Folder;
  created: boolean;
};

const DEFAULT_INITIAL_IMPORT = 100;
const MAX_INITIAL_IMPORT = 500;

/**
 * Follow a feed under a folder. Idempotent on the feed's credential-free
 * identity: adding a feed the workspace already follows opens its existing
 * source folder instead of importing everything twice.
 */
export async function addFeedConnection(input: AddFeedInput): Promise<AddFeedResult> {
  if (!readingFlags.connections) {
    throw new FeedConnectionError("Reading is not enabled on this deployment", "disabled");
  }
  const key = endpointKey(input.endpointUrl);
  if (!key) throw new FeedConnectionError("Enter a web address for the feed", "invalid_url");
  const blogId = await workspaceIdForHandle(input.handle);
  const allFolders = await getFolders(input.handle);
  const parent = allFolders.find((folder) => folder.path === input.parentFolderPath);
  if (!parent) throw new FeedConnectionError("Choose a folder to add the feed to", "no_parent");
  if (parent.mode !== "bookmarks") {
    throw new FeedConnectionError(
      "Feeds live under Bookmarks. Choose a Bookmarks folder, or create a reading folder there.",
      "wrong_mode",
    );
  }
  const defaultRetention = await blogRetentionDefault(blogId);

  const existing = await requireDb()
    .select()
    .from(feedConnections)
    .where(
      and(
        eq(feedConnections.blogId, blogId),
        eq(feedConnections.endpointKey, key),
        isNull(feedConnections.deletedAt),
        sql`${feedConnections.state} <> 'detached'`,
      ),
    )
    .limit(1);
  if (existing[0]) {
    const folder = allFolders.find((entry) => entry.id === existing[0].folderId);
    if (folder) {
      const counts = await itemCountsByFolder(blogId, [folder.id]);
      return {
        connection: connectionView(existing[0], folder, counts.get(folder.id) ?? 0, defaultRetention),
        folder,
        created: false,
      };
    }
  }

  // One bounded fetch to learn what this is and what to call it. A feed that
  // cannot be read is not followed: a source folder for nothing is a trap.
  const fetched = await (input.fetcher ?? fetchFeedDocument)(input.endpointUrl);
  if (fetched.kind === "error") {
    throw new FeedConnectionError(fetched.detail, fetched.reason === "blocked" ? "invalid_url" : "unreachable");
  }
  if (fetched.kind !== "ok") {
    throw new FeedConnectionError("The feed did not answer", "unreachable");
  }
  let parsed;
  try {
    parsed = parseFeed(fetched.body, fetched.contentType);
  } catch (error) {
    throw new FeedConnectionError(
      error instanceof Error ? error.message : "That address is not a feed",
      "not_a_feed",
    );
  }

  const folderName = (input.name?.trim() || parsed.title || new URL(fetched.finalUrl).hostname).slice(0, 120);
  const folder = await createSubfolder(input.handle, parent.path, folderName, {
    audit: {
      actorUserId: input.actor.userId,
      actorType: input.actor.actorType,
      actionName: "reading.create_source_folder",
      targetType: "workspace",
      inputSummary: `${parent.path} <- ${redactedEndpoint(input.endpointUrl)}`,
    },
  });

  const retentionDays =
    input.retentionDays === undefined || input.retentionDays === null
      ? null
      : Math.max(0, Math.trunc(input.retentionDays));
  const initialImportLimit = Math.min(
    MAX_INITIAL_IMPORT,
    Math.max(1, Math.trunc(input.initialImportLimit ?? DEFAULT_INITIAL_IMPORT)),
  );
  const inserted = await requireDb()
    .insert(feedConnections)
    .values({
      blogId,
      folderId: folder.id,
      endpointUrl: fetched.finalUrl,
      endpointKey: endpointKey(fetched.finalUrl) ?? key,
      feedFormat: parsed.format,
      publisherTitle: parsed.title,
      siteUrl: parsed.siteUrl,
      state: "active",
      health: "checking",
      retentionDays,
      initialImportLimit,
      createdById: input.actor.userId,
      nextCheckAt: new Date(),
    })
    .returning();
  const row = inserted[0];
  await recordAction({
    actorUserId: input.actor.userId,
    actorType: input.actor.actorType,
    actionName: "reading.add_feed",
    targetType: "folder",
    targetId: folder.id,
    inputSummary: redactedEndpoint(fetched.finalUrl),
    outputSummary: `${parsed.format} · ${parsed.entries.length} entries`,
  });
  await enqueueReadingJob({
    blogId,
    kind: "poll_feed",
    opKey: `poll_feed:${row.id}:initial`,
    payload: { connectionId: row.id, handle: input.handle, initial: true },
  });
  return {
    connection: connectionView(row, folder, 0, defaultRetention),
    folder,
    created: true,
  };
}

export async function setFeedConnectionState(
  handle: string,
  id: string,
  state: "active" | "paused",
  actor: AddFeedInput["actor"],
): Promise<FeedConnectionView> {
  const row = await feedConnectionById(handle, id);
  if (!row) throw new FeedConnectionError("Feed not found", "not_found");
  if (row.state === "detached") throw new FeedConnectionError("This folder no longer follows a feed", "conflict");
  const updated = await requireDb()
    .update(feedConnections)
    .set({
      state,
      health: state === "paused" ? "disabled" : "checking",
      healthDetail: state === "paused" ? "Paused" : null,
      nextCheckAt: state === "active" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(feedConnections.id, row.id))
    .returning();
  await recordAction({
    actorUserId: actor.userId,
    actorType: actor.actorType,
    actionName: state === "paused" ? "reading.pause_feed" : "reading.resume_feed",
    targetType: "folder",
    targetId: row.folderId,
  });
  if (state === "active") {
    await enqueueReadingJob({
      blogId: row.blogId,
      kind: "poll_feed",
      opKey: `poll_feed:${row.id}:resume:${Date.now()}`,
      payload: { connectionId: row.id, handle },
    });
  }
  return viewFor(handle, updated[0]);
}

/**
 * Stop following: the folder becomes an ordinary folder, every item stays,
 * and each item keeps whatever retention it already had. Keeping everything
 * is a separate choice the caller can make with keepAllItems.
 */
export async function detachFeedConnection(
  handle: string,
  id: string,
  actor: AddFeedInput["actor"],
  options: { keepAllItems?: boolean } = {},
): Promise<FeedConnectionView> {
  const row = await feedConnectionById(handle, id);
  if (!row) throw new FeedConnectionError("Feed not found", "not_found");
  const updated = await requireDb()
    .update(feedConnections)
    .set({
      state: "detached",
      health: "disabled",
      healthDetail: "Detached",
      nextCheckAt: null,
      updatedAt: new Date(),
    })
    .where(eq(feedConnections.id, row.id))
    .returning();
  await requireDb()
    .update(feedReceipts)
    .set({
      status: "detached",
      ...(options.keepAllItems ? { expiresAt: null } : {}),
    })
    .where(and(eq(feedReceipts.connectionId, row.id), eq(feedReceipts.status, "active")));
  await recordAction({
    actorUserId: actor.userId,
    actorType: actor.actorType,
    actionName: "reading.detach_feed",
    targetType: "folder",
    targetId: row.folderId,
    inputSummary: options.keepAllItems ? "keep all items" : "keep current policies",
  });
  return viewFor(handle, updated[0]);
}

export async function requestFeedRefresh(
  handle: string,
  id: string,
): Promise<{ queued: boolean }> {
  const row = await feedConnectionById(handle, id);
  if (!row) throw new FeedConnectionError("Feed not found", "not_found");
  if (row.state !== "active") return { queued: false };
  // A person asking now outranks a scheduled retry that is waiting out its
  // backoff: cancel whatever poll is open for this connection, then queue one
  // that runs immediately. Two people asking at once still collapse to one.
  await cancelOpenReadingJobs(row.blogId, `poll_feed:${row.id}:`);
  const queued = await enqueueReadingJob({
    blogId: row.blogId,
    kind: "poll_feed",
    opKey: `poll_feed:${row.id}:manual`,
    payload: { connectionId: row.id, handle, manual: true },
  });
  return { queued };
}

async function viewFor(handle: string, row: FeedConnectionRow): Promise<FeedConnectionView> {
  const allFolders = await getFolders(handle);
  const folder = allFolders.find((entry) => entry.id === row.folderId);
  const [defaultRetention, counts] = await Promise.all([
    blogRetentionDefault(row.blogId),
    itemCountsByFolder(row.blogId, [row.folderId]),
  ]);
  return connectionView(
    row,
    folder ?? { path: "", name: "" },
    counts.get(row.folderId) ?? 0,
    defaultRetention,
  );
}

/** Publisher facts for one item, for the article header. */
export async function readingProvenanceForPost(postId: string) {
  const rows = await requireDb()
    .select()
    .from(readingProvenance)
    .where(eq(readingProvenance.postId, postId))
    .limit(1);
  return rows[0] ?? null;
}

/** Folder rows the subtree of a path, for aggregate scope. */
export async function subtreeFolderIds(blogId: string, folderPath: string): Promise<string[]> {
  const rows = await requireDb()
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        isNull(folders.deletedAt),
        sql`(${folders.path} = ${folderPath} or ${folders.path} like ${`${folderPath}/%`})`,
      ),
    );
  return rows.map((row) => row.id);
}
