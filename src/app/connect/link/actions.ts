"use server";

// Approval half of the device link: only a signed-in user can approve, and
// the minted token will belong to them. The approve page submits a plain
// HTML form to this action, so approval works even with JavaScript disabled
// or a page whose client bundle never hydrated (the failure mode that ate
// the owner's first two link attempts in Safari).

import { redirect } from "next/navigation";
import { isAuthConfigured } from "@/auth";
import { recordAction } from "@/lib/audit";
import { approveDeviceLink, cleanDeviceLinkCode } from "@/lib/device-link";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { resolveOwnedWorkspace } from "@/lib/workspace";

async function approve(codeInput: unknown): Promise<string | null> {
  if (!isAuthConfigured) return "Sign-in is not configured";
  const user = await getCurrentUser();
  if (!user) return "Sign in to approve this link";

  // Approval is a first meaningful touch: make sure the user exists and has
  // a workspace, so the app's token lands on the blog the person can see.
  await resolveOwnedWorkspace(user);
  const userId = await getUserIdBySub(user.sub);
  if (!userId) return "Sign in to approve this link";

  const code = cleanDeviceLinkCode(codeInput);
  if (!code) return "That code is not valid";

  const approved = await approveDeviceLink(code, userId);
  if (!approved) {
    return "This link expired or was already used. Start again from the app.";
  }
  await recordAction({
    actorUserId: userId,
    actorType: "human",
    actionName: "approve_device_link",
    targetType: "workspace",
    inputSummary: code,
  });
  return null;
}

/** Form action: approve, then land on a server-rendered done or error state. */
export async function approveDeviceLinkFormAction(
  formData: FormData,
): Promise<void> {
  const rawCode = formData.get("code");
  const code = cleanDeviceLinkCode(rawCode) ?? "";
  let error: string | null;
  try {
    error = await approve(rawCode);
  } catch (cause) {
    error =
      cause instanceof Error && cause.message
        ? cause.message
        : "Could not approve the link";
  }

  const params = new URLSearchParams({ code });
  if (error) {
    params.set("error", error);
  } else {
    params.set("approved", "1");
  }
  redirect(`/connect/link?${params.toString()}`);
}
