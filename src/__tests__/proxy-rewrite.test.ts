import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/store", () => ({
  getBlog: vi.fn().mockResolvedValue({ id: "workspace" }),
  resolvePublicPostPath: vi.fn(),
}));

const { proxy } = await import("@/proxy");

describe("public page rewrites behind HTTPS termination", () => {
  it("uses the HTTP loopback listener for a canonical /@ page", async () => {
    const request = new NextRequest("https://localhost:3400/@ramine", {
      headers: {
        host: "texttext.app",
        "x-forwarded-host": "texttext.app",
        "x-forwarded-proto": "https",
        cookie: "session=present",
      },
    });
    const response = await proxy(request);
    expect(response.headers.get("x-middleware-rewrite"))
      .toBe("http://localhost:3400/u/ramine");
  });

  it("preserves an HTTPS public origin for hosted rewrites", async () => {
    const request = new NextRequest("https://texttext.app/@ramine", {
      headers: { host: "texttext.app", cookie: "session=present" },
    });
    const response = await proxy(request);
    expect(response.headers.get("x-middleware-rewrite"))
      .toBe("https://texttext.app/u/ramine");
  });
});
