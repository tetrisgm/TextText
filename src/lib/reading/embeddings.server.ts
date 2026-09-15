import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { blogs, posts, readingEmbeddings, users } from "@/lib/db/schema";
import { getWorkspaceAiConfigForOwner } from "@/lib/ai/workspace-ai-config.server";
import { sha256 } from "./feed-identity";
import { readingFlags } from "./flags";
import { enqueueReadingJob, type ReadingJobRow } from "./jobs.server";

/**
 * Embeddings for retained reading, computed off the request path by the
 * index_item job and stored as unit-length real[] rows.
 *
 * The provider is the workspace's own key when it is an OpenAI key (the
 * development override applies the same way it does for the assistant). A
 * workspace without one has no embeddings and search stays lexical; nothing
 * about search results depends on this module having run.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 512;
const MAX_INPUT_CHARS = 6000;

export type Embedder = {
  model: string;
  dims: number;
  embed(texts: string[]): Promise<number[][]>;
};

function requireDb() {
  if (!db) throw new Error("Reading embeddings need DATABASE_URL");
  return db;
}

export function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) return vector.map(() => 0);
  return vector.map((value) => value / length);
}

/** The text an item is indexed by: title, excerpt, then as much body as fits. */
export function embeddingText(item: { title: string; excerpt?: string | null; body: string }): string {
  const parts = [item.title.trim(), (item.excerpt ?? "").trim(), item.body.trim()].filter(Boolean);
  return parts.join("\n\n").slice(0, MAX_INPUT_CHARS);
}

export function openAiEmbedder(apiKey: string, baseUrl?: string | null): Embedder {
  const endpoint = `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/embeddings`;
  return {
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    async embed(texts) {
      if (texts.length === 0) return [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMS }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Embedding request failed (${response.status})`);
        const payload = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
        const rows = payload.data ?? [];
        if (rows.length !== texts.length) throw new Error("Embedding response was incomplete");
        return rows
          .slice()
          .sort((left, right) => left.index - right.index)
          .map((row) => normalize(row.embedding));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * The embedder a workspace can use, or null. Resolved through the same owner
 * identity path the assistant uses, so the key never travels anywhere new.
 */
export async function workspaceEmbedder(blogId: string): Promise<Embedder | null> {
  if (!readingFlags.semanticIndex) return null;
  const rows = await requireDb()
    .select({ sub: users.appleSub })
    .from(blogs)
    .innerJoin(users, eq(users.id, blogs.ownerId))
    .where(eq(blogs.id, blogId))
    .limit(1);
  const sub = rows[0]?.sub;
  if (!sub) return null;
  const config = await getWorkspaceAiConfigForOwner(sub);
  if (!config || config.provider !== "openai") return null;
  const isDevelopment = process.env.NODE_ENV !== "production";
  const apiKey = isDevelopment && process.env.TEXTTEXT_DEV_AI_KEY ? process.env.TEXTTEXT_DEV_AI_KEY : config.apiKey;
  const baseUrl = isDevelopment ? process.env.TEXTTEXT_AI_BASE_URL || null : null;
  if (!apiKey) return null;
  return openAiEmbedder(apiKey, baseUrl);
}

export async function enqueueIndexItem(blogId: string, postId: string): Promise<boolean> {
  if (!readingFlags.semanticIndex) return false;
  return enqueueReadingJob({ blogId, kind: "index_item", opKey: `index_item:${postId}`, payload: { postId } });
}

/**
 * Index one item. Idempotent on the text hash; a missing provider is a
 * no-op, not a failure, so the job never retries into a wall.
 */
export async function indexPost(postId: string, embedder?: Embedder | null): Promise<"indexed" | "unchanged" | "skipped"> {
  const database = requireDb();
  const rows = await database
    .select({ id: posts.id, blogId: posts.blogId, title: posts.title, excerpt: posts.excerpt, body: posts.body, deletedAt: posts.deletedAt })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  const post = rows[0];
  if (!post || post.deletedAt) return "skipped";
  const text = embeddingText(post);
  if (!text) return "skipped";
  const textHash = sha256(text);
  const existing = await database
    .select({ textHash: readingEmbeddings.textHash, model: readingEmbeddings.model })
    .from(readingEmbeddings)
    .where(eq(readingEmbeddings.postId, postId))
    .limit(1);
  const provider = embedder === undefined ? await workspaceEmbedder(post.blogId) : embedder;
  if (!provider) return "skipped";
  if (existing[0] && existing[0].textHash === textHash && existing[0].model === provider.model) return "unchanged";
  const [vector] = await provider.embed([text]);
  if (!vector || vector.length !== provider.dims) throw new Error("Embedding had the wrong shape");
  await database
    .insert(readingEmbeddings)
    .values({ postId, blogId: post.blogId, model: provider.model, dims: provider.dims, vector, textHash, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: readingEmbeddings.postId,
      set: { model: provider.model, dims: provider.dims, vector, textHash, updatedAt: new Date() },
    });
  return "indexed";
}

export async function runIndexItemJob(job: ReadingJobRow, embedder?: Embedder | null): Promise<void> {
  const postId = typeof job.payload.postId === "string" ? job.payload.postId : null;
  if (!postId) return;
  await indexPost(postId, embedder);
}

/** Which of these items have an embedding at all; lets search say what it could and could not see. */
export async function embeddedPostIds(blogId: string, postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const rows = await requireDb()
    .select({ postId: readingEmbeddings.postId })
    .from(readingEmbeddings)
    .where(and(eq(readingEmbeddings.blogId, blogId), inArray(readingEmbeddings.postId, postIds)));
  return new Set(rows.map((row) => row.postId));
}
