import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const store = vi.hoisted(() => ({ resolvePublicPostPath: vi.fn() }));
vi.mock("@/lib/store", () => ({
  getBlog: vi.fn().mockResolvedValue({ id: "workspace" }),
  resolvePublicPostPath: store.resolvePublicPostPath,
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

  it.each(["/v/workspace-1/item-1", "/api/public/vault/workspace-1/item-1/assets/movie.mp4"])(
    "passes the live file-vault public route through on a tenant host: %s", async pathname => {
      store.resolvePublicPostPath.mockClear();
      const request = new NextRequest(`https://writer.texttext.app${pathname}`, {
        headers: { host: "writer.texttext.app", cookie: "session=private", authorization: "Bearer private" },
      });
      const response = await proxy(request);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-middleware-request-x-texttext-public-origin")).toBe("1");
      expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
      expect(response.headers.get("x-middleware-request-authorization")).toBeNull();
      expect(store.resolvePublicPostPath).not.toHaveBeenCalled();
    },
  );
});
