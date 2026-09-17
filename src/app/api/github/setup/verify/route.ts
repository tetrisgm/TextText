import { exchangeUserCode, getInstallation, githubAppConfig, userControlsInstallation } from "@/lib/github/app.server";
import { verifyInstallState } from "@/lib/github/install-state";
import { getCurrentUser } from "@/lib/session";
import { authSecret, clearInstallStateCookie, readInstallStateCookie, settingsRedirect, verifyRedirectUri } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * The last step of Connect: GitHub returns with ?code&state. The code buys a
 * user token that is used for exactly one question, "can this person see
 * installation N", and then dropped. Only then is the installation bound to
 * the workspace named in the state.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = githubAppConfig();
  const secret = authSecret();
  if (!config || !secret) return settingsRedirect(request, "not-configured");
  const state = url.searchParams.get("state") ?? "";
  const cookie = await readInstallStateCookie();
  const intent = cookie && cookie === state ? verifyInstallState(cookie, secret) : null;
  await clearInstallStateCookie();
  if (!intent || intent.installationId === null) return settingsRedirect(request, "expired");
  const user = await getCurrentUser();
  const store = await import("@/lib/store");
  const userId = user ? await store.getUserIdBySub(user.sub) : null;
  if (!userId || userId !== intent.userId) return settingsRedirect(request, "signed-out");
  const code = url.searchParams.get("code");
  if (!code) return settingsRedirect(request, "denied");
  try {
    const userToken = await exchangeUserCode(config, code, verifyRedirectUri(request));
    const seen = await userControlsInstallation(userToken, intent.installationId);
    if (!seen) return settingsRedirect(request, "not-yours");
    const installation = await getInstallation(config, intent.installationId);
    if (!installation || installation.suspended) return settingsRedirect(request, "missing");
    await store.saveGithubInstallation({
      blogId: intent.blogId,
      installationId: installation.id,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      connectedByLogin: seen.login,
      actor: { userId, actorType: "human" },
    });
    return settingsRedirect(request, "connected");
  } catch (error) {
    console.warn("github setup verify failed", error instanceof Error ? error.message : error);
    return settingsRedirect(request, "failed");
  }
}
