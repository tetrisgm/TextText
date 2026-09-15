import { saveReadingBrief } from "@/lib/reading/overview.server";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";

/** POST { handle, folder? } -> a new note in Notes listing the last day's articles as citations. Owner only. */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  try {
    const result = await saveReadingBrief({
      handle,
      user: owner.user,
      folderPath: typeof body.folder === "string" && body.folder ? body.folder : null,
      actor: { userId: owner.ownerId, actorType: "human" },
    });
    return json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not save the brief", 500);
  }
}
