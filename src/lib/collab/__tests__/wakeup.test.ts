import { describe, expect, it } from "vitest";
import { announceCollabUpdate, collabWaiterCount, waitForCollabUpdate } from "@/lib/collab/wakeup";

/**
 * The wakeup bus is an optimisation in the middle of the sync path, which is
 * the most dangerous place for one to be. These tests hold it to the three
 * promises the relay relies on: it wakes the right readers, it never holds a
 * reader past its timer, and it leaves nothing behind.
 */

const elapsed = async (run: Promise<unknown>): Promise<number> => {
  const started = Date.now();
  await run;
  return Date.now() - started;
};

describe("the collab wakeup bus", () => {
  it("WK-01: a write wakes a reader waiting on that item", async () => {
    const waited = waitForCollabUpdate("post-a", 5_000);
    // Give the waiter a tick to register before announcing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(collabWaiterCount("post-a")).toBe(1);
    announceCollabUpdate("post-a");
    expect(await elapsed(waited)).toBeLessThan(200);
  });

  it("WK-02: a write on another item wakes nobody", async () => {
    const waited = waitForCollabUpdate("post-b", 300);
    await new Promise((resolve) => setTimeout(resolve, 10));
    announceCollabUpdate("post-elsewhere");
    // It still returns, on its own timer, which is the relay's floor.
    expect(await elapsed(waited)).toBeGreaterThanOrEqual(250);
  });

  it("WK-03: every reader of an item wakes, not just the first", async () => {
    const readers = [
      waitForCollabUpdate("post-c", 5_000),
      waitForCollabUpdate("post-c", 5_000),
      waitForCollabUpdate("post-c", 5_000),
    ];
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(collabWaiterCount("post-c")).toBe(3);
    announceCollabUpdate("post-c");
    expect(await elapsed(Promise.all(readers))).toBeLessThan(200);
  });

  it("WK-04: the timer still returns when no write ever comes", async () => {
    expect(await elapsed(waitForCollabUpdate("post-d", 120))).toBeGreaterThanOrEqual(100);
  });

  it("WK-05: a reader that leaves is not held, and leaves nothing behind", async () => {
    const controller = new AbortController();
    const waited = waitForCollabUpdate("post-e", 10_000, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await elapsed(waited)).toBeLessThan(200);
    expect(collabWaiterCount("post-e")).toBe(0);
  });

  it("WK-06: an announcement with nobody listening is not an error", () => {
    expect(() => announceCollabUpdate("post-nobody")).not.toThrow();
  });

  it("WK-07: nothing is retained once every reader has gone", async () => {
    await waitForCollabUpdate("post-f", 20);
    const waited = waitForCollabUpdate("post-f", 5_000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    announceCollabUpdate("post-f");
    await waited;
    expect(collabWaiterCount("post-f")).toBe(0);
    expect(collabWaiterCount()).toBe(0);
  });
});
