import { listReadingItems } from "@/lib/reading/list.server";
import { handleFrom, json, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** Bounded metadata lookup for explicitly chosen assistant sources. */
export async function GET(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const idsParam = params.get("ids");
  const ids = idsParam === null ? undefined : [...new Set(idsParam.split(","))];
  if (ids ? !ids.length || ids.length > 5 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) : query.length < 2 || query.length > 200) {
    return jsonError("Choose up to five sources or search with 2 to 200 characters", 400);
  }
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  const page = await listReadingItems({ handle, user: reader.user, limit: ids ? 5 : 8,
    scope: { folderPath: "", includeDescendants: true, state: "all", dateBasis: "received", ...(ids ? { ids } : { query }) },
  });
  return json({ items: page.items.map((item) => ({ id: item.id, name: item.title || "Untitled", detail: `${item.folderPath || "News"} · ${item.publisherName || "Source"}` })) });
}
