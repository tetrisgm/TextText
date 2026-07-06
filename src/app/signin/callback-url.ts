// Where sign-in lands afterwards. The device-link approval flow
// (/connect/link) depends on the callback surviving the round trip, so this
// is validated, not trusted, and /signin never acts as an open redirect.
//
// Two shapes are accepted, both reduced to a same-origin relative path:
// - Relative paths ("/connect/link?code=..."), from our own forms and links.
// - Absolute http(s) URLs on OUR OWN host, because Auth.js absolutizes every
//   callbackUrl against its origin before redirecting to pages.signIn (the
//   default redirect callback in @auth/core/lib/init.js turns "/connect"
//   into "http://host/connect", so every /api/auth/signin entry arrives
//   here absolutized). Only the path + query + hash survive; an absolute
//   URL on any other host falls back to the default.

export const DEFAULT_CALLBACK_URL = "/start?to=home";

export function sanitizeCallbackUrl(
  raw: string | string[] | undefined | null,
  requestHost?: string | null,
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return DEFAULT_CALLBACK_URL;
  let candidate = value;
  if (/^https?:\/\//i.test(candidate)) {
    if (!requestHost) return DEFAULT_CALLBACK_URL;
    try {
      const parsed = new URL(candidate);
      if (parsed.host !== requestHost) return DEFAULT_CALLBACK_URL;
      candidate = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return DEFAULT_CALLBACK_URL;
    }
  }
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return DEFAULT_CALLBACK_URL;
  }
  return candidate;
}
