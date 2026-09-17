import { githubAppConfig, userAuthorizeUrl } from "@/lib/github/app.server";
import { mintInstallState, verifyInstallState } from "@/lib/github/install-state";
import { getCurrentUser } from "@/lib/session";
import { authSecret, clearInstallStateCookie, readInstallStateCookie, setInstallStateCookie, settingsRedirect, verifyRedirectUri } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * The GitHub App's setup URL. GitHub lands here after an install with
 * ?installation_id&setup_action&state. Nothing is stored yet: the state is
 * checked against the cookie, then the person is sent through the app's own
 * OAuth so the verify step can confirm they can see that installation.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = githubAppConfig();
  const secret = authSecret();
  if (!config || !secret) return settingsRedirect(request, "not-configured");
  const state = url.searchParams.get("state") ?? "";
  const cookie = await readInstallStateCookie();
  const intent = cookie && cookie === state ? verifyInstallState(cookie, secret) : null;
  if (!intent || intent.installationId !== null) {
    await clearInstallStateCookie();
    return settingsRedirect(request, "expired");
  }
  const user = await getCurrentUser();
  const { getUserIdBySub } = await import("@/lib/store");
  const userId = user ? await getUserIdBySub(user.sub) : null;
  if (!userId || userId !== intent.userId) {
    await clearInstallStateCookie();
    return settingsRedirect(request, "signed-out");
  }
  const action = url.searchParams.get("setup_action");
  if (action === "request") {
    // An organization member asked an admin to install; nothing to bind yet.
    await clearInstallStateCookie();
    return settingsRedirect(request, "requested");
  }
  const installationId = Number(url.searchParams.get("installation_id"));
  if (!Number.isInteger(installationId) || installationId <= 0) {
    await clearInstallStateCookie();
    return settingsRedirect(request, "expired");
  }
  const next = mintInstallState({ userId: intent.userId, blogId: intent.blogId, installationId }, secret);
  await setInstallStateCookie(next);
  return Response.redirect(userAuthorizeUrl(config, verifyRedirectUri(request), next), 303);
}
