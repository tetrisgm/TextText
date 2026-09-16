import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { folders, posts, readingEmbeddings, readingProvenance, readingReadState, retentionHolds } from "@/lib/db/schema";
import { DURABLE_HOLD_REASONS } from "./holds";
import { listReadingItems, type ReadingListItem } from "./list.server";
import type { AccessUser } from "@/lib/permissions";
import { getAccessibleFolders, workspaceIdForHandle } from "@/lib/store";
import { subtreeFolderIds } from "./connections.server";
import { type Embedder, workspaceEmbedder } from "./embeddings.server";

/**
 * Hybrid retrieval over retained reading, with evidence attached.
 *
 * Lexical always runs: bounded ILIKE over title, excerpt and body of the
 * accessible items in scope, scored by how many query tokens hit. Semantic
 * runs when the workspace has an embedder and rows to compare, as a dot
 * product over unit vectors in SQL. The two lists are fused by reciprocal
 * rank so neither can drown the other, and every result says which side
 * found it. Results carry what an answer needs to cite: the item id, its
 * folder, the publisher and permalink, and a snippet from the stored text.
 */

export type ReadingSearchScope = {
  /** Limit to one folder and its descendants; omitted means every reading item the person can see. */
  folderPath?: string | null;
  /** Include manually saved bookmarks that sit in reading folders. Default true. */
  includeManual?: boolean;
};

export type ReadingSearchResult = {
  id: string;
  slug: string;
  title: string;
  folderPath: string | null;
  origin: "manual" | "feed";
  publisherName: string | null;
  permalink: string | null;
  publishedAt: string | null;
  snippet: string;
  match: "lexical" | "semantic" | "both";
  score: number;
};

export type ReadingSearchReport = {
  query: string;
  results: ReadingSearchResult[];
  /** True when the semantic side ran; false means lexical only, which callers should say. */
  semantic: boolean;
  /** Items in scope that had no embedding when semantic ran. */
  unembedded: number;
};

const LEXICAL_CANDIDATES = 200;
const SEMANTIC_CANDIDATES = 200;
const RRF_K = 60;

function requireDb() {
  if (!db) throw new Error("Reading search needs DATABASE_URL");
  return db;
}

export function searchTokens(query: string): string[] {
  return [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2))].slice(0, 8);
}

export type ParsedReadingQuery = {
  /** Free text with operators removed. */
  text: string;
  /** Quoted phrases, matched whole. */
  phrases: string[];
  feed: string | null;
  unread: boolean;
  starred: boolean;
  kept: boolean;
  /** Published strictly before this day. */
  before: Date | null;
  /** Published on or after this day. */
  after: Date | null;
};

/**
 * Reader-style operators: feed:name, is:unread, is:starred, is:kept,
 * before:YYYY-MM-DD, after:YYYY-MM-DD, and "quoted phrases". Anything else
 * is text. Unknown operators stay text so a colon in a title still matches.
 */
export function parseReadingQuery(query: string): ParsedReadingQuery {
  const parsed: ParsedReadingQuery = { text: "", phrases: [], feed: null, unread: false, starred: false, kept: false, before: null, after: null };
  const rest: string[] = [];
  // An operator may take a quoted value (feed:"Hacker News"); a bare quoted
  // run is a phrase; everything else splits on whitespace.
  const pattern = /([A-Za-z]+:"[^"]+")|"([^"]+)"|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    if (match[2]) {
      parsed.phrases.push(match[2].trim());
      continue;
    }
    const token = match[1] ?? match[3] ?? "";
    const lower = token.toLocaleLowerCase();
    const day = (value: string) => {
      const date = new Date(`${value}T00:00:00Z`);
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) ? date : null;
    };
    if (lower.startsWith("feed:") && token.length > 5) parsed.feed = token.slice(5).replace(/^"|"$/g, "");
    else if (lower === "is:unread") parsed.unread = true;
    else if (lower === "is:starred") parsed.starred = true;
    else if (lower === "is:kept") parsed.kept = true;
    else if (lower.startsWith("before:") && day(token.slice(7))) parsed.before = day(token.slice(7));
    else if (lower.startsWith("after:") && day(token.slice(6))) parsed.after = day(token.slice(6));
    else rest.push(token);
  }
  parsed.text = rest.join(" ").trim();
  return parsed;
}

export function snippetFor(text: string, tokens: string[], width = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLocaleLowerCase();
  let at = -1;
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) return flat.length > width ? `${flat.slice(0, width - 3)}...` : flat;
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return `${start > 0 ? "..." : ""}${flat.slice(start, end)}${end < flat.length ? "..." : ""}`;
}

/** Reciprocal rank fusion. Pure, so the ordering rule is testable on its own. */
export function fuseRanks(
  lexical: string[],
  semantic: string[],
): Array<{ id: string; score: number; match: ReadingSearchResult["match"] }> {
  const scores = new Map<string, { score: number; lexical: boolean; semantic: boolean }>();
  lexical.forEach((id, rank) => {
    const entry = scores.get(id) ?? { score: 0, lexical: false, semantic: false };
    entry.score += 1 / (RRF_K + rank + 1);
    entry.lexical = true;
    scores.set(id, entry);
  });
  semantic.forEach((id, rank) => {
    const entry = scores.get(id) ?? { score: 0, lexical: false, semantic: false };
    entry.score += 1 / (RRF_K + rank + 1);
    entry.semantic = true;
    scores.set(id, entry);
  });
  return [...scores.entries()]
    .map(([id, entry]) => ({
      id,
      score: entry.score,
      match: entry.lexical && entry.semantic ? ("both" as const) : entry.lexical ? ("lexical" as const) : ("semantic" as const),
    }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export async function searchReading(input: {
  handle: string;
  user: AccessUser | null;
  query: string;
  scope?: ReadingSearchScope;
  limit?: number;
  embedder?: Embedder | null;
}): Promise<ReadingSearchReport> {
  const database = requireDb();
  const limit = Math.max(1, Math.min(50, input.limit ?? 20));
  const parsed = parseReadingQuery(input.query);
  const tokens = [...searchTokens(parsed.text), ...parsed.phrases.map((phrase) => phrase.toLocaleLowerCase())].slice(0, 10);
  const blogId = await workspaceIdForHandle(input.handle);
  const userId = input.user?.userId ?? null;
  const accessible = await getAccessibleFolders(input.handle, input.user);
  const accessibleIds = new Set(accessible.map((folder) => folder.id));
  const pathById = new Map(accessible.map((folder) => [folder.id, folder.path]));
  let folderIds: string[] | null = null;
  if (input.scope?.folderPath) {
    const subtree = await subtreeFolderIds(blogId, input.scope.folderPath);
    folderIds = subtree.filter((id) => accessibleIds.has(id));
    if (folderIds.length === 0) return { query: input.query, results: [], semantic: false, unembedded: 0 };
  } else {
    folderIds = [...accessibleIds];
    if (folderIds.length === 0) return { query: input.query, results: [], semantic: false, unembedded: 0 };
  }

  const includeManual = input.scope?.includeManual ?? true;
  // Saved bookmarks sit beside imported ones in reading folders and the
  // tool promises them, so a bookmark counts whether a person or a feed
  // saved it.
  const readingItem = includeManual ? or(eq(posts.origin, "feed"), eq(posts.type, "bookmark")) : eq(posts.origin, "feed");
  const publishedExpr = sql`coalesce(${readingProvenance.publishedAt}, ${posts.createdAt})`;
  const operators = [
    parsed.feed ? or(ilike(folders.name, `%${parsed.feed}%`), ilike(readingProvenance.publisherName, `%${parsed.feed}%`)) : undefined,
    parsed.unread
      ? userId
        ? sql`not exists (select 1 from ${readingReadState} r where r.post_id = ${posts.id} and r.user_id = ${userId} and r.read_at is not null)`
        : sql`false`
      : undefined,
    parsed.starred ? eq(posts.starred, true) : undefined,
    parsed.kept
      ? or(
          eq(posts.starred, true),
          sql`exists (select 1 from ${retentionHolds} h where h.post_id = ${posts.id} and h.released_at is null and h.reason in (${sql.join(
            DURABLE_HOLD_REASONS.map((reason) => sql`${reason}`),
            sql`, `,
          )}))`,
        )
      : undefined,
    parsed.before ? lt(publishedExpr, parsed.before) : undefined,
    parsed.after ? gte(publishedExpr, parsed.after) : undefined,
  ];
  const inScope = and(
    eq(posts.blogId, blogId),
    isNull(posts.deletedAt),
    inArray(posts.folderId, folderIds),
    isNull(readingProvenance.duplicateOfPostId),
    readingItem,
    ...operators,
  );
  const hasOperators = operators.some(Boolean);

  const lexicalRows =
    tokens.length === 0
      ? hasOperators
        ? await database
            .select({ id: posts.id, hits: sql<number>`1`.as("hits") })
            .from(posts)
            .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
            .leftJoin(folders, eq(folders.id, posts.folderId))
            .where(inScope)
            .orderBy(desc(publishedExpr))
            .limit(LEXICAL_CANDIDATES)
        : []
      : await database
          .select({ id: posts.id, hits: sql<number>`(${sql.join(
            tokens.map(
              (token) =>
                sql`(case when ${posts.title} ilike ${`%${token}%`} then 3 when ${posts.excerpt} ilike ${`%${token}%`} then 2 when ${posts.body} ilike ${`%${token}%`} then 1 else 0 end)`,
            ),
            sql` + `,
          )})`.as("hits") })
          .from(posts)
          .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
          .leftJoin(folders, eq(folders.id, posts.folderId))
          .where(and(inScope, or(...tokens.map((token) => or(ilike(posts.title, `%${token}%`), ilike(posts.excerpt, `%${token}%`), ilike(posts.body, `%${token}%`))))))
          .orderBy(desc(sql`hits`), desc(posts.updatedAt))
          .limit(LEXICAL_CANDIDATES);
  const lexicalIds = lexicalRows.map((row) => row.id);

  let semanticIds: string[] = [];
  let semanticRan = false;
  let unembedded = 0;
  const embedder = input.embedder === undefined ? await workspaceEmbedder(blogId) : input.embedder;
  if (embedder && parsed.text.trim()) {
    const [queryVector] = await embedder.embed([parsed.text.trim()]);
    if (queryVector) {
      semanticRan = true;
      const vectorLiteral = sql`ARRAY[${sql.join(queryVector.map((value) => sql`${value}::real`), sql`, `)}]::real[]`;
      const rows = await database
        .select({
          id: readingEmbeddings.postId,
          similarity: sql<number>`(select coalesce(sum(a * b), 0) from unnest(${readingEmbeddings.vector}, ${vectorLiteral}) as pair(a, b))`.as("similarity"),
        })
        .from(readingEmbeddings)
        .innerJoin(posts, eq(posts.id, readingEmbeddings.postId))
        .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
        .leftJoin(folders, eq(folders.id, posts.folderId))
        .where(and(inScope, eq(readingEmbeddings.model, embedder.model)))
        .orderBy(desc(sql`similarity`))
        .limit(SEMANTIC_CANDIDATES);
      semanticIds = rows.filter((row) => Number(row.similarity) > 0.2).map((row) => row.id);
      const [{ total }] = await database
        .select({ total: sql<number>`count(*)::int` })
        .from(posts)
        .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
        .leftJoin(folders, eq(folders.id, posts.folderId))
        .where(and(inScope, sql`not exists (select 1 from ${readingEmbeddings} where ${readingEmbeddings.postId} = ${posts.id})`));
      unembedded = Number(total);
    }
  }

  const fused = fuseRanks(lexicalIds, semanticIds).slice(0, limit);
  if (fused.length === 0) return { query: input.query, results: [], semantic: semanticRan, unembedded };
  const ids = fused.map((entry) => entry.id);
  const rows = await database
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      excerpt: posts.excerpt,
      body: posts.body,
      folderId: posts.folderId,
      origin: posts.origin,
      publisherName: readingProvenance.publisherName,
      permalink: readingProvenance.permalink,
      publishedAt: readingProvenance.publishedAt,
      folderPath: folders.path,
    })
    .from(posts)
    .leftJoin(readingProvenance, eq(readingProvenance.postId, posts.id))
    .leftJoin(folders, eq(folders.id, posts.folderId))
    .where(inArray(posts.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results: ReadingSearchResult[] = [];
  for (const entry of fused) {
    const row = byId.get(entry.id);
    if (!row) continue;
    results.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      folderPath: row.folderPath ?? (row.folderId ? (pathById.get(row.folderId) ?? null) : null),
      origin: row.origin === "feed" ? "feed" : "manual",
      publisherName: row.publisherName ?? null,
      permalink: row.permalink ?? null,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      snippet: snippetFor([row.excerpt ?? "", row.body].filter(Boolean).join(" "), tokens),
      match: entry.match,
      score: Number(entry.score.toFixed(6)),
    });
  }
  return { query: input.query, results, semantic: semanticRan, unembedded };
}

/**
 * Search results in the reading list's own row shape, in rank order, so a
 * folder can show a search the way it shows its list. One bounded search,
 * one id-filtered page.
 */
export async function searchReadingItems(input: {
  handle: string;
  user: AccessUser | null;
  query: string;
  folderPath?: string | null;
  limit?: number;
}): Promise<{ items: ReadingListItem[]; semantic: boolean; total: number }> {
  const report = await searchReading({ handle: input.handle, user: input.user, query: input.query, scope: { folderPath: input.folderPath ?? null }, limit: input.limit ?? 50 });
  if (report.results.length === 0) return { items: [], semantic: report.semantic, total: 0 };
  const rank = new Map(report.results.map((result, index) => [result.id, index]));
  const page = await listReadingItems({
    handle: input.handle,
    user: input.user,
    scope: { folderPath: input.folderPath ?? "", includeDescendants: true, state: "all", dateBasis: "published", ids: [...rank.keys()] },
    limit: Math.min(100, rank.size),
  });
  const items = page.items.slice().sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0));
  return { items, semantic: report.semantic, total: items.length };
}
