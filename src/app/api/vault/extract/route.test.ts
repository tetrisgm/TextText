import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock("../auth", () => ({ authorizeVault: mocks.auth }));
vi.mock("@/lib/reading/fetch-article.server", () => ({ fetchArticle: mocks.fetch }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ workspaceId: "one" }); });
const request = (body: unknown) => new Request("https://texttext.test/api/vault/extract", { method: "POST", body: JSON.stringify(body) });
it("authorizes before contacting a source", async () => {
  mocks.auth.mockResolvedValue(new Response(null, { status: 401 }));
  expect((await POST(request({ sourceURL: "https://example.com" }))).status).toBe(401);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("returns capture data without a content mutation", async () => {
  mocks.fetch.mockResolvedValue({ sourceURL: "https://example.com/", markdown: "article", capturedAt: "2026-09-30T00:00:00Z" });
  const input = request({ sourceURL: "https://example.com/" });
  const response = await POST(input);
  expect(response.status).toBe(200); expect((await response.json()).markdown).toBe("article");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(mocks.fetch).toHaveBeenCalledWith("https://example.com/", undefined, input.signal);
});
it("rejects malformed and oversized input and makes failure retryable", async () => {
  expect((await POST(request({ sourceURL: false }))).status).toBe(400);
  expect((await POST(request({ sourceURL: "x".repeat(9000) }))).status).toBe(400);
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.fetch.mockRejectedValue(new Error("private diagnostic"));
  const response = await POST(request({ sourceURL: "https://example.com/" }));
  expect(response.status).toBe(422); expect(await response.text()).not.toContain("private diagnostic");
});
