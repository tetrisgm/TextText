import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { collabState, collabUpdates, feedReceipts, posts } from "@/lib/db/schema";
import { legacyProjectionFromDocument } from "@/lib/documents/legacy";
import { validateDocumentSnapshot } from "@/lib/documents/model";

/**
 * Whether a workspace still agrees with itself.
 *
 * The simulator in concurrent-writes.db.test.ts catches a write path that can
 * lose text before it ships. This catches the other half: a workspace that
 * has already drifted, for a reason nobody predicted, in a way nothing else
 * would notice until a person opened an item and found the wrong words.
 *
 * Every check here answers a question that has exactly one right answer, and
 * names the items that got it wrong. None of them repairs anything. A checker
 * that fixes what it finds is a checker nobody reads, and the first thing to
 * know about drift is that it happened at all.
 *
 * Bounded: each check reports at most SAMPLE offenders, with the true count
 * beside them, so a workspace that has gone badly wrong does not produce a
 * report nobody can read.
 */

const SAMPLE = 20;

export type ConsistencyFinding = {
  /** What was checked, in the form of the promise it makes. */
  check: string;
  /** How many items fail it. */
  count: number;
  /** A few of them, by id, for looking at. */
  examples: string[];
  detail: string;
};

export type ConsistencyReport = {
  blogId: string;
  items: number;
  findings: ConsistencyFinding[];
  /** True when every check passed. */
  consistent: boolean;
};

function requireDb() {
  if (!db) throw new Error("The consistency checker needs DATABASE_URL");
  return db;
}

/** Same shape, same order, for comparing a projection with what it projects from. */
function stable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${key}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return String(value);
}

export async function checkWorkspaceConsistency(blogId: string): Promise<ConsistencyReport> {
  const database = requireDb();
  const findings: ConsistencyFinding[] = [];
  const add = (check: string, offenders: string[], detail: string) => {
    if (offenders.length === 0) return;
    findings.push({ check, count: offenders.length, examples: offenders.slice(0, SAMPLE), detail });
  };

  const rows = await database
    .select({
      id: posts.id,
      revision: posts.revision,
      document: posts.document,
      title: posts.title,
      body: posts.body,
      excerpt: posts.excerpt,
      tags: posts.tags,
      gallery: posts.gallery,
      links: posts.links,
      origin: posts.origin,
      deletedAt: posts.deletedAt,
    })
    .from(posts)
    .where(and(eq(posts.blogId, blogId), isNull(posts.deletedAt)));

  const unreadable: string[] = [];
  const projectionDrift: string[] = [];
  for (const row of rows) {
    let document;
    try {
      document = validateDocumentSnapshot(row.document);
    } catch {
      unreadable.push(row.id);
      continue;
    }
    // The columns are a projection of the document, and for these three the
    // document is the truth: a column that says something else is what a
    // reader sees in a list while the item itself says otherwise.
    //
    // Deliberately not checked here, because the document cannot hold what
    // the column does and reporting that on every workspace would be noise
    // rather than drift. The snapshot keeps one link, in sourceUrl, while the
    // column keeps a list with the labels a person wrote; and a bookmark's
    // excerpt comes from its capture while the document's subtitle is its
    // own field. Both are recorded in docs/reading-architecture.md as gaps in
    // the schema, which is where they belong until the schema can hold them.
    const projection = legacyProjectionFromDocument(document);
    const differs =
      (projection.title || null) !== (row.title || null) ||
      (projection.body || null) !== (row.body || null) ||
      stable(projection.tags ?? []) !== stable(row.tags ?? []);
    if (differs) projectionDrift.push(row.id);
  }
  add(
    "every item's document can be read",
    unreadable,
    "The document does not validate against the schema, so nothing can render or save it.",
  );
  add(
    "the columns say what the document says",
    projectionDrift,
    "A list shows one thing and the item shows another. The document is the truth; the columns were written from something else.",
  );

  // The collaborative markers describe revisions of this workspace's items.
  // A marker ahead of the row means the log claims to have materialized
  // something the row never received, which is how a reseed decides the
  // baseline is current when it is not.
  const aheadRows = await database
    .select({ postId: collabState.postId })
    .from(collabState)
    .innerJoin(posts, eq(posts.id, collabState.postId))
    .where(
      and(
        eq(posts.blogId, blogId),
        sql`(${collabState.materializedRevision} > ${posts.revision} OR ${collabState.baselineRevision} > ${posts.revision})`,
      ),
    );
  add(
    "no collaborative marker is ahead of its item",
    aheadRows.map((row) => row.postId),
    "The collaborative state claims a revision the item never reached, which disarms the rotation that would repair it.",
  );

  // A retired epoch's log is swept once its text is safely in the history.
  // Rows below the current epoch mean a sweep did not happen, which is safe
  // but unbounded, and worth knowing about before it is a gigabyte.
  const strandedRows = await database
    .select({ postId: collabUpdates.postId, rows: sql<number>`count(*)::int` })
    .from(collabUpdates)
    .innerJoin(collabState, eq(collabState.postId, collabUpdates.postId))
    .innerJoin(posts, eq(posts.id, collabUpdates.postId))
    .where(and(eq(posts.blogId, blogId), lt(collabUpdates.epoch, collabState.epoch)))
    .groupBy(collabUpdates.postId);
  add(
    "no retired collaborative log is left behind",
    strandedRows.map((row) => `${row.postId} (${row.rows} rows)`),
    "A rotation archived its session but could not sweep the log, or did not get that far. Nothing is lost; it simply grows.",
  );

  // A receipt whose item is gone and which is still active is how a deleted
  // article comes back on the next poll.
  const orphanReceipts = await database
    .select({ id: feedReceipts.id })
    .from(feedReceipts)
    .where(and(eq(feedReceipts.blogId, blogId), isNull(feedReceipts.postId), eq(feedReceipts.status, "active"), isNotNull(feedReceipts.contentHash)));
  add(
    "no active receipt has lost its item",
    orphanReceipts.map((row) => row.id),
    "The item was destroyed without the receipt being told, so the next poll of that feed imports the entry again.",
  );

  return { blogId, items: rows.length, findings, consistent: findings.length === 0 };
}
