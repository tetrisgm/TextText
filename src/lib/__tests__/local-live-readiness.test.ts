import { describe, expect, it } from "vitest";
import {
  formatLocalLiveReadiness,
  isLocalLiveServerReady,
  localLiveReadinessPaths,
} from "../../../scripts/local-live-readiness";

describe("local live server readiness", () => {
  it("accepts the public page and OAuth discovery surfaces", () => {
    expect(
      isLocalLiveServerReady([
        { path: "/signin", status: 200 },
        { path: "/.well-known/oauth-authorization-server", status: 200 },
      ]),
    ).toBe(true);
  });

  it("rejects missing, failed, and server-error probes", () => {
    expect(
      isLocalLiveServerReady([
        { path: "/signin", status: 200 },
        { path: "/.well-known/oauth-authorization-server", status: 404 },
      ]),
    ).toBe(false);
    expect(
      isLocalLiveServerReady([
        { path: "/signin", status: 200 },
        { path: "/.well-known/oauth-authorization-server", status: "error" },
      ]),
    ).toBe(false);
    expect(
      isLocalLiveServerReady([
        { path: "/signin", status: 503 },
        { path: "/.well-known/oauth-authorization-server", status: 200 },
      ]),
    ).toBe(false);
  });

  it("does not use authenticated content routes as health probes", () => {
    expect(localLiveReadinessPaths).not.toContain("/api/sync/v1/files");
  });

  it("formats the last probe state for release diagnostics", () => {
    expect(
      formatLocalLiveReadiness([
        { path: "/signin", status: 200 },
        { path: "/.well-known/oauth-authorization-server", status: 404 },
      ]),
    ).toBe(
      "/signin=200, /.well-known/oauth-authorization-server=404",
    );
  });
});
