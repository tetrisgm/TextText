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
    useRef: <T>(value: T) => ({ current: value }),
  }));
  vi.doMock("@/lib/pool/store", () => ({ refreshWorkspacePool }));
  const loadedModule = await import("@/lib/pool/useWorkspaceLiveSync");
  return {
    useWorkspaceLiveSync: loadedModule.useWorkspaceLiveSync,
    cleanup: () => cleanup?.(),
  };
}

function sessionStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
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

  it("delivers a fresh focus request for an item in another workspace once", async () => {
    const refreshWorkspacePool = vi.fn();
    const onAgentFocus = vi.fn();
    const sessionStorage = sessionStorageMock();
    const focus = {
      eventId: "focus-1",
      targetUserId: "user-1",
      workspaceHandle: "other-workspace",
      folderPath: "notes",
      postId: "post-2",
      path: "/t/other-workspace/private-note?edit=1&id=post-2",
      mode: "edit",
      requestedAt: new Date(Date.now()).toISOString(),
    };
    let resolvePending: ((response: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ cursor: "1", changed: false, focus }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ cursor: "1", changed: false, focus }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePending = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { sessionStorage });
    vi.stubGlobal("document", { hidden: false });

    const liveSync = await loadLiveSync(refreshWorkspacePool);
    liveSync.useWorkspaceLiveSync("writer", "blog-1", onAgentFocus);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    expect(onAgentFocus).toHaveBeenCalledTimes(1);
    expect(onAgentFocus).toHaveBeenCalledWith(focus);
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      "texttext:agent-focus:last-event",
      "focus-1",
    );

    liveSync.cleanup();
    resolvePending?.(jsonResponse({ cursor: "1", changed: false, focus }));
  });

  it("ignores focus requests that are stale or already delivered in this tab", async () => {
    const refreshWorkspacePool = vi.fn();
    const onAgentFocus = vi.fn();
    const sessionStorage = sessionStorageMock();
    sessionStorage.setItem("texttext:agent-focus:last-event", "focus-seen");
    const staleFocus = {
      eventId: "focus-stale",
      targetUserId: "user-1",
      workspaceHandle: "writer",
      folderPath: "blog",
      postId: "post-1",
      path: "/t/writer/post-1",
      mode: "read",
      requestedAt: new Date(Date.now() - 31_000).toISOString(),
    };
    const deliveredFocus = {
      ...staleFocus,
      eventId: "focus-seen",
      requestedAt: new Date(Date.now()).toISOString(),
    };
    let resolvePending: ((response: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ cursor: "1", changed: false, focus: staleFocus }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ cursor: "1", changed: false, focus: deliveredFocus }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePending = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { sessionStorage });
    vi.stubGlobal("document", { hidden: false });

    const liveSync = await loadLiveSync(refreshWorkspacePool);
    liveSync.useWorkspaceLiveSync("writer", "blog-1", onAgentFocus);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    expect(onAgentFocus).not.toHaveBeenCalled();

    liveSync.cleanup();
    resolvePending?.(
      jsonResponse({ cursor: "1", changed: false, focus: deliveredFocus }),
    );
  });
});
