import { installUrl } from "@/lib/github/app.server";
import { mintInstallState } from "@/lib/github/install-state";
import { authSecret, json, jsonError, requireOwnerWithApp, setInstallStateCookie } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * POST { handle } -> { url }: where to send the owner to install the app.
 * The signed state travels twice, in the URL GitHub hands back and in a
 * cookie only this browser holds, and setup requires both to agree.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { handle?: unknown };
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const owner = await requireOwnerWithApp(handle);
  if (!owner.ok) return owner.response;
  const secret = authSecret();
  if (!secret) return jsonError("Auth is not configured", 503);
  const state = mintInstallState({ userId: owner.userId, blogId: owner.blogId, installationId: null }, secret);
  await setInstallStateCookie(state);
  return json({ url: installUrl(owner.config, state) });
}
