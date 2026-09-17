import { readScope } from "@/lib/request-scope";
import { readingHome } from "@/lib/reading/home.server";
import { markSummariesSeen, setSummaryHidden, workspaceIdForHandle } from "@/lib/store";
import { handleFrom, json, jsonError, readJson, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle=&mode=forYou|latest&topic=&offset=&limit= -> the home page's news units. */
export async function GET(request: Request) {
  // The whole handler reads, so the permission check and the news share one
  // answer to "which workspace is this". Nothing here writes.
  return readScope(() => loadHome(request));
}

async function loadHome(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  const url = new URL(request.url);
  try {
    return json(
      await readingHome({
        handle,
        user: reader.user,
        mode: url.searchParams.get("mode") === "latest" ? "latest" : "forYou",
        topic: url.searchParams.get("topic"),
        offset: Number(url.searchParams.get("offset") ?? 0) || 0,
        limit: Number(url.searchParams.get("limit") ?? 20) || 20,
      }),
    );
  } catch (error) {
    console.warn("reading home failed", error instanceof Error ? error.message : error);
    return jsonError("Could not load the news", 500);
  }
}

/**
 * POST { handle, action }:
 *   "seen" { seen: [{ id, revision }] }   the person saw these Summaries at these revisions (bounded, monotonic)
 *   "hide" { id, hidden? }                hide or unhide one Summary for this person
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  const userId = reader.user?.userId;
  if (!userId) return jsonError("Sign in to keep your place", 401);
  try {
    const blogId = await workspaceIdForHandle(handle);
    if (body.action === "seen") {
      const seen = Array.isArray(body.seen) ? body.seen.filter((entry): entry is { id: string; revision: number } => typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { revision?: unknown }).revision === "number") : [];
      const count = await markSummariesSeen({ userId, blogId, seen: seen.slice(0, 100).map((entry) => ({ summaryId: entry.id, revision: entry.revision })) });
      return json({ ok: true, count });
    }
    if (body.action === "hide") {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return jsonError("Missing id", 400);
      await setSummaryHidden({ userId, blogId, summaryId: body.id, hidden: body.hidden !== false, actor: { actorType: "human" } });
      return json({ ok: true });
    }
    return jsonError("Unknown action", 400);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No such Summary")) return jsonError(error.message, 404);
    console.warn("reading home update failed", error instanceof Error ? error.message : error);
    return jsonError("Could not update", 500);
  }
}
