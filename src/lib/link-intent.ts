import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed note that turns a sign-in into a linking.
 *
 * Connecting a second provider reuses the ordinary OAuth dance, and the jwt
 * callback needs a way to tell "this person is adding a way in" apart from
 * "this person is switching accounts", because the two are byte-identical on
 * the wire. The intent is this cookie: minted by a server action that verified
 * the live session, bound to that session's user id, short-lived, and signed
 * so the browser cannot editorialise.
 *
 * The cookie alone is not sufficient to link. The jwt callback also requires
 * the surviving session token to name the same user, so a cookie left behind
 * on a shared machine cannot attach a stranger's sign-in to the previous
 * person's account: after a sign-out there is no session token to match.
 */

const LINK_INTENT_VERSION = "v1";

export const LINK_INTENT_COOKIE = "texttext-link-intent";
export const LINK_INTENT_MAX_AGE_SECONDS = 5 * 60;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function mintLinkIntent(
  userId: string,
  secret: string,
  now: number = Date.now(),
): string {
  const expires = Math.floor(now / 1000) + LINK_INTENT_MAX_AGE_SECONDS;
  const payload = `${LINK_INTENT_VERSION}.${userId}.${expires}`;
  return `${payload}.${signature(payload, secret)}`;
}

/** The user id the intent was minted for, or null for anything else at all. */
export function verifyLinkIntent(
  value: string | undefined,
  secret: string,
  now: number = Date.now(),
): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, userId, expiresRaw, provided] = parts;
  if (version !== LINK_INTENT_VERSION || !userId) return null;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires * 1000 < now) return null;
  const expected = signature(`${version}.${userId}.${expiresRaw}`, secret);
  if (provided.length !== expected.length) return null;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
      ? userId
      : null;
  } catch {
    return null;
  }
}
