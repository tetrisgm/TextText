import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog } from "@/lib/store";
import { recordAction } from "@/lib/audit";
import { readBoundedJson } from "@/lib/http/bounded-json";

const MAX_BODY_BYTES = 8_000;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/**
 * Store only the small, content-blind signal that an answer helped. The answer
 * itself stays in the user's transcript and never gets copied into telemetry.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Sign in to rate an answer." }, {
      status: 401,
      headers: NO_STORE_HEADERS,
    });
  }
  const blog = await getOwnedBlog(user.sub);
  if (!blog) {
    return Response.json({ error: "No workspace is connected." }, {
      status: 403,
      headers: NO_STORE_HEADERS,
    });
  }
  const body = await readBoundedJson(request, MAX_BODY_BYTES);
  if ("error" in body) {
    return Response.json({ error: "That feedback was too large." }, {
      status: 413,
      headers: NO_STORE_HEADERS,
    });
  }
  const value = body.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Response.json({ error: "Feedback is required." }, {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }
  const record = value as Record<string, unknown>;
  const rating = record.rating === "up" || record.rating === "down"
    ? record.rating
    : null;
  if (!rating) {
    return Response.json({ error: "Choose thumbs up or thumbs down." }, {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }
  const provider =
    record.provider === "Anthropic" || record.provider === "OpenAI" || record.provider === "Codex"
      ? record.provider
      : "unknown";
  const messageId =
    typeof record.messageId === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(record.messageId)
      ? record.messageId
      : null;
  await recordAction({
    actorUserId: user.userId ?? null,
    actorType: "human",
    actionName: "ai.answer_feedback",
    targetType: "mode",
    targetId: messageId,
    inputSummary: `${rating}${provider === "unknown" ? "" : ` · ${provider}`}`,
    outputSummary: blog.handle,
  });
  return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
}
