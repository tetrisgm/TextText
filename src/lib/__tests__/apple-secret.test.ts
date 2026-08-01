import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { mintAppleClientSecret } from "@/lib/apple-secret";

function testKeyPair() {
  return crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("mintAppleClientSecret", () => {
  const { privateKey, publicKey } = testKeyPair();
  const pem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  const inputs = {
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    servicesId: "com.example.texttext.web",
    privateKeyPem: pem,
  };

  it("produces a JWT with Apple's required claims", () => {
    const jwt = mintAppleClientSecret(inputs);
    const [headerSeg, payloadSeg, signature] = jwt.split(".");
    expect(signature).toBeTruthy();

    const header = decodeSegment(headerSeg);
    expect(header).toMatchObject({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });

    const payload = decodeSegment(payloadSeg);
    expect(payload.iss).toBe("TEAM123456");
    expect(payload.sub).toBe("com.example.texttext.web");
    expect(payload.aud).toBe("https://appleid.apple.com");
    const iat = payload.iat as number;
    const exp = payload.exp as number;
    // Apple caps the lifetime at ~6 months; the mint uses exactly 180 days.
    expect(exp - iat).toBe(180 * 24 * 60 * 60);
  });

  it("signs with raw R||S ES256 that verifies against the public key", () => {
    const jwt = mintAppleClientSecret(inputs);
    const [headerSeg, payloadSeg, signature] = jwt.split(".");
    const valid = crypto.verify(
      "sha256",
      Buffer.from(`${headerSeg}.${payloadSeg}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(valid).toBe(true);
  });

  it("tolerates env-style escaped newlines in the key", () => {
    const escaped = pem.replace(/\n/g, "\\n");
    const jwt = mintAppleClientSecret({ ...inputs, privateKeyPem: escaped });
    expect(jwt.split(".")).toHaveLength(3);
  });
});
