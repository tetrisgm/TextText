import {
  addFeedConnection,
  listFeedConnections,
} from "@/lib/reading/connections.server";
import { runReadingJobs } from "@/lib/reading/jobs.server";
import { runPollFeedJob } from "@/lib/reading/ingest.server";
import {
  feedErrorResponse,
  handleFrom,
  json,
  jsonError,
  readJson,
  requireOwner,
  requireReader,
} from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle=  -> every connection in the workspace, endpoints redacted. */
export async function GET(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  try {
    return json({ connections: await listFeedConnections(handle) });
  } catch (error) {
    return feedErrorResponse(error);
  }
}

/**
 * POST { handle, parentFolderPath, url, name?, retentionDays?, initialImportLimit? }
 * Follows one feed: creates its source folder, queues the initial import, and
 * runs a bounded slice of that import before answering so the folder is not
 * empty when it appears. The rest continues on later ticks.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const parentFolderPath = typeof body.parentFolderPath === "string" ? body.parentFolderPath.trim() : "";
  if (!url) return jsonError("Enter a feed address", 400);
  if (!parentFolderPath) return jsonError("Choose a folder", 400);
  try {
    const result = await addFeedConnection({
      handle,
      parentFolderPath,
      endpointUrl: url,
      name: typeof body.name === "string" ? body.name : null,
      retentionDays: typeof body.retentionDays === "number" ? body.retentionDays : null,
      initialImportLimit: typeof body.initialImportLimit === "number" ? body.initialImportLimit : null,
      actor: { userId: owner.ownerId, actorType: "human" },
    });
    let imported = null;
    if (result.created) {
      imported = await runReadingJobs({
        executors: { poll_feed: runPollFeedJob },
        blogId: owner.blogId,
        limit: 1,
        owner: `add-feed:${owner.ownerId}`,
      });
    }
    return json({ ...result, imported }, result.created ? 201 : 200);
  } catch (error) {
    return feedErrorResponse(error);
  }
}
