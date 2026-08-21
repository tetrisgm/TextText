import type { Folder } from "@/lib/content";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { documentsForActivityDate } from "@/lib/workspace-activity";

export type WorkspaceSearchResult =
  | {
      kind: "folder";
      id: string;
      title: string;
      detail: string;
      folderPath: string;
      score: number;
    }
  | {
      kind: "post";
      id: string;
      title: string;
      detail: string;
      postId: string;
      score: number;
    };

const MONTHS = new Map<string, number>(
  [
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ] as const,
);

function dateKey(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day, 12);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseWorkspaceDateQuery(
  query: string,
  now = new Date(),
): string | null {
  const clean = query.trim().toLowerCase();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean);
  if (iso) return dateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const named = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(clean);
  if (!named) return null;
  const month = MONTHS.get(named[1]);
  if (!month) return null;
  return dateKey(
    named[3] ? Number(named[3]) : now.getFullYear(),
    month,
    Number(named[2]),
  );
}

export function workspaceRootBodyMode(
  query: string,
  now = new Date(),
): "date" | "home" | "search" {
  if (!query.trim()) return "home";
  return parseWorkspaceDateQuery(query, now) ? "date" : "search";
}

export function workspaceSearchHandoffIndex(
  itemCount: number,
  direction: "down" | "up",
): number | null {
  if (itemCount <= 0) return null;
  return direction === "down" ? 0 : itemCount - 1;
}

function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The canonical search normalization used by Library and the workspace
 * command surface. Punctuation, repeated whitespace, case, and accents must
 * not make an item disappear just because a person remembered different
 * typography.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function queryTokens(query: string): string[] {
  return [...new Set(normalizeSearchText(query).split(" ").filter(Boolean))];
}

function tokenScore(value: string, tokens: readonly string[]): number | null {
  let score = 0;
  for (const token of tokens) {
    const index = value.indexOf(token);
    if (index < 0) return null;
    score += index;
  }
  return score;
}

/**
 * Rank a remembered phrase even when its meaningful words are separated or
 * reordered in the document. Every query token is required, while exact
 * title and phrase matches remain strongest.
 */
export function rankSearchText(
  title: string,
  content: string,
  query: string,
): number | null {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = queryTokens(query);
  if (!normalizedQuery || tokens.length === 0) return null;

  const normalizedTitle = normalizeSearchText(title);
  const normalizedContent = normalizeSearchText(content);
  const combined = [normalizedTitle, normalizedContent]
    .filter(Boolean)
    .join(" ");

  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 8;
  const titlePhraseIndex = normalizedTitle.indexOf(normalizedQuery);
  if (titlePhraseIndex >= 0) return 16 + titlePhraseIndex;

  const titleTokens = tokenScore(normalizedTitle, tokens);
  if (titleTokens !== null) return 32 + titleTokens;

  const contentPhraseIndex = normalizedContent.indexOf(normalizedQuery);
  if (contentPhraseIndex >= 0) return 100 + contentPhraseIndex;

  const combinedTokens = tokenScore(combined, tokens);
  return combinedTokens === null ? null : 200 + combinedTokens;
}

export function searchExcerpt(value: string, query: string): string {
  const clean = cleanText(value);
  if (!clean) return "";
  const tokens = queryTokens(query);
  const lowered = normalizeSearchText(clean);
  const indices = tokens
    .map((token) => lowered.indexOf(token))
    .filter((index) => index >= 0);
  const index = indices.length > 0 ? Math.min(...indices) : 0;
  const start = Math.max(0, index - 42);
  const end = Math.min(
    clean.length,
    Math.max(index + normalizeSearchText(query).length + 72, 130),
  );
  return `${start > 0 ? "..." : ""}${clean.slice(start, end)}${end < clean.length ? "..." : ""}`;
}

function updatedTimestamp(post: WorkspacePoolPost): number {
  const value = Date.parse(post.updatedAt ?? post.createdAt ?? post.date ?? "");
  return Number.isFinite(value) ? value : 0;
}

export function searchWorkspace({
  bodies = {},
  folders,
  limit = 12,
  now = new Date(),
  posts,
  query,
}: {
  bodies?: Readonly<Record<string, string>>;
  folders: readonly Folder[];
  limit?: number;
  now?: Date;
  posts: readonly WorkspacePoolPost[];
  query: string;
}): WorkspaceSearchResult[] {
  const cleanQuery = query.trim().toLocaleLowerCase();
  if (!cleanQuery) return [];
  const parsedDate = parseWorkspaceDateQuery(cleanQuery, now);
  if (parsedDate) {
    const activity = documentsForActivityDate([...posts], parsedDate);
    return [...activity.created, ...activity.edited]
      .sort((a, b) => updatedTimestamp(b) - updatedTimestamp(a))
      .slice(0, limit)
      .map((post, index) => ({
        kind: "post" as const,
        id: `post:${post.id}`,
        postId: post.id,
        title: cleanText(post.title) || "Untitled",
        detail: cleanText(post.excerpt) || post.type,
        score: index,
      }));
  }

  const results: WorkspaceSearchResult[] = [];
  for (const folder of folders) {
    const score = rankSearchText(folder.name, folder.path, cleanQuery);
    if (score === null) continue;
    results.push({
      kind: "folder",
      id: `folder:${folder.id}`,
      folderPath: folder.path,
      title: folder.name,
      detail: folder.path,
      score,
    });
  }

  for (const post of posts) {
    const title = cleanText(post.title) || "Untitled";
    const excerpt = cleanText(post.excerpt);
    const preview = cleanText(post.bodyPreview);
    const body = cleanText(bodies[post.id]);
    const content = [excerpt, preview, body].filter(Boolean).join(" ");
    const score = rankSearchText(title, content, cleanQuery);
    if (score === null) continue;
    results.push({
      kind: "post",
      id: `post:${post.id}`,
      postId: post.id,
      title,
      detail: searchExcerpt(content, cleanQuery) || post.type,
      score,
    });
  }

  return results
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
