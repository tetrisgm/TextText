// The open-redirect guard for /signin. Two contracts under test:
// 1. Relative paths survive; anything that could leave our origin does not.
// 2. Auth.js absolutizes every callbackUrl against its own origin before
//    redirecting to pages.signIn (default redirect callback in @auth/core),
//    so same-host absolute URLs must reduce to their relative path or the
//    device-link approval hand-off (/connect/link) breaks.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALLBACK_URL,
  sanitizeCallbackUrl,
} from "@/app/signin/callback-url";

const HOST = "localhost:3000";

describe("sanitizeCallbackUrl: relative paths", () => {
  it("passes clean relative paths through", () => {
    expect(sanitizeCallbackUrl("/connect")).toBe("/connect");
    expect(sanitizeCallbackUrl("/connect/link?code=ABCD-1234")).toBe(
      "/connect/link?code=ABCD-1234",
    );
  });

  it("falls back to the default for missing values", () => {
    expect(sanitizeCallbackUrl(undefined)).toBe(DEFAULT_CALLBACK_URL);
    expect(sanitizeCallbackUrl(null)).toBe(DEFAULT_CALLBACK_URL);
    expect(sanitizeCallbackUrl("")).toBe(DEFAULT_CALLBACK_URL);
  });

  it("uses the first value of a repeated query param", () => {
    expect(sanitizeCallbackUrl(["/connect", "/other"])).toBe("/connect");
  });

  it("rejects protocol-relative and backslash escapes", () => {
    expect(sanitizeCallbackUrl("//evil.example")).toBe(DEFAULT_CALLBACK_URL);
    expect(sanitizeCallbackUrl("/\\evil.example")).toBe(DEFAULT_CALLBACK_URL);
    expect(sanitizeCallbackUrl("\\\\evil.example")).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects non-path garbage", () => {
    expect(sanitizeCallbackUrl("javascript:alert(1)")).toBe(
      DEFAULT_CALLBACK_URL,
    );
    expect(sanitizeCallbackUrl("connect")).toBe(DEFAULT_CALLBACK_URL);
  });
});

describe("sanitizeCallbackUrl: absolute URLs (the Auth.js round trip)", () => {
  it("reduces a same-host absolute URL to its relative path", () => {
    expect(
      sanitizeCallbackUrl(
        "http://localhost:3000/connect/link?code=ABCD-1234",
        HOST,
      ),
    ).toBe("/connect/link?code=ABCD-1234");
  });

  it("keeps query and hash, discards the origin", () => {
    expect(
      sanitizeCallbackUrl("http://localhost:3000/start?to=home#top", HOST),
    ).toBe("/start?to=home#top");
  });

  it("accepts scheme and host case-insensitively", () => {
    expect(sanitizeCallbackUrl("HTTP://LOCALHOST:3000/connect", HOST)).toBe(
      "/connect",
    );
  });

  it("rejects absolute URLs on any other host", () => {
    expect(sanitizeCallbackUrl("https://evil.example/phish", HOST)).toBe(
      DEFAULT_CALLBACK_URL,
    );
    expect(
      sanitizeCallbackUrl("https://localhost:3000.evil.example/x", HOST),
    ).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects the userinfo trick (our host before an @)", () => {
    expect(
      sanitizeCallbackUrl("http://localhost:3000@evil.example/x", HOST),
    ).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects a same-host URL whose path is protocol-relative", () => {
    expect(
      sanitizeCallbackUrl("http://localhost:3000//evil.example", HOST),
    ).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects every absolute URL when the request host is unknown", () => {
    expect(sanitizeCallbackUrl("http://localhost:3000/connect")).toBe(
      DEFAULT_CALLBACK_URL,
    );
  });
});
