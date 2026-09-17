import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, readingEmbeddings, readingSummaries, readingTopics, retentionHolds } from "@/lib/db/schema";
import type { AccessUser } from "@/lib/permissions";
import { countHiddenSummaries, listReadingPreferences, listSummaryState, workspaceIdForHandle } from "@/lib/store";
import { listFeedConnections } from "./connections.server";
import { listReadingItems, type ReadingListItem } from "./list.server";
import { cosine, meanVector, rankCandidates, snapshotId, type RankCandidate, type RankPreferences, type RankTerm } from "./rank";
import { listSavedSearches } from "./saved-searches.server";
import { searchReadingItems } from "./search.server";
import { clusterReadingItems, type ReadingSummary } from "./summaries.server";
import { withSummaryTexts } from "./summary-text.server";

/**
 * The home page's news: what the person should know, as units they can
 * scan. A unit is a Summary (several sources on one story, with the cached
 * model line when the workspace has one) or a single article.
 *
 * For You reads the materialized Summaries (kept current by the tick's
 * job), applies the person's seen and hidden state and their explicit
 * preferences, and orders with the small ranker in rank.ts. Latest is the
 * plain chronological list. Both are bounded: at most CONSIDERED recent
 * items feed a page, and a page is a slice of a named snapshot. Feed items
 * never enter the client pool.
 */

export const HOME_CONSIDERED = 300;
const PAGE = 20;
const MAX_TOPICS = 12;
const CANDIDATE_DAYS = 7;
const AFFINITY_SAMPLE = 40;

function requireDb() {
  if (!db) throw new Error("Home needs DATABASE_URL");
  return db;
}

export type HomeTopic = {
  id: string;
  label: string;
  /** "search" reuses a saved search exactly; "source" is one feed's folder; "derived" comes from the embedded corpus. */
  kind: "search" | "source" | "derived";
  detail: string | null;
};

export type HomeUnit =
  | {
      kind: "summary";
      id: string;
      /** The materialized row's id, when there is one; hide and seen act on it. */
      summaryId: string | null;
      headline: string;
      text: string | null;
      /** The line was written against earlier coverage than what is shown. */
      textStale: boolean;
      sources: string[];
      sourcePaths: string[];
      members: ReadingListItem[];
      representative: ReadingListItem;
      imageUrl: string | null;
      unread: number;
      latestAt: string;
      coverageRevision: number;
      seenRevision: number;
      topicIds: string[];
      reasons: RankTerm[];
    }
  | { kind: "article"; id: string; item: ReadingListItem; latestAt: string; topicIds: string[]; reasons: RankTerm[] };

export type HomeNews = {
  mode: "forYou" | "latest";
  /** What the mode really is right now, said plainly. */
  modeLabel: string;
  topic: string | null;
  topics: HomeTopic[];
  units: HomeUnit[];
  nextOffset: number | null;
  considered: number;
  /** "exact terms" when a topic is a saved search matched by words only. */
  topicNote: string | null;
  snapshot: string | null;
  hiddenCount: number;
  /** Rules in force, so the page can say why it looks the way it does. */
  preferences: number;
};

function timeOf(item: ReadingListItem): number {
  return new Date(item.publishedAt ?? item.receivedAt).getTime();
}

/** The article a Summary's headline opens: the newest unread member, else the newest. */
export function representativeOf(summary: Pick<ReadingSummary, "members">): ReadingListItem {
  return summary.members.find((member) => !member.read) ?? summary.members[0];
}

type SummaryLike = ReadingSummary & { text?: string | null; summaryId?: string | null; textStale?: boolean; coverageRevision?: number; seenRevision?: number; topicIds?: string[]; reasons?: RankTerm[] };

/** Summaries plus the articles they did not absorb, newest first unless already ordered. */
export function unitsFrom(items: ReadingListItem[], summaries: SummaryLike[], options: { ordered?: boolean; topicOf?: (item: ReadingListItem) => string[] } = {}): HomeUnit[] {
  const grouped = new Set(summaries.flatMap((summary) => summary.members.map((member) => member.id)));
  const units: HomeUnit[] = summaries.map((summary) => ({
    kind: "summary",
    id: summary.id,
    summaryId: summary.summaryId ?? null,
    headline: summary.headline,
    text: summary.text ?? null,
    textStale: summary.textStale ?? false,
    sources: summary.sources,
    sourcePaths: [...new Set(summary.members.map((member) => member.folderPath))],
    members: summary.members,
    representative: representativeOf(summary),
    imageUrl: summary.members.find((member) => member.imageUrl)?.imageUrl ?? null,
    unread: summary.unread,
    latestAt: summary.latestAt,
    coverageRevision: summary.coverageRevision ?? 1,
    seenRevision: summary.seenRevision ?? 0,
    topicIds: summary.topicIds ?? [],
    reasons: summary.reasons ?? [],
  }));
  for (const item of items) {
    if (grouped.has(item.id)) continue;
    units.push({ kind: "article", id: item.id, item, latestAt: new Date(timeOf(item)).toISOString(), topicIds: options.topicOf?.(item) ?? [], reasons: [] });
  }
  return options.ordered ? units : units.sort((left, right) => new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime());
}

export function parseTopic(topic: string | null | undefined): { kind: "search"; id: string } | { kind: "source"; folderPath: string } | { kind: "derived"; id: string } | null {
  if (!topic) return null;
  if (topic.startsWith("search:")) return { kind: "search", id: topic.slice(7) };
  if (topic.startsWith("source:")) return { kind: "source", folderPath: topic.slice(7) };
  if (topic.startsWith("derived:")) return { kind: "derived", id: topic.slice(8) };
  return null;
}

type TopicRow = typeof readingTopics.$inferSelect;

function topicIdOf(row: TopicRow): string {
  if (row.kind === "search" && row.ref) return `search:${row.ref}`;
  if (row.kind === "source" && row.ref) return `source:${row.ref}`;
  return `derived:${row.id}`;
}

async function homeTopics(handle: string, user: AccessUser | null, blogId: string): Promise<{ topics: HomeTopic[]; rows: TopicRow[] }> {
  const rows = await requireDb().select().from(readingTopics).where(eq(readingTopics.blogId, blogId)).orderBy(readingTopics.position);
  if (rows.length > 0) {
    const queries = new Map((await listSavedSearches({ handle, user })).map((search) => [search.id, search.query]));
    const topics: HomeTopic[] = [];
    for (const row of rows) {
      if (row.kind === "search" && row.ref && !queries.has(row.ref)) continue; // the saved search is gone
      topics.push({ id: topicIdOf(row), label: row.label, kind: row.kind === "derived" ? "derived" : row.kind === "search" ? "search" : "source", detail: row.kind === "derived" ? `${row.memberCount} articles` : row.kind === "search" && row.ref ? (queries.get(row.ref) ?? null) : row.ref });
    }
    return { rows, topics: topics.slice(0, MAX_TOPICS) };
  }
  // Nothing materialized yet (a workspace that just added feeds): the live
  // list, so the strip is never empty for want of a tick.
  const [searches, connections] = await Promise.all([listSavedSearches({ handle, user }), listFeedConnections(handle)]);
  const topics: HomeTopic[] = [
    ...searches.filter((search) => !search.folderPath).map((search) => ({ id: `search:${search.id}`, label: search.name, kind: "search" as const, detail: search.query })),
    ...connections.filter((connection) => connection.state !== "detached").map((connection) => ({ id: `source:${connection.folderPath}`, label: connection.publisherTitle ?? connection.folderName, kind: "source" as const, detail: connection.folderPath })),
  ];
  return { rows: [], topics: topics.slice(0, MAX_TOPICS) };
}

async function recentItems(input: { handle: string; user: AccessUser | null; folderPath: string; considered: number }): Promise<ReadingListItem[]> {
  const items: ReadingListItem[] = [];
  let cursor: string | null = null;
  while (items.length < input.considered) {
    const page = await listReadingItems({
      handle: input.handle,
      user: input.user,
      scope: { folderPath: input.folderPath, includeDescendants: true, state: "all", dateBasis: "published" },
      cursor,
      limit: 100,
    });
    items.push(...page.items.filter((item) => item.origin === "feed"));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items.slice(0, input.considered);
}

/** The items of a derived topic, by nearest centroid; without vectors an item is not in any derived topic. */
async function filterByDerivedTopic(blogId: string, items: ReadingListItem[], row: TopicRow): Promise<ReadingListItem[]> {
  if (!row.centroid || items.length === 0) return [];
  const rows = await requireDb().select({ id: readingEmbeddings.postId, vector: readingEmbeddings.vector }).from(readingEmbeddings).where(and(eq(readingEmbeddings.blogId, blogId), inArray(readingEmbeddings.postId, items.map((item) => item.id))));
  const vectors = new Map(rows.map((entry) => [entry.id, entry.vector]));
  return items.filter((item) => {
    const vector = vectors.get(item.id);
    return vector ? cosine(vector, row.centroid!) >= 0.35 : false;
  });
}

/** The person's Keep and star centroid, from the embedded items they deliberately kept. */
async function affinityCentroid(blogId: string, userId: string | null): Promise<number[] | null> {
  if (!userId) return null;
  const rows = await requireDb()
    .select({ vector: readingEmbeddings.vector })
    .from(readingEmbeddings)
    .innerJoin(posts, eq(posts.id, readingEmbeddings.postId))
    .where(
      and(
        eq(readingEmbeddings.blogId, blogId),
        isNull(posts.deletedAt),
        or(eq(posts.starred, true), sql`exists (select 1 from ${retentionHolds} where ${retentionHolds.postId} = ${posts.id} and ${retentionHolds.releasedAt} is null and ${retentionHolds.reason} = 'keep')`),
      ),
    )
    .orderBy(sql`${posts.updatedAt} desc`)
    .limit(AFFINITY_SAMPLE);
  return meanVector(rows.map((row) => row.vector));
}

async function preferencesFor(userId: string | null, blogId: string): Promise<{ rank: RankPreferences; count: number }> {
  const empty = { topicMore: new Set<string>(), topicLess: new Set<string>(), sourceLess: new Set<string>() };
  if (!userId) return { rank: empty, count: 0 };
  const rules = await listReadingPreferences(userId, blogId);
  for (const rule of rules) {
    if (rule.kind === "topic_more") empty.topicMore.add(rule.target);
    else if (rule.kind === "topic_less") empty.topicLess.add(rule.target);
    else empty.sourceLess.add(rule.target);
  }
  return { rank: empty, count: rules.length };
}

/**
 * For You from the materialized rows: the candidate window is the last
 * seven days of Summaries plus the recent articles no Summary absorbed,
 * scored, varied, and named by a snapshot id.
 */
async function forYouUnits(input: { handle: string; user: AccessUser | null; blogId: string; items: ReadingListItem[]; topicRows: TopicRow[]; scopeTopic: string | null; now: Date }): Promise<{ units: HomeUnit[]; snapshot: string | null; hiddenCount: number; preferences: number }> {
  const database = requireDb();
  const since = new Date(input.now.getTime() - CANDIDATE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await database
    .select()
    .from(readingSummaries)
    .where(and(eq(readingSummaries.blogId, input.blogId), isNull(readingSummaries.retiredInto), gte(readingSummaries.latestAt, since)))
    .orderBy(sql`${readingSummaries.latestAt} desc`)
    .limit(400);
  const userId = input.user?.userId ?? null;
  const [state, preferences, centroid, hiddenCount] = await Promise.all([
    userId ? listSummaryState(userId, rows.map((row) => row.id)) : new Map<string, { seenRevision: number; hidden: boolean }>(),
    preferencesFor(userId, input.blogId),
    affinityCentroid(input.blogId, userId),
    userId ? countHiddenSummaries(userId, input.blogId) : 0,
  ]);
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const topicById = new Map(input.topicRows.map((row) => [row.id, row]));
  const idsByTopicRow = (ids: string[]) => ids.map((id) => topicById.get(id)).filter((row): row is TopicRow => Boolean(row)).map(topicIdOf);
  // Vectors for affinity, one query, bounded to what is on the page's window.
  const memberIds = rows.flatMap((row) => row.memberIds).filter((id) => itemById.has(id));
  const vectors = centroid && memberIds.length ? new Map((await database.select({ id: readingEmbeddings.postId, vector: readingEmbeddings.vector }).from(readingEmbeddings).where(and(eq(readingEmbeddings.blogId, input.blogId), inArray(readingEmbeddings.postId, memberIds.slice(0, 600))))).map((row) => [row.id, row.vector])) : new Map<string, number[]>();
  const affinityOf = (ids: string[]): number | null => {
    if (!centroid) return null;
    const unitCentroid = meanVector(ids.map((id) => vectors.get(id)).filter((vector): vector is number[] => Boolean(vector)));
    return unitCentroid ? cosine(unitCentroid, centroid) : null;
  };
  type Candidate = RankCandidate & { summary: SummaryLike | null; item: ReadingListItem | null };
  const candidates: Candidate[] = [];
  const grouped = new Set<string>();
  for (const row of rows) {
    const personal = state.get(row.id);
    if (personal?.hidden) {
      for (const id of row.memberIds) grouped.add(id);
      continue;
    }
    const members = row.memberIds.map((id) => itemById.get(id)).filter((item): item is ReadingListItem => Boolean(item));
    if (members.length < 2) continue;
    for (const member of members) grouped.add(member.id);
    const topicIds = idsByTopicRow(row.topicIds);
    if (input.scopeTopic && !topicIds.includes(input.scopeTopic)) continue;
    const sorted = members.slice().sort((left, right) => timeOf(right) - timeOf(left));
    // A person who can see only some of the members (folder-scoped access,
    // or a source topic narrowing the list) gets a Summary of what they can
    // see: the sources they can see, no line written over the rest.
    const complete = members.length === row.memberIds.length;
    const sources = [...new Set(sorted.map((member) => member.publisherName ?? member.sourceFolderName))];
    candidates.push({
      id: row.id,
      latestAt: sorted[0] ? new Date(timeOf(sorted[0])).toISOString() : row.latestAt.toISOString(),
      sources,
      sourcePaths: [...new Set(members.map((member) => member.folderPath))],
      topicIds,
      coverageRevision: row.coverageRevision,
      seenRevision: personal?.seenRevision ?? 0,
      affinity: affinityOf(row.memberIds),
      item: null,
      summary: {
        id: row.id,
        summaryId: row.id,
        headline: complete ? row.headline : sorted.map((member) => member.title).sort((left, right) => left.length - right.length)[0],
        members: sorted,
        sources,
        firstAt: row.firstAt.toISOString(),
        latestAt: sorted[0] ? new Date(timeOf(sorted[0])).toISOString() : row.latestAt.toISOString(),
        unread: sorted.filter((member) => !member.read).length,
        text: complete ? row.text : null,
        textStale: complete && Boolean(row.text && row.textEvidenceHash !== row.evidenceHash),
        coverageRevision: row.coverageRevision,
        seenRevision: personal?.seenRevision ?? 0,
        topicIds,
      },
    });
  }
  const topicOfItem = (item: ReadingListItem): string[] => {
    const ids: string[] = [];
    for (const row of input.topicRows) {
      if (row.kind === "source" && row.ref === item.folderPath) ids.push(topicIdOf(row));
      if (row.kind === "derived" && row.centroid) {
        const vector = vectors.get(item.id);
        if (vector && cosine(vector, row.centroid) >= 0.35) ids.push(topicIdOf(row));
      }
    }
    return ids;
  };
  for (const item of input.items) {
    if (grouped.has(item.id) || timeOf(item) < since.getTime()) continue;
    const topicIds = topicOfItem(item);
    if (input.scopeTopic && !topicIds.includes(input.scopeTopic)) continue;
    candidates.push({
      id: item.id,
      latestAt: new Date(timeOf(item)).toISOString(),
      sources: [item.publisherName ?? item.sourceFolderName],
      sourcePaths: [item.folderPath],
      topicIds,
      coverageRevision: 1,
      seenRevision: item.read ? 1 : 0,
      affinity: affinityOf([item.id]),
      item,
      summary: null,
    });
  }
  const ranked = rankCandidates(candidates, preferences.rank, input.now.getTime());
  const units: HomeUnit[] = ranked.map((entry) =>
    entry.candidate.summary
      ? unitsFrom([], [{ ...entry.candidate.summary, reasons: entry.terms }], { ordered: true })[0]
      : { kind: "article", id: entry.candidate.id, item: entry.candidate.item!, latestAt: entry.candidate.latestAt, topicIds: entry.candidate.topicIds, reasons: entry.terms },
  );
  return { units, snapshot: snapshotId(units.map((unit) => unit.id)), hiddenCount, preferences: preferences.count };
}

export async function readingHome(input: {
  handle: string;
  user: AccessUser | null;
  mode?: "forYou" | "latest";
  topic?: string | null;
  offset?: number;
  limit?: number;
  now?: Date;
}): Promise<HomeNews> {
  const mode = input.mode === "latest" ? "latest" : "forYou";
  const limit = Math.max(1, Math.min(50, input.limit ?? PAGE));
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const now = input.now ?? new Date();
  const blogId = await workspaceIdForHandle(input.handle);
  const { topics, rows: topicRows } = await homeTopics(input.handle, input.user, blogId);
  const topic = parseTopic(input.topic);
  const activeTopic = topic ? topics.find((entry) => entry.id === input.topic) ?? null : null;
  let items: ReadingListItem[];
  let topicNote: string | null = null;
  if (topic?.kind === "search" && activeTopic?.detail) {
    const query = topicRows.length ? (await listSavedSearches({ handle: input.handle, user: input.user })).find((search) => search.id === topic.id)?.query ?? activeTopic.detail : activeTopic.detail;
    const found = await searchReadingItems({ handle: input.handle, user: input.user, query, limit: 50 });
    items = found.items.filter((item) => item.origin === "feed").sort((left, right) => timeOf(right) - timeOf(left));
    topicNote = found.semantic ? null : "Matched by the search's exact words.";
  } else {
    items = await recentItems({ handle: input.handle, user: input.user, folderPath: topic?.kind === "source" ? topic.folderPath : "", considered: HOME_CONSIDERED });
  }
  if (activeTopic?.kind === "derived") {
    const row = topicRows.find((entry) => topicIdOf(entry) === activeTopic.id);
    items = row ? await filterByDerivedTopic(blogId, items, row) : [];
  }
  let units: HomeUnit[];
  let snapshot: string | null = null;
  let hiddenCount = 0;
  let preferences = 0;
  let modeLabel = "Latest";
  if (mode === "latest") {
    units = items.map((item) => ({ kind: "article" as const, id: item.id, item, latestAt: new Date(timeOf(item)).toISOString(), topicIds: [], reasons: [] }));
  } else if (topicRows.length > 0 || (await requireDb().select({ id: readingSummaries.id }).from(readingSummaries).where(eq(readingSummaries.blogId, blogId)).limit(1)).length > 0) {
    const ranked = await forYouUnits({ handle: input.handle, user: input.user, blogId, items, topicRows, scopeTopic: activeTopic && activeTopic.kind === "derived" ? activeTopic.id : null, now });
    units = ranked.units;
    snapshot = ranked.snapshot;
    hiddenCount = ranked.hiddenCount;
    preferences = ranked.preferences;
    modeLabel = preferences > 0 || hiddenCount > 0 ? "Ranked with your preferences" : "Ranked by freshness and coverage";
  } else {
    // Nothing materialized yet: group on read, newest first, and say so.
    const summaries = await withSummaryTexts(blogId, clusterReadingItems(items), { write: false });
    units = unitsFrom(items, summaries);
    modeLabel = "Newest first";
  }
  const page = units.slice(offset, offset + limit);
  return {
    mode,
    modeLabel,
    topic: activeTopic?.id ?? null,
    topics,
    units: page,
    nextOffset: offset + limit < units.length ? offset + limit : null,
    considered: items.length,
    topicNote,
    snapshot,
    hiddenCount,
    preferences,
  };
}
