import { listWorkspaceTimeline } from "@/lib/store";
import { handleFrom, json, jsonError, requireReader } from "../reading/_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter");
  if (filter && !["all", "writing", "saved"].includes(filter)) return jsonError("Invalid timeline filter", 400);
  try {
    return json(await listWorkspaceTimeline({ handle, user: reader.user,
      filter: filter === "writing" || filter === "saved" ? filter : "all",
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") || 40),
    }));
  } catch (error) {
    return jsonError(error instanceof Error && error.message === "Invalid timeline cursor" ? error.message : "Could not load timeline", error instanceof Error && error.message === "Invalid timeline cursor" ? 400 : 500);
  }
}
