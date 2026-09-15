import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { folders, posts, readingEmbeddings, readingProvenance } from "@/lib/db/schema";
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
  const tokens = searchTokens(input.query);
  const blogId = await workspaceIdForHandle(input.handle);
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
  const inScope = and(eq(posts.blogId, blogId), isNull(posts.deletedAt), inArray(posts.folderId, folderIds), readingItem);

  const lexicalRows =
    tokens.length === 0
      ? []
      : await database
          .select({ id: posts.id, hits: sql<number>`(${sql.join(
            tokens.map(
              (token) =>
                sql`(case when ${posts.title} ilike ${`%${token}%`} then 3 when ${posts.excerpt} ilike ${`%${token}%`} then 2 when ${posts.body} ilike ${`%${token}%`} then 1 else 0 end)`,
            ),
            sql` + `,
          )})`.as("hits") })
          .from(posts)
          .where(and(inScope, or(...tokens.map((token) => or(ilike(posts.title, `%${token}%`), ilike(posts.excerpt, `%${token}%`), ilike(posts.body, `%${token}%`))))))
          .orderBy(desc(sql`hits`), desc(posts.updatedAt))
          .limit(LEXICAL_CANDIDATES);
  const lexicalIds = lexicalRows.map((row) => row.id);

  let semanticIds: string[] = [];
  let semanticRan = false;
  let unembedded = 0;
  const embedder = input.embedder === undefined ? await workspaceEmbedder(blogId) : input.embedder;
  if (embedder && input.query.trim()) {
    const [queryVector] = await embedder.embed([input.query.trim()]);
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
        .where(and(inScope, eq(readingEmbeddings.model, embedder.model)))
        .orderBy(desc(sql`similarity`))
        .limit(SEMANTIC_CANDIDATES);
      semanticIds = rows.filter((row) => Number(row.similarity) > 0.2).map((row) => row.id);
      const [{ total }] = await database
        .select({ total: sql<number>`count(*)::int` })
        .from(posts)
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
