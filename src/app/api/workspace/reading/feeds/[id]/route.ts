import {
  adoptMovedFeed,
  detachFeedConnection,
  requestFeedRefresh,
  setFeedConnectionState,
  updateFeedConnectionSettings,
} from "@/lib/reading/connections.server";
import { runReadingJobs } from "@/lib/reading/jobs.server";
import { runPollFeedJob } from "@/lib/reading/ingest.server";
import { feedErrorResponse, handleFrom, json, jsonError, readJson, requireOwner } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * POST { handle, action: "pause" | "resume" | "detach" | "refresh", keepAllItems? }
 * Every action is non-destructive. Deleting the folder is the folder's own
 * flow, with its own preview.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  const actor = { userId: owner.ownerId, actorType: "human" as const };
  try {
    switch (body.action) {
      case "pause":
        return json({ connection: await setFeedConnectionState(handle, id, "paused", actor) });
      case "resume":
        return json({ connection: await setFeedConnectionState(handle, id, "active", actor) });
      case "detach":
        return json({
          connection: await detachFeedConnection(handle, id, actor, {
            keepAllItems: body.keepAllItems === true,
          }),
        });
      case "refresh": {
        const queued = await requestFeedRefresh(handle, id);
        const ran = queued.queued
          ? await runReadingJobs({
              executors: { poll_feed: runPollFeedJob },
              blogId: owner.blogId,
              limit: 1,
              owner: `refresh:${owner.ownerId}`,
            })
          : null;
        return json({ ...queued, ran });
      }
      case "settings": {
        const settings = (body.settings ?? {}) as Record<string, unknown>;
        return json({
          connection: await updateFeedConnectionSettings(
            handle,
            id,
            {
              ...(typeof settings.name === "string" ? { name: settings.name } : {}),
              ...(settings.retentionDays === null || typeof settings.retentionDays === "number"
                ? { retentionDays: settings.retentionDays as number | null }
                : {}),
              ...(settings.channel === null || typeof settings.channel === "string"
                ? { channel: settings.channel as string | null }
                : {}),
              ...(Array.isArray(settings.mutedKeywords)
                ? { mutedKeywords: settings.mutedKeywords.filter((word: unknown): word is string => typeof word === "string") }
                : {}),
            },
            actor,
          ),
        });
      }
      case "adopt_move":
        return json({ connection: await adoptMovedFeed(handle, id, actor) });
      default:
        return jsonError("Unknown action", 400);
    }
  } catch (error) {
    return feedErrorResponse(error);
  }
}
