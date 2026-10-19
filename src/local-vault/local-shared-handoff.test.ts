import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { handoffLocalToShared, type LocalSharedHandoffOptions } from "./local-shared-handoff";
import type { FileCollaborationDurabilityResult } from "@/sync/engine/client";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const base = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  const handle = { id: "retained-native-owner" };
  const scope = { workspaceId: "workspace", itemId: "item", lifecycle: "captured-lifecycle" };
  const drain = deferred<{ file: { path: string; hash: string; markdown: string }; base: typeof base }>();
  const opened = deferred<void>(), ack = deferred<FileCollaborationDurabilityResult>(), finalAck = deferred<FileCollaborationDurabilityResult>();
  const events: string[] = [], merges: string[][] = [], cleared: number[] = [], retained: unknown[] = [];
  let generation = 1, current = base, valid = true, writesPaused = false, committed = false, receipts = 0;
  const receipt = (value = 4): FileCollaborationDurabilityResult => ({ ...scope, generation: value, outcome: "durable" });
  const options: LocalSharedHandoffOptions<typeof handle> = {
    assertCurrent: () => { if (!valid) throw Error("superseded owner"); },
    capture: () => ({ generation, document: current }),
    pauseAndDrain: () => { events.push("pause"); writesPaused = true; return drain.promise; },
    beginOpen: () => { expect(writesPaused).toBe(true); events.push("open"); return { handle, ready: opened.promise }; },
    scope: () => scope,
    merge: (_handle, before, local) => { merges.push([before.content.body, local.content.body]); events.push("merge"); return merges.length === 1 ? 4 : 5; },
    durability: () => { events.push("durability"); return receipts++ === 0 ? ack.promise : finalAck.promise; },
    atomicCommit: (_handle, expected) => { expect(expected).toBe(generation); events.push("commit"); committed = true; return true; },
    acknowledgeDraft: async (_handle, expected) => { events.push("clear"); cleared.push(expected); },
    retain: (error, owner) => { retained.push({ error, owner }); events.push("retain"); },
  };
  const input = (body: string) => { generation++; current = { ...current, content: { ...current.content, body } }; };
  const releaseDrain = () => drain.resolve({ file: { path: "Notes/New.textpack", hash: "exact", markdown: "" }, base });
  return { options, handle, scope, drain, opened, ack, finalAck, receipt, releaseDrain, input, events, merges, cleared, retained,
    invalidate: () => { valid = false; }, committed: () => committed };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("bounded single-view local to shared handoff", () => {
  it("captures input across drain/open/ACK without waiting for typing to stop and clears only transferred generation", async () => {
    const f = fixture(), result = handoffLocalToShared(f.options);
    expect(f.events).toEqual(["pause"]);
    f.input("during drain"); f.releaseDrain(); await tick();
    f.input("during native open"); f.opened.resolve(); await tick();
    expect(f.merges).toEqual([["", "during native open"]]);
    f.input("during first durable ACK"); f.ack.resolve(f.receipt()); await tick();
    expect(f.committed()).toBe(true);
    expect(f.merges).toEqual([["", "during native open"], ["during native open", "during first durable ACK"]]);
    expect(f.cleared).toEqual([]);
    f.input("new shared input after commit"); f.finalAck.resolve(f.receipt(5));
    expect(await result).toEqual({ state: "shared", handle: f.handle });
    expect(f.cleared).toEqual([4]);
    expect(f.events).toEqual(["pause", "open", "merge", "durability", "merge", "commit", "durability", "clear"]);
  });
  it.each(["drain", "open", "first ACK", "final ACK"])("retains owner and draft on failed %s without clearing or fallback", async stage => {
    const f = fixture(), result = handoffLocalToShared(f.options);
    if (stage === "drain") f.drain.reject(Error("write failed"));
    else {
      f.releaseDrain(); await tick();
      if (stage === "open") f.opened.reject(Error("unknown lease outcome"));
      else {
        f.opened.resolve(); await tick();
        if (stage === "first ACK") f.ack.reject(Error("checkpoint unavailable"));
        else { f.ack.resolve(f.receipt()); await tick(); f.finalAck.reject(Error("checkpoint unavailable")); }
      }
    }
    expect((await result).state).toBe("retained");
    expect(f.cleared).toEqual([]); expect(f.retained).toHaveLength(1);
    if (stage !== "drain") expect(f.retained[0]).toMatchObject({ owner: f.handle });
    expect(f.events).not.toContain("resume");
  });
  it.each(["drain", "open", "ACK"])("fences a superseded owner after %s", async stage => {
    const f = fixture(), result = handoffLocalToShared(f.options);
    if (stage === "drain") { f.invalidate(); f.releaseDrain(); }
    else {
      f.releaseDrain(); await tick();
      if (stage === "open") { f.invalidate(); f.opened.resolve(); }
      else { f.opened.resolve(); await tick(); f.invalidate(); f.ack.resolve(f.receipt()); }
    }
    expect((await result).state).toBe("retained"); expect(f.cleared).toEqual([]); expect(f.committed()).toBe(false);
  });
  it.each(["pending", "wrong lifecycle", "wrong item", "generation rollback", "stale first target", "stale final target"])("refuses a %s receipt", async mode => {
    const f = fixture(), result = handoffLocalToShared(f.options);
    f.releaseDrain(); await tick(); f.opened.resolve(); await tick();
    if (mode === "stale first target") f.ack.resolve(f.receipt(3));
    else if (mode === "stale final target") { f.ack.resolve(f.receipt(4)); await tick(); f.finalAck.resolve(f.receipt(4)); }
    else if (mode === "generation rollback") { f.ack.resolve(f.receipt(4)); await tick(); f.finalAck.resolve(f.receipt(3)); }
    else f.ack.resolve({ ...f.receipt(), ...(mode === "pending" ? { outcome: "pending" as const } : mode === "wrong item" ? { itemId: "other" } : { lifecycle: "other" }) });
    expect((await result).state).toBe("retained"); expect(f.cleared).toEqual([]);
  });
  it.each([null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("retains an invalid merge target %s", async target => {
    const f = fixture(); f.options.merge = () => target;
    const result = handoffLocalToShared(f.options); f.releaseDrain(); await tick(); f.opened.resolve();
    expect((await result).state).toBe("retained"); expect(f.cleared).toEqual([]); expect(f.committed()).toBe(false);
  });
  it("rejects a target rollback before transferring view ownership", async () => {
    const f = fixture(); let count = 0;
    f.options.merge = () => count++ === 0 ? 4 : 3;
    const result = handoffLocalToShared(f.options); f.releaseDrain(); await tick(); f.opened.resolve(); await tick();
    f.ack.resolve(f.receipt(4));
    expect((await result).state).toBe("retained"); expect(f.committed()).toBe(false); expect(f.cleared).toEqual([]);
  });
  it.each(["merge", "commit", "draft removal"])("retains on %s refusal", async mode => {
    const f = fixture();
    if (mode === "merge") f.options.merge = () => null;
    if (mode === "commit") f.options.atomicCommit = () => false;
    if (mode === "draft removal") f.options.acknowledgeDraft = async () => { throw Error("storage failed"); };
    const result = handoffLocalToShared(f.options); f.releaseDrain(); await tick(); f.opened.resolve(); await tick();
    f.ack.resolve(f.receipt()); await tick(); f.finalAck.resolve(f.receipt(5));
    expect((await result).state).toBe("retained"); expect(f.cleared).toEqual([]);
  });
});
