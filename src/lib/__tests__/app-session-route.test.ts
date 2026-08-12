import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveApiToken: vi.fn(),
}));

vi.mock("@/auth", () => ({
  isAuthConfigured: true,
}));

vi.mock("@/lib/api-tokens", () => ({
  resolveApiToken: mocks.resolveApiToken,
}));

import { POST } from "@/app/api/app/session/route";

const appToken = `wsk_${"a".repeat(43)}`;

function request(
  options: {
    origin?: string;
    next?: string;
    token?: string;
    appHeader?: string;
  } = {},
) {
  const origin = options.origin ?? "https://TextText.app";
  const url = new URL("/api/app/session", origin);
  if (options.next) url.searchParams.set("next", options.next);
  return new NextRequest(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token ?? appToken}`,
      "x-texttext-app": options.appHeader ?? "1",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET =
    "test-secret-that-is-long-enough-for-session-encryption";
  mocks.resolveApiToken.mockResolvedValue({
    userId: "user-id",
    sub: "apple-user",
    scopes: "sync",
    expiresAt: null,
  });
});

describe("app session route", () => {
  it("exchanges a scoped app token for an HttpOnly session and redirect", async () => {
    const response = await POST(
      request({ next: "/t/workspace/post?edit=1" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      new URL("https://TextText.app/t/workspace/post?edit=1").href,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Secure-authjs.session-token=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain=");
    expect(mocks.resolveApiToken).toHaveBeenCalledWith(
      `Bearer ${appToken}`,
    );
  });

  it("does not expose the exchange without the app header", async () => {
    const response = await POST(request({ appHeader: "0" }));
    expect(response.status).toBe(404);
    expect(mocks.resolveApiToken).not.toHaveBeenCalled();
  });

  it("rejects invalid and insufficiently scoped app tokens", async () => {
    mocks.resolveApiToken.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);

    mocks.resolveApiToken.mockResolvedValueOnce({
      userId: "user-id",
      sub: "apple-user",
      scopes: "comments",
      expiresAt: null,
    });
    expect((await POST(request())).status).toBe(403);
  });
});
