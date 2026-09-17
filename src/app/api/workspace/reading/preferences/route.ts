import { clearReadingPreferences, countHiddenSummaries, listReadingPreferences, removeReadingPreference, setReadingPreference, workspaceIdForHandle, type ReadingPreferenceKind } from "@/lib/store";
import { handleFrom, json, jsonError, readJson, requireReader } from "../_shared";

export const dynamic = "force-dynamic";

const KINDS: ReadingPreferenceKind[] = ["topic_more", "topic_less", "source_less"];

/** GET ?handle= -> this person's rules and hidden count. */
export async function GET(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  const userId = reader.user?.userId;
  if (!userId) return json({ rules: [], hidden: 0 });
  const blogId = await workspaceIdForHandle(handle);
  const rules = await listReadingPreferences(userId, blogId);
  return json({ rules: rules.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString() })), hidden: await countHiddenSummaries(userId, blogId) });
}

/**
 * POST { handle, action }:
 *   "set" { kind, target, label }   add one rule (a more and a less on the same topic replace each other)
 *   "remove" { id }                 undo one rule
 *   "clear"                          every rule and every hidden Summary
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const reader = await requireReader(handle);
  if (!reader.ok) return reader.response;
  const userId = reader.user?.userId;
  if (!userId) return jsonError("Sign in to keep preferences", 401);
  const blogId = await workspaceIdForHandle(handle);
  const actor = { actorType: "human" as const };
  try {
    switch (body.action) {
      case "set": {
        const kind = KINDS.find((value) => value === body.kind);
        if (!kind || typeof body.target !== "string" || !body.target || body.target.length > 300) return jsonError("Missing kind or target", 400);
        const rule = await setReadingPreference({ userId, blogId, kind, target: body.target, label: typeof body.label === "string" && body.label ? body.label : body.target, actor });
        return json({ rule: { ...rule, createdAt: rule.createdAt.toISOString() } });
      }
      case "remove":
        if (typeof body.id !== "string") return jsonError("Missing id", 400);
        return json({ removed: await removeReadingPreference({ userId, blogId, id: body.id, actor }) });
      case "clear":
        return json(await clearReadingPreferences({ userId, blogId, actor }));
      default:
        return jsonError("Unknown action", 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return jsonError(/capped|too long/.test(message) ? message : "Could not update preferences", 400);
  }
}
