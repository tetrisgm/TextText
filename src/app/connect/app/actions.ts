"use server";

// Browser-fallback minting for the in-app link (see AppLinkBridge). The desktop
// app itself mints silently over /api/app/token; this server action backs the
// visible /connect/app page for the rare case the native bridge is absent. Both
// paths share mintAppTokenForUser, so one sign-in authenticates the web view
// and links the Mac for folder sync with no separate code-approval step.

import { isAuthConfigured } from "@/auth";
import { mintAppTokenForUser } from "@/lib/app-token";
import { getCurrentUser } from "@/lib/session";

export type { MintAppTokenResult } from "@/lib/app-token";

export async function mintAppTokenAction(deviceNameInput: unknown) {
  if (!isAuthConfigured) return { error: "Sign-in is not configured" };
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first" };
  return mintAppTokenForUser(user, deviceNameInput);
}
