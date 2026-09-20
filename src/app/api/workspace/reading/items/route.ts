import { listReadingItems, readingFolderSummary, resolveReadingFolderIds, type ReadingScope } from "@/lib/reading/list.server";
import { recordAction } from "@/lib/audit";
import { setKeep, setReadState, setReadStateForScope } from "@/lib/reading/retention.server";
import { extractFullContent } from "@/lib/reading/extract.server";
import { handleFrom, json, jsonError, readJson, requireOwner, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * GET ?handle=&folder=&descendants=1&state=all|unread|kept&dateBasis=published|received&cursor=&limit=
 * One bounded page of imported articles in scope, plus the folder's header
 * numbers when no cursor is given (the first page of a view).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  // "" is a real scope: every reading folder the person can see, which is
  // what the home page's Recent column asks for.
  const folderPath = url.searchParams.get("folder")?.trim();
  if (!handle) return jsonError("Missing workspace handle", 400);
  if (folderPath === undefined || folderPath === null) return jsonError("Missing folder", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;

  const stateParam = url.searchParams.get("state");
  const state: ReadingScope["state"] =
    stateParam === "unread" || stateParam === "kept" || stateParam === "read" || stateParam === "saved" || stateParam === "starred" ? stateParam : "all";
  const dateBasis: ReadingScope["dateBasis"] =
    url.searchParams.get("dateBasis") === "received" ? "received" : url.searchParams.get("dateBasis") === "read" ? "read" : "published";
  const scope: ReadingScope = {
    folderPath,
    includeDescendants: url.searchParams.get("descendants") !== "0",
    state,
    dateBasis,
    direction: url.searchParams.get("direction") === "oldest" ? "oldest" : "newest",
  };
  const cursor = url.searchParams.get("cursor");
  const limitParam = Number(url.searchParams.get("limit") ?? "");
  try {
    const [page, summary] = await Promise.all([
      listReadingItems({
        handle,
        user: reader.user,
        scope,
        cursor,
        limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      }),
      cursor ? Promise.resolve(null) : readingFolderSummary({ handle, user: reader.user, folderPath }),
    ]);
    return json({ ...page, summary });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not list reading", 500);
  }
}

/**
 * POST { handle, action: "read" | "unread" | "keep" | "unkeep", ids: string[] }
 * Read state is the signed-in person's own. Keep is a workspace decision, so
 * it is the owner's.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const action = body.action;
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0).slice(0, 200)
    : [];
  try {
    if (action === "read_all") {
      // Everything currently in a folder scope, for this person only.
      const reader = await requireReader(handle);
      if (!reader.ok) return reader.response;
      if (!reader.user?.userId) return jsonError("Sign in to track what you have read", 401);
      const folderPath = typeof body.folder === "string" ? body.folder : "";
      const { blogId, folderIds } = await resolveReadingFolderIds({ handle, user: reader.user, folderPath, includeDescendants: true });
      const count = await setReadStateForScope({ userId: reader.user.userId, blogId, folderIds });
      await recordAction({
        actorUserId: reader.user.userId,
        actorType: "human",
        actionName: "reading.mark_all_read",
        targetType: "folder",
        targetId: folderPath || null,
        outputSummary: `${count} items`,
      });
      return json({ ok: true, count });
    }
    if (ids.length === 0) return jsonError("Missing ids", 400);
    if (action === "read" || action === "unread") {
      const reader = await requireReader(handle);
      if (!reader.ok) return reader.response;
      if (!reader.user?.userId) return jsonError("Sign in to track what you have read", 401);
      const count = await setReadState({ handle, user: reader.user, postIds: ids, read: action === "read" });
      return json({ ok: true, count });
    }
    if (action === "extract") {
      const owner = await requireOwner(handle);
      if (!owner.ok) return owner.response;
      const result = await extractFullContent({ handle, postId: ids[0], actor: { userId: owner.ownerId, actorType: "human" } });
      return json(result);
    }
    if (action === "keep" || action === "unkeep") {
      const owner = await requireOwner(handle);
      if (!owner.ok) return owner.response;
      const result = await setKeep({
        handle,
        postIds: ids,
        keep: action === "keep",
        actor: { userId: owner.ownerId, actorType: "human" },
      });
      return json({ ok: true, count: result.changed });
    }
    return jsonError("Unknown action", 400);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not update items", 500);
  }
}
