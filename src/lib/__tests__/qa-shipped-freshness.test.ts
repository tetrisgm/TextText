import { afterEach, expect, it, vi } from "vitest";
import { startReaderFreshness } from "@/lib/reader-freshness";
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("F3: does not request the same pending revision refresh on every visibility event", async () => {
  vi.useFakeTimers();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", page);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ revision: "2:today" })));
  const refresh = vi.fn();
  const poll = startReaderFreshness("item", "1:today", refresh);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledOnce();
    // The RSC refresh is still pending or failed, so props have not advanced.
    for (let i = 0; i < 5; i++) {
      page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange"));
      page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(refresh).toHaveBeenCalledOnce();
  } finally { poll.stop(); }
});
