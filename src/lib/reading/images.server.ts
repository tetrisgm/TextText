import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, readingProvenance } from "@/lib/db/schema";
import { fetchPublicResource } from "@/lib/bookmark-fetch";
import { enqueueReadingJob, type ReadingJobRow } from "./jobs.server";
import { pageMetaFromHtml } from "./page-image";

/**
 * Giving items a picture.
 *
 * A news surface without photographs is a wall of type, and the feeds we
 * follow mostly send none: an aggregator's entry is a title and a link. The
 * page behind that link almost always declares a social card image, so one
 * small request per item buys the whole look.
 *
 * Bounded on purpose, because this is the app's own tick and not a crawler:
 * a handful of items per pass, newest first, a short timeout, a byte cap well
 * below a full page, and a permanent mark so a page that has no picture is
 * asked once and never again. Failure is silent by design; an item with no
 * picture is a layout this design already handles.
 */

/** Items looked at per pass. */
const BATCH = 6;
/** Enough of a page to hold its head. */
const MAX_BYTES = 160_000;
const TIMEOUT_MS = 6000;

function requireDb() {
  if (!db) throw new Error("Reading images need DATABASE_URL");
  return db;
}

export type PageFetcher = (url: string) => Promise<{ html: string; url: string } | null>;

const defaultFetcher: PageFetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchPublicResource(url, {
      signal: controller.signal,
      headers: { accept: "text/html,*/*;q=0.5", "user-agent": "texttext-reading/1" },
    });
    if (!response || !response.ok) return null;
    if (!(response.headers.get("content-type") ?? "").includes("html")) return null;
    const body = await response.text();
    return { html: body.slice(0, MAX_BYTES), url: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** The items still worth asking about: no picture, never asked, and linked. */
async function pendingItems(blogId: string, limit: number) {
  return requireDb()
    .select({
      postId: readingProvenance.postId,
      url: sql<string>`coalesce(${readingProvenance.externalUrl}, ${readingProvenance.permalink})`,
      publisherName: readingProvenance.publisherName,
    })
    .from(readingProvenance)
    .innerJoin(posts, eq(posts.id, readingProvenance.postId))
    .where(
      and(
        eq(readingProvenance.blogId, blogId),
        isNull(readingProvenance.imageUrl),
        isNull(readingProvenance.imageCheckedAt),
        isNull(posts.deletedAt),
        sql`coalesce(${readingProvenance.externalUrl}, ${readingProvenance.permalink}) is not null`,
      ),
    )
    .orderBy(desc(readingProvenance.publishedAt), asc(readingProvenance.postId))
    .limit(limit);
}

export async function enrichPendingImages(
  blogId: string,
  options: { fetcher?: PageFetcher; limit?: number } = {},
): Promise<{ looked: number; found: number; remaining: boolean }> {
  const database = requireDb();
  const limit = Math.max(1, Math.min(BATCH, options.limit ?? BATCH));
  const rows = await pendingItems(blogId, limit + 1);
  const batch = rows.slice(0, limit);
  let found = 0;
  for (const row of batch) {
    const fetched = await (options.fetcher ?? defaultFetcher)(row.url);
    const meta = fetched ? pageMetaFromHtml(fetched.html, fetched.url) : { image: null, siteName: null };
    if (meta.image) found += 1;
    // The mark is written whatever happened, so a page with no picture costs
    // exactly one request in its lifetime.
    await database
      .update(readingProvenance)
      .set({
        imageUrl: meta.image,
        imageCheckedAt: new Date(),
        ...(meta.siteName && !row.publisherName ? { publisherName: meta.siteName } : {}),
      })
      .where(eq(readingProvenance.postId, row.postId));
  }
  return { looked: batch.length, found, remaining: rows.length > limit };
}

export async function enqueueImageEnrichment(blogId: string): Promise<void> {
  await enqueueReadingJob({
    blogId,
    kind: "enrich_item",
    opKey: `enrich_item:${blogId}`,
    payload: {},
  });
}

export async function runEnrichItemJob(job: ReadingJobRow, fetcher?: PageFetcher): Promise<void> {
  const result = await enrichPendingImages(job.blogId, fetcher ? { fetcher } : {});
  // More to do: queue the next pass rather than run unbounded here, the same
  // way indexing does. The finished job frees the key.
  if (result.remaining) {
    await enqueueReadingJob({
      blogId: job.blogId,
      kind: "enrich_item",
      opKey: `enrich_item:${job.blogId}:next`,
      payload: {},
    });
  }
}
