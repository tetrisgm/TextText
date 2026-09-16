import { exportBookmarksHtml, importBookmarksHtml } from "@/lib/reading/bookmarks-migration.server";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?handle=&folder= -> the person's saved bookmarks as a Netscape file. Owner only. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  const html = await exportBookmarksHtml({ handle, folderPath: url.searchParams.get("folder") || null });
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="${handle}-bookmarks.html"`, "cache-control": "no-store" },
  });
}

/** POST { handle, parentFolderPath, html } -> import a browser or Pinboard export as saved bookmarks. Owner only. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  if (typeof body.html !== "string" || body.html.length > 8_000_000) return jsonError("Missing bookmarks file", 400);
  try {
    const report = await importBookmarksHtml({
      handle,
      html: body.html,
      parentFolderPath: typeof body.parentFolderPath === "string" && body.parentFolderPath ? body.parentFolderPath : "bookmarks",
      actor: { userId: owner.ownerId, actorType: "human" },
    });
    return json(report);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not import bookmarks", 400);
  }
}
