import { readScope } from "@/lib/request-scope";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { folders, posts, readingProvenance, readingReadState } from "@/lib/db/schema";
import type { AccessUser } from "@/lib/permissions";
import { createDraftInFolder, getAccessibleFolders } from "@/lib/store";
import { slugify } from "@/lib/post-edit-draft";
import type { AuditActorType } from "@/lib/audit";
import { listFeedConnections, type FeedConnectionView } from "./connections.server";
import { listReadingItems, resolveReadingFolderIds, type ReadingListItem } from "./list.server";

/**
 * The reading module on the workspace's front page: what arrived, from
 * where, and what is still unread, across every source the person can see.
 * Bounded like the folder view; this never loads the corpus.
 */

export type ReadingOverview = {
  sources: Array<
    Pick<FeedConnectionView, "id" | "folderPath" | "folderName" | "publisherTitle" | "state" | "health" | "healthDetail" | "lastSuccessAt"> & {
      unread: number | null;
    }
  >;
  totals: { items: number; unread: number | null; newSince24h: number };
  latest: ReadingListItem[];
};

function requireDb() {
  if (!db) throw new Error("Reading overview needs DATABASE_URL");
  return db;
}

export function readingOverview(input: { handle: string; user: AccessUser | null; now?: Date }): Promise<ReadingOverview> {
  // The same workspace and folder list every layer under here asks for.
  return readScope(() => overviewOf(input));
}

async function overviewOf(input: { handle: string; user: AccessUser | null; now?: Date }): Promise<ReadingOverview> {
  const database = requireDb();
  const now = input.now ?? new Date();
  const { blogId, folderIds } = await resolveReadingFolderIds({ handle: input.handle, user: input.user, folderPath: "", includeDescendants: true });
  const visible = new Set(folderIds);
  const connections = (await listFeedConnections(input.handle)).filter((connection) => connection.state !== "detached" && visible.has(connection.folderId));
  if (connections.length === 0) return { sources: [], totals: { items: 0, unread: null, newSince24h: 0 }, latest: [] };

  const userId = input.user?.userId ?? null;
  const sourceFolderIds = connections.map((connection) => connection.folderId);
  const perFolder = await database
    .select({
      folderId: posts.folderId,
      items: sql<number>`count(*)::int`,
      unread: userId
        ? sql<number>`count(*) filter (where not exists (select 1 from ${readingReadState} r where r.post_id = ${posts.id} and r.user_id = ${userId} and r.read_at is not null))::int`
        : sql<number>`0`,
      fresh: sql<number>`count(*) filter (where ${posts.createdAt} > ${new Date(now.getTime() - 24 * 60 * 60 * 1000)})::int`,
    })
    .from(posts)
    .innerJoin(folders, eq(folders.id, posts.folderId))
    .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
    .where(
      and(
        eq(posts.blogId, blogId),
        isNull(posts.deletedAt),
        eq(posts.origin, "feed"),
        inArray(posts.folderId, sourceFolderIds),
        isNull(readingProvenance.duplicateOfPostId),
      ),
    )
    .groupBy(posts.folderId);
  const byFolder = new Map(perFolder.map((row) => [row.folderId, row]));

  const latest = await listReadingItems({
    handle: input.handle,
    user: input.user,
    scope: { folderPath: "", includeDescendants: true, state: userId ? "unread" : "all", dateBasis: "published" },
    limit: 8,
  });

  return {
    sources: connections.map((connection) => ({
      id: connection.id,
      folderPath: connection.folderPath,
      folderName: connection.folderName,
      publisherTitle: connection.publisherTitle,
      state: connection.state,
      health: connection.health,
      healthDetail: connection.healthDetail,
      lastSuccessAt: connection.lastSuccessAt,
      unread: userId ? (byFolder.get(connection.folderId)?.unread ?? 0) : null,
    })),
    totals: {
      items: perFolder.reduce((sum, row) => sum + row.items, 0),
      unread: userId ? perFolder.reduce((sum, row) => sum + row.unread, 0) : null,
      newSince24h: perFolder.reduce((sum, row) => sum + row.fresh, 0),
    },
    latest: latest.items,
  };
}

const BRIEF_LIMIT = 50;

/**
 * Save a brief: a note in the person's own Notes that lists what arrived
 * in the last day, grouped by source, each line a wiki-link to the article
 * and its original address. Built from the data, not generated, so every
 * line is a citation; the links are what keep those articles past cleanup.
 */
export async function saveReadingBrief(input: {
  handle: string;
  user: AccessUser;
  folderPath?: string | null;
  actor: { userId: string | null; actorType: AuditActorType };
  now?: Date;
}): Promise<{ id: string; slug: string; folderPath: string; items: number }> {
  const now = input.now ?? new Date();
  const accessible = await getAccessibleFolders(input.handle, input.user);
  const notes = accessible.find((folder) => folder.mode === "notes" && folder.path === "notes") ?? accessible.find((folder) => folder.mode === "notes");
  if (!notes) throw new Error("This workspace has no notes folder to save a brief into");
  const page = await listReadingItems({
    handle: input.handle,
    user: input.user,
    scope: { folderPath: input.folderPath ?? "", includeDescendants: true, state: "all", dateBasis: "received" },
    limit: BRIEF_LIMIT,
  });
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  const fresh = page.items.filter((item) => item.origin === "feed" && new Date(item.receivedAt).getTime() >= since);
  const bySource = new Map<string, ReadingListItem[]>();
  for (const item of fresh) {
    const key = item.publisherName ?? item.sourceFolderName;
    bySource.set(key, [...(bySource.get(key) ?? []), item]);
  }
  const day = now.toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`${fresh.length} ${fresh.length === 1 ? "article" : "articles"} from ${bySource.size} ${bySource.size === 1 ? "source" : "sources"} in the last day${input.folderPath ? ` in ${input.folderPath}` : ""}.`);
  lines.push("");
  for (const [source, items] of bySource) {
    lines.push(`## ${source}`);
    lines.push("");
    for (const item of items) {
      const link = item.permalink ?? item.externalUrl;
      lines.push(`- [[${item.slug}|${item.title}]]${link ? ` ([original](${link}))` : ""}`);
    }
    lines.push("");
  }
  if (fresh.length === 0) lines.push("Nothing new arrived in the last day.");
  const post = await createDraftInFolder(input.handle, notes.id, {
    initial: { type: "note", slug: slugify(`reading-brief-${day}`, "reading-brief"), title: `Reading brief, ${day}`, body: lines.join("\n").trim() },
    audit: {
      actorUserId: input.actor.userId,
      actorType: input.actor.actorType,
      actionName: "reading.save_brief",
      targetType: "item",
      inputSummary: `${fresh.length} articles`,
    },
  });
  if (!post.id) throw new Error("The brief could not be saved");
  return { id: post.id, slug: post.slug, folderPath: notes.path, items: fresh.length };
}
