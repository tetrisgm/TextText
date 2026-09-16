import { searchReadingItems } from "@/lib/reading/search.server";
import { handleFrom, json, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle=&folder=&q= -> reading search results in list-row shape, rank order. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  if (!query) return json({ items: [], semantic: false, total: 0 });
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  try {
    return json(await searchReadingItems({ handle, user: reader.user, query, folderPath: url.searchParams.get("folder") || null, limit: 50 }));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not search", 500);
  }
}
