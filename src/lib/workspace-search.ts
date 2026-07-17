import type { Folder } from "@/lib/content";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { localDateKey } from "@/lib/workspace-activity";

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

function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function titleScore(title: string, query: string): number | null {
  const lowered = title.toLocaleLowerCase();
  if (lowered === query) return 0;
  if (lowered.startsWith(query)) return 8;
  const wordIndex = lowered.search(new RegExp(`(?:^|\\s)${escapeRegExp(query)}`));
  if (wordIndex >= 0) return 14 + wordIndex;
  const index = lowered.indexOf(query);
  return index >= 0 ? 24 + index : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excerptAround(value: string, query: string): string {
  const clean = cleanText(value);
  if (!clean) return "";
  const index = clean.toLocaleLowerCase().indexOf(query);
  const start = Math.max(0, index - 42);
  const end = Math.min(clean.length, Math.max(index + query.length + 72, 130));
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
    return posts
      .filter(
        (post) => localDateKey(post.createdAt ?? post.date) === parsedDate,
      )
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
    const score = titleScore(folder.name, cleanQuery);
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
    const titleMatch = titleScore(title, cleanQuery);
    if (titleMatch !== null) {
      results.push({
        kind: "post",
        id: `post:${post.id}`,
        postId: post.id,
        title,
        detail: cleanText(post.excerpt) || post.type,
        score: titleMatch,
      });
      continue;
    }
    const excerpt = cleanText(post.excerpt);
    const preview = cleanText(post.bodyPreview);
    const body = cleanText(bodies[post.id]);
    const content = [excerpt, preview, body].filter(Boolean).join(" ");
    const contentIndex = content.toLocaleLowerCase().indexOf(cleanQuery);
    if (contentIndex < 0) continue;
    results.push({
      kind: "post",
      id: `post:${post.id}`,
      postId: post.id,
      title,
      detail: excerptAround(content, cleanQuery) || post.type,
      score: 100 + contentIndex,
    });
  }

  return results
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
