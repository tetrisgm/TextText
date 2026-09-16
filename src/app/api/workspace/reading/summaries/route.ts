import { readingSummaries } from "@/lib/reading/summaries.server";
import { withSummaryTexts } from "@/lib/reading/summary-text.server";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { workspaceIdForHandle } from "@/lib/store";
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
    const grouped = await readingSummaries({ handle, user: reader.user, folderPath });
    // Text is written with the owner's key, so only the owner's request
    // writes new text; everyone reads what is cached.
    const [blogId, access] = await Promise.all([workspaceIdForHandle(handle), resolveWorkspaceAccess({ handle, user: reader.user })]);
    const summaries = await withSummaryTexts(blogId, grouped.summaries, { write: access.isOwner });
    return json({ ...grouped, summaries });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not build summaries", 500);
  }
}
