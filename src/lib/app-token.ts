// One in-app sign-in mints the desktop app's sync token. Ensure the user and
// workspace exist (claiming the browser's guest blog if there is one), then
// bind a token to the account. Shared by the /connect/app server action (the
// browser fallback) and the /api/app/token route the app's web view calls
// silently in the background right after sign-in. No separate code step.

import { recordAction } from "@/lib/audit";
import { createApiToken } from "@/lib/api-tokens";
import type { CurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { rootDomainUrl } from "@/lib/site-url";
import { resolveOwnedWorkspace } from "@/lib/workspace";

export type MintAppTokenResult =
  | { token: string; origin: string }
  | { error: string };

export async function mintAppTokenForUser(
  user: CurrentUser,
  deviceNameInput: unknown,
): Promise<MintAppTokenResult> {
  await resolveOwnedWorkspace(user);
  const userId = await getUserIdBySub(user.sub);
  if (!userId) return { error: "Sign in first" };

  const deviceName =
    typeof deviceNameInput === "string" && deviceNameInput.trim()
      ? deviceNameInput.trim().slice(0, 60)
      : "this Mac";
  const { raw } = await createApiToken(userId, `Write.app on ${deviceName}`);
  await recordAction({
    actorUserId: userId,
    actorType: "human",
    actionName: "link_app",
    targetType: "workspace",
    inputSummary: deviceName,
  });
  return { token: raw, origin: rootDomainUrl().origin };
}
