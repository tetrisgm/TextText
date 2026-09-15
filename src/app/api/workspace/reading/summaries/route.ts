import { readingSummaries } from "@/lib/reading/summaries.server";
import { handleFrom, json, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle=&folder= -> Summaries: the same news from more than one source, grouped conservatively. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = handleFrom(request);
  const folderPath = url.searchParams.get("folder")?.trim() ?? "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  try {
    return json(await readingSummaries({ handle, user: reader.user, folderPath }));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not build summaries", 500);
  }
}
