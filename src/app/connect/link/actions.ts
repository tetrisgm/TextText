"use server";

// Approval half of the device link: only a signed-in user can approve, and
// the minted token will belong to them. The approve page calls this.

import { isAuthConfigured } from "@/auth";
import { recordAction } from "@/lib/audit";
import { approveDeviceLink, cleanDeviceLinkCode } from "@/lib/device-link";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { resolveOwnedWorkspace } from "@/lib/workspace";

export async function approveDeviceLinkAction(
  codeInput: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!isAuthConfigured) throw new Error("Sign-in is not configured");
    const user = await getCurrentUser();
    if (!user) throw new Error("Sign in to approve this link");
    // Approval is a first meaningful touch: make sure the user exists and has
    // a workspace, claiming the browser's guest blog on the way when there is
    // one, so the app's token lands on the blog the person can already see.
    await resolveOwnedWorkspace(user);
    const userId = await getUserIdBySub(user.sub);
    if (!userId) throw new Error("Sign in to approve this link");

    const code = cleanDeviceLinkCode(codeInput);
    if (!code) throw new Error("That code is not valid");

    const approved = await approveDeviceLink(code, userId);
    if (!approved) {
      throw new Error("This link expired or was already used. Start again from the app.");
    }
    await recordAction({
      actorUserId: userId,
      actorType: "human",
      actionName: "approve_device_link",
      targetType: "workspace",
      inputSummary: code,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Could not approve the link",
    };
  }
}
