import { readingHome } from "@/lib/reading/home.server";
import { handleFrom, json, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle=&mode=forYou|latest&topic=&offset=&limit= -> the home page's news units. */
export async function GET(request: Request) {
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
    return jsonError(error instanceof Error ? error.message : "Could not load the news", 500);
  }
}
