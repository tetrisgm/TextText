import { describe, expect, it } from "vitest";
import { nativeDeviceAuthorization, resolveNativeAiConnection } from "../connection-state";

describe("native device authorization display", () => {
  const pending = { phase: "authorizing" as const, verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" };
  it("shows only the fixed provider page during active authorization", () => {
    expect(nativeDeviceAuthorization(pending)).toEqual({ url: pending.verificationUrl, code: pending.userCode });
    expect(nativeDeviceAuthorization({ ...pending, phase: "checking" })).toBeNull();
  });
  it.each(["https://auth.openai.com/codex/device?token=secret", "https://auth.openai.com/other", "https://auth.openai.com.evil.test/codex/device", "javascript:alert(1)"])("rejects unexpected authorization URL %s", (verificationUrl) => {
    expect(nativeDeviceAuthorization({ ...pending, verificationUrl })).toBeNull();
  });
  it("rejects unbounded or secret-looking device codes", () => {
    expect(nativeDeviceAuthorization({ ...pending, userCode: "sk-private" })).toBeNull();
    expect(nativeDeviceAuthorization({ ...pending, userCode: "A".repeat(33) })).toBeNull();
  });
});

describe("resolveNativeAiConnection", () => {
  it("keeps embedded ChatGPT unavailable in a browser", () => {
    const snapshot = resolveNativeAiConnection({ surface: "web", runtimeAvailable: false });
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.embeddedChatSupported).toBe(false);
  });

  it("offers connection when the Mac runtime is present but signed out", () => {
    const snapshot = resolveNativeAiConnection({ surface: "mac", runtimeAvailable: true });
    expect(snapshot.state).toBe("signed-out");
    expect(snapshot.recoveryAction).toBe("connect");
  });

  it("reports a ready ChatGPT account and preserves plan metadata", () => {
    const snapshot = resolveNativeAiConnection({
      surface: "mac",
      runtimeAvailable: true,
      runtimeVersion: "0.144.1",
      account: { email: "writer@example.com", planType: "pro" },
      lastHealthCheckAt: 123,
    });
    expect(snapshot.state).toBe("ready");
    expect(snapshot.accountEmail).toBe("writer@example.com");
    expect(snapshot.planLabel).toBe("pro");
    expect(snapshot.runtimeVersion).toBe("0.144.1");
  });

  it("does not call account authentication proof of generation", () => {
    expect(resolveNativeAiConnection({ surface: "mac", runtimeAvailable: true, account: { email: "writer@example.com" } }).state).toBe("unverified");
  });

  it("maps runtime and rate-limit failures to recoverable states", () => {
    expect(
      resolveNativeAiConnection({ surface: "mac", runtimeAvailable: false, error: "runtime-missing" }).recoveryAction,
    ).toBe("install-runtime");
    expect(
      resolveNativeAiConnection({ surface: "mac", runtimeAvailable: true, rateLimitReached: true }).state,
    ).toBe("rate-limited");
  });
});
