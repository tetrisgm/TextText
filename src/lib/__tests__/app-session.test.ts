import { decode } from "@auth/core/jwt";
import { describe, expect, it } from "vitest";
import {
  appSessionCookieName,
  appSessionHasSyncScope,
  createAppSessionCookie,
  safeAppSessionNextPath,
} from "@/lib/app-session";

describe("app session exchange", () => {
  it("encodes an Auth.js session with the matching secure-cookie salt", async () => {
    const secret = "test-secret-that-is-long-enough-for-session-encryption";
    const cookie = await createAppSessionCookie(
      { sub: "apple-user", userId: "user-id" },
      { secure: true, secret },
    );
    const decoded = await decode({
      token: cookie.value,
      secret,
      salt: cookie.name,
    });

    expect(cookie.name).toBe("__Secure-authjs.session-token");
    expect(cookie.secure).toBe(true);
    expect(decoded).toMatchObject({
      sub: "apple-user",
      userId: "user-id",
    });
  });

  it("uses the development cookie name for an HTTP origin", () => {
    expect(appSessionCookieName(false)).toBe("authjs.session-token");
  });

  it("accepts only local absolute paths for the post-login destination", () => {
    expect(safeAppSessionNextPath("/t/workspace/post?edit=1")).toBe(
      "/t/workspace/post?edit=1",
    );
    for (const unsafe of [
      null,
      "",
      "https://attacker.example",
      "//attacker.example",
      "/\\attacker.example",
    ]) {
      expect(safeAppSessionNextPath(unsafe)).toBe("/start?to=home");
    }
  });

  it("requires the sync scope", () => {
    expect(appSessionHasSyncScope("sync")).toBe(true);
    expect(appSessionHasSyncScope("mcp sync comments")).toBe(true);
    expect(appSessionHasSyncScope("mcp comments")).toBe(false);
  });
});
