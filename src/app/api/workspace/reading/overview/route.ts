import { readingOverview } from "@/lib/reading/overview.server";
import { handleFrom, json, jsonError, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?handle= -> sources, totals, and the latest unread across every reading folder the caller can see. */
export async function GET(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  try {
    return json(await readingOverview({ handle, user: reader.user }));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load reading", 500);
  }
}
