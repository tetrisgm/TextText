import { enqueueDueFeedPolls, runPollFeedJob } from "@/lib/reading/ingest.server";
import { enqueueReadingJob, readingJobCounts, runReadingJobs } from "@/lib/reading/jobs.server";
import { enqueueIndexItem, runIndexItemJob } from "@/lib/reading/embeddings.server";
import { enqueueRetentionSweep, runRetentionJob } from "@/lib/reading/retention.server";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { handle, limit? } -> queue whatever polls are due for this workspace
 * and run a bounded batch of jobs now.
 *
 * This is the whole scheduler: the open workspace calls it on an interval,
 * the owner's Refresh calls it, and a deployment that wants unattended
 * polling can point a scheduler at it. Nothing in the codebase installs one.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(10, Math.trunc(body.limit))) : 3;
  const queued = await enqueueDueFeedPolls(owner.blogId, enqueueReadingJob);
  await enqueueRetentionSweep(owner.blogId);
  // Reconciles missing or stale vectors, including after a key is configured
  // later; a no-op when nothing is pending.
  await enqueueIndexItem(owner.blogId);
  const ran = await runReadingJobs({
    executors: { poll_feed: runPollFeedJob, retention_enforce: runRetentionJob, index_item: runIndexItemJob },
    blogId: owner.blogId,
    limit,
    owner: `tick:${owner.ownerId}`,
  });
  return json({ queued, ran, jobs: await readingJobCounts(owner.blogId) });
}
