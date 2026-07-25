import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Cleanup = void | (() => void);

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
  } as Response;
}

async function loadLiveSync(refreshWorkspacePool: ReturnType<typeof vi.fn>) {
  let cleanup: Cleanup;
  vi.doMock("react", () => ({
    useEffect: (effect: () => Cleanup) => {
      cleanup = effect();
    },
  }));
  vi.doMock("@/lib/pool/store", () => ({ refreshWorkspacePool }));
  const loadedModule = await import("@/lib/pool/useWorkspaceLiveSync");
  return {
    useWorkspaceLiveSync: loadedModule.useWorkspaceLiveSync,
    cleanup: () => cleanup?.(),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("workspace live sync", () => {
  it("stops polling when the workspace has no owner change feed", async () => {
    const refreshWorkspacePool = vi.fn();
    const fetch = vi.fn().mockResolvedValue(errorResponse(404));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { hidden: false });

    const liveSync = await loadLiveSync(refreshWorkspacePool);
    liveSync.useWorkspaceLiveSync("guest", "guest-blog");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refreshWorkspacePool).not.toHaveBeenCalled();
    liveSync.cleanup();
  });

  it("stops polling when production storage is quota-paused", async () => {
    const refreshWorkspacePool = vi.fn();
    const fetch = vi.fn().mockResolvedValue(errorResponse(402));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { hidden: false });

    const liveSync = await loadLiveSync(refreshWorkspacePool);
    liveSync.useWorkspaceLiveSync("writer", "blog-1");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refreshWorkspacePool).not.toHaveBeenCalled();
    liveSync.cleanup();
  });

  it("backs off repeated server failures instead of hot-looping", async () => {
    const refreshWorkspacePool = vi.fn();
    const fetch = vi.fn().mockResolvedValue(errorResponse(503));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { hidden: false });

    const liveSync = await loadLiveSync(refreshWorkspacePool);
    liveSync.useWorkspaceLiveSync("writer", "blog-1");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);

    // Exponential delays produce only a handful of attempts in a minute. The
    // previous fixed three-second loop would have made about twenty.
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(6);
    expect(refreshWorkspacePool).not.toHaveBeenCalled();
    liveSync.cleanup();
  });

  it("does not reload or speculatively refresh when visibility returns", async () => {
    const reload = vi.fn();
    const addEventListener = vi.fn();
    const refreshWorkspacePool = vi.fn();
    let resolvePending: ((response: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ cursor: "1", changed: false, build: "old" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ cursor: "1", changed: false, build: "new" }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePending = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener,
      removeEventListener: vi.fn(),
    });

    const liveSync = await loadLiveSync(refreshWorkspacePool);
    liveSync.useWorkspaceLiveSync("writer", "blog-1");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(addEventListener).not.toHaveBeenCalled();
    expect(refreshWorkspacePool).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    liveSync.cleanup();
    resolvePending?.(jsonResponse({ cursor: "1", changed: false }));
  });

  it("refreshes exactly when the change cursor reports new workspace data", async () => {
    const refreshWorkspacePool = vi.fn();
    let resolvePending: ((response: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ cursor: "1", changed: false }))
      .mockResolvedValueOnce(jsonResponse({ cursor: "2", changed: true }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePending = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { hidden: false });

    const liveSync = await loadLiveSync(refreshWorkspacePool);
    liveSync.useWorkspaceLiveSync("writer", "blog-1");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    expect(refreshWorkspacePool).toHaveBeenCalledTimes(1);
    expect(refreshWorkspacePool).toHaveBeenCalledWith("writer", "blog-1");

    liveSync.cleanup();
    resolvePending?.(jsonResponse({ cursor: "2", changed: false }));
  });
});
