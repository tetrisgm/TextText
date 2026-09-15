import { previewCleanup, runCleanup } from "@/lib/reading/retention.server";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { handle, mode: "preview" | "run" } -> what cleanup would move to
 * Trash, or one bounded batch of it. Owner only. This is the explicit path;
 * the unattended sweep runs from the tick only when its flag is on.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  try {
    if (body.mode === "run") {
      const report = await runCleanup({ handle, actor: { userId: owner.ownerId, actorType: "human" } });
      return json(report);
    }
    const preview = await previewCleanup({ handle });
    return json({
      expiring: preview.expiring.map((item) => ({ id: item.postId, title: item.title, expiresAt: item.expiresAt })),
      protected: preview.protected.map((item) => ({ id: item.postId, title: item.title, reason: item.reason })),
      truncated: preview.truncated,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not check cleanup", 500);
  }
}
