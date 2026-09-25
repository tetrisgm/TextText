import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPublicOrigin } from "@/lib/request-origin";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_URL", "https://texttext.app");
  vi.stubEnv("TEXTTEXT_PRODUCT_ORIGIN", "");
  vi.stubEnv("NEXTAUTH_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("public origins behind the standalone listener", () => {
  it.each(["http://localhost:3400", "https://localhost:3400", "http://127.0.0.1:3400"])(
    "resolves %s to the configured public origin",
    (internal) => {
      expect(requestPublicOrigin(new Request(`${internal}/start`, {
        headers: { host: "texttext.app", "x-forwarded-proto": "http" },
      }))).toBe("https://texttext.app");
      expect(requestPublicOrigin(new Request(`${internal}/start`))).toBe("https://texttext.app");
    },
  );

  it("keeps workspace subdomains within the configured host boundary", () => {
    expect(requestPublicOrigin(new Request("https://localhost:3400/icon", {
      headers: { host: "alice.texttext.app" },
    }))).toBe("https://alice.texttext.app");
    expect(requestPublicOrigin(new Request("https://alice.texttext.app/icon")))
      .toBe("https://alice.texttext.app");
    expect(requestPublicOrigin(new Request("http://localhost:3400/icon", {
      headers: { host: "localhost:3400", "x-forwarded-host": "alice.texttext.app" },
    }))).toBe("https://alice.texttext.app");
  });

  it.each([
    "evil.example", "texttext.app.evil.example", "nested.alice.texttext.app",
    "texttext.app:444", "texttext.app@evil.example", "texttext.app/evil",
    "texttext.app, evil.example", "texttext.app\\evil", "texttext.app?evil",
  ])("does not trust injected host %s", (host) => {
    for (const header of ["host", "x-forwarded-host"]) {
      expect(requestPublicOrigin(new Request("http://localhost:3400/start", {
        headers: { [header]: host, "x-forwarded-proto": "javascript" },
      }))).toBe("https://texttext.app");
    }
  });

  it("does not let forwarded headers replace a valid visible host", () => {
    expect(requestPublicOrigin(new Request("http://localhost:3400/start", {
      headers: { host: "texttext.app", "x-forwarded-host": "alice.texttext.app" },
    }))).toBe("https://texttext.app");
  });

  it("preserves loopback development, including local workspace subdomains", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const origin of ["http://localhost:3100", "http://alice.localhost:3100", "http://[::1]:3100"]) {
      expect(requestPublicOrigin(new Request(`${origin}/start`))).toBe(origin);
    }
  });

  it("uses a validated product origin when the auth override is invalid", () => {
    vi.stubEnv("AUTH_URL", "https://user:password@evil.example");
    vi.stubEnv("TEXTTEXT_PRODUCT_ORIGIN", "https://notes.example");
    expect(requestPublicOrigin(new Request("https://localhost:3400/start"))).toBe("https://notes.example");
  });
});
