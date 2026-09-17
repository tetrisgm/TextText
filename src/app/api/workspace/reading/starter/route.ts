import { applyStarterFeeds } from "@/lib/reading/starter.server";
import { STARTER_FEEDS } from "@/lib/reading/starter-feeds";
import { feedErrorResponse, handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { handle } -> give a workspace that follows nothing its starter
 * sources, a few at a time.
 *
 * Only the owner, only when the workspace follows nothing of its own, and
 * only once in its life: the decision is recorded in the audit ledger, so a
 * workspace whose owner removed every source stays empty. The response says
 * how many are left, and the caller comes back for them.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body as Record<string, unknown>);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  try {
    const outcome = await applyStarterFeeds({
      handle,
      blogId: owner.blogId,
      actor: { userId: owner.ownerId, actorType: "human" },
    });
    return json({ outcome, total: STARTER_FEEDS.length });
  } catch (error) {
    return feedErrorResponse(error);
  }
}
