import { addFeedConnection, FeedConnectionError, feedEndpointsForOwner } from "@/lib/reading/connections.server";
import { buildOpml, parseOpml } from "@/lib/reading/opml";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?handle= -> the workspace's sources as OPML, grouped by parent folder. Owner only. */
export async function GET(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  const connections = await feedEndpointsForOwner(handle);
  const body = buildOpml({
    title: `${handle} reading`,
    sources: connections.map((connection) => ({
      title: connection.publisherTitle ?? connection.folderName,
      xmlUrl: connection.endpointUrl,
      htmlUrl: connection.siteUrl,
      folder: connection.folderPath.split("/").slice(0, -1).join("/") || "bookmarks",
    })),
  });
  return new Response(body, {
    headers: {
      "content-type": "text/x-opml; charset=utf-8",
      "content-disposition": `attachment; filename="${handle}-reading.opml"`,
      "cache-control": "no-store",
    },
  });
}

const IMPORT_LIMIT = 50;

/**
 * POST { handle, parentFolderPath, opml } -> follow each feed in the list
 * under the given folder. Bounded to IMPORT_LIMIT per request; each feed is
 * verified by fetching before it is added, and one that fails does not stop
 * the rest. Nothing is imported synchronously; polls are queued.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  const parentFolderPath = typeof body.parentFolderPath === "string" && body.parentFolderPath ? body.parentFolderPath : "bookmarks";
  if (typeof body.opml !== "string" || body.opml.length > 2_000_000) return jsonError("Missing OPML", 400);
  let entries;
  try {
    entries = parseOpml(body.opml);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not read the OPML", 400);
  }
  const considered = entries.slice(0, IMPORT_LIMIT);
  const results: Array<{ url: string; title: string | null; status: "added" | "existing" | "failed"; detail?: string; folderPath?: string }> = [];
  for (const entry of considered) {
    try {
      const added = await addFeedConnection({
        handle,
        parentFolderPath,
        endpointUrl: entry.xmlUrl,
        name: entry.title,
        actor: { userId: owner.ownerId, actorType: "human" },
        initialImportLimit: 25,
      });
      results.push({ url: entry.xmlUrl, title: entry.title, status: added.created ? "added" : "existing", folderPath: added.folder.path });
    } catch (error) {
      results.push({
        url: entry.xmlUrl,
        title: entry.title,
        status: "failed",
        detail: error instanceof FeedConnectionError ? error.message : error instanceof Error ? error.message : "failed",
      });
    }
  }
  return json({ results, skipped: Math.max(0, entries.length - considered.length) });
}
