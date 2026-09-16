import { listReadingItems } from "@/lib/reading/list.server";
import { handleFrom, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

const MAX_EXPORT = 5000;

/**
 * GET ?handle=&folder=&state=all|kept&format=json|csv -> the articles in
 * scope, bounded, as a file. What a person can see, nothing more.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  const folderPath = url.searchParams.get("folder") ?? "";
  const state = url.searchParams.get("state") === "kept" ? "kept" : "all";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const rows: Array<Record<string, string | boolean | null>> = [];
  let cursor: string | null = null;
  while (rows.length < MAX_EXPORT) {
    const page = await listReadingItems({
      handle,
      user: reader.user,
      scope: { folderPath, includeDescendants: true, state, dateBasis: "published" },
      cursor,
      limit: 100,
    });
    for (const item of page.items) {
      rows.push({
        title: item.title,
        url: item.permalink ?? item.externalUrl,
        source: item.publisherName ?? item.sourceFolderName,
        folder: item.folderPath,
        published_at: item.publishedAt,
        received_at: item.receivedAt,
        read: item.read,
        starred: item.starred,
        kept: item.kept,
        workspace_id: item.id,
      });
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${handle}-reading-${state}-${stamp}.${format}`;
  if (format === "csv") {
    const header = Object.keys(rows[0] ?? { title: "", url: "", source: "", folder: "", published_at: "", received_at: "", read: "", starred: "", kept: "", workspace_id: "" });
    const escape = (value: string | boolean | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const body = [header.join(","), ...rows.map((row) => header.map((key) => escape(row[key] ?? null)).join(","))].join("\n");
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  }
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), handle, folder: folderPath, state, count: rows.length, truncated: rows.length >= MAX_EXPORT, articles: rows }, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
