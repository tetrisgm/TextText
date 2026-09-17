import { describe, expect, it } from "vitest";
import { mintInstallState, verifyInstallState } from "../install-state";

const secret = "test-secret";
const now = Date.UTC(2026, 8, 17, 12, 0, 0);

describe("github install state", () => {
  it("round-trips the user, workspace, and a missing installation", () => {
    const value = mintInstallState({ userId: "u1", blogId: "b1", installationId: null }, secret, now);
    expect(verifyInstallState(value, secret, now)).toEqual({ userId: "u1", blogId: "b1", installationId: null });
  });

  it("round-trips an installation id once the setup step adds it", () => {
    const value = mintInstallState({ userId: "u1", blogId: "b1", installationId: 4242 }, secret, now);
    expect(verifyInstallState(value, secret, now)?.installationId).toBe(4242);
  });

  it("expires after ten minutes", () => {
    const value = mintInstallState({ userId: "u1", blogId: "b1", installationId: null }, secret, now);
    expect(verifyInstallState(value, secret, now + 9 * 60_000)).not.toBeNull();
    expect(verifyInstallState(value, secret, now + 11 * 60_000)).toBeNull();
  });

  it("refuses a tampered payload, the wrong secret, and junk", () => {
    const value = mintInstallState({ userId: "u1", blogId: "b1", installationId: 7 }, secret, now);
    const swapped = value.replace(".7.", ".8.");
    expect(verifyInstallState(swapped, secret, now)).toBeNull();
    expect(verifyInstallState(value, "other", now)).toBeNull();
    expect(verifyInstallState("v1.u1.b1.x.1.abc", secret, now)).toBeNull();
    expect(verifyInstallState(undefined, secret, now)).toBeNull();
    expect(verifyInstallState("", secret, now)).toBeNull();
  });
});
