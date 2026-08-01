import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mintAppleClientSecret,
  resolveAppleClientSecret,
} from "@/lib/apple-secret";
import {
  emailSub,
  verificationHtml,
  verificationText,
} from "@/lib/auth-email";

const ORIGINAL_ENV = { ...process.env };

function decodePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("production authentication", () => {
  it("mints a valid six-month Apple ES256 client secret", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const token = mintAppleClientSecret({
      teamId: "52WM463HR2",
      keyId: "J6958HV8HB",
      servicesId: "app.texttext.web",
      privateKeyPem: privateKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string,
    });
    const [encodedHeader, encodedPayload, signature] = token.split(".");
    const header = decodePart<{ alg: string; kid: string; typ: string }>(
      encodedHeader,
    );
    const payload = decodePart<{
      iss: string;
      iat: number;
      exp: number;
      aud: string;
      sub: string;
    }>(encodedPayload);

    expect(header).toEqual({
      alg: "ES256",
      kid: "J6958HV8HB",
      typ: "JWT",
    });
    expect(payload).toMatchObject({
      iss: "52WM463HR2",
      aud: "https://appleid.apple.com",
      sub: "app.texttext.web",
    });
    expect(payload.exp - payload.iat).toBe(180 * 24 * 60 * 60);
    expect(
      crypto.verify(
        "sha256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        {
          key: publicKey,
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("prefers an explicit Apple secret and safely rejects malformed key material", () => {
    process.env.AUTH_APPLE_SECRET = "explicit-secret";
    expect(resolveAppleClientSecret()).toBe("explicit-secret");

    delete process.env.AUTH_APPLE_SECRET;
    process.env.AUTH_APPLE_ID = "app.texttext.web";
    process.env.AUTH_APPLE_TEAM_ID = "52WM463HR2";
    process.env.AUTH_APPLE_KEY_ID = "J6958HV8HB";
    process.env.AUTH_APPLE_PRIVATE_KEY = "not-a-private-key";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(resolveAppleClientSecret()).toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });

  it("keeps email identities stable and magic links TextText-only", () => {
    const url =
      "https://TextText.app/api/auth/callback/nodemailer?token=a%26b";
    const text = verificationText(url);
    const html = verificationHtml(url);

    expect(emailSub("  Person@Example.COM ")).toBe(
      "email:person@example.com",
    );
    expect(text).toContain("Sign in to TextText");
    expect(text).toContain(url);
    expect(html).toContain("Sign in to TextText");
    expect(html).toContain(
      "https://TextText.app/api/auth/callback/nodemailer?token=a%26b",
    );
    const legacyHost = ["ramine", "net"].join(".");
    expect(html).not.toContain(legacyHost);
    expect(text).not.toContain(legacyHost);
  });
});
