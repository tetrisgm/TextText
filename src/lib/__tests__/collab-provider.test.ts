import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollabProvider } from "@/lib/collab/provider";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASELINE_UPDATE = (() => {
  const doc = new Y.Doc();
  doc.getMap("document").set("schemaVersion", 1);
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  doc.destroy();
  return update;
})();

function catchUpResponse({
  updates = [],
  seq = 0,
  epoch = 0,
  revision = 1,
}: {
  updates?: Array<{ seq: number; update: string }>;
  seq?: number;
  epoch?: number;
  revision?: number;
} = {}): Response {
  return jsonResponse({
    updates,
    seq,
    epoch,
    baseline: { update: BASELINE_UPDATE, revision },
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
  // The relay excludes the asking client from the co-editor check that gates a
  // stale-log reseed, so the catch-up has to say who is asking. Without it a
  // client's own presence vetoes its own reseed and a body written out of band
  // is silently replaced by the stale log's content.
  it("identifies itself on every catch-up read", async () => {
    const reads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (init?.method === "POST") return jsonResponse({ seq: 1, epoch: 0 });
        reads.push(url);
        return catchUpResponse({ epoch: 0 });
      }),
    );
    const doc = new Y.Doc();
    const provider = providerFor(doc, "identifies-itself");
    await provider.start();
    provider.destroy();
    expect(reads.length).toBeGreaterThan(0);
    for (const url of reads) {
      expect(url).toMatch(/[?&]clientId=[^&]+/);
    }
  });

  it("captures edits during catch-up and flushes them after destroy", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const initial = deferred<Response>();
    const never = new Promise<Response>(() => {});
    const pushed: Array<{ updates: string[]; epoch?: number }> = [];
    let initialRequested = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) {
          return jsonResponse({ presence: [] });
        }
        if (init?.method === "POST") {
          pushed.push(JSON.parse(String(init.body)) as { updates: string[]; epoch?: number });
          return jsonResponse({ seq: 1, epoch: 5 });
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

    // The debounce expires while the initial epoch is still unknown. The edit
    // must remain queued instead of being sent with epoch 0 and fenced out.
    await vi.advanceTimersByTimeAsync(400);
    expect(pushed).toHaveLength(0);

    initial.resolve(catchUpResponse({ epoch: 5 }));
    await expect(started).resolves.toEqual({
      authoritative: true,
      remoteEmpty: false,
      baselineRevision: 1,
    });
    provider.destroy();

    await vi.advanceTimersByTimeAsync(250);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].updates).toHaveLength(1);
    expect(pushed[0].epoch).toBe(5);

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
          return catchUpResponse();
        }
        return never;
      }),
    );

    const firstDoc = new Y.Doc();
    const first = providerFor(firstDoc, "retry-after-remount");
    await expect(first.start()).resolves.toEqual({
      authoritative: true,
      remoteEmpty: true,
      baselineRevision: 1,
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
      baselineRevision: 1,
    });
    expect(remountedDoc.getMap("body").get("text")).toBe("unsent");
    remounted.destroy();

    await vi.advanceTimersByTimeAsync(1500);
    expect(pushAttempts).toBe(2);
  });

  it("drops a remounted outbox when catch-up reports that its epoch retired", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const retired: boolean[] = [];
    let epoch = 5;
    const pushed: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (init?.method === "POST") {
          pushed.push((JSON.parse(String(init.body)) as { epoch: number }).epoch);
          return jsonResponse({ error: "offline" }, 503);
        }
        if (url.includes("wait=0")) {
          return catchUpResponse({ epoch });
        }
        return new Promise<Response>(() => {});
      }),
    );

    const firstDoc = new Y.Doc();
    const first = providerFor(firstDoc, "retired-remount");
    await first.start();
    firstDoc.getMap("body").set("text", "stale queued edit");
    await vi.advanceTimersByTimeAsync(400);
    expect(pushed).toEqual([5]);
    first.destroy();

    epoch = 6;
    const remounted = new CollabProvider(new Y.Doc(), {
      postId: "retired-remount",
      userName: "Ada",
      color: "#112233",
      canPush: true,
      onRetired: () => retired.push(true),
    });
    await expect(remounted.start()).resolves.toEqual({
      authoritative: false,
      remoteEmpty: false,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(retired).toEqual([true]);
    expect(pushed).toEqual([5]);
    remounted.destroy();
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
          return catchUpResponse({ updates: [{ seq: 7, update }], seq: 7 });
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
      baselineRevision: 1,
    });
    expect(target.getMap("body").get("text")).toBe("remote");
    provider.destroy();
  });

  it("stops pushing and reports when a push loses access (403)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const never = new Promise<Response>(() => {});
    const errors: string[] = [];
    let pushes = 0;
    let catchUpDone = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (init?.method === "POST") {
          pushes += 1;
          return jsonResponse({ error: "revoked" }, 403);
        }
        // First GET (catch-up) returns empty/authoritative; the poll GET parks.
        if (!catchUpDone) {
          catchUpDone = true;
          return catchUpResponse();
        }
        return never;
      }),
    );

    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, {
      postId: "revoked-mid-session",
      userName: "Ada",
      color: "#112233",
      canPush: true,
      onError: (m) => errors.push(m),
    });
    await provider.start();

    doc.getMap("body").set("text", "first edit"); // queues a push
    await vi.advanceTimersByTimeAsync(400); // flush debounce -> push -> 403
    expect(pushes).toBe(1);
    expect(errors.some((m) => /access/i.test(m))).toBe(true);

    // After the access loss the provider is stopped: a further edit must not
    // queue a new push, so the relay is never hammered post-revoke.
    doc.getMap("body").set("text", "second edit");
    await vi.advanceTimersByTimeAsync(5000);
    expect(pushes).toBe(1);

    provider.destroy();
  });

  it("caught-up epoch is sent on every push, and a fenced push retires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const retired: boolean[] = [];
    const pushed: Array<{ epoch?: number }> = [];
    let pushes = 0;
    let catchUpDone = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (init?.method === "POST") {
          pushes += 1;
          pushed.push(JSON.parse(String(init.body)) as { epoch?: number });
          // First push accepted; the second is fenced out (generation retired).
          return pushes === 1
            ? jsonResponse({ seq: 1, epoch: 5 })
            : jsonResponse({ retired: true, epoch: 6 });
        }
        if (!catchUpDone) {
          catchUpDone = true;
          return catchUpResponse({ epoch: 5 });
        }
        return new Promise<Response>(() => {});
      }),
    );
    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, {
      postId: "epoch-fence",
      userName: "Ada",
      color: "#112233",
      canPush: true,
      onRetired: () => retired.push(true),
    });
    await provider.start();

    doc.getMap("body").set("t", "one");
    await vi.advanceTimersByTimeAsync(400);
    expect(pushed[0].epoch).toBe(5); // caught up under epoch 5

    doc.getMap("body").set("t", "two");
    await vi.advanceTimersByTimeAsync(400);
    // The fenced push triggers a retirement (the editor will reload/reseed).
    expect(retired).toEqual([true]);

    provider.destroy();
  });

  it("retires on a poll that reports a new epoch and never applies its rows", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const retired: boolean[] = [];
    let catchUpDone = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (url.includes("wait=0")) {
          catchUpDone = true;
          return catchUpResponse({ epoch: 3 });
        }
        // The long-poll returns a DIFFERENT (advanced) epoch with a row: the
        // generation was retired. The row must NOT be applied to the stale doc.
        return jsonResponse({
          updates: [{ seq: 9, update: "not-a-real-update" }],
          seq: 9,
          epoch: 4,
        });
      }),
    );
    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, {
      postId: "epoch-poll",
      userName: "Ada",
      color: "#112233",
      canPush: false, // a viewer follows along and still learns of retirement
      onRetired: () => retired.push(true),
    });
    await provider.start();
    expect(catchUpDone).toBe(true);
    await vi.advanceTimersByTimeAsync(50); // let one poll iteration run
    expect(retired).toEqual([true]);
    // The doc was never mutated by the retired epoch's row.
    expect(doc.getMap("body").size).toBe(0);

    provider.destroy();
  });

  it("pauses collaboration traffic while hidden and resumes it when visible", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });

    let visibilityState: "hidden" | "visible" = "hidden";
    const visibilityListeners = new Set<() => void>();
    vi.stubGlobal("document", {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: (event: string, listener: () => void) => {
        if (event === "visibilitychange") visibilityListeners.add(listener);
      },
      removeEventListener: (event: string, listener: () => void) => {
        if (event === "visibilitychange") visibilityListeners.delete(listener);
      },
    });

    let caughtUp = false;
    const longPollSignals: AbortSignal[] = [];
    const presenceMethods: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/presence")) {
          presenceMethods.push(init?.method ?? "GET");
          return jsonResponse({ presence: [] });
        }
        if (!caughtUp) {
          caughtUp = true;
          return catchUpResponse();
        }
        longPollSignals.push(init?.signal as AbortSignal);
        return new Promise<Response>(() => {});
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = providerFor(new Y.Doc(), "visibility-lifecycle");
    await provider.start();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibilityState = "visible";
    for (const listener of visibilityListeners) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(longPollSignals).toHaveLength(1);
    expect(presenceMethods.sort()).toEqual(["GET", "POST"]);

    visibilityState = "hidden";
    for (const listener of visibilityListeners) listener();
    expect(longPollSignals[0].aborted).toBe(true);
    const requestsAtPause = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(requestsAtPause);

    visibilityState = "visible";
    for (const listener of visibilityListeners) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(longPollSignals).toHaveLength(2);
    expect(presenceMethods.filter((method) => method === "GET")).toHaveLength(2);
    expect(presenceMethods.filter((method) => method === "POST")).toHaveLength(2);

    provider.destroy();
  });

  it("delivers queued edits over sendBeacon on pagehide", async () => {
    vi.useFakeTimers();
    const beacons: string[] = [];
    const pageListeners = new Map<string, Set<() => void>>();
    vi.stubGlobal("window", {
      addEventListener: (ev: string, fn: () => void) => {
        (pageListeners.get(ev) ?? pageListeners.set(ev, new Set()).get(ev)!).add(fn);
      },
      removeEventListener: (ev: string, fn: () => void) => {
        pageListeners.get(ev)?.delete(fn);
      },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    });
    vi.stubGlobal("navigator", {
      sendBeacon: vi.fn((url: string) => {
        beacons.push(url);
        return true;
      }),
    });
    let catchUpDone = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (init?.method === "POST") return new Promise<Response>(() => {}); // push never resolves: stays queued
        if (!catchUpDone) {
          catchUpDone = true;
          return catchUpResponse();
        }
        return new Promise<Response>(() => {});
      }),
    );

    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, {
      postId: "beacon-post",
      userName: "Ada",
      color: "#112233",
      canPush: true,
    });
    await provider.start();
    doc.getMap("body").set("text", "queued edit"); // enqueues a push (debounced)

    // The tab is closing before the debounced flush fires: the queued edit
    // must still be delivered, via a beacon to the collab push endpoint.
    for (const fn of pageListeners.get("pagehide") ?? []) fn();
    expect(beacons).toContain("/api/collab/beacon-post");

    provider.destroy();
  });

  // Shared harness for the beacon-invariant cases: a parked collab session whose
  // pushes never resolve, so any queued edit stays in the outbox until a beacon
  // (or the assertions) inspect it.
  function beaconHarness(postId: string) {
    const beacons: Array<{ url: string }> = [];
    const keepalives: Array<{ url: string; init: RequestInit }> = [];
    const pageListeners = new Map<string, Set<() => void>>();
    vi.stubGlobal("window", {
      addEventListener: (ev: string, fn: () => void) => {
        (pageListeners.get(ev) ?? pageListeners.set(ev, new Set()).get(ev)!).add(fn);
      },
      removeEventListener: (ev: string, fn: () => void) => {
        pageListeners.get(ev)?.delete(fn);
      },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    });
    vi.stubGlobal("navigator", {
      sendBeacon: vi.fn((url: string) => {
        beacons.push({ url });
        return true;
      }),
    });
    let catchUpDone = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (init?.method === "POST") {
          if (init.keepalive) keepalives.push({ url, init });
          return new Promise<Response>(() => {});
        }
        if (!catchUpDone) {
          catchUpDone = true;
          return catchUpResponse({ epoch: 5 });
        }
        return new Promise<Response>(() => {});
      }),
    );
    const firePageHide = () => {
      for (const fn of pageListeners.get("pagehide") ?? []) fn();
    };
    return { beacons, keepalives, firePageHide, base: `/api/collab/${postId}` };
  }

  it("uses an epoch-fenced keepalive fetch for a single over-limit update", async () => {
    vi.useFakeTimers();
    const { beacons, keepalives, firePageHide, base } = beaconHarness("beacon-big");
    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, {
      postId: "beacon-big",
      userName: "Ada",
      color: "#112233",
      canPush: true,
    });
    await provider.start();
    // An edit whose serialized update blows past the 60KB sendBeacon ceiling.
    doc.getText("big").insert(0, "x".repeat(80_000));

    firePageHide();
    // The update cannot fit in even an otherwise empty beacon envelope. It
    // must fall back to unload-safe fetch instead of disappearing with the tab.
    expect(beacons.some((b) => b.url === base)).toBe(false);
    expect(keepalives).toHaveLength(1);
    expect(keepalives[0]).toMatchObject({
      url: base,
      init: {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      },
    });
    const payload = JSON.parse(String(keepalives[0].init.body)) as {
      updates: string[];
      epoch?: number;
    };
    expect(payload.updates).toHaveLength(1);
    expect(payload.updates[0].length).toBeGreaterThanOrEqual(60_000);
    expect(payload.epoch).toBe(5);

    provider.destroy();
  });

  it("keeps the normal small-update pagehide path on sendBeacon", async () => {
    vi.useFakeTimers();
    const { beacons, keepalives, firePageHide, base } = beaconHarness("beacon-small");
    const doc = new Y.Doc();
    const provider = providerFor(doc, "beacon-small");
    await provider.start();
    doc.getMap("body").set("text", "small queued edit");

    firePageHide();

    expect(beacons.filter((b) => b.url === base)).toHaveLength(1);
    expect(keepalives).toHaveLength(0);
    provider.destroy();
  });

  it("retains beacon-queued edits for another pagehide and an acknowledged push", async () => {
    vi.useFakeTimers();
    const { beacons, firePageHide, base } = beaconHarness("beacon-splice");
    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, {
      postId: "beacon-splice",
      userName: "Ada",
      color: "#112233",
      canPush: true,
    });
    await provider.start();
    doc.getMap("body").set("text", "queued once");

    firePageHide();
    firePageHide();
    // Both beacons were queued but neither was acknowledged by the server.
    // The operations must still be available after a bfcache restore or retry.
    expect(beacons.filter((b) => b.url === base)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(300);
    const pushes = vi.mocked(fetch).mock.calls.filter(
      ([input, init]) => String(input) === base && init?.method === "POST",
    );
    expect(pushes).toHaveLength(1);
    const payload = JSON.parse(String(pushes[0][1]?.body));
    const recovered = new Y.Doc();
    for (const update of payload.updates) {
      Y.applyUpdate(recovered, new Uint8Array(Buffer.from(update, "base64")));
    }
    expect(recovered.getMap("body").get("text")).toBe("queued once");
    recovered.destroy();

    provider.destroy();
  });

  it("does not remove a newer edit when an in-flight push finishes after a beacon", async () => {
    vi.useFakeTimers();
    const pageListeners = new Map<string, Set<() => void>>();
    vi.stubGlobal("window", {
      addEventListener: (ev: string, fn: () => void) => {
        (pageListeners.get(ev) ?? pageListeners.set(ev, new Set()).get(ev)!).add(fn);
      },
      removeEventListener: (ev: string, fn: () => void) => {
        pageListeners.get(ev)?.delete(fn);
      },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    });
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => true) });
    const firstPush = deferred<Response>();
    const pushed: Array<{ updates: string[] }> = [];
    let caughtUp = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
        if (init?.method === "POST") {
          pushed.push(JSON.parse(String(init.body)) as { updates: string[] });
          return pushed.length === 1
            ? firstPush.promise
            : jsonResponse({ seq: 2, epoch: 0 });
        }
        if (!caughtUp) {
          caughtUp = true;
          return catchUpResponse();
        }
        return new Promise<Response>(() => {});
      }),
    );

    const doc = new Y.Doc();
    const provider = providerFor(doc, "beacon-inflight-race");
    await provider.start();
    doc.getMap("body").set("first", "in flight");
    await vi.advanceTimersByTimeAsync(300);
    expect(pushed).toHaveLength(1);

    for (const fn of pageListeners.get("pagehide") ?? []) fn();
    doc.getMap("body").set("second", "newer edit");
    firstPush.resolve(jsonResponse({ seq: 1, epoch: 0 }));
    await vi.advanceTimersByTimeAsync(300);

    expect(pushed).toHaveLength(2);
    const replayed = new Y.Doc();
    for (const payload of [pushed[0], pushed[1]]) {
      for (const update of payload.updates) {
        Y.applyUpdate(
          replayed,
          new Uint8Array(Buffer.from(update, "base64")),
        );
      }
    }
    expect(replayed.getMap("body").get("second")).toBe("newer edit");
    provider.destroy();
  });

  it("destroy() never sends an unauthenticated leave or drains the outbox", async () => {
    vi.useFakeTimers();
    const { beacons, base } = beaconHarness("beacon-destroy");
    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, {
      postId: "beacon-destroy",
      userName: "Ada",
      color: "#112233",
      canPush: true,
    });
    await provider.start();
    doc.getMap("body").set("text", "still queued");

    provider.destroy();
    // A React unmount with the tab still open: the module-level outbox survives,
    // so destroy must NOT flush edits (that is pagehide's job). This old-server
    // fixture supplied no session, so there is no authorized presence to leave.
    expect(beacons.some((b) => b.url === base)).toBe(false);
    expect(beacons.some((b) => b.url === `${base}/presence`)).toBe(false);
  });
});


describe("epoch-fenced materialization", () => {
  it("waits for a learned epoch and includes it on autosave and keepalive", async () => {
    vi.useFakeTimers();
    const initial = deferred<Response>();
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      if (String(input).endsWith("/materialize")) {
        requests.push(init);
        return jsonResponse({ ok: true });
      }
      if (String(input).endsWith("/presence")) return jsonResponse({ presence: [] });
      return initial.promise;
    }));
    const doc = new Y.Doc();
    const provider = providerFor(doc, "materialize-learned-epoch");
    const start = provider.start();
    expect(await provider.materialize("demo")).toBeNull();
    expect(requests).toHaveLength(0);
    initial.resolve(catchUpResponse({ epoch: 7 }));
    await start;
    doc.getText("local").insert(0, "Keep this");
    await provider.materialize("demo");
    await provider.materialize("demo", true);
    expect(requests.map((r) => r.keepalive)).toEqual([false, true]);
    for (const request of requests) {
      const body = JSON.parse(String(request.body));
      expect(body).toMatchObject({ handle: "demo", epoch: 7 });
      const restored = new Y.Doc();
      Y.applyUpdate(restored, Buffer.from(body.state, "base64"));
      expect(restored.getText("local").toString()).toBe("Keep this");
      restored.destroy();
    }
    provider.destroy();
  });

  it("retains the live state on a 409 and blocks queued or unload materialization", async () => {
    vi.useFakeTimers();
    const save = deferred<Response>();
    let retained = "";
    const doc = new Y.Doc();
    const onRetired = vi.fn(() => { retained = doc.getText("local").toString(); });
    const fetcher = vi.fn(async (input) => {
      if (String(input).endsWith("/materialize")) return save.promise;
      if (String(input).endsWith("/presence")) return jsonResponse({ presence: [] });
      return catchUpResponse({ epoch: 0 });
    });
    vi.stubGlobal("fetch", fetcher);
    const provider = new CollabProvider(doc, {
      postId: "materialize-rejected", userName: "Ada", color: "#112233", canPush: true, onRetired,
    });
    await provider.start();
    doc.getText("local").insert(0, "Rejected edit");
    const pending = provider.materialize("demo");
    doc.getText("local").insert(doc.getText("local").length, " plus newer edit");
    save.resolve(jsonResponse({ retired: true }, 409));
    expect((await pending)?.status).toBe(409);
    expect(onRetired).toHaveBeenCalledOnce();
    expect(retained).toBe("Rejected edit plus newer edit");
    expect(provider.learnedEpoch).toBe(0);
    expect(provider.materializationBlocked).toBe(true);
    expect(await provider.materialize("demo", true)).toBeNull();
    expect(await provider.materialize("demo")).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/materialize"))).toHaveLength(1);
    provider.destroy();
  });

  it("does not send state with the replacement epoch after relay retirement", async () => {
    vi.useFakeTimers();
    const poll = deferred<Response>();
    let first = true;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      if (String(input).endsWith("/presence")) return jsonResponse({ presence: [] });
      if (first) { first = false; return catchUpResponse({ epoch: 3 }); }
      return poll.promise;
    }));
    const provider = providerFor(new Y.Doc(), "materialize-retired-poll");
    await provider.start();
    poll.resolve(jsonResponse({ updates: [], seq: 0, epoch: 4 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.materializationBlocked).toBe(true);
    expect(provider.learnedEpoch).toBe(3);
    expect(await provider.materialize("demo")).toBeNull();
    provider.destroy();
  });
});

it("pins an unmounted document's epoch while a remount retires the shared outbox", async () => {
  vi.useFakeTimers();
  const save = deferred<Response>();
  let catchups = 0;
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/materialize")) {
      expect(JSON.parse(String(init?.body)).epoch).toBe(3);
      return save.promise;
    }
    if (url.endsWith("/presence")) return jsonResponse({ presence: [] });
    // Catch-up uses wait=0; long polls stay in flight.
    if (url.includes("wait=0")) return catchUpResponse({ epoch: ++catchups === 1 ? 3 : 4 });
    return new Promise<Response>(() => {});
  }));
  const oldDoc = new Y.Doc();
  const old = providerFor(oldDoc, "materialize-unmount-remount");
  await old.start();
  oldDoc.getText("local").insert(0, "Old queued edit");
  const pending = old.materialize("demo", true);
  old.destroy();
  const remount = providerFor(new Y.Doc(), "materialize-unmount-remount");
  await remount.start();
  expect(old.learnedEpoch).toBe(3);
  save.resolve(jsonResponse({ retired: true }, 409));
  await pending;
  expect(old.learnedEpoch).toBe(3);
  expect(old.materializationBlocked).toBe(true);
  expect(await old.materialize("demo")).toBeNull();
  remount.destroy();
});


it("notifies recovery when an unload materialization is rejected after destroy", async () => {
  vi.useFakeTimers();
  const save = deferred<Response>();
  const onRetired = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    if (String(input).endsWith("/materialize")) return save.promise;
    if (String(input).endsWith("/presence")) return jsonResponse({ presence: [] });
    return catchUpResponse({ epoch: 5 });
  }));
  const provider = new CollabProvider(new Y.Doc(), {
    postId: "materialize-rejected-after-unmount", userName: "Ada", color: "#112233", canPush: true, onRetired,
  });
  await provider.start();
  const pending = provider.materialize("demo", true);
  provider.destroy();
  save.resolve(jsonResponse({ retired: true }, 409));
  await pending;
  expect(onRetired).toHaveBeenCalledWith(5);
  expect(provider.materializationBlocked).toBe(true);
  expect(await provider.materialize("demo", true)).toBeNull();
});


it("does not invent epoch zero when catch-up omits its generation", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    if (String(input).endsWith("/presence")) return jsonResponse({ presence: [] });
    return jsonResponse({ updates: [], seq: 0, baseline: { update: BASELINE_UPDATE, revision: 1 } });
  }));
  const provider = providerFor(new Y.Doc(), "materialize-missing-learned-epoch");
  await provider.start();
  expect(provider.learnedEpoch).toBeNull();
  expect(await provider.materialize("demo", true)).toBeNull();
  provider.destroy();
});
