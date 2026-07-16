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
          return jsonResponse({ updates: [], seq: 0 });
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
          return jsonResponse({ updates: [], seq: 0 });
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
        if (init?.method === "POST") return new Promise<Response>(() => {});
        if (!catchUpDone) {
          catchUpDone = true;
          return jsonResponse({ updates: [], seq: 0 });
        }
        return new Promise<Response>(() => {});
      }),
    );
    const firePageHide = () => {
      for (const fn of pageListeners.get("pagehide") ?? []) fn();
    };
    return { beacons, firePageHide, base: `/api/collab/${postId}` };
  }

  it("skips the beacon for an over-limit payload so the normal flush keeps it", async () => {
    vi.useFakeTimers();
    const { beacons, firePageHide, base } = beaconHarness("beacon-big");
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
    // Over-limit: nothing is beaconed to the push endpoint (the edit stays in
    // the outbox for the chunked normal flush rather than being silently
    // dropped by sendBeacon).
    expect(beacons.some((b) => b.url === base)).toBe(false);

    provider.destroy();
  });

  it("splices delivered edits so a second pagehide does not double-send", async () => {
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
    // The first beacon delivered and spliced the outbox; the second finds an
    // empty queue and sends nothing. Exactly one push-endpoint beacon.
    expect(beacons.filter((b) => b.url === base)).toHaveLength(1);

    provider.destroy();
  });

  it("destroy() leaves presence but never drains the outbox over a beacon", async () => {
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
    // so destroy must NOT flush edits (that is pagehide's job). It DOES announce
    // a presence leave.
    expect(beacons.some((b) => b.url === base)).toBe(false);
    expect(beacons.some((b) => b.url === `${base}/presence`)).toBe(true);
  });
});
