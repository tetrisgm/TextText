"use server";

// Minting half of the in-app link: when someone signs in inside the Write
// desktop app, this hands the app a sync token bound to their account, so one
// sign-in both authenticates the app's web view (the session cookie) and links
// the Mac for folder sync. No separate code-approval step.

import { isAuthConfigured } from "@/auth";
import { recordAction } from "@/lib/audit";
import { createApiToken } from "@/lib/api-tokens";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { resolveOwnedWorkspace } from "@/lib/workspace";
import { rootDomainUrl } from "@/lib/site-url";

export type MintAppTokenResult =
  | { token: string; origin: string }
  | { error: string };

export async function mintAppTokenAction(
  deviceNameInput: unknown,
): Promise<MintAppTokenResult> {
  if (!isAuthConfigured) return { error: "Sign-in is not configured" };
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first" };

  // First meaningful touch: ensure the user and workspace exist (claiming the
  // browser's guest blog if there is one), exactly like device-link approval,
  // so the app's token lands on the blog the person can already see.
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
