import { describe, expect, it } from "vitest";
import { prepareSharedNote } from "./new-note-promotion";
import type { VaultFile } from "./bridge";

const initial: VaultFile = { path: "Notes/New.textpack", hash: "first", markdown: '---\ntextTextId: "note-1"\n---\n', documentJSON: "{}" };
const shared = { namespace: "https://texttext.app/", workspaceId: "workspace", itemId: "note-1", localFiles: true };

describe("new note promotion", () => {
  it("waits for the saved local revision to become the acknowledged shared file", async () => {
    const events: string[] = [];
    let file = initial;
    let synced = false;
    const options = {
      path: initial.path, candidate: shared,
      flush: async () => { events.push("flush"); file = { ...file, hash: "edited" }; return true; },
      hasDraft: () => false,
      read: async () => { events.push("read"); return file; },
      config: async () => { events.push("config"); return synced ? shared : null; },
    };
    expect(await prepareSharedNote(options)).toBeNull();
    expect(events).toEqual(["flush", "read", "config"]);
    synced = true;
    events.length = 0;
    expect(await prepareSharedNote({ ...options, flush: async () => { events.push("flush"); return true; } })).toEqual({ config: shared, file });
    expect(events).toEqual(["flush", "read", "config", "read"]);
  });

  it("keeps local mode if saving fails, a draft remains, or the file changes during promotion", async () => {
    const base = { path: initial.path, candidate: shared, read: async () => initial, config: async () => shared,
      flush: async () => true, hasDraft: () => false };
    expect(await prepareSharedNote({ ...base, flush: async () => false })).toBeNull();
    expect(await prepareSharedNote({ ...base, hasDraft: () => true })).toBeNull();
    let reads = 0;
    expect(await prepareSharedNote({ ...base, read: async () => ({ ...initial, hash: String(++reads) }) })).toBeNull();
    expect(await prepareSharedNote({ ...base, config: async () => ({ ...shared, workspaceId: "other" }) })).toBeNull();
  });
});
