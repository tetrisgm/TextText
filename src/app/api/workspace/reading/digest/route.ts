import { readingDigestSetting, sendReadingDigest, setReadingDigestHour } from "@/lib/reading/digest.server";
import { handleFrom, json, jsonError, readJson, requireOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?handle= -> the digest hour. POST { handle, hour|null } sets it; POST { handle, action: "send" } sends one now. Owner only. */
export async function GET(request: Request) {
  const handle = handleFrom(request);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  return json(await readingDigestSetting(owner.blogId));
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const handle = handleFrom(request, body);
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwner(handle);
  if (!owner.ok) return owner.response;
  try {
    if (body.action === "send") {
      const report = await sendReadingDigest({ blogId: owner.blogId, force: true });
      return json({ sent: report.sent, reason: report.reason ?? null, articles: report.articles, alerts: report.alerts.length, to: report.to });
    }
    if (body.hour === null || typeof body.hour === "number") {
      await setReadingDigestHour({ blogId: owner.blogId, hour: body.hour, actor: { userId: owner.ownerId } });
      return json(await readingDigestSetting(owner.blogId));
    }
    return jsonError("Missing hour", 400);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not update the digest", 500);
  }
}
