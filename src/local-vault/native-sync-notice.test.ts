import { describe, expect, it } from "vitest";
import { nativeSyncNotice } from "./native-sync-notice";

const connected = { available: true, connected: true };
it("keeps scoped catalog warnings visible without exposing native paths or overriding authentication", () => {
  const catalogIssues = [{ path: "Private folder ", reason: "nonportable-name" }];
  for (const state of [{ onlineReady: true }, { connecting: true }, { onlineReady: false }]) {
    const notice = nativeSyncNotice({ ...connected, ...state, catalogIssues });
    expect(notice?.message).toBe("Some folders need attention. Their files are held. Review unsupported folder names on the web.");
  }
  expect(nativeSyncNotice({ ...connected, catalogIssues, authenticationRequired: true })?.kind).toBe("authentication");
  const message = "Some documents have conflicting changes. Both copies are retained.";
  expect(nativeSyncNotice({ ...connected, catalogIssues, hasConflicts: true, message })?.message).toBe(message);
  expect(nativeSyncNotice({ ...connected, catalogIssues })?.folders).toEqual(['"Private folder "']);
  const many = Array.from({length: 50}, () => ({reason:"nonportable-name",path:"x".repeat(1000)+"\n"}));
  const folders = nativeSyncNotice({ ...connected, catalogIssues:many })?.folders;
  expect(folders).toHaveLength(3);
  expect(folders?.every(folder=>folder.length <= 162)).toBe(true);
  for (const catalogIssues of [[], [{reason:"unknown"}], "invalid", [{reason:"nonportable-name",path:7}]]) {
    expect(nativeSyncNotice({ ...connected, onlineReady:true, catalogIssues })).toBeNull();
  }
});
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

it("preserves the specific retained document conflict while remote contact is healthy", () => {
 const message = "Some documents have conflicting changes. Both copies are retained.";
 expect(nativeSyncNotice({ ...connected, onlineReady: false, hasConflicts: true, remoteManifestResponses: 3, message })).toEqual({kind:"attention",message});
 expect(nativeSyncNotice({ ...connected, onlineReady: true, hasConflicts: true, message })?.message).toBe(message);
});
