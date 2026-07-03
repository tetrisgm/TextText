#!/usr/bin/env node
// Mint the Apple "client secret" JWT for Sign in with Apple (AUTH_APPLE_SECRET).
// Zero dependencies (Node built-in crypto). Apple caps the lifetime at 6 months,
// so this secret expires and must be regenerated (a cron or a calendar reminder).
//
// Inputs (flags or env):
//   --team-id      APPLE_TEAM_ID    10-char Team ID (Membership details)
//   --key-id       APPLE_KEY_ID     10-char Key ID of the Sign in with Apple key
//   --services-id  AUTH_APPLE_ID    the Services ID identifier (the OAuth client_id)
//   --p8           APPLE_P8_PATH    path to the downloaded AuthKey_XXXX.p8
//   --days         (optional)       lifetime in days, 1..180 (default 180)
//
// Usage:
//   node scripts/apple-client-secret.mjs \
//     --team-id ABCDE12345 --key-id KEY1234567 \
//     --services-id net.ramine.write.signin --p8 ./AuthKey_KEY1234567.p8
//
// Prints the JWT to stdout. Set it as AUTH_APPLE_SECRET (locally in .env.local,
// in production on the Vercel project). Never commit the .p8 or the JWT.

import { readFileSync } from "node:fs";
import crypto from "node:crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const teamId = arg("team-id", process.env.APPLE_TEAM_ID);
const keyId = arg("key-id", process.env.APPLE_KEY_ID);
const servicesId = arg("services-id", process.env.AUTH_APPLE_ID);
const p8Path = arg("p8", process.env.APPLE_P8_PATH);
const days = Number(arg("days", "180"));

if (!teamId || !keyId || !servicesId || !p8Path) {
  console.error(
    "Missing input. Need --team-id, --key-id, --services-id, and --p8 (path to AuthKey_*.p8).",
  );
  process.exit(1);
}
if (!(days > 0 && days <= 180)) {
  console.error("Apple caps the secret lifetime at ~6 months; use --days between 1 and 180.");
  process.exit(1);
}

const b64url = (input) => Buffer.from(input).toString("base64url");

const nowSeconds = Math.floor(Date.now() / 1000);
const header = { alg: "ES256", kid: keyId, typ: "JWT" };
const payload = {
  iss: teamId,
  iat: nowSeconds,
  exp: nowSeconds + days * 24 * 60 * 60,
  aud: "https://appleid.apple.com",
  sub: servicesId,
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

let privateKey;
try {
  privateKey = crypto.createPrivateKey(readFileSync(p8Path, "utf8"));
} catch (error) {
  console.error(`Could not read the .p8 private key at ${p8Path}: ${error.message}`);
  process.exit(1);
}

// ES256 for JWS requires the raw R||S signature (IEEE P-1363), not DER.
const signature = crypto
  .sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  })
  .toString("base64url");

process.stdout.write(`${signingInput}.${signature}\n`);
