"use server";

// The Connect Apple / Connect Google buttons in Settings post here. Each
// action verifies the LIVE session, mints the signed link intent for exactly
// that user, and only then starts the ordinary provider sign-in. The jwt
// callback (src/auth.ts) sees the intent plus the surviving session token and
// links the new subject to the same account instead of switching to a new one.

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { hasAppleProvider, hasGoogleProvider, signIn } from "@/auth";
import {
  LINK_INTENT_COOKIE,
  LINK_INTENT_MAX_AGE_SECONDS,
  mintLinkIntent,
} from "@/lib/link-intent";

async function beginLink(provider: "apple" | "google"): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Connecting a provider requires signing in first");
  const userId = await getUserIdBySub(user.sub);
  if (!userId) throw new Error("Connecting a provider requires a workspace account");
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Auth is not configured");

  const cookieStore = await cookies();
  cookieStore.set({
    name: LINK_INTENT_COOKIE,
    value: mintLinkIntent(userId, secret),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: LINK_INTENT_MAX_AGE_SECONDS,
  });

  // Ordinary sign-in from here on. redirectTo lands back in the workspace;
  // the linking itself happens in the jwt callback during the OAuth callback.
  await signIn(provider, { redirectTo: "/start?to=home" });
}

export async function connectApple(): Promise<void> {
  if (!hasAppleProvider) throw new Error("Apple sign-in is not configured");
  await beginLink("apple");
}

export async function connectGoogle(): Promise<void> {
  if (!hasGoogleProvider) throw new Error("Google sign-in is not configured");
  await beginLink("google");
}
