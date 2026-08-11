// This route hands the app a secret that mints an API token, so its edges are
// security, not ergonomics: the callback target must never be steerable, an
// unusable state must not reach the database, and signed out must mean sign in
// rather than a token.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  startDeviceLink: vi.fn(),
  approveDeviceLink: vi.fn(),
  cleanAppName: vi.fn((value: unknown) => (typeof value === "string" ? value : "A device")),
  getUserIdBySub: vi.fn(),
  recordAction: vi.fn(),
  resolveOwnedWorkspace: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/device-link", () => ({
  startDeviceLink: mocks.startDeviceLink,
  approveDeviceLink: mocks.approveDeviceLink,
  cleanAppName: mocks.cleanAppName,
}));
vi.mock("@/lib/store", () => ({ getUserIdBySub: mocks.getUserIdBySub }));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/workspace", () => ({
  resolveOwnedWorkspace: mocks.resolveOwnedWorkspace,
}));

const { GET } = await import("@/app/connect/app/native/route");

const STATE = "s0Zx8Kq1LmNpQrTuVwXy";

function get(query: string): Request {
  return new Request(`http://localhost/connect/app/native${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "apple:123" });
  mocks.getUserIdBySub.mockResolvedValue("user-1");
  mocks.resolveOwnedWorkspace.mockResolvedValue(undefined);
  mocks.recordAction.mockResolvedValue(undefined);
  mocks.startDeviceLink.mockResolvedValue({
    code: "ABCD-EFGH",
    pollToken: "poll-secret",
    expiresAt: new Date(Date.now() + 60_000),
  });
  mocks.approveDeviceLink.mockResolvedValue(true);
});

describe("native auth callback", () => {
  it("sends the secret to the app's own scheme", async () => {
    const response = await GET(get(`?state=${STATE}`));
    const location = new URL(response.headers.get("Location") ?? "");
    expect(response.status).toBe(303);
    expect(location.protocol).toBe("texttext-app:");
    expect(location.searchParams.get("code")).toBe("poll-secret");
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("ignores a redirect_uri, however it is spelled", async () => {
    for (const attempt of [
      "&redirect_uri=https://evil.example/steal",
      "&redirectUri=https://evil.example/steal",
      "&callback=https://evil.example/steal",
      "&redirect_uri=texttext-app://auth@evil.example",
    ]) {
      const response = await GET(get(`?state=${STATE}${attempt}`));
      const location = response.headers.get("Location") ?? "";
      expect(location.startsWith("texttext-app://auth")).toBe(true);
      expect(location).not.toContain("evil.example");
    }
  });

  it("sends a signed-out visitor to sign in and back, minting nothing", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(get(`?state=${STATE}&device=Ramine%27s%20Mac`));
    const location = response.headers.get("Location") ?? "";
    expect(response.status).toBe(303);
    expect(location.startsWith("/signin?callbackUrl=")).toBe(true);
    expect(decodeURIComponent(location)).toContain("/connect/app/native");
    expect(decodeURIComponent(location)).toContain(STATE);
    expect(mocks.startDeviceLink).not.toHaveBeenCalled();
  });

  it("refuses a state it could not have issued", async () => {
    for (const bad of ["", "short", "has spaces in it here", "x".repeat(129), "sql';--injection"]) {
      const response = await GET(get(`?state=${encodeURIComponent(bad)}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.startDeviceLink).not.toHaveBeenCalled();
  });

  it("audits the sign-in against the resolved user", async () => {
    await GET(get(`?state=${STATE}&device=TextText%20on%20a%20Mac`));
    expect(mocks.resolveOwnedWorkspace).toHaveBeenCalled();
    expect(mocks.approveDeviceLink).toHaveBeenCalledWith("ABCD-EFGH", "user-1");
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "user-1", actionName: "approve_app_sign_in" }),
    );
  });

  it("does not hand out a secret when the session has no user row", async () => {
    mocks.getUserIdBySub.mockResolvedValue(null);
    const response = await GET(get(`?state=${STATE}`));
    expect(response.status).toBe(500);
    expect(mocks.approveDeviceLink).not.toHaveBeenCalled();
  });

  it("does not hand out a secret when the approval did not take", async () => {
    mocks.approveDeviceLink.mockResolvedValue(false);
    const response = await GET(get(`?state=${STATE}`));
    expect(response.status).toBe(500);
    expect(response.headers.get("Location")).toBeNull();
  });
});
