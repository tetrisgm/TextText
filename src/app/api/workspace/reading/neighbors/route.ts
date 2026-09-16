import { readingNeighbors } from "@/lib/reading/list.server";
import { handleFrom, json, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle=&id=&dateBasis= -> the newer and older article around one item, in its folder. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  const id = url.searchParams.get("id")?.trim();
  if (!handle) return jsonError("Missing workspace handle", 400);
  if (!id) return jsonError("Missing id", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  try {
    return json(
      await readingNeighbors({
        handle,
        user: reader.user,
        postId: id,
        dateBasis: url.searchParams.get("dateBasis") === "received" ? "received" : "published",
      }),
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not find neighbours", 500);
  }
}
