// One way to keep a third-party secret in our own database.
//
// AES-256-GCM with a key derived from the server secret. Two things store
// secrets this way: the workspace's AI provider key, and the bearer token for
// an outbound MCP connection. They shared an implementation by copy once; this
// is that implementation, owned in one place, so a fix to the format reaches
// both.
//
// Server-only: imports node:crypto. Never import from a client component.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

const CIPHER_VERSION = "v1";
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const secret =
    process.env.AI_CONFIG_ENCRYPTION_KEY ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("Secret storage needs a server encryption secret.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(":");
  if (
    version !== CIPHER_VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra !== undefined
  ) {
    throw new Error("The stored secret could not be read.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Bind protected configuration into durable metadata without storing a token
 * or a reusable unsalted verifier. The purpose label prevents a fingerprint
 * created for one subsystem from being meaningful in another.
 */
export function fingerprintProtectedValue(
  purpose: string,
  value: string,
): string {
  return createHmac("sha256", encryptionKey())
    .update(purpose, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}
