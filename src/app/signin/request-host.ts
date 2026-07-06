// The host Auth.js itself treats as its origin, mirrored here so
// sanitizeCallbackUrl accepts absolutized callback URLs for exactly this
// host and nothing else. Same derivation order as @auth/core's
// createActionURL: the AUTH_URL/NEXTAUTH_URL override first, then the
// proxy-aware request headers.

import { headers } from "next/headers";

export async function authRequestHost(): Promise<string | null> {
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (envUrl) {
    try {
      return new URL(envUrl).host;
    } catch {
      // Malformed override; fall through to the request headers.
    }
  }
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  );
}
