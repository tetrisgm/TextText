import { describe, expect, it } from "vitest";
import { resolveNativeAiConnection } from "../connection-state";

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

  it("maps runtime and rate-limit failures to recoverable states", () => {
    expect(
      resolveNativeAiConnection({ surface: "mac", runtimeAvailable: false, error: "runtime-missing" }).recoveryAction,
    ).toBe("install-runtime");
    expect(
      resolveNativeAiConnection({ surface: "mac", runtimeAvailable: true, rateLimitReached: true }).state,
    ).toBe("rate-limited");
  });
});
