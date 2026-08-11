// The link intent is what lets one OAuth flow mean "add this provider to my
// account" instead of "sign me in as whoever this is". It is one half of the
// guard (the session token is the other), so its edges have to hold on their
// own: it must be unforgeable, bound to one user, and expire.

import { describe, expect, it } from "vitest";
import {
  mintLinkIntent,
  verifyLinkIntent,
  LINK_INTENT_MAX_AGE_SECONDS,
} from "@/lib/link-intent";

const SECRET = "test-secret-value";
const NOW = 1_800_000_000_000;

describe("link intent", () => {
  it("verifies a fresh intent back to its user", () => {
    const token = mintLinkIntent("user-1", SECRET, NOW);
    expect(verifyLinkIntent(token, SECRET, NOW)).toBe("user-1");
  });

  it("rejects a wrong secret", () => {
    const token = mintLinkIntent("user-1", SECRET, NOW);
    expect(verifyLinkIntent(token, "other-secret", NOW)).toBeNull();
  });

  it("rejects a tampered user id", () => {
    const token = mintLinkIntent("user-1", SECRET, NOW);
    const forged = token.replace("user-1", "user-2");
    expect(verifyLinkIntent(forged, SECRET, NOW)).toBeNull();
  });

  it("rejects after expiry", () => {
    const token = mintLinkIntent("user-1", SECRET, NOW);
    const later = NOW + (LINK_INTENT_MAX_AGE_SECONDS + 1) * 1000;
    expect(verifyLinkIntent(token, SECRET, later)).toBeNull();
  });

  it("still holds just before expiry", () => {
    const token = mintLinkIntent("user-1", SECRET, NOW);
    const later = NOW + (LINK_INTENT_MAX_AGE_SECONDS - 1) * 1000;
    expect(verifyLinkIntent(token, SECRET, later)).toBe("user-1");
  });

  it("rejects junk and empty", () => {
    for (const value of [undefined, "", "a.b.c", "v1.user.notanumber.sig", "x"]) {
      expect(verifyLinkIntent(value as string | undefined, SECRET, NOW)).toBeNull();
    }
  });

  it("does not confuse two users", () => {
    const a = mintLinkIntent("alice", SECRET, NOW);
    expect(verifyLinkIntent(a, SECRET, NOW)).toBe("alice");
    expect(verifyLinkIntent(a, SECRET, NOW)).not.toBe("bob");
  });
});
