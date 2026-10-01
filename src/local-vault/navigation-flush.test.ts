import { describe, expect, it, vi } from "vitest";
import { flushForNavigation } from "./navigation-flush";

describe("web vault navigation flush", () => {
  it("leaves a clean editor without a save or listing refresh", async () => {
    const flush = vi.fn(async () => true), changed = vi.fn();
    expect(await flushForNavigation({ hasPendingChanges: false, flush }, changed)).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("waits for pending edits and refreshes the listing after acknowledgement", async () => {
    const client = { hasPendingChanges: true, flush: vi.fn(async () => { client.hasPendingChanges = false; return true; }) };
    const changed = vi.fn();
    expect(await flushForNavigation(client, changed)).toBe(true);
    expect(client.flush).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("keeps navigation blocked when a save fails or concurrent edits remain", async () => {
    const changed = vi.fn();
    expect(await flushForNavigation({ hasPendingChanges: true, flush: async () => false }, changed)).toBe(false);
    expect(await flushForNavigation({ hasPendingChanges: true, flush: async () => true }, changed)).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });
});
