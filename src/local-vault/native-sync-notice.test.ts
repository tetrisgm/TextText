import { describe, expect, it } from "vitest";
import { nativeSyncNotice } from "./native-sync-notice";

const connected = { available: true, connected: true };
describe("native account sync notice", () => {
  it("shows attention for a signed-in workspace that is not online ready", () => {
    expect(nativeSyncNotice({ ...connected, onlineReady: false })).toEqual({ kind: "attention", message: "Sync needs attention. Your files are kept on this device." });
  });
  it("offers authentication guidance only for the actual authentication flag", () => {
    expect(nativeSyncNotice({ ...connected, onlineReady: false, authenticationRequired: true })?.kind).toBe("authentication");
    expect(nativeSyncNotice({ ...connected, onlineReady: false, message: "Unauthorized 401" })?.kind).toBe("attention");
    expect(nativeSyncNotice({ ...connected, onlineReady: false, authenticationRequired: "true" })?.kind).toBe("attention");
  });
  it("does not turn ordinary startup or missing legacy fields into a failure", () => {
    for (const value of [null, { ...connected }, { ...connected, connecting: true, onlineReady: false }, { ...connected, available: false, onlineReady: false }]) {
      expect(nativeSyncNotice(value)).toBeNull();
    }
  });
  it("clears stale messages on a ready connection but preserves conflict attention", () => {
    expect(nativeSyncNotice({ ...connected, onlineReady: true, message: "old problem" })).toBeNull();
    expect(nativeSyncNotice({ ...connected, onlineReady: true, hasConflicts: true })?.kind).toBe("attention");
  });
  it("preserves known actionable copy without exposing arbitrary native diagnostics", () => {
    const message = "Sync is paused. Restart TextText to reconnect.";
    expect(nativeSyncNotice({ ...connected, onlineReady: false, message })?.message).toBe(message);
    for (const raw of ["/Users/owner/private.textpack", "{\"token\":\"secret\"}", "Error: stack at /machine/path", "".padEnd(20_000, "x")]) {
      const notice = nativeSyncNotice({ ...connected, onlineReady: false, message: raw });
      expect(notice?.message).not.toContain(raw);
      expect(notice?.message).toContain("Your files are kept on this device.");
    }
  });
  it("keeps actual authentication and conflict status visible during reconnect", () => {
    expect(nativeSyncNotice({ ...connected, connecting: true, authenticationRequired: true })?.kind).toBe("authentication");
    expect(nativeSyncNotice({ ...connected, connecting: true, hasConflicts: true })?.kind).toBe("attention");
  });
});
