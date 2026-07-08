"use server";

// Server actions behind the /signin forms. Plain HTML forms post here, so
// sign-in works even when the client bundle never hydrates. Auth.js's
// server-side signIn throws AuthError back into the action (raw mode without
// a return-redirect header), so each action catches it and lands back on
// /signin with a human-readable error code; NEXT_REDIRECT passes through.

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  devLoginEnabled,
  hasAppleProvider,
  hasEmailProvider,
  hasGoogleProvider,
  SIGNIN_CALLBACK_COOKIE,
  SIGNIN_EMAIL_COOKIE,
  signIn,
} from "@/auth";
import { sanitizeCallbackUrl } from "./callback-url";
import { authRequestHost } from "./request-host";

const SIGNIN_CHECK_COOKIE_MAX_AGE_SECONDS = 15 * 60;

function backToSignIn(callbackUrl: string, error?: string): never {
  const params = new URLSearchParams({ callbackUrl });
  if (error) params.set("error", error);
  redirect(`/signin?${params}`);
}

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function formCallbackUrl(formData: FormData): Promise<string> {
  return sanitizeCallbackUrl(
    formValue(formData, "callbackUrl"),
    await authRequestHost(),
  );
}

async function rememberEmailCheck(email: string, callbackUrl: string): Promise<void> {
  const cookieStore = await cookies();
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/signin",
    maxAge: SIGNIN_CHECK_COOKIE_MAX_AGE_SECONDS,
  };
  cookieStore.set({ name: SIGNIN_EMAIL_COOKIE, value: email, ...options });
  cookieStore.set({
    name: SIGNIN_CALLBACK_COOKIE,
    value: callbackUrl,
    ...options,
  });
}

async function oauthSignIn(
  provider: "apple" | "google",
  formData: FormData,
): Promise<void> {
  const callbackUrl = await formCallbackUrl(formData);
  try {
    await signIn(provider, { redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) backToSignIn(callbackUrl, error.type);
    throw error;
  }
}

export async function signInWithApple(formData: FormData): Promise<void> {
  if (!hasAppleProvider) backToSignIn(await formCallbackUrl(formData));
  await oauthSignIn("apple", formData);
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!hasGoogleProvider) backToSignIn(await formCallbackUrl(formData));
  await oauthSignIn("google", formData);
}

export async function signInWithEmail(formData: FormData): Promise<void> {
  const callbackUrl = await formCallbackUrl(formData);
  if (!hasEmailProvider) backToSignIn(callbackUrl);
  const email = formValue(formData, "email").toLowerCase();
  if (!email || !email.includes("@")) {
    backToSignIn(callbackUrl, "EmailRequired");
  }
  try {
    await rememberEmailCheck(email, callbackUrl);
    // Lands on /signin/check (pages.verifyRequest) once the link is sent.
    await signIn("nodemailer", { email, redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) backToSignIn(callbackUrl, error.type);
    throw error;
  }
}

export async function signInWithDevLogin(formData: FormData): Promise<void> {
  const callbackUrl = await formCallbackUrl(formData);
  if (!devLoginEnabled) backToSignIn(callbackUrl);
  const email = formValue(formData, "email").toLowerCase();
  const name = formValue(formData, "name");
  if (!email) backToSignIn(callbackUrl, "CredentialsSignin");
  try {
    await signIn("dev-login", { email, name, redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) backToSignIn(callbackUrl, error.type);
    throw error;
  }
}
