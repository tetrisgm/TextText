import { describe, expect, it, vi } from "vitest";
import { SessionOwner, type OwnedSession } from "./session-owner";
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => resolve = done); return { promise, resolve }; }
function session(): OwnedSession {
  return { connected: true, start: vi.fn(async () => {}), setAttached: vi.fn(), save: vi.fn(async () => true), close: vi.fn() };
}
describe("page session ownership", () => {
  it("includes failed detached owners in application shutdown until storage recovers", async () => {
    const owner = new SessionOwner(), value = session(); value.save = vi.fn(async () => false);
    const a = owner.acquire("hidden", () => value); await a.ready;
    expect(await a.release()).toBe(false);
    expect(await owner.flushAll()).toBe(false); expect(owner.size).toBe(1);
    value.save = vi.fn(async () => true);
    expect(await owner.flushAll()).toBe(true);
    const b = owner.acquire("hidden", () => { throw Error("must retain"); }); await b.release();
  });
  it("refuses shutdown during file mutation and when a save throws", async () => {
    const owner = new SessionOwner(), value = session(), barrier = gate<void>();
    const a = owner.acquire("a", () => value); await a.ready;
    const operation = a.runExclusive(() => barrier.promise);
    expect(await owner.flushAll()).toBe(false);
    barrier.resolve(); await operation;
    value.save = vi.fn(async () => { throw Error("disk unavailable"); });
    expect(await owner.flushAll()).toBe(false);
    value.save = vi.fn(async () => true); await a.release();
  });
  it("refuses shutdown when another document opens during a captured flush", async () => {
    const owner = new SessionOwner(), value = session(), commit = gate<boolean>(); value.save = () => commit.promise;
    const a = owner.acquire("a", () => value); await a.ready;
    const flushing = owner.flushAll();
    const b = owner.acquire("b", session); await b.ready;
    commit.resolve(true); expect(await flushing).toBe(false);
    expect(await owner.flushAll()).toBe(true); await a.release(); await b.release();
  });
  it("rechecks an earlier owner when a view attaches while a later owner saves", async () => {
    const owner = new SessionOwner(), later = session(), commit = gate<boolean>(); later.save = () => commit.promise;
    const a = owner.acquire("a", session), b = owner.acquire("b", () => later); await Promise.all([a.ready,b.ready]);
    const flushing = owner.flushAll(); await Promise.resolve(); await Promise.resolve();
    const again = owner.acquire("a", session);
    commit.resolve(true); expect(await flushing).toBe(false);
    await again.release(); await a.release(); await b.release();
  });
  it("shares a lifecycle between views and closes once after the last idempotent release", async () => {
    const owner = new SessionOwner(), value = session(), create = vi.fn(() => value);
    const a = owner.acquire("account/workspace/item", create), b = owner.acquire("account/workspace/item", create);
    await a.ready; expect(a.session).toBe(b.session); expect(a.lifecycle).toBe(b.lifecycle); expect(create).toHaveBeenCalledTimes(1);
    expect(await a.release()).toBe(true); expect(await a.release()).toBe(true); expect(value.close).not.toHaveBeenCalled();
    expect(await b.release()).toBe(true); expect(value.save).toHaveBeenCalledTimes(1); expect(value.close).toHaveBeenCalledTimes(1); expect(owner.size).toBe(0);
  });
  it("retains ownership and the document until a delayed local commit finishes", async () => {
    const owner = new SessionOwner(), value = session(), commit = gate<boolean>(); value.save = vi.fn(() => commit.promise);
    const a = owner.acquire("a", () => value); await a.ready; const release = a.release(); await Promise.resolve();
    expect(a.phase).toBe("draining"); expect(owner.size).toBe(1); expect(value.close).not.toHaveBeenCalled();
    commit.resolve(true); expect(await release).toBe(true); expect(a.phase).toBe("closed");
  });
  it("invalidates an old drain when a second view reacquires the same document", async () => {
    const owner = new SessionOwner(), value = session(), commit = gate<boolean>(); value.save = vi.fn(() => commit.promise);
    const a = owner.acquire("a", () => value); await a.ready; const release = a.release(); await Promise.resolve();
    const b = owner.acquire("a", () => { throw Error("must reuse"); }); commit.resolve(true);
    expect(await release).toBe(false); expect(value.close).not.toHaveBeenCalled(); expect(b.phase).toBe("ready");
    expect(await b.release()).toBe(true); expect(value.close).toHaveBeenCalledTimes(1);
  });
  it("keeps failed saves available to a later view without starting another writer", async () => {
    const owner = new SessionOwner(), value = session(); value.save = vi.fn(async () => false);
    const a = owner.acquire("a", () => value); await a.ready;
    expect(await a.release()).toBe(false); expect(a.phase).toBe("retained-error"); expect(value.close).not.toHaveBeenCalled();
    const b = owner.acquire("a", () => { throw Error("must retain"); }); expect(b.session).toBe(value);
    value.save = vi.fn(async () => true); expect(await b.release()).toBe(true); expect(owner.size).toBe(0);
  });
  it("awaits a cancelled open before releasing any resulting resources", async () => {
    const owner = new SessionOwner(), value = session(), opening = gate<void>(); value.start = vi.fn(() => opening.promise);
    const a = owner.acquire("a", () => value); const release = a.release(); await Promise.resolve();
    expect(value.close).not.toHaveBeenCalled(); opening.resolve(); expect(await release).toBe(true); expect(value.close).toHaveBeenCalledTimes(1);
  });
  it("isolates accounts and workspace keys and assigns a new lifecycle after closing", async () => {
    const owner = new SessionOwner(), a = owner.acquire("A/W/item", session), b = owner.acquire("B/W/item", session), c = owner.acquire("A/V/item", session);
    expect(new Set([a.session,b.session,c.session]).size).toBe(3); await Promise.all([a.release(),b.release(),c.release()]);
    const next = owner.acquire("A/W/item", session); expect(next.lifecycle).not.toBe(a.lifecycle); await next.release();
  });
  it("rejects resetting a session held by another view before invoking prepare", async () => {
    const owner = new SessionOwner(), value = session(), a = owner.acquire("a", () => value), b = owner.acquire("a", () => value), prepare = vi.fn();
    await expect(a.closeExclusive(prepare)).rejects.toThrow("other view"); expect(prepare).not.toHaveBeenCalled();
    await b.release(); expect(await a.closeExclusive(prepare)).toBe(true); expect(prepare).toHaveBeenCalledOnce(); expect(await a.release()).toBe(true);
  });
  it("blocks acquire during asynchronous final close and permits retry afterward", async () => {
    const owner = new SessionOwner(), value = session(), closing = gate<void>(); value.close = vi.fn(() => closing.promise);
    const a = owner.acquire("a", () => value); await a.ready; const releasing = a.release();
    await vi.waitFor(() => expect(value.close).toHaveBeenCalledOnce()); expect(() => owner.acquire("a", session)).toThrow("finishing a save");
    closing.resolve(); await releasing; const b = owner.acquire("a", session); await b.release();
  });
  it("retains a throwing close for recovery and retries it with the same owner", async () => {
    const owner = new SessionOwner(), value = session(); value.close = vi.fn(() => { throw Error("native close failed"); });
    const a = owner.acquire("a", () => value); expect(await a.closeExclusive()).toBe(false); expect(a.phase).toBe("retained-error"); expect(owner.size).toBe(1);
    value.close = vi.fn(); expect(await a.closeExclusive()).toBe(true); expect(owner.size).toBe(0);
  });
  it("saves before retirement and waits for it even when the view unmounts", async () => {
    const owner = new SessionOwner(), value = session(), retired = gate<void>(), events: string[] = [];
    value.save = async () => { events.push("saved"); return true; }; value.close = () => { events.push("closed"); };
    const a = owner.acquire("a", () => value); await a.ready;
    const reset = a.closeExclusive(async () => { events.push("retiring"); await retired.promise; });
    await vi.waitFor(() => expect(events).toEqual(["saved", "retiring"]));
    const release = a.release(); expect(() => owner.acquire("a", session)).toThrow("finishing a save");
    retired.resolve(); expect(await reset).toBe(true); expect(await release).toBe(true);
    expect(events).toEqual(["saved", "retiring", "closed"]); expect(owner.size).toBe(0);
  });
  it("keeps a file mutation exclusive through unmount and its explicit reopen", async () => {
    const owner = new SessionOwner(), value = session(), barrier = gate<void>();
    const a = owner.acquire("a", () => value); await a.ready;
    const mutation = a.runExclusive(async () => { await barrier.promise; return a.closeExclusive(); });
    expect(() => owner.acquire("a", session)).toThrow("finishing a save");
    const release = a.release(); expect(value.close).not.toHaveBeenCalled();
    barrier.resolve(); expect(await mutation).toBe(true); expect(await release).toBe(true);
    expect(value.close).toHaveBeenCalledOnce(); expect(owner.size).toBe(0);
  });
  it("refuses file mutations shared with another view before invoking them", async () => {
    const owner = new SessionOwner(), a = owner.acquire("a", session), b = owner.acquire("a", session), mutation = vi.fn(async () => {});
    await expect(a.runExclusive(mutation)).rejects.toThrow("other view"); expect(mutation).not.toHaveBeenCalled();
    await a.release(); await b.release();
  });
  it("retains the closed owner tombstone through an external file write", async () => {
    const owner = new SessionOwner(), value = session(), writing = gate<void>();
    const a = owner.acquire("a", () => value); await a.ready;
    const mutation = a.runExclusive(async () => {
      expect(await a.closeExclusive()).toBe(true);
      await writing.promise;
    });
    await vi.waitFor(() => expect(a.phase).toBe("closed"));
    expect(owner.size).toBe(1);
    expect(() => owner.acquire("a", session)).toThrow("finishing a save");
    const release = a.release();
    writing.resolve(); await mutation; expect(await release).toBe(true);
    expect(owner.size).toBe(0);
    const next = owner.acquire("a", session); await next.release();
  });
  it("releases only the exact closed tombstone after a failed external write", async () => {
    const owner = new SessionOwner(), value = session();
    const a = owner.acquire("a", () => value); await a.ready;
    await expect(a.runExclusive(async () => {
      expect(await a.closeExclusive()).toBe(true);
      expect(() => owner.acquire("a", session)).toThrow("finishing a save");
      throw Error("CAS refused");
    })).rejects.toThrow("CAS refused");
    expect(owner.size).toBe(0);
    const next = owner.acquire("a", session); expect(next.lifecycle).not.toBe(a.lifecycle); await next.release();
  });

});

describe("detached ownership diagnostics", () => {
  it("reads only stored scalars and returns no owned references across 25 cycles", async () => {
    const owner = new SessionOwner();
    for (let n = 0; n < 25; n++) {
      const value = session(), handle = owner.acquire(`private-${n}`, () => value); await handle.ready;
      const connected = Object.getOwnPropertyDescriptor(value, "connected")!;
      Object.defineProperty(value, "connected", { configurable: true, get() { throw Error("diagnostics invoked session getter"); } });
      const snapshot = owner.diagnostics;
      expect(snapshot.entries).toBe(1); expect(snapshot.attachedRefs).toBe(1);
      expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.storedPhaseCounts)).toBe(true);
      expect(JSON.stringify(snapshot)).not.toContain("private-");
      Object.defineProperty(value, "connected", connected);
      await handle.release(); expect(owner.diagnostics.entries).toBe(0);
      expect(snapshot.entries).toBe(1); expect(value.close).toHaveBeenCalledOnce();
    }
  });
  it("reports retained failures without calling recovery", async () => {
    const owner = new SessionOwner(), value = session(); value.save = vi.fn(async () => false);
    const handle = owner.acquire("secret", () => value); await handle.ready; await handle.release();
    const calls = vi.mocked(value.save).mock.calls.length;
    expect(owner.diagnostics.storedPhaseCounts?.["retained-error"]).toBe(1);
    expect(vi.mocked(value.save).mock.calls.length).toBe(calls);
    value.save = vi.fn(async () => true); await owner.acquire("secret", () => value).release();
  });
});

it("diagnostics count the closed external-write tombstone without calling it an active document", async () => {
  const owner = new SessionOwner(), value = session(), external = gate<void>();
  const handle = owner.acquire("private", () => value); await handle.ready;
  const action = handle.runExclusive(async () => {
    expect(await handle.closeExclusive()).toBe(true);
    expect(owner.diagnostics).toMatchObject({ entries: 1, attachedRefs: 0, closing: 1, operationBusy: 1, storedPhaseCounts: { closed: 1 } });
    expect(() => owner.acquire("private", session)).toThrow("finishing a save");
    await external.promise;
  });
  await vi.waitFor(() => expect(value.close).toHaveBeenCalledOnce());
  expect(owner.diagnostics.entries).toBe(1);
  external.resolve(); await action;
  expect(owner.diagnostics).toMatchObject({ entries: 0, attachedRefs: 0, closing: 0, operationBusy: 0, storedPhaseCounts: { closed: 0 } });
});
