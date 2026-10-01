import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), discover: vi.fn(), read: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultWorkspaceOrScoped: mocks.auth }));
vi.mock("@/lib/vault/rss-feed.server", () => ({
  discoverVaultFeeds: mocks.discover, readVaultFeed: mocks.read,
  VaultFeedError: class VaultFeedError extends Error { constructor(message: string, readonly status: number) { super(message); } },
}));
import { POST } from "./route";

const context = { params: Promise.resolve({ workspaceId: "workspace-1" }) };
const request = (body: unknown) => new Request("https://texttext.test/api/vault/workspace-1/feeds", {
  method: "POST", headers: { Origin: "https://texttext.test", "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("workspace feed API", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ fullAccess: true, actorUserId: "reader" }); });

  it("authorizes before discovery, fetch, or parsing", async () => {
    mocks.auth.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await POST(request({ action: "read", feedURL: "https://publisher.example/feed" }), context)).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({ fullAccess: false });
    expect((await POST(request({ action: "discover", address: "publisher.example" }), context)).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("returns transient entries and rechecks access after network work", async () => {
    mocks.read.mockResolvedValue({ title: "Daily", entries: [{ title: "One" }] });
    const response = await POST(request({ action: "read", feedURL: "https://publisher.example/feed" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: "Daily", entries: [{ title: "One" }] });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.read).toHaveBeenCalledWith("https://publisher.example/feed");
    expect(mocks.auth).toHaveBeenCalledTimes(2);

    mocks.auth.mockResolvedValueOnce({ fullAccess: true, actorUserId: "reader" })
      .mockResolvedValueOnce({ fullAccess: false, actorUserId: "reader" });
    expect((await POST(request({ action: "read", feedURL: "https://publisher.example/feed" }), context)).status).toBe(403);
  });

  it("bounds input and maps failures without returning internal details", async () => {
    expect((await POST(request({ action: "keep", feedURL: "https://publisher.example/feed" }), context)).status).toBe(400);
    expect((await POST(request({ action: "read", feedURL: "x".repeat(9000) }), context)).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockRejectedValue(new Error("internal fetch detail"));
    const failed = await POST(request({ action: "read", feedURL: "https://publisher.example/feed" }), context);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("internal fetch detail");
  });
});
