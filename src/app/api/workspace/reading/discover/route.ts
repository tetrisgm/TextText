import { discoverFeedCandidates } from "@/lib/reading/fetch.server";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * POST { handle, input } -> verified feed candidates for a URL or a site.
 * Discovery fetches; it never subscribes.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) return jsonError("Enter a web address", 400);
  if (input.length > 2048) return jsonError("That address is too long", 400);
  return json(await discoverFeedCandidates(input));
}
