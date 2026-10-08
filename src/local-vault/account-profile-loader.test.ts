import { afterEach, expect, it, vi } from "vitest";
import { loadAccountProfile } from "./account-profile-loader";
import { VaultError } from "./bridge";
afterEach(() => vi.useRealTimers());
it("recovers profile after restart without a Settings click and stops after success", async () => {
  vi.useFakeTimers(); const events = new EventTarget(), controller = new AbortController();
  const read = vi.fn().mockRejectedValueOnce(new VaultError("Restarting", "503")).mockResolvedValue({ email: "person@example.test" });
  const loaded = vi.fn(), failed = vi.fn();
  const stop = loadAccountProfile({ read, signal: controller.signal, events, loaded, failed });
  await vi.advanceTimersByTimeAsync(0); expect(failed).toHaveBeenCalledOnce();
  for (let i = 0; i < 20; i++) events.dispatchEvent(new CustomEvent("texttext:vault-sync-status", { detail: { available: true, onlineReady: true } }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(loaded).toHaveBeenCalledWith({ email: "person@example.test" }); expect(read).toHaveBeenCalledTimes(2);
  events.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(120_000); expect(read).toHaveBeenCalledTimes(2); stop();
});
it("bounds failed attempts despite repeated recovery events and refuses authorization retries", async () => {
  vi.useFakeTimers(); const events = new EventTarget(), read = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const stop = loadAccountProfile({ read, signal: new AbortController().signal, events, loaded: vi.fn(), failed: vi.fn() });
  for (let i = 0; i < 30; i++) { events.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(10_000); }
  expect(read).toHaveBeenCalledTimes(6); stop();
  const denied = vi.fn().mockRejectedValue(new VaultError("Denied", "403"));
  const off = loadAccountProfile({ read: denied, signal: new AbortController().signal, events, loaded: vi.fn(), failed: vi.fn() });
  await vi.advanceTimersByTimeAsync(0); events.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(120_000); expect(denied).toHaveBeenCalledOnce(); off();
});
it("ignores late old-account responses and aborts in-flight requests on account change", async () => {
  let resolve!: (value: string) => void; let requestSignal!: AbortSignal;
  const loaded = vi.fn(), controller = new AbortController();
  const stop = loadAccountProfile({ read: signal => { requestSignal = signal; return new Promise<string>(r => { resolve = r; }); }, signal: controller.signal, events: new EventTarget(), loaded, failed: vi.fn() });
  controller.abort(); resolve("old account"); await Promise.resolve(); await Promise.resolve();
  expect(requestSignal.aborted).toBe(true); expect(loaded).not.toHaveBeenCalled(); stop();
});
