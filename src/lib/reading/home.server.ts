import type { AccessUser } from "@/lib/permissions";
import { workspaceIdForHandle } from "@/lib/store";
import { listFeedConnections } from "./connections.server";
import { listReadingItems, type ReadingListItem } from "./list.server";
import { listSavedSearches } from "./saved-searches.server";
import { searchReadingItems } from "./search.server";
import { clusterReadingItems, type ReadingSummary } from "./summaries.server";
import { withSummaryTexts } from "./summary-text.server";

/**
 * The home page's news: what the person should know, as units they can
 * scan. A unit is a Summary (several sources on one story, with the cached
 * model line when the workspace has one) or a single article. This is the
 * read model behind For You and Latest; the ranking that makes For You
 * personal arrives in the second slice, and until then the mode is
 * labelled for what it is: newest first.
 *
 * Bounded like every reading read: at most CONSIDERED recent items are
 * grouped, and the page is a slice of that snapshot. Feed items never
 * enter the client pool.
 */

export const HOME_CONSIDERED = 300;
const PAGE = 20;
const MAX_TOPICS = 12;

export type HomeTopic = {
  id: string;
  label: string;
  /** "search" reuses a saved search exactly; "source" is one feed's folder. */
  kind: "search" | "source";
  detail: string | null;
};

export type HomeUnit =
  | {
      kind: "summary";
      id: string;
      headline: string;
      text: string | null;
      sources: string[];
      members: ReadingListItem[];
      representative: ReadingListItem;
      imageUrl: string | null;
      unread: number;
      latestAt: string;
    }
  | { kind: "article"; id: string; item: ReadingListItem; latestAt: string };

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
};

function timeOf(item: ReadingListItem): number {
  return new Date(item.publishedAt ?? item.receivedAt).getTime();
}

/** The article a Summary's headline opens: the newest unread member, else the newest. */
export function representativeOf(summary: Pick<ReadingSummary, "members">): ReadingListItem {
  return summary.members.find((member) => !member.read) ?? summary.members[0];
}

/** Summaries plus the articles they did not absorb, newest first. */
export function unitsFrom(items: ReadingListItem[], summaries: Array<ReadingSummary & { text?: string | null }>): HomeUnit[] {
  const grouped = new Set(summaries.flatMap((summary) => summary.members.map((member) => member.id)));
  const units: HomeUnit[] = summaries.map((summary) => ({
    kind: "summary",
    id: summary.id,
    headline: summary.headline,
    text: summary.text ?? null,
    sources: summary.sources,
    members: summary.members,
    representative: representativeOf(summary),
    imageUrl: summary.members.find((member) => member.imageUrl)?.imageUrl ?? null,
    unread: summary.unread,
    latestAt: summary.latestAt,
  }));
  for (const item of items) {
    if (grouped.has(item.id)) continue;
    units.push({ kind: "article", id: item.id, item, latestAt: new Date(timeOf(item)).toISOString() });
  }
  return units.sort((left, right) => new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime());
}

export function parseTopic(topic: string | null | undefined): { kind: "search"; id: string } | { kind: "source"; folderPath: string } | null {
  if (!topic) return null;
  if (topic.startsWith("search:")) return { kind: "search", id: topic.slice(7) };
  if (topic.startsWith("source:")) return { kind: "source", folderPath: topic.slice(7) };
  return null;
}

async function homeTopics(handle: string, user: AccessUser | null): Promise<HomeTopic[]> {
  const [searches, connections] = await Promise.all([listSavedSearches({ handle, user }), listFeedConnections(handle)]);
  const fromSearches: HomeTopic[] = searches
    .filter((search) => !search.folderPath)
    .map((search) => ({ id: `search:${search.id}`, label: search.name, kind: "search", detail: search.query }));
  const fromSources: HomeTopic[] = connections
    .filter((connection) => connection.state !== "detached")
    .map((connection) => ({ id: `source:${connection.folderPath}`, label: connection.publisherTitle ?? connection.folderName, kind: "source", detail: connection.folderPath }));
  return [...fromSearches, ...fromSources].slice(0, MAX_TOPICS);
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

export async function readingHome(input: {
  handle: string;
  user: AccessUser | null;
  mode?: "forYou" | "latest";
  topic?: string | null;
  offset?: number;
  limit?: number;
}): Promise<HomeNews> {
  const mode = input.mode === "latest" ? "latest" : "forYou";
  const limit = Math.max(1, Math.min(50, input.limit ?? PAGE));
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const topics = await homeTopics(input.handle, input.user);
  const topic = parseTopic(input.topic);
  const activeTopic = topic ? topics.find((entry) => entry.id === input.topic) ?? null : null;
  let items: ReadingListItem[];
  let topicNote: string | null = null;
  if (topic?.kind === "search" && activeTopic?.detail) {
    const found = await searchReadingItems({ handle: input.handle, user: input.user, query: activeTopic.detail, limit: 50 });
    items = found.items.filter((item) => item.origin === "feed").sort((left, right) => timeOf(right) - timeOf(left));
    topicNote = found.semantic ? null : "Matched by the search's exact words.";
  } else {
    items = await recentItems({ handle: input.handle, user: input.user, folderPath: topic?.kind === "source" ? topic.folderPath : "", considered: HOME_CONSIDERED });
  }
  let units: HomeUnit[];
  if (mode === "latest") {
    // The plain chronological list: every article on its own, unread first
    // within the day it arrived, which is the Reader habit.
    units = items.map((item) => ({ kind: "article" as const, id: item.id, item, latestAt: new Date(timeOf(item)).toISOString() }));
  } else {
    const blogId = await workspaceIdForHandle(input.handle);
    const summaries = await withSummaryTexts(blogId, clusterReadingItems(items), { write: false });
    units = unitsFrom(items, summaries);
  }
  const page = units.slice(offset, offset + limit);
  return {
    mode,
    modeLabel: mode === "latest" ? "Latest" : "Newest first",
    topic: activeTopic?.id ?? null,
    topics,
    units: page,
    nextOffset: offset + limit < units.length ? offset + limit : null,
    considered: items.length,
    topicNote,
  };
}
