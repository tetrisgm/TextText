import { listReadingItems, readingFolderSummary, type ReadingScope } from "@/lib/reading/list.server";
import { handleFrom, json, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * GET ?handle=&folder=&descendants=1&state=all|unread|kept&dateBasis=published|received&cursor=&limit=
 * One bounded page of imported articles in scope, plus the folder's header
 * numbers when no cursor is given (the first page of a view).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  const folderPath = url.searchParams.get("folder")?.trim();
  if (!handle) return jsonError("Missing workspace handle", 400);
  if (!folderPath) return jsonError("Missing folder", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;

  const stateParam = url.searchParams.get("state");
  const state: ReadingScope["state"] =
    stateParam === "unread" || stateParam === "kept" ? stateParam : "all";
  const dateBasis: ReadingScope["dateBasis"] =
    url.searchParams.get("dateBasis") === "received" ? "received" : "published";
  const scope: ReadingScope = {
    folderPath,
    includeDescendants: url.searchParams.get("descendants") !== "0",
    state,
    dateBasis,
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
