import crypto from "node:crypto";
import type { NextAuthConfig } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initialize } = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock("next-auth", () => ({ default: initialize }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: null }));
vi.mock("@/lib/auth-email", () => ({
  createAuthAdapter: vi.fn(),
  sendTextTextVerificationRequest: vi.fn(),
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  initialize.mockReset().mockReturnValue({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
  process.env.AUTH_SECRET = "test-auth-secret";
  process.env.AUTH_APPLE_ID = "app.texttext.web";
  process.env.AUTH_APPLE_TEAM_ID = "test-team";
  process.env.AUTH_APPLE_KEY_ID = "test-key";
  delete process.env.AUTH_APPLE_SECRET;
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.AUTH_APPLE_PRIVATE_KEY = privateKey.export({
    type: "pkcs8", format: "pem",
  }) as string;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function appleSecret(config: NextAuthConfig): string | undefined {
  const provider = config.providers.find((entry) => typeof entry !== "function" && entry.id === "apple");
  if (!provider || typeof provider === "function" || provider.type !== "oidc") return undefined;
  return provider.options?.clientSecret;
}

describe("Apple credentials on a persistent auth server", () => {
  it("renews the client secret after six months without reloading the auth module", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const auth = await import("@/auth");
    expect(auth.hasAppleProvider).toBe(true);
    expect(auth.isAuthConfigured).toBe(true);
    const configure = initialize.mock.calls[0][0];
    expect(configure).toBeTypeOf("function");
    const initialSecret = appleSecret(configure());
    const initialPayload = JSON.parse(Buffer.from(initialSecret!.split(".")[1], "base64url").toString());

    vi.advanceTimersByTime(181 * 24 * 60 * 60 * 1000);
    const renewedSecret = appleSecret(configure());
    const renewedPayload = JSON.parse(Buffer.from(renewedSecret!.split(".")[1], "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    expect(initialPayload.exp).toBeLessThan(now);
    expect(renewedPayload.iat).toBe(now);
    expect(renewedPayload.exp).toBe(now + 180 * 24 * 60 * 60);
    expect(renewedSecret).not.toBe(initialSecret);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicit client secret override", async () => {
    process.env.AUTH_APPLE_SECRET = "explicit-secret";
    const auth = await import("@/auth");
    expect(auth.hasAppleProvider).toBe(true);
    expect(appleSecret(initialize.mock.calls[0][0]())).toBe("explicit-secret");
  });

  it("keeps malformed Apple credentials unavailable", async () => {
    process.env.AUTH_APPLE_PRIVATE_KEY = "malformed-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const auth = await import("@/auth");
    expect(auth.hasAppleProvider).toBe(false);
    expect(appleSecret(initialize.mock.calls[0][0]())).toBeUndefined();
  });
});
