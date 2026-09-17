import { enqueueDueFeedPolls, runPollFeedJob } from "@/lib/reading/ingest.server";
import { enqueueReadingJob, readingJobCounts, runReadingJobs } from "@/lib/reading/jobs.server";
import { enqueueIndexItem, runIndexItemJob } from "@/lib/reading/embeddings.server";
import { enqueueRetentionSweep, runRetentionJob } from "@/lib/reading/retention.server";
import { digestDue, sendReadingDigest } from "@/lib/reading/digest.server";
import { enqueueSummarize, runSummarizeJob } from "@/lib/reading/summaries-materialize.server";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { handle, limit? } -> queue whatever polls are due for this workspace
 * and run a bounded batch of jobs now, and send the digest if its hour has
 * passed.
 *
 * This is the whole scheduler, and it is the app: the front page and any
 * reading folder call it when their sources look stale, and Refresh calls it
 * on demand. There is no cron and no separate service; work happens on the
 * requests the app already serves, in bounded pieces.
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
  // The home page's Summaries and topics, refreshed at most every ten
  // minutes, after polls and before the digest.
  await enqueueSummarize(owner.blogId);
  const ran = await runReadingJobs({
    executors: { poll_feed: runPollFeedJob, retention_enforce: runRetentionJob, index_item: runIndexItemJob, summarize_recent: runSummarizeJob },
    blogId: owner.blogId,
    limit,
    owner: `tick:${owner.ownerId}`,
  });
  // The digest rides the same tick: due once its hour has passed today,
  // stamped before sending so two ticks in the same minute send once.
  let digest: { sent: boolean; reason?: string } | null = null;
  if (await digestDue(owner.blogId)) {
    try {
      const report = await sendReadingDigest({ blogId: owner.blogId });
      digest = { sent: report.sent, reason: report.reason };
    } catch (error) {
      digest = { sent: false, reason: error instanceof Error ? error.message : "failed" };
    }
  }
  return json({ queued, ran, digest, jobs: await readingJobCounts(owner.blogId) });
}
