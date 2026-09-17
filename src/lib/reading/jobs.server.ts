import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { readingJobs } from "@/lib/db/schema";

/**
 * Durable bounded work for reading.
 *
 * A request enqueues; a runner leases a handful of queued rows and executes
 * them; effects are idempotent so a job that runs twice changes nothing the
 * second time. Nothing here polls on a timer of its own: the runner is
 * invoked by the requests that need work done and by the owner's refresh.
 * A deployment that wants unattended polling points a scheduler at the tick
 * route; that is a deployment decision, not something this code installs.
 */

export type ReadingJobKind = "poll_feed" | "index_item" | "retention_enforce" | "summarize_recent" | "enrich_item";

export type ReadingJobRow = typeof readingJobs.$inferSelect;

const LEASE_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

function requireDb() {
  if (!db) throw new Error("Reading jobs need DATABASE_URL");
  return db;
}

/**
 * Queue one job. Returns false when an open job with the same key already
 * exists: retries and repeated refresh clicks collapse onto that one.
 */
export async function enqueueReadingJob(input: {
  blogId: string;
  kind: ReadingJobKind;
  opKey: string;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
}): Promise<boolean> {
  const result = await requireDb().execute(sql`
    insert into reading_jobs (blog_id, kind, op_key, payload, run_after, max_attempts)
    values (
      ${input.blogId}, ${input.kind}, ${input.opKey},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${input.runAfter ?? new Date()}, ${input.maxAttempts ?? 5}
    )
    on conflict (blog_id, op_key) where status in ('queued', 'running') do nothing
    returning id
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return Array.isArray(rows) ? rows.length > 0 : false;
}

/**
 * Take a bounded batch of runnable jobs. One statement, so it is atomic on
 * both drivers; SKIP LOCKED lets two runners share a queue without either
 * seeing the other's rows.
 */
export async function leaseReadingJobs(options: {
  blogId?: string;
  /** Lease only this job, when a request needs one specific piece of work done now. */
  opKey?: string;
  limit: number;
  now?: Date;
  owner: string;
}): Promise<ReadingJobRow[]> {
  const now = options.now ?? new Date();
  const until = new Date(now.getTime() + LEASE_MS);
  const limit = Math.max(1, Math.min(50, options.limit));
  const result = await requireDb().execute(sql`
    update reading_jobs
    set status = 'running', lease_until = ${until}, lease_owner = ${options.owner},
        attempts = attempts + 1, updated_at = ${now}
    where id in (
      select id from reading_jobs
      where (
        (status = 'queued' and run_after <= ${now})
        or (status = 'running' and lease_until is not null and lease_until < ${now})
      )
      ${options.blogId ? sql`and blog_id = ${options.blogId}` : sql``}
      ${options.opKey ? sql`and op_key = ${options.opKey}` : sql``}
      order by run_after asc
      limit ${limit}
      for update skip locked
    )
    returning *
  `);
  const rows = ((result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])) as Record<string, unknown>[];
  return rows.map(rowFromSql);
}

function rowFromSql(row: Record<string, unknown>): ReadingJobRow {
  const date = (value: unknown) => (value instanceof Date ? value : value ? new Date(String(value)) : null);
  return {
    id: String(row.id),
    blogId: String(row.blog_id),
    kind: String(row.kind),
    opKey: String(row.op_key),
    payload: (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload ?? {}) as Record<string, unknown>,
    status: String(row.status),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    leaseUntil: date(row.lease_until),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    runAfter: date(row.run_after) ?? new Date(),
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: date(row.created_at) ?? new Date(),
    updatedAt: date(row.updated_at) ?? new Date(),
    finishedAt: date(row.finished_at),
  };
}

/**
 * Completion and failure are fenced to the lease: a runner that outlived its
 * lease, and whose job another runner has since taken, changes nothing.
 */
export async function completeReadingJob(job: Pick<ReadingJobRow, "id" | "leaseOwner">, now = new Date()): Promise<boolean> {
  const rows = await requireDb()
    .update(readingJobs)
    .set({ status: "done", finishedAt: now, updatedAt: now, leaseUntil: null, leaseOwner: null })
    .where(and(eq(readingJobs.id, job.id), eq(readingJobs.status, "running"), job.leaseOwner ? eq(readingJobs.leaseOwner, job.leaseOwner) : sql`true`))
    .returning({ id: readingJobs.id });
  return rows.length > 0;
}

export async function failReadingJob(job: ReadingJobRow, error: string, now = new Date()): Promise<void> {
  const dead = job.attempts >= job.maxAttempts;
  const backoff = Math.min(MAX_BACKOFF_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, job.attempts - 1));
  const jitter = Math.floor(Math.random() * BACKOFF_BASE_MS);
  await requireDb()
    .update(readingJobs)
    .set({
      status: dead ? "dead" : "queued",
      lastError: error.slice(0, 1000),
      runAfter: dead ? job.runAfter : new Date(now.getTime() + backoff + jitter),
      finishedAt: dead ? now : null,
      leaseUntil: null,
      leaseOwner: null,
      updatedAt: now,
    })
    .where(and(eq(readingJobs.id, job.id), eq(readingJobs.status, "running"), job.leaseOwner ? eq(readingJobs.leaseOwner, job.leaseOwner) : sql`true`));
}

export async function cancelOpenReadingJobs(blogId: string, opKeyPrefix: string, now = new Date()): Promise<number> {
  const result = await requireDb().execute(sql`
    update reading_jobs set status = 'cancelled', finished_at = ${now}, updated_at = ${now}
    where blog_id = ${blogId} and op_key like ${`${opKeyPrefix}%`} and status in ('queued', 'running')
    returning id
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return Array.isArray(rows) ? rows.length : 0;
}

export type ReadingJobExecutor = (job: ReadingJobRow) => Promise<void>;

export type RunReadingJobsReport = {
  leased: number;
  done: number;
  failed: number;
  kinds: Record<string, number>;
};

/**
 * Run up to `limit` jobs now. Each executor is responsible for being
 * idempotent; this only leases, dispatches, and records the outcome.
 */
export async function runReadingJobs(options: {
  executors: Partial<Record<ReadingJobKind, ReadingJobExecutor>>;
  blogId?: string;
  opKey?: string;
  limit?: number;
  owner?: string;
  now?: Date;
}): Promise<RunReadingJobsReport> {
  const jobs = await leaseReadingJobs({
    blogId: options.blogId,
    opKey: options.opKey,
    limit: options.limit ?? 5,
    now: options.now,
    owner: options.owner ?? `runner:${process.pid}`,
  });
  const report: RunReadingJobsReport = { leased: jobs.length, done: 0, failed: 0, kinds: {} };
  for (const job of jobs) {
    report.kinds[job.kind] = (report.kinds[job.kind] ?? 0) + 1;
    const executor = options.executors[job.kind as ReadingJobKind];
    if (!executor) {
      await failReadingJob(job, `No executor for ${job.kind}`);
      report.failed += 1;
      continue;
    }
    try {
      await executor(job);
      await completeReadingJob(job);
      report.done += 1;
    } catch (error) {
      await failReadingJob(job, error instanceof Error ? error.message : String(error));
      report.failed += 1;
    }
  }
  return report;
}

export async function readingJobCounts(blogId: string): Promise<Record<string, number>> {
  const rows = await requireDb()
    .select({ status: readingJobs.status, count: sql<number>`count(*)::int` })
    .from(readingJobs)
    .where(and(eq(readingJobs.blogId, blogId)))
    .groupBy(readingJobs.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}
