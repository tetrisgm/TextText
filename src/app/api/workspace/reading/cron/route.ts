import { runIndexItemJob } from "@/lib/reading/embeddings.server";
import { blogsWithDueFeeds, enqueueDueFeedPolls, runPollFeedJob } from "@/lib/reading/ingest.server";
import { enqueueReadingJob, runReadingJobs } from "@/lib/reading/jobs.server";
import { enqueueRetentionSweep, runRetentionJob } from "@/lib/reading/retention.server";
import { blogsDueForDigest, sendReadingDigest } from "@/lib/reading/digest.server";
import { enqueueIndexItem } from "@/lib/reading/embeddings.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The unattended pass, called by the platform scheduler (vercel.json) with
 * its bearer secret. Queues due polls for every workspace, runs a bounded
 * batch of jobs, and sends the digests whose hour this is. Without
 * CRON_SECRET configured the route refuses everything, so a stray request
 * can never make it work.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const now = new Date();
  const due = await blogsWithDueFeeds(now);
  let queued = 0;
  for (const blogId of due) {
    queued += await enqueueDueFeedPolls(blogId, enqueueReadingJob, now);
    await enqueueRetentionSweep(blogId, now);
    await enqueueIndexItem(blogId);
  }
  const ran = await runReadingJobs({
    executors: { poll_feed: runPollFeedJob, retention_enforce: runRetentionJob, index_item: runIndexItemJob },
    limit: 25,
    owner: `cron:${now.toISOString()}`,
  });
  const digests: Array<{ handle: string; sent: boolean; reason?: string }> = [];
  for (const blogId of await blogsDueForDigest(now)) {
    try {
      const report = await sendReadingDigest({ blogId, now });
      digests.push({ handle: report.handle, sent: report.sent, reason: report.reason });
    } catch (error) {
      digests.push({ handle: blogId, sent: false, reason: error instanceof Error ? error.message : "failed" });
    }
  }
  return Response.json({ workspaces: due.length, queued, ran, digests });
}
