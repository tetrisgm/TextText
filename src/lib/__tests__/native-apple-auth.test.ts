import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { exchangeNativeAppleCode, verifyNativeAppleIdentity } from "../native-apple-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "apple-test-key", alg: "RS256", use: "sig" };
const nonce = "a".repeat(43);

function token(overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://appleid.apple.com",
    aud: "app.texttext.mac",
    sub: "apple-person-1",
    email: "person@example.com",
    nonce,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  })).toString("base64url");
  const payload = `${header}.${claims}`;
  return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
}

const keys: typeof fetch = async () => Response.json({ keys: [jwk] });

describe("native Apple identity verification", () => {
  it("accepts a signed token for this Mac app and nonce", async () => {
    expect(await verifyNativeAppleIdentity(token(), nonce, keys)).toEqual({
      sub: "apple-person-1", email: "person@example.com",
    });
  });

  it("rejects a token for the web client or a different request", async () => {
    expect(await verifyNativeAppleIdentity(token({ aud: "net.writeapp.write.web" }), nonce, keys)).toBeNull();
    expect(await verifyNativeAppleIdentity(token(), "other-request", keys)).toBeNull();
    expect(await verifyNativeAppleIdentity(token({ exp: 1 }), nonce, keys)).toBeNull();
  });

  it("rejects an altered signature", async () => {
    const parts = token().split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url");
    expect(await verifyNativeAppleIdentity(parts.join("."), nonce, keys)).toBeNull();
  });

  it("exchanges the one-use code under the native App ID", async () => {
    const signingKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    vi.stubEnv("AUTH_APPLE_TEAM_ID", "TEAM123456");
    vi.stubEnv("AUTH_APPLE_KEY_ID", "KEY1234567");
    vi.stubEnv("AUTH_APPLE_PRIVATE_KEY", signingKey.export({ format: "pem", type: "pkcs8" }).toString());
    try {
      const fetcher: typeof fetch = async (input, options) => {
        if (String(input).endsWith("/auth/keys")) return keys(input, options);
        expect(String(input)).toBe("https://appleid.apple.com/auth/token");
        const body = options?.body as URLSearchParams;
        expect(body.get("client_id")).toBe("app.texttext.mac");
        expect(body.get("code")).toBe("one-use-code");
        expect(body.get("grant_type")).toBe("authorization_code");
        return Response.json({ id_token: token() });
      };
      expect(await exchangeNativeAppleCode("one-use-code", nonce, fetcher)).toEqual({
        sub: "apple-person-1", email: "person@example.com",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
