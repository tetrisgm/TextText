import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollabProvider } from "@/lib/collab/provider";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function providerFor(doc: Y.Doc, postId: string) {
  return new CollabProvider(doc, {
    postId,
    userName: "Ada",
    color: "#112233",
    canPush: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CollabProvider startup and outbox", () => {
  it("captures edits during catch-up and flushes them after destroy", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const initial = deferred<Response>();
    const never = new Promise<Response>(() => {});
    const pushed: Array<{ updates: string[] }> = [];
    let initialRequested = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) {
          return jsonResponse({ presence: [] });
        }
        if (init?.method === "POST") {
          pushed.push(JSON.parse(String(init.body)) as { updates: string[] });
          return jsonResponse({ seq: 1 });
        }
        if (!initialRequested) {
          initialRequested = true;
          return initial.promise;
        }
        return never;
      }),
    );

    const doc = new Y.Doc();
    const provider = providerFor(doc, "capture-during-catch-up");
    const started = provider.start();
    doc.getMap("body").set("text", "written while loading");

    initial.resolve(jsonResponse({ updates: [], seq: 0 }));
    await expect(started).resolves.toEqual({
      authoritative: true,
      remoteEmpty: false,
    });
    provider.destroy();

    await vi.advanceTimersByTimeAsync(250);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].updates).toHaveLength(1);

    const replayed = new Y.Doc();
    Y.applyUpdate(
      replayed,
      new Uint8Array(Buffer.from(pushed[0].updates[0], "base64")),
    );
    expect(replayed.getMap("body").get("text")).toBe(
      "written while loading",
    );
  });

  it("retains a failed push across teardown and replays it on remount", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const never = new Promise<Response>(() => {});
    let pushAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) {
          return jsonResponse({ presence: [] });
        }
        if (init?.method === "POST") {
          pushAttempts += 1;
          return pushAttempts === 1
            ? jsonResponse({ error: "offline" }, 503)
            : jsonResponse({ seq: 1 });
        }
        if (url.includes("wait=0")) {
          return jsonResponse({ updates: [], seq: 0 });
        }
        return never;
      }),
    );

    const firstDoc = new Y.Doc();
    const first = providerFor(firstDoc, "retry-after-remount");
    await expect(first.start()).resolves.toEqual({
      authoritative: true,
      remoteEmpty: true,
    });
    firstDoc.getMap("body").set("text", "unsent");
    first.destroy();

    await vi.advanceTimersByTimeAsync(250);
    expect(pushAttempts).toBe(1);

    const remountedDoc = new Y.Doc();
    const remounted = providerFor(remountedDoc, "retry-after-remount");
    await expect(remounted.start()).resolves.toEqual({
      authoritative: true,
      remoteEmpty: false,
    });
    expect(remountedDoc.getMap("body").get("text")).toBe("unsent");
    remounted.destroy();

    await vi.advanceTimersByTimeAsync(1500);
    expect(pushAttempts).toBe(2);
  });

  it("reports a failed initial fetch as non-authoritative", async () => {
    const never = new Promise<Response>(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("wait=0")
          ? jsonResponse({ error: "offline" }, 503)
          : never,
      ),
    );

    const provider = new CollabProvider(new Y.Doc(), {
      postId: "failed-catch-up",
      userName: "Ada",
      color: "#112233",
      canPush: false,
    });
    await expect(provider.start()).resolves.toEqual({
      authoritative: false,
      remoteEmpty: false,
    });
    provider.destroy();
  });

  it("applies all initial pages before reporting non-empty authority", async () => {
    const source = new Y.Doc();
    source.getMap("body").set("text", "remote");
    const update = Buffer.from(Y.encodeStateAsUpdate(source)).toString("base64");
    const never = new Promise<Response>(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("since=0") && url.includes("wait=0")) {
          return jsonResponse({ updates: [{ seq: 7, update }], seq: 7 });
        }
        if (url.includes("since=7") && url.includes("wait=0")) {
          return jsonResponse({ updates: [], seq: 7 });
        }
        return never;
      }),
    );

    const target = new Y.Doc();
    const provider = new CollabProvider(target, {
      postId: "paged-catch-up",
      userName: "Ada",
      color: "#112233",
      canPush: false,
    });
    await expect(provider.start()).resolves.toEqual({
      authoritative: true,
      remoteEmpty: false,
    });
    expect(target.getMap("body").get("text")).toBe("remote");
    provider.destroy();
  });
});
