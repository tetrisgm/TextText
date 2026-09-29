import { afterEach, expect, it, vi } from "vitest";
const cursor = vi.hoisted(() => vi.fn(async () => "1"));
const historyVersion = vi.hoisted(() => vi.fn(async () => "version-1"));
const access = vi.hoisted(() => vi.fn(async () => ({ canView: true, isOwner: true, blogId: "blog-1" })));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/permissions", () => ({ resolveWorkspaceAccess: access }));
vi.mock("@/lib/sync-cursor", () => ({ workspaceChangeCursor: cursor }));
vi.mock("@/lib/collab", () => ({ activeAgentFocus: async () => null }));
vi.mock("@/lib/ai/assistant-conversation-history.server", () => ({ assistantHistoryVersion: historyVersion }));
import { GET } from "@/app/api/workspace/changes/route";
afterEach(() => { vi.useRealTimers(); cursor.mockReset(); cursor.mockResolvedValue("1"); historyVersion.mockClear(); access.mockReset(); access.mockResolvedValue({ canView: true, isOwner: true, blogId: "blog-1" }); });
it("bounds cursor queries for a quiet 25-second request", async () => {
  vi.useFakeTimers();
  const response = GET(new Request("https://example.test/api/workspace/changes?handle=writer&cursor=1&wait=25"));
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await (await response).json()).toMatchObject({ cursor: "1", changed: false });
  expect(cursor.mock.calls.length).toBeLessThanOrEqual(10);
  expect(historyVersion).not.toHaveBeenCalled();
});
it("reads only the compact history version when the cursor changes", async () => {
  cursor.mockResolvedValueOnce("1").mockResolvedValueOnce("2");
  vi.useFakeTimers();
  const response = GET(new Request("https://example.test/api/workspace/changes?handle=writer&cursor=1&wait=20"));
  await vi.advanceTimersByTimeAsync(750);
  expect(await (await response).json()).toMatchObject({ cursor: "2", changed: true, assistantHistory: "version-1" });
  expect(historyVersion).toHaveBeenCalledTimes(1);
});
it("never reveals an owner's history token to a viewer", async () => {
  access.mockResolvedValueOnce({ canView: true, isOwner: false, blogId: "blog-1" });
  const response = await GET(new Request("https://example.test/api/workspace/changes?handle=writer"));
  expect(await response.json()).not.toHaveProperty("assistantHistory");
  expect(historyVersion).not.toHaveBeenCalled();
});
it("does not query again after the waiting client disconnects", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const response = GET(new Request("https://example.test/api/workspace/changes?handle=writer&cursor=1&wait=25", { signal: controller.signal }));
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await vi.advanceTimersByTimeAsync(1000);
  await response;
  expect(cursor).toHaveBeenCalledTimes(1);
});
