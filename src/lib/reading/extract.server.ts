import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { readingProvenance, readingSourceRevisions } from "@/lib/db/schema";
import { fetchPublicResource } from "@/lib/bookmark-fetch";
import type { AuditActorType } from "@/lib/audit";
import { getPostById, PostConflictError, savePostContentPatch } from "@/lib/store";
import { sha256 } from "./feed-identity";
import { htmlToMarkdown } from "./html-to-markdown";
import { itemBody } from "./ingest.server";

/**
 * Full text for a feed that only sends a teaser. The original page is
 * fetched through the same public-resource gate as everything else, the
 * article body is found without a DOM (the regions that are never the
 * article are cut, then the run of paragraphs and headings that remains is
 * kept in document order), and the result becomes a source revision of the
 * item like any publisher update: recorded always, shown only while nobody
 * has edited the item.
 */

const MAX_HTML_BYTES = 2_000_000;
const MIN_ARTICLE_CHARS = 200;
const TIMEOUT_MS = 15_000;

const NEVER_ARTICLE = ["script", "style", "noscript", "template", "svg", "nav", "footer", "aside", "header", "form", "iframe", "button", "select", "menu", "dialog"];

function cutRegions(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
  }
  return out.replace(/<!--[\s\S]*?-->/g, " ");
}

function textOf(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The article's HTML, or null when the page does not read as one. Prefers
 * an <article> or <main> when the page marks one and it carries real text;
 * otherwise takes every paragraph and heading with enough words, in order.
 */
export function extractArticleHtml(html: string): string | null {
  const cleaned = cutRegions(html, NEVER_ARTICLE);
  const marked =
    cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1] ??
    cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1] ??
    null;
  const source = marked && textOf(marked).length >= MIN_ARTICLE_CHARS ? marked : cleaned;
  const blocks = [...source.matchAll(/<(p|h1|h2|h3|h4|blockquote|pre|ul|ol|figure)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)]
    .map((match) => match[0])
    .filter((block) => {
      const text = textOf(block);
      if (/^<(h[1-4]|figure|pre)/i.test(block)) return text.length > 0;
      return text.length >= 40 && text.split(" ").length >= 6;
    });
  if (blocks.length === 0) return null;
  const joined = blocks.join("\n");
  return textOf(joined).length >= MIN_ARTICLE_CHARS ? joined : null;
}

export function extractArticleMarkdown(html: string): string | null {
  const article = extractArticleHtml(html);
  if (!article) return null;
  const markdown = htmlToMarkdown(article).markdown.trim();
  return markdown.length >= MIN_ARTICLE_CHARS ? markdown : null;
}

export type ExtractFetcher = (url: string) => Promise<{ ok: boolean; html: string | null; status: number }>;

const defaultFetcher: ExtractFetcher = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchPublicResource(url, {
      signal: controller.signal,
      headers: { accept: "text/html,*/*;q=0.5", "user-agent": "texttext-reading/1" },
    });
    if (!response) return { ok: false, html: null, status: 0 };
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) return { ok: false, html: null, status: response.status };
    const text = await response.text();
    return { ok: true, html: text.slice(0, MAX_HTML_BYTES), status: response.status };
  } finally {
    clearTimeout(timer);
  }
};

export type ExtractResult =
  | { outcome: "applied"; characters: number }
  | { outcome: "recorded"; characters: number; reason: "edited" }
  | { outcome: "unavailable"; reason: "no_link" | "unreachable" | "not_readable" };

/** Fetch the original page and make its text the item's body, when nobody has edited the item. */
export async function extractFullContent(input: {
  handle: string;
  postId: string;
  actor: { userId: string | null; actorType: AuditActorType };
  fetcher?: ExtractFetcher;
  now?: Date;
}): Promise<ExtractResult> {
  if (!db) throw new Error("Full-text extraction needs DATABASE_URL");
  const now = input.now ?? new Date();
  const [provenance] = await db.select().from(readingProvenance).where(eq(readingProvenance.postId, input.postId)).limit(1);
  const target = provenance?.permalink ?? provenance?.externalUrl ?? null;
  if (!provenance || !target) return { outcome: "unavailable", reason: "no_link" };
  const post = await getPostById(input.handle, input.postId);
  if (!post?.id) return { outcome: "unavailable", reason: "no_link" };

  const fetched = await (input.fetcher ?? defaultFetcher)(target);
  if (!fetched.ok || !fetched.html) return { outcome: "unavailable", reason: "unreachable" };
  const markdown = extractArticleMarkdown(fetched.html);
  if (!markdown) return { outcome: "unavailable", reason: "not_readable" };

  const sourceHash = `extract:${sha256(markdown)}`;
  await db
    .insert(readingSourceRevisions)
    .values({ postId: post.id, sourceHash, title: post.title, bodyMarkdown: markdown, availability: "full", capturedAt: now })
    .onConflictDoNothing();

  // Untouched means the body is still exactly the last source version.
  const [latest] = await db
    .select({ body: readingSourceRevisions.bodyMarkdown })
    .from(readingSourceRevisions)
    .where(and(eq(readingSourceRevisions.postId, post.id), eq(readingSourceRevisions.sourceHash, provenance.sourceHash)))
    .limit(1);
  const untouched =
    !!latest &&
    (post.body === latest.body || post.body === itemBody({ bodyMarkdown: latest.body, permalink: provenance.permalink, externalUrl: provenance.externalUrl }));
  let applied = untouched;
  if (untouched) {
    try {
      await savePostContentPatch(
        input.handle,
        post,
        { body: markdown },
        {
          expectedRevision: post.revision,
          audit: {
            actorUserId: input.actor.userId,
            actorType: input.actor.actorType,
            actionName: "reading.extract_full_text",
            targetType: "item",
            targetId: post.id,
            inputSummary: target.slice(0, 200),
          },
        },
      );
    } catch (error) {
      if (!(error instanceof PostConflictError)) throw error;
      applied = false;
    }
  }
  await db
    .update(readingProvenance)
    .set({
      availability: "full",
      ...(applied ? { sourceHash } : {}),
      revisionCount: provenance.revisionCount + 1,
      updatedAt: now,
    })
    .where(eq(readingProvenance.postId, post.id));
  return applied ? { outcome: "applied", characters: markdown.length } : { outcome: "recorded", characters: markdown.length, reason: "edited" };
}

/** Whether an item still shows only what the feed sent. */
export async function readingAvailability(postId: string): Promise<"full" | "excerpt" | "metadata" | null> {
  if (!db) return null;
  const [row] = await db.select({ availability: readingProvenance.availability }).from(readingProvenance).where(eq(readingProvenance.postId, postId)).orderBy(desc(readingProvenance.updatedAt)).limit(1);
  return (row?.availability as "full" | "excerpt" | "metadata" | undefined) ?? null;
}
