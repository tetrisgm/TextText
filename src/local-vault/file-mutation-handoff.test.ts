import { describe, expect, it, vi } from "vitest";
import { SessionOwner } from "@/sync/session-owner";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import type { VaultDocumentSession } from "./document-session";
import { closeFileMutationOwner, guardFileMutationInput } from "./file-mutation-handoff";

function fixture() {
  const document = emptyDocumentSnapshot();
  const source = { path: "Owned.textpack", hash: "a".repeat(64), markdown: "Owned" };
  let generation = 1;
  const events: string[] = [];
  const client = { get localDurabilityTarget() { return { generation, lifecycle: "owned", epoch: 1 }; },
    hasPendingChanges: false, hasUnreadableJournal: false, setActive: vi.fn(),
    discardCleanJournalDurably: vi.fn(async () => { events.push("discard"); }) };
  const session = { connected: true, start: async () => {}, setAttached: () => {}, client, file: source, snapshot: document,
    save: vi.fn(async () => { events.push("save"); return true; }), close: vi.fn(async () => { events.push("close"); }) };
  const owner = new SessionOwner<VaultDocumentSession>();
  const handle = owner.acquire("owned", () => session as unknown as VaultDocumentSession);
  return { document, source, client, session, owner, handle, events, advance: () => { generation++; } };
}
describe("external file mutation durable handoff", () => {
  it("saves, discards clean history durably and closes before the write for either transport", async () => {
    for (const localFiles of [true, false]) {
      const f = fixture(); await f.handle.ready;
      await f.handle.runExclusive(async () => {
        await closeFileMutationOwner(f.handle, f.source, f.document, () => {});
        expect(f.events).toEqual(["save", "discard", "close"]);
        expect(f.owner.size).toBe(1); f.events.push(localFiles ? "native-write" : "hosted-write");
      });
      expect(f.owner.size).toBe(0);
    }
  });
  it("retains an unsuccessful save without discarding or writing", async () => {
    const f = fixture(); f.session.save.mockResolvedValue(false); await f.handle.ready;
    await expect(f.handle.runExclusive(() => closeFileMutationOwner(f.handle, f.source, f.document, () => {}))).rejects.toThrow("Save or recover");
    expect(f.client.discardCleanJournalDurably).not.toHaveBeenCalled(); expect(f.session.close).not.toHaveBeenCalled(); expect(f.owner.size).toBe(1);
  });
  it("refuses a generation accepted during save before clearing the journal", async () => {
    const f = fixture(); f.session.save.mockImplementation(async () => { f.advance(); return true; }); await f.handle.ready;
    await expect(f.handle.runExclusive(() => closeFileMutationOwner(f.handle, f.source, f.document, () => {}))).rejects.toThrow("Save or recover");
    expect(f.client.discardCleanJournalDurably).not.toHaveBeenCalled(); expect(f.session.close).not.toHaveBeenCalled(); expect(f.owner.size).toBe(1);
  });
  it("refuses a late generation at native close without authorizing any write", async () => {
    const f = fixture(); f.session.close.mockImplementation(async () => { f.advance(); }); await f.handle.ready;
    const write = vi.fn();
    await expect(f.handle.runExclusive(async () => { await closeFileMutationOwner(f.handle, f.source, f.document, () => {}); write(); })).rejects.toThrow("shared document changed");
    expect(write).not.toHaveBeenCalled(); expect(f.owner.size).toBe(0);
  });
  it("refuses a changed view, source, unreadable journal or pending input", async () => {
    for (const kind of ["view", "source", "unreadable", "pending"]) {
      const f = fixture(); await f.handle.ready;
      if (kind === "source") f.session.file = { ...f.source, hash: "b".repeat(64) };
      if (kind === "unreadable") f.client.hasUnreadableJournal = true;
      if (kind === "pending") f.client.hasPendingChanges = true;
      await expect(f.handle.runExclusive(() => closeFileMutationOwner(f.handle, f.source, f.document, () => { if (kind === "view") throw Error("changed view"); }))).rejects.toThrow();
      expect(f.client.discardCleanJournalDurably).not.toHaveBeenCalled(); expect(f.session.close).not.toHaveBeenCalled();
    }
  });
});

describe("file mutation input guard lifetime", () => {
  it("blocks plain editing only while inert and removes exactly across 25 cycles", () => {
    const target = new EventTarget(), surface = { inert: true, isConnected: true } as HTMLElement;
    const add = vi.spyOn(target, "addEventListener"), remove = vi.spyOn(target, "removeEventListener");
    const key = (value: string, modifiers = {}) => Object.assign(new Event("keydown", { cancelable: true }), { key: value, metaKey: false, ctrlKey: false, altKey: false, ...modifiers });
    for (let cycle = 0; cycle < 25; cycle++) {
      const cleanup = guardFileMutationInput(surface, target as unknown as Window);
      for (const value of ["n", "a", "b", "c", "Enter", "Backspace", "Delete"]) {
        const event = key(value); target.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
      }
      for (const modifiers of [{metaKey:true}, {ctrlKey:true}, {altKey:true}]) {
        const event = key("q", modifiers); target.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
      }
      surface.inert = false; const active = key("n"); target.dispatchEvent(active); expect(active.defaultPrevented).toBe(false); surface.inert = true;
      cleanup(); cleanup(); const after = key("n"); target.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
    }
    expect(add).toHaveBeenCalledTimes(25); expect(remove).toHaveBeenCalledTimes(25);
  });
});
