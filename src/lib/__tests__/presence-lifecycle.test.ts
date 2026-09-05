import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresencePeer } from "../collab/provider";

type State = { postId: string | null; peers: PresencePeer[] };
const hooks = vi.hoisted(() => ({
  state: undefined as State | undefined,
  effect: undefined as (() => undefined | (() => void)) | undefined,
}));
// A small hook driver runs the real polling effect without a browser dependency.
vi.mock("react", () => ({
  useState: (initial: State) => {
    hooks.state ??= initial;
    return [hooks.state, (next: State | ((current: State) => State)) => {
      hooks.state = typeof next === "function" ? next(hooks.state!) : next;
    }];
  },
  useEffect: (effect: () => undefined | (() => void)) => { hooks.effect = effect; },
}));
import { usePresence } from "../collab/usePresence";

const peer: PresencePeer = { clientId: "session", userName: "Ada", role: "editor", awareness: null, color: "red" };
let page: EventTarget & { visibilityState: string };
let cleanup: (() => void) | undefined;
const fetchMock = vi.fn();
const success = (peers = [peer]) => ({ ok: true, status: 200, json: async () => ({ presence: peers }) });
async function mount(postId: string) {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The mock above drives the real effect outside a renderer.
  usePresence(postId);
  cleanup = hooks.effect?.() || undefined;
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.state = undefined;
  hooks.effect = undefined;
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", page);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(success());
});
afterEach(() => {
  cleanup?.(); cleanup = undefined;
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("presence freshness and item boundaries", () => {
  it("shows a successful poll and clears activity on a failed read", async () => {
    await mount("item");
    expect(usePresence("item")).toEqual([peer]);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(4000);
    expect(usePresence("item")).toEqual([]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(usePresence("item")).toEqual([peer]);
  });
  it.each([401, 403, 410, 500])("clears peers on HTTP %s", async (status) => {
    await mount("item");
    fetchMock.mockResolvedValueOnce({ ok: false, status });
    await vi.advanceTimersByTimeAsync(4000);
    expect(usePresence("item")).toEqual([]);
  });
  it("clears and pauses while hidden, then reads immediately on return", async () => {
    await mount("item");
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(usePresence("item")).toEqual([]);
    await vi.advanceTimersByTimeAsync(12000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usePresence("item")).toEqual([peer]);
  });
  it("does not restore peers when an in-flight poll finishes after hiding", async () => {
    let resolve!: (value: ReturnType<typeof success>) => void;
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await mount("item");
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(usePresence("item")).toEqual([]);
  });
  it("hides the previous item's peers synchronously during navigation", async () => {
    await mount("old-item");
    expect(usePresence("new-item")).toEqual([]);
  });
  it("fences late responses from an unmounted item and aborts its request", async () => {
    let resolve!: (value: ReturnType<typeof success>) => void;
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await mount("old-item");
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    cleanup?.();
    expect(signal.aborted).toBe(true);
    await mount("new-item");
    resolve(success([{ ...peer, userName: "Old item" }]));
    await vi.advanceTimersByTimeAsync(0);
    expect(usePresence("new-item")).toEqual([peer]);
  });
});

it("revisiting an item after failed reads shows no stale peers", async () => {
 await mount("a");
 expect(usePresence("a")).toEqual([peer]);
 cleanup?.();
 fetchMock.mockResolvedValue(success([]));
 await mount("b");
 expect(usePresence("b")).toEqual([]);
 cleanup?.();
 fetchMock.mockResolvedValue({ok: false, status: 403});
 await mount("a");
 expect(usePresence("a")).toEqual([]);
 await vi.advanceTimersByTimeAsync(12000);
 expect(usePresence("a")).toEqual([]);
});

it("probe: two surfaces share polling and last cleanup stops it", async () => {
 await mount("item"); const firstCleanup = cleanup!;
 await mount("item"); const secondCleanup = cleanup!;
 expect(fetchMock).toHaveBeenCalledTimes(1);
 firstCleanup();
 await vi.advanceTimersByTimeAsync(4000);
 expect(fetchMock).toHaveBeenCalledTimes(2);
 secondCleanup(); cleanup = undefined;
 await vi.advanceTimersByTimeAsync(12000);
 expect(fetchMock).toHaveBeenCalledTimes(2);
});
