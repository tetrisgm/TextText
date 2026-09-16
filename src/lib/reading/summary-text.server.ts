import { generateText } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { blogs, posts, readingSummaryTexts, users } from "@/lib/db/schema";
import { workspaceLanguageModel } from "@/lib/ai/provider-model.server";
import { getWorkspaceAiConfigForOwner } from "@/lib/ai/workspace-ai-config.server";
import { sha256 } from "./feed-identity";
import { readingFlags } from "./flags";
import type { ReadingSummary } from "./summaries.server";

/**
 * A Summary's written text: a few sentences the workspace's own model
 * writes from the member articles, and nothing else. The prompt carries the
 * articles' titles, sources, and stored text; the instruction is to report
 * what they say and name the source for each point, never to add. The text
 * is cached by the exact set of members, so it is written once per grouping
 * and a folder view never waits on a model for a Summary it has seen.
 *
 * Only the workspace's key writes; with no key configured the Summary is its
 * grouped articles, which is complete on its own.
 */

const MAX_NEW_PER_REQUEST = 4;
const MAX_ARTICLE_CHARS = 2500;

function requireDb() {
  if (!db) throw new Error("Summary text needs DATABASE_URL");
  return db;
}

export function summaryClusterKey(summary: Pick<ReadingSummary, "members">): string {
  return sha256(summary.members.map((member) => member.id).sort().join("\n"));
}

const SYSTEM = [
  "You write the text of a Summary for a reading dashboard.",
  "You are given several articles that report the same news, each with its source name.",
  "Write two to four plain sentences that say what happened according to the articles, and where the sources differ, say so.",
  "Name the source for each point in parentheses, like (Hacker News).",
  "Use only what the articles say. Do not add background, opinion, or anything not in the text. Do not use the word Story.",
  "No headings, no lists, no markdown.",
].join(" ");

async function ownerModel(blogId: string) {
  const rows = await requireDb()
    .select({ sub: users.appleSub })
    .from(blogs)
    .innerJoin(users, eq(users.id, blogs.ownerId))
    .where(eq(blogs.id, blogId))
    .limit(1);
  const sub = rows[0]?.sub;
  if (!sub) return null;
  const config = await getWorkspaceAiConfigForOwner(sub);
  if (!config) return null;
  return { model: workspaceLanguageModel(config), name: `${config.provider}:${config.model}` };
}

/**
 * Attach cached text to each Summary, and write text for at most a few
 * uncached ones now. Returns the summaries with `text` where available.
 */
export async function withSummaryTexts(
  blogId: string,
  summaries: ReadingSummary[],
  options: { write?: boolean } = {},
): Promise<Array<ReadingSummary & { text: string | null }>> {
  if (!readingFlags.summaries || summaries.length === 0) return summaries.map((summary) => ({ ...summary, text: null }));
  const database = requireDb();
  const keys = summaries.map(summaryClusterKey);
  const cached = new Map(
    (
      await database
        .select({ clusterKey: readingSummaryTexts.clusterKey, text: readingSummaryTexts.text })
        .from(readingSummaryTexts)
        .where(and(eq(readingSummaryTexts.blogId, blogId), inArray(readingSummaryTexts.clusterKey, keys)))
    ).map((row) => [row.clusterKey, row.text]),
  );
  const result = summaries.map((summary, index) => ({ ...summary, text: cached.get(keys[index]) ?? null }));
  if (!options.write) return result;

  const pending = result.map((summary, index) => ({ summary, index })).filter((entry) => entry.summary.text === null).slice(0, MAX_NEW_PER_REQUEST);
  if (pending.length === 0) return result;
  const owner = await ownerModel(blogId);
  if (!owner) return result;

  for (const { summary, index } of pending) {
    const bodies = await database
      .select({ id: posts.id, body: posts.body, excerpt: posts.excerpt })
      .from(posts)
      .where(inArray(posts.id, summary.members.map((member) => member.id)));
    const bodyById = new Map(bodies.map((row) => [row.id, row]));
    const articles = summary.members
      .map((member) => {
        const row = bodyById.get(member.id);
        const text = [row?.excerpt ?? "", row?.body ?? ""].filter(Boolean).join("\n\n").slice(0, MAX_ARTICLE_CHARS);
        return `Source: ${member.publisherName ?? member.sourceFolderName}\nTitle: ${member.title}\n${text}`;
      })
      .join("\n\n---\n\n");
    try {
      const written = await generateText({
        model: owner.model,
        system: SYSTEM,
        prompt: `Articles:\n\n${articles}`,
        maxOutputTokens: 300,
      });
      const text = written.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      await database
        .insert(readingSummaryTexts)
        .values({ clusterKey: keys[index], blogId, model: owner.name, text })
        .onConflictDoNothing();
      result[index] = { ...result[index], text };
    } catch {
      // A model that does not answer leaves the Summary as its articles.
    }
  }
  return result;
}
