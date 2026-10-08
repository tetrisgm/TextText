import { afterEach, expect, it, vi } from "vitest";
import { watchWebWorkspace } from "./web-watch";
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  vi.useFakeTimers();
  let visible = true;
  const polls: { signal: AbortSignal; result: ReturnType<typeof deferred<boolean>> }[] = [];
  const wait = vi.fn((signal: AbortSignal) => { const result = deferred<boolean>(); polls.push({ signal, result }); return result.promise; });
  const refresh = vi.fn(async () => false);
  const changed = vi.fn();
  const watcher = watchWebWorkspace({ visible: () => visible, wait, refresh, changed });
  return { polls, wait, refresh, changed, watcher, visibility(value: boolean) { visible = value; watcher.visibilityChanged(); } };
}
afterEach(() => { vi.useRealTimers(); });
it("resumes when online returns before the old aborted poll rejects, without overlapping", async () => {
  const f = fixture();
  f.visibility(false); f.visibility(true);
  expect(f.polls[0].signal.aborted).toBe(true);
  expect(f.wait).toHaveBeenCalledTimes(1);
  f.polls[0].result.reject(new DOMException("aborted", "AbortError"));
  await vi.advanceTimersByTimeAsync(0);
  expect(f.wait).toHaveBeenCalledTimes(2);
  f.polls[1].result.resolve(true);
  await Promise.resolve();
  expect(f.changed).toHaveBeenCalledTimes(1);
  f.watcher.dispose();
});
it("ignores an old response that resolves after hide and stops polling while hidden", async () => {
  const f = fixture(); f.visibility(false); f.polls[0].result.resolve(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.changed).not.toHaveBeenCalled(); expect(f.wait).toHaveBeenCalledTimes(1);
  f.visibility(true); expect(f.wait).toHaveBeenCalledTimes(2); f.watcher.dispose();
});
it("backs off failed connections, even during repeated focus events", async () => {
  const f = fixture(); f.polls[0].result.reject(new Error("offline"));
  await Promise.resolve();
  f.visibility(true); f.visibility(true);
  await vi.advanceTimersByTimeAsync(4999); expect(f.wait).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(f.wait).toHaveBeenCalledTimes(2);
  f.watcher.dispose();
});
it("coalesces refreshes and prevents late work or timers after disposal", async () => {
  const f = fixture(); const refresh = deferred<boolean>(); f.refresh.mockImplementation(() => refresh.promise);
  f.visibility(true); f.visibility(true); expect(f.refresh).toHaveBeenCalledTimes(1);
  f.watcher.dispose(); refresh.resolve(true); f.polls[0].result.reject(new Error("closed"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.changed).not.toHaveBeenCalled(); expect(f.wait).toHaveBeenCalledTimes(1);
});
it("clears a backoff when hidden and resumes immediately on return", async () => {
  const f = fixture(); f.polls[0].result.reject(new Error("failed")); await Promise.resolve();
  f.visibility(false); await vi.advanceTimersByTimeAsync(6000);
  expect(f.wait).toHaveBeenCalledTimes(1);
  f.visibility(true); expect(f.wait).toHaveBeenCalledTimes(2); f.watcher.dispose();
});
