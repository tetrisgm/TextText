import { afterEach, expect, it, vi } from "vitest";
const cursor = vi.hoisted(() => vi.fn(async () => "1"));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/permissions", () => ({ resolveWorkspaceAccess: async () => ({ canView: true }) }));
vi.mock("@/lib/sync-cursor", () => ({ workspaceChangeCursor: cursor }));
vi.mock("@/lib/collab", () => ({ activeAgentFocus: async () => null }));
import { GET } from "@/app/api/workspace/changes/route";
afterEach(() => { vi.useRealTimers(); cursor.mockClear(); });
it("bounds cursor queries for a quiet 25-second request", async () => {
  vi.useFakeTimers();
  const response = GET(new Request("https://example.test/api/workspace/changes?handle=writer&cursor=1&wait=25"));
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await (await response).json()).toMatchObject({ cursor: "1", changed: false });
  expect(cursor.mock.calls.length).toBeLessThanOrEqual(10);
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
