import type { AccessUser } from "@/lib/permissions";
import { listReadingItems, type ReadingListItem } from "./list.server";

/**
 * Summaries: the same news arriving from more than one source, grouped.
 *
 * Grouping is conservative on purpose. Two articles join a Summary only when
 * they share a canonical link, or when their titles share most of their
 * meaningful words and they arrived within three days of each other. Nothing
 * is generated here: a Summary is its member articles, the sources that
 * carried them, and the span of time they cover. Every member keeps its own
 * id and link, so an answer built on a Summary still cites articles.
 */

export type ReadingSummary = {
  id: string;
  headline: string;
  members: ReadingListItem[];
  sources: string[];
  firstAt: string;
  latestAt: string;
  unread: number;
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from", "is", "are", "was", "were",
  "its", "it", "as", "this", "that", "be", "has", "have", "how", "why", "what", "new", "now", "after", "over", "into",
]);
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const MIN_TOKENS = 3;
const MIN_JACCARD = 0.5;

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3 && !STOP.has(token)),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function canonicalKey(item: Pick<ReadingListItem, "permalink" | "externalUrl">): string | null {
  const target = item.permalink ?? item.externalUrl;
  if (!target) return null;
  try {
    const url = new URL(target);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) url.searchParams.delete(key);
    return `${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
  } catch {
    return null;
  }
}

function timeOf(item: ReadingListItem): number {
  return new Date(item.publishedAt ?? item.receivedAt).getTime();
}

/** Pure grouping over an already-bounded list, so the rule is testable without a database. */
export function clusterReadingItems(items: ReadingListItem[]): ReadingSummary[] {
  const groups: Array<{ members: ReadingListItem[]; tokens: Set<string>; keys: Set<string> }> = [];
  for (const item of items) {
    const tokens = titleTokens(item.title);
    const key = canonicalKey(item);
    let home = key ? groups.find((group) => group.keys.has(key)) : undefined;
    if (!home && tokens.size >= MIN_TOKENS) {
      home = groups.find((group) => {
        if (group.tokens.size < MIN_TOKENS) return false;
        const near = group.members.some((member) => Math.abs(timeOf(member) - timeOf(item)) <= WINDOW_MS);
        return near && jaccard(group.tokens, tokens) >= MIN_JACCARD;
      });
    }
    if (home) {
      home.members.push(item);
      if (key) home.keys.add(key);
      for (const token of tokens) home.tokens.add(token);
    } else {
      groups.push({ members: [item], tokens, keys: new Set(key ? [key] : []) });
    }
  }
  return groups
    .filter((group) => group.members.length >= 2)
    .map((group) => {
      const members = group.members.slice().sort((left, right) => timeOf(right) - timeOf(left));
      const headline = members.map((member) => member.title).sort((left, right) => left.length - right.length)[0] ?? "Summary";
      const times = members.map(timeOf);
      return {
        id: members.map((member) => member.id).sort().join("+").slice(0, 200),
        headline,
        members,
        sources: [...new Set(members.map((member) => member.publisherName ?? member.sourceFolderName))],
        firstAt: new Date(Math.min(...times)).toISOString(),
        latestAt: new Date(Math.max(...times)).toISOString(),
        unread: members.filter((member) => !member.read).length,
      };
    })
    .sort((left, right) => new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime());
}

const CONSIDERED = 300;

export async function readingSummaries(input: {
  handle: string;
  user: AccessUser | null;
  folderPath: string;
}): Promise<{ summaries: ReadingSummary[]; considered: number; singles: number }> {
  const items: ReadingListItem[] = [];
  let cursor: string | null = null;
  // Bounded: at most CONSIDERED recent items, in pages the list already serves.
  while (items.length < CONSIDERED) {
    const page = await listReadingItems({
      handle: input.handle,
      user: input.user,
      scope: { folderPath: input.folderPath, includeDescendants: true, state: "all", dateBasis: "published" },
      cursor,
      limit: 100,
    });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  const summaries = clusterReadingItems(items.slice(0, CONSIDERED));
  const grouped = new Set(summaries.flatMap((summary) => summary.members.map((member) => member.id)));
  return { summaries, considered: Math.min(items.length, CONSIDERED), singles: Math.min(items.length, CONSIDERED) - grouped.size };
}
