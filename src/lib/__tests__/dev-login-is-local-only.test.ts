// The real ways in are Apple, Google and an emailed link. The developer login
// is not one of them and must never appear beside them.
//
// It used to be guarded only by configuration: an env var plus a Vercel-
// specific check. Configuration is a habit, and the Vercel check does nothing
// anywhere else. A dev login is for local development, so the host it was
// served on is enough on its own to disqualify it.

import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "@/lib/loopback-host";

describe("the developer login is local-only", () => {
  it("accepts the hosts a developer's own machine answers on", () => {
    for (const host of [
      "localhost",
      "localhost:3000",
      "127.0.0.1",
      "127.0.0.1:3000",
      "::1",
      "[::1]:3000",
      "app.localhost:3000",
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("refuses anything served to the public", () => {
    for (const host of [
      "texttext.app",
      "www.texttext.app",
      "texttext-git-branch.vercel.app",
      "192.168.1.68:3000",
      "notlocalhost.com",
      "localhost.example.com",
      "",
      null,
      undefined,
    ]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});
