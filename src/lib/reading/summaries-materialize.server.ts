import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts, readingEmbeddings, readingSummaries, readingTopics } from "@/lib/db/schema";
import { listFeedConnections } from "./connections.server";
import { sha256 } from "./feed-identity";
import { listReadingItems, type ReadingListItem } from "./list.server";
import { meanVector, cosine } from "./rank";
import { listSavedSearches } from "./saved-searches.server";
import { parseReadingQuery, searchTokens } from "./search.server";
import { clusterReadingItems, titleTokens, type ReadingSummary } from "./summaries.server";
import { withSummaryTexts } from "./summary-text.server";
import { enqueueReadingJob, type ReadingJobRow } from "./jobs.server";
import { blogs } from "@/lib/db/schema";

/**
 * Keeps reading_summaries and reading_topics current for one workspace.
 *
 * Runs from the app's own tick (a bounded job, at most every ten minutes),
 * never from a request that renders Home. The grouping rule is the one the
 * reading views already use; this reconciles its output with what the
 * table holds so a Summary keeps its id while members join, bumps the
 * coverage revision only when the member set really changes, and writes
 * model text for a few clusters per run with the workspace's own key.
 */

const CONSIDERED = 300;
const TEXTS_PER_RUN = 8;
const MAX_EMBEDDED = 2000;
const MIN_FOR_DERIVED = 40;
const MAX_DERIVED = 8;
const KMEANS_ROUNDS = 8;
const TOPIC_ASSIGN_MIN = 0.35;

function requireDb() {
  if (!db) throw new Error("Summaries need DATABASE_URL");
  return db;
}

export type SummaryRow = typeof readingSummaries.$inferSelect;
export type TopicRow = typeof readingTopics.$inferSelect;

function evidenceHashOf(members: ReadingListItem[]): string {
  return sha256(members.map((member) => member.id).sort().join("\n"));
}

function stableKeyOf(members: ReadingListItem[]): string {
  // The oldest member: it is the one that was there first and stays as
  // others join, so the key survives growth.
  return members.slice().sort((left, right) => new Date(left.publishedAt ?? left.receivedAt).getTime() - new Date(right.publishedAt ?? right.receivedAt).getTime() || left.id.localeCompare(right.id))[0].id;
}

/** Runs as the owner: reading folders are private, so an anonymous read sees nothing. */
async function ownerOf(blogId: string): Promise<{ sub: null; userId: string } | null> {
  const rows = await requireDb().select({ ownerId: blogs.ownerId }).from(blogs).where(eq(blogs.id, blogId)).limit(1);
  return rows[0]?.ownerId ? { sub: null, userId: rows[0].ownerId } : null;
}

async function recentFeedItems(handle: string, user: { sub: null; userId: string }): Promise<ReadingListItem[]> {
  const items: ReadingListItem[] = [];
  let cursor: string | null = null;
  while (items.length < CONSIDERED) {
    const page = await listReadingItems({ handle, user, scope: { folderPath: "", includeDescendants: true, state: "all", dateBasis: "published" }, cursor, limit: 100 });
    items.push(...page.items.filter((item) => item.origin === "feed"));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items.slice(0, CONSIDERED);
}

// ---------------------------------------------------------------------------
// Topics

type TopicSpec = { kind: "search" | "source" | "derived"; ref: string | null; label: string; centroid: number[] | null; memberCount: number };

/** k-means over the embedded corpus, labelled by the most frequent title tokens. */
export function deriveTopics(points: Array<{ id: string; vector: number[]; title: string }>, k: number, rounds = KMEANS_ROUNDS): Array<{ label: string; centroid: number[]; members: string[] }> {
  if (points.length < k || k <= 0) return [];
  // Deterministic seeds: evenly spaced through the id-sorted list.
  const sorted = points.slice().sort((left, right) => left.id.localeCompare(right.id));
  let centroids = Array.from({ length: k }, (_, index) => sorted[Math.floor((index * sorted.length) / k)].vector);
  let assignment = new Array<number>(sorted.length).fill(0);
  for (let round = 0; round < rounds; round += 1) {
    assignment = sorted.map((point) => {
      let best = 0;
      let bestScore = -Infinity;
      centroids.forEach((centroid, index) => {
        const score = cosine(point.vector, centroid);
        if (score > bestScore) {
          bestScore = score;
          best = index;
        }
      });
      return best;
    });
    centroids = centroids.map((centroid, index) => meanVector(sorted.filter((_, position) => assignment[position] === index).map((point) => point.vector)) ?? centroid);
  }
  return centroids
    .map((centroid, index) => {
      const members = sorted.filter((_, position) => assignment[position] === index);
      const counts = new Map<string, number>();
      for (const member of members) for (const token of titleTokens(member.title)) counts.set(token, (counts.get(token) ?? 0) + 1);
      const label = [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 2)
        .map(([token]) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(" and ");
      return { label: label || `Topic ${index + 1}`, centroid, members: members.map((member) => member.id) };
    })
    .filter((topic) => topic.members.length >= 3);
}

async function refreshTopics(blogId: string, handle: string): Promise<TopicRow[]> {
  const database = requireDb();
  const [searches, connections] = await Promise.all([listSavedSearches({ handle, user: null }), listFeedConnections(handle)]);
  const specs: TopicSpec[] = [
    ...searches.filter((search) => !search.folderPath).map((search) => ({ kind: "search" as const, ref: search.id, label: search.name, centroid: null, memberCount: 0 })),
    ...connections.filter((connection) => connection.state !== "detached").map((connection) => ({ kind: "source" as const, ref: connection.folderPath, label: connection.publisherTitle ?? connection.folderName, centroid: null, memberCount: 0 })),
  ];
  // Derived topics need embeddings; without them the strip is the saved
  // searches and sources, labelled as such.
  const embedded = await database
    .select({ id: readingEmbeddings.postId, vector: readingEmbeddings.vector, title: posts.title })
    .from(readingEmbeddings)
    .innerJoin(posts, eq(posts.id, readingEmbeddings.postId))
    .where(and(eq(readingEmbeddings.blogId, blogId), eq(posts.origin, "feed"), isNull(posts.deletedAt)))
    .orderBy(sql`${posts.createdAt} desc`)
    .limit(MAX_EMBEDDED);
  if (embedded.length >= MIN_FOR_DERIVED) {
    const k = Math.max(3, Math.min(MAX_DERIVED, Math.round(Math.sqrt(embedded.length / 20))));
    for (const topic of deriveTopics(embedded, k)) specs.push({ kind: "derived", ref: null, label: topic.label, centroid: topic.centroid, memberCount: topic.members.length });
  }
  const existing = await database.select().from(readingTopics).where(eq(readingTopics.blogId, blogId));
  const keep = new Set<string>();
  const rows: TopicRow[] = [];
  for (const [position, spec] of specs.entries()) {
    const match = existing.find((row) => row.kind === spec.kind && (spec.kind === "derived" ? row.label === spec.label : row.ref === spec.ref));
    if (match) {
      const [updated] = await database
        .update(readingTopics)
        .set({ label: spec.label, centroid: spec.centroid, memberCount: spec.memberCount, position, updatedAt: new Date() })
        .where(eq(readingTopics.id, match.id))
        .returning();
      keep.add(match.id);
      rows.push(updated);
    } else {
      const [inserted] = await database.insert(readingTopics).values({ blogId, label: spec.label, kind: spec.kind, ref: spec.ref, centroid: spec.centroid, memberCount: spec.memberCount, position }).returning();
      keep.add(inserted.id);
      rows.push(inserted);
    }
  }
  const stale = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (stale.length) await database.delete(readingTopics).where(inArray(readingTopics.id, stale));
  return rows;
}

/** Which topics a set of members belongs to: sources by folder, searches by their words, derived by nearest centroid. */
export function assignTopics(members: ReadingListItem[], topics: TopicRow[], vectors: Map<string, number[]>, queries: Map<string, string>): string[] {
  const ids = new Set<string>();
  const folderPaths = new Set(members.map((member) => member.folderPath));
  const text = members.map((member) => `${member.title} ${member.excerpt ?? ""}`).join(" ").toLocaleLowerCase();
  const memberVectors = members.map((member) => vectors.get(member.id)).filter((vector): vector is number[] => Boolean(vector));
  const centroid = meanVector(memberVectors);
  for (const topic of topics) {
    if (topic.kind === "source" && topic.ref && folderPaths.has(topic.ref)) ids.add(topic.id);
    if (topic.kind === "search" && topic.ref) {
      const query = queries.get(topic.ref);
      if (query) {
        const parsed = parseReadingQuery(query);
        const tokens = [...searchTokens(parsed.text), ...parsed.phrases.map((phrase) => phrase.toLocaleLowerCase())];
        if (tokens.length > 0 && tokens.every((token) => text.includes(token))) ids.add(topic.id);
      }
    }
    if (topic.kind === "derived" && topic.centroid && centroid && cosine(centroid, topic.centroid) >= TOPIC_ASSIGN_MIN) ids.add(topic.id);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Summaries

async function vectorsFor(blogId: string, ids: string[]): Promise<Map<string, number[]>> {
  if (ids.length === 0) return new Map();
  const rows = await requireDb().select({ id: readingEmbeddings.postId, vector: readingEmbeddings.vector }).from(readingEmbeddings).where(and(eq(readingEmbeddings.blogId, blogId), inArray(readingEmbeddings.postId, ids)));
  return new Map(rows.map((row) => [row.id, row.vector]));
}

export type MaterializeReport = { summaries: number; created: number; revised: number; retired: number; textsWritten: number; topics: number };

export async function materializeSummaries(input: { blogId: string; handle: string; writeTexts?: boolean }): Promise<MaterializeReport> {
  const database = requireDb();
  const owner = await ownerOf(input.blogId);
  if (!owner) return { summaries: 0, created: 0, revised: 0, retired: 0, textsWritten: 0, topics: 0 };
  const items = await recentFeedItems(input.handle, owner);
  const clusters = clusterReadingItems(items);
  const topics = await refreshTopics(input.blogId, input.handle);
  const searches = await listSavedSearches({ handle: input.handle, user: null });
  const queries = new Map(searches.map((search) => [search.id, search.query]));
  const vectors = await vectorsFor(input.blogId, clusters.flatMap((cluster) => cluster.members.map((member) => member.id)));
  const withText = await withSummaryTexts(input.blogId, clusters, { write: input.writeTexts ?? true });
  const existing = await database.select().from(readingSummaries).where(and(eq(readingSummaries.blogId, input.blogId), isNull(readingSummaries.retiredInto)));
  const byKey = new Map(existing.map((row) => [row.stableKey, row]));
  const byMember = new Map<string, SummaryRow>();
  for (const row of existing) for (const member of row.memberIds) byMember.set(member, row);
  const report: MaterializeReport = { summaries: clusters.length, created: 0, revised: 0, retired: 0, textsWritten: 0, topics: topics.length };
  const touched = new Set<string>();
  for (const [index, cluster] of clusters.entries()) {
    const members = cluster.members;
    const key = stableKeyOf(members);
    const evidence = evidenceHashOf(members);
    const text = withText[index]?.text ?? null;
    const topicIds = assignTopics(members, topics, vectors, queries);
    const representative = members.find((member) => !member.read) ?? members[0];
    const values = {
      memberIds: members.map((member) => member.id),
      evidenceHash: evidence,
      headline: cluster.headline,
      topicIds,
      sourceNames: cluster.sources,
      representativePostId: representative.id,
      imageUrl: members.find((member) => member.imageUrl)?.imageUrl ?? null,
      firstAt: new Date(cluster.firstAt),
      latestAt: new Date(cluster.latestAt),
      updatedAt: new Date(),
    };
    // A cluster that absorbed another one: the row whose key is not this
    // one but shares a member is retired into the survivor.
    const home = byKey.get(key) ?? members.map((member) => byMember.get(member.id)).find((row): row is SummaryRow => Boolean(row) && !touched.has(row!.id));
    if (!home) {
      const [inserted] = await database.insert(readingSummaries).values({ blogId: input.blogId, stableKey: key, coverageRevision: 1, text, textModel: text ? "cached" : null, textEvidenceHash: text ? evidence : null, ...values }).returning();
      touched.add(inserted.id);
      report.created += 1;
      if (text) report.textsWritten += 1;
      continue;
    }
    const revised = home.evidenceHash !== evidence;
    const textChanged = text !== null && text !== home.text;
    // The key stays while the member it names is still here, so a newer
    // member with a smaller id cannot rename a Summary it merely joined.
    const keptKey = members.some((member) => member.id === home.stableKey) ? home.stableKey : key;
    await database
      .update(readingSummaries)
      .set({
        stableKey: keptKey,
        ...values,
        coverageRevision: revised ? home.coverageRevision + 1 : home.coverageRevision,
        ...(text !== null ? { text, textModel: "cached", textEvidenceHash: evidence } : {}),
      })
      .where(eq(readingSummaries.id, home.id));
    touched.add(home.id);
    if (revised) report.revised += 1;
    if (textChanged) report.textsWritten += 1;
    for (const member of members) {
      const other = byMember.get(member.id);
      if (other && other.id !== home.id && !touched.has(other.id)) {
        await database.update(readingSummaries).set({ retiredInto: home.id, updatedAt: new Date() }).where(eq(readingSummaries.id, other.id));
        touched.add(other.id);
        report.retired += 1;
      }
    }
  }
  // Rows for clusters that fell out of the window stay, so a person's seen
  // and hidden state keeps its meaning; Home reads by latest_at anyway.
  return report;
}

// ---------------------------------------------------------------------------
// The job

const EVERY_MS = 10 * 60 * 1000;

export async function enqueueSummarize(blogId: string, now = new Date()): Promise<boolean> {
  const bucket = Math.floor(now.getTime() / EVERY_MS);
  return enqueueReadingJob({ blogId, kind: "summarize_recent", opKey: `summarize_recent:${bucket}`, runAfter: now, maxAttempts: 2 });
}

export async function runSummarizeJob(job: ReadingJobRow): Promise<void> {
  const rows = await requireDb().select({ handle: blogs.handle }).from(blogs).where(eq(blogs.id, job.blogId)).limit(1);
  const handle = rows[0]?.handle;
  if (!handle) return;
  await materializeSummaries({ blogId: job.blogId, handle, writeTexts: true });
}

export { TEXTS_PER_RUN };
