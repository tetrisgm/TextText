import { createPublicKey, verify } from "node:crypto";
import { mintAppleClientSecret } from "./apple-secret";

const APP_ID = "app.texttext.mac";
const APPLE_ISSUER = "https://appleid.apple.com";
const MAX_CLOCK_SKEW_SECONDS = 300;

type AppleIdentity = { sub: string; email?: string };

function decodeSegment(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Only an Apple-signed, current token for the Mac App ID identifies a user. */
export async function verifyNativeAppleIdentity(
  identityToken: string,
  nonce: string,
  fetcher: typeof fetch = fetch,
): Promise<AppleIdentity | null> {
  const parts = identityToken.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const header = record(decodeSegment(parts[0]));
    if (header?.alg !== "RS256" || typeof header.kid !== "string") return null;
    const keyResponse = await fetcher("https://appleid.apple.com/auth/keys", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!keyResponse.ok) return null;
    const keySet = record(await keyResponse.json());
    const keys = Array.isArray(keySet?.keys) ? keySet.keys : [];
    const jwk = keys.map(record).find((key) =>
      key !== null && key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256" &&
      key.use === "sig" && typeof key.n === "string" && typeof key.e === "string"
    );
    if (!jwk) return null;
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!verify("RSA-SHA256", signed, publicKey, Buffer.from(parts[2], "base64url"))) {
      return null;
    }
    const claims = record(decodeSegment(parts[1]));
    const now = Math.floor(Date.now() / 1000);
    if (!claims || claims.iss !== APPLE_ISSUER || claims.aud !== APP_ID ||
        claims.nonce !== nonce || typeof claims.sub !== "string" || !claims.sub ||
        typeof claims.exp !== "number" || claims.exp <= now ||
        typeof claims.iat !== "number" || claims.iat > now + MAX_CLOCK_SKEW_SECONDS) {
      return null;
    }
    return {
      sub: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
    };
  } catch {
    return null;
  }
}

/** Exchange Apple's one-use native authorization code before issuing our token. */
export async function exchangeNativeAppleCode(
  code: string,
  nonce: string,
  fetcher: typeof fetch = fetch,
): Promise<AppleIdentity | null> {
  const teamId = process.env.AUTH_APPLE_TEAM_ID;
  const keyId = process.env.AUTH_APPLE_KEY_ID;
  const privateKeyPem = process.env.AUTH_APPLE_PRIVATE_KEY;
  if (!teamId || !keyId || !privateKeyPem) return null;
  try {
    const clientSecret = mintAppleClientSecret({
      teamId, keyId, servicesId: APP_ID, privateKeyPem,
    });
    const response = await fetcher("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: APP_ID,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = record(await response.json());
    if (typeof body?.id_token !== "string") return null;
    return verifyNativeAppleIdentity(body.id_token, nonce, fetcher);
  } catch {
    return null;
  }
}
