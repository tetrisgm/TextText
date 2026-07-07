// Sign in with Apple "client secret" minting, at runtime. Apple has no static
// secret: the durable credential is the .p8 private key, and the secret is a
// short-lived ES256 JWT signed with it (Apple caps each at 6 months). Normal
// production apps sign these automatically from the stored key so nothing
// ever expires by surprise; this module does that. Every server cold start
// mints a fresh secret, so a deployment can never outlive one.
//
// Env (all four required to enable this path):
//   AUTH_APPLE_ID           the Services ID (the OAuth client_id)
//   AUTH_APPLE_TEAM_ID      10-char Team ID
//   AUTH_APPLE_KEY_ID       10-char Key ID of the Sign in with Apple key
//   AUTH_APPLE_PRIVATE_KEY  the .p8 file CONTENTS (BEGIN/END PRIVATE KEY block;
//                           literal \n sequences are tolerated)
//
// A manually minted AUTH_APPLE_SECRET still works and takes precedence, for
// anyone preferring the scripts/apple-client-secret.mjs path.

import crypto from "node:crypto";

const SECRET_TTL_DAYS = 180; // Apple's maximum

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

/** The .p8 as pasted into an env var, with escaped newlines tolerated. */
function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function mintAppleClientSecret({
  teamId,
  keyId,
  servicesId,
  privateKeyPem,
}: {
  teamId: string;
  keyId: string;
  servicesId: string;
  privateKeyPem: string;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: teamId,
    iat: nowSeconds,
    exp: nowSeconds + SECRET_TTL_DAYS * 24 * 60 * 60,
    aud: "https://appleid.apple.com",
    sub: servicesId,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const privateKey = crypto.createPrivateKey(
    normalizePrivateKey(privateKeyPem),
  );
  // ES256 for JWS requires the raw R||S signature (IEEE P-1363), not DER.
  const signature = crypto
    .sign("sha256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    })
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

/**
 * The Apple client secret for this process: an explicit AUTH_APPLE_SECRET
 * wins; otherwise, when the key material is present, a fresh secret is
 * signed once per cold start. Returns undefined when Apple is not
 * configured (the provider then stays off).
 */
export function resolveAppleClientSecret(): string | undefined {
  const explicit = process.env.AUTH_APPLE_SECRET;
  if (explicit) return explicit;

  const servicesId = process.env.AUTH_APPLE_ID;
  const teamId = process.env.AUTH_APPLE_TEAM_ID;
  const keyId = process.env.AUTH_APPLE_KEY_ID;
  const privateKeyPem = process.env.AUTH_APPLE_PRIVATE_KEY;
  if (!servicesId || !teamId || !keyId || !privateKeyPem) return undefined;

  try {
    return mintAppleClientSecret({ teamId, keyId, servicesId, privateKeyPem });
  } catch (error) {
    // A malformed key must not take the whole auth config down; Apple simply
    // stays unconfigured and the other providers keep working.
    console.error("Sign in with Apple: could not sign the client secret", error);
    return undefined;
  }
}
