import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startReaderFreshness } from "@/lib/reader-freshness";

let page: EventTarget & { visibilityState: string };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers();
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", page);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => Response.json({ revision: "1:today" }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("requests a server render only after another writer changes the item revision", async () => {
  const refresh = vi.fn();
  const poll = startReaderFreshness("item", "1:today", refresh);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).not.toHaveBeenCalled();
  fetchMock.mockImplementation(async () => Response.json({ revision: "2:today" }));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/items/item/reader-revision", {
    cache: "no-store", signal: expect.any(AbortSignal),
  });
  poll.stop();
  const refreshed = startReaderFreshness("item", "2:today", refresh);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  refreshed.stop();
});

it("does not request while hidden, resumes on visibility, and stops on unmount", async () => {
  page.visibilityState = "hidden";
  const poll = startReaderFreshness("item", "1:today", vi.fn());
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).not.toHaveBeenCalled();
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  poll.stop();
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("aborts in-flight reads when hidden and ignores their late changed revision", async () => {
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const refresh = vi.fn();
  const poll = startReaderFreshness("item", "1:today", refresh);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  finish(Response.json({ revision: "2:today" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).not.toHaveBeenCalled();
  poll.stop();
});

it("retries transient failures and refreshes the permission-gated page on access loss", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const refresh = vi.fn();
  const poll = startReaderFreshness("item", "1:today", refresh);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  poll.stop();
});
