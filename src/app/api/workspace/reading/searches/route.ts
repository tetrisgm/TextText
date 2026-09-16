import { createSavedSearch, deleteSavedSearch, listSavedSearches, setSavedSearchNotify } from "@/lib/reading/saved-searches.server";
import { handleFrom, json, jsonError, readJson, requireOwner, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle=&folder= -> saved searches relevant to a folder, with unread counts for the viewer. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  try {
    const folderPath = url.searchParams.get("folder");
    return json({ searches: await listSavedSearches({ handle, user: reader.user, folderPath: folderPath ?? undefined, withCounts: true }) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not list saved searches", 500);
  }
}

/** POST { handle, name, query, folder } -> save; DELETE { handle, id } -> remove. Owner only. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  try {
    const saved = await createSavedSearch({
      handle,
      name: typeof body.name === "string" ? body.name : "",
      query: typeof body.query === "string" ? body.query : "",
      folderPath: typeof body.folder === "string" ? body.folder : "",
      actor: { userId: owner.ownerId, actorType: "human" },
    });
    return json({ search: saved }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not save the search", 400);
  }
}

export async function DELETE(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  if (typeof body.id !== "string") return jsonError("Missing id", 400);
  const removed = await deleteSavedSearch({ handle, id: body.id, actor: { userId: owner.ownerId, actorType: "human" } });
  return json({ ok: removed });
}

/** PATCH { handle, id, notify } -> alert on or off. Owner only. */
export async function PATCH(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  if (typeof body.id !== "string") return jsonError("Missing id", 400);
  const ok = await setSavedSearchNotify({ handle, id: body.id, notify: body.notify === true, actor: { userId: owner.ownerId, actorType: "human" } });
  return json({ ok });
}
