import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentText } from "@/lib/collab/document";
import { applyVaultCollaboration, seedVaultCollaboration } from "@/lib/vault/collaboration";
import { FileCollaborationClient, type FileCollaborationJournalStore, type FileCollaborationRequest, type FileCollaborationCheckpoint, selectFileCollaborationJournal, createFileCollaborationOwnership } from "./collaboration-client";

class Journal implements FileCollaborationJournalStore {
  values = new Map<string, string>(); fail = false;
  load(key: string) { return this.values.get(key) ?? null; }
  save(key: string, value: string) { if (this.fail) throw new Error("disk full"); this.values.set(key, value); }
  remove(key: string) { this.values.delete(key); }
}
function pack() {
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); document.content.body = "Hello";
  return buildTextpack("Shared", { document, markdown: '---\ntextTextId: item-1\n---\n\nHello' });
}
class Server {
  bytes: Uint8Array = pack(); state = seedVaultCollaboration(this.bytes, "item-1", 1);
  canEdit = true; pushes: string[] = []; reads = 0; aborted = 0; loseAck = false;
  receipts = new Set<string>(); waiters = new Set<() => void>();
  response() { return { ...this.state, relativePath: "Shared.textpack", canEditContent: this.canEdit, canComment: true }; }
  wake() { for (const resolve of [...this.waiters]) resolve(); }
  request: FileCollaborationRequest = async (method, params, signal) => {
    if (method === "read") {
      this.reads++;
      if (params.waitMs && params.epoch === this.state.epoch && params.seq === this.state.seq) {
        await new Promise<void>((resolve, reject) => {
          const done = () => { this.waiters.delete(done); signal.removeEventListener("abort", abort); resolve(); };
          const abort = () => { this.aborted++; this.waiters.delete(done); reject(new DOMException("Aborted", "AbortError")); };
          this.waiters.add(done); signal.addEventListener("abort", abort, { once: true });
        });
      }
      return this.response();
    }
    const id = params.operationId as string; this.pushes.push(id);
    if (!this.canEdit) throw Object.assign(new Error("Forbidden"), { status: 403 });
    if (params.epoch !== this.state.epoch) throw Object.assign(new Error("Epoch"), { status: 409, code: "epoch_changed" });
    if (!this.receipts.has(id)) {
      const next = applyVaultCollaboration(this.state, this.bytes, params.updates as string[]);
      this.bytes = next.bytes; this.state = next.state; this.receipts.add(id); this.wake();
    }
    if (this.loseAck) { this.loseAck = false; throw new Error("Network disconnected"); }
    return { status: "written", revision: this.state.revision };
  };
}
const clients: FileCollaborationClient[] = [];
function client(server: Server, journal = new Journal(), request = server.request) {
  const result = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request });
  clients.push(result); return result;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const entry of clients.splice(0)) entry.destroy(); vi.useRealTimers(); });

describe("durable file collaboration client", () => {
  it("converges two real Yjs clients through the pack engine without idle uploads", async () => {
    const server = new Server(), alice = client(server), bob = client(server);
    await Promise.all([alice.start(), bob.start()]);
    expect(alice.hasBaseline).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.waiters.size).toBe(2); expect(server.pushes).toHaveLength(0);
    alice.mutate(doc => documentText(doc, "body").insert(5, " Alice"));
    bob.mutate(doc => documentText(doc, "body").insert(0, "Bob "));
    expect(await alice.flush()).toBe(true); expect(await bob.flush()).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(documentText(alice.doc, "body").toString()).toBe("Bob Hello Alice");
    expect(documentText(bob.doc, "body").toString()).toBe("Bob Hello Alice");
    const count = server.pushes.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.pushes).toHaveLength(count);
    alice.destroy(); bob.destroy();
    expect(server.waiters.size).toBe(0); expect(server.aborted).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resumes a lost acknowledgement with the exact operation identifier after restart", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); first.mutate(doc => documentText(doc, "body").insert(5, " once"));
    expect(journal.load(first.journalKey)).toContain('"pending":["');
    server.loseAck = true;
    expect(await first.flush()).toBe(false);
    const operation = server.pushes[0]; first.destroy();
    const resumed = client(server, journal); await resumed.start();
    expect(await resumed.flush()).toBe(true);
    expect(server.pushes).toEqual([operation, operation]);
    expect(documentText(resumed.doc, "body").toString()).toBe("Hello once");
    expect(resumed.recoveryJournal?.batch).toBeNull();
  });

  it("keeps later local edits separate from the immutable in-flight batch", async () => {
    const server = new Server(), journal = new Journal();
    let release!: () => void; let hold = true;
    const request: FileCollaborationRequest = async (method, params, signal) => {
      const response = await server.request(method, params, signal);
      if (method === "push" && hold) { hold = false; await new Promise<void>(resolve => { release = resolve; }); }
      return response;
    };
    const editor = client(server, journal, request); await editor.start();
    editor.mutate(doc => documentText(doc, "body").insert(5, " first"));
    const flushing = editor.flush(); await Promise.resolve(); await Promise.resolve();
    editor.mutate(doc => documentText(doc, "body").insert(11, " later"));
    expect(editor.recoveryJournal?.pending.length).toBe(1);
    release(); expect(await flushing).toBe(true);
    expect(new Set(server.pushes).size).toBe(2);
    expect(editor.recoveryJournal?.pending).toEqual([]);
    expect(documentText(editor.doc, "body").toString()).toBe("Hello first later");
  });

  it("retires pending changes on epoch replacement or permission loss and never uploads them", async () => {
    for (const epochChanged of [true, false]) {
      const server = new Server(), journal = new Journal(), editor = client(server, journal);
      await editor.start(); await vi.advanceTimersByTimeAsync(1);
      editor.mutate(doc => documentText(doc, "body").insert(5, " pending"));
      if (epochChanged) server.state = seedVaultCollaboration(server.bytes, "item-1", 2);
      else server.canEdit = false;
      server.wake(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(editor.status).toBe("recovery"); expect(editor.canEdit).toBe(false);
      expect(editor.recoveryJournal?.retired).toBeTruthy();
      expect(editor.recoveryJournal?.pending).toHaveLength(1);
      expect(await editor.flush()).toBe(false);
      expect(() => editor.mutate(() => {})).toThrow();
      editor.destroy();
      const reopened = client(server, journal); await reopened.start();
      expect(reopened.status).toBe("recovery"); expect(server.pushes).toHaveLength(0);
      reopened.destroy();
    }
  });

  it("stops requests while inactive, resumes pending work and surfaces storage failure", async () => {
    const server = new Server(), journal = new Journal(), editor = client(server, journal);
    await editor.start(); await vi.advanceTimersByTimeAsync(1);
    editor.setActive(false);
    editor.mutate(doc => documentText(doc, "body").insert(5, " offline"));
    const reads = server.reads;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.reads).toBe(reads); expect(server.pushes).toHaveLength(0);
    editor.setActive(true); await vi.advanceTimersByTimeAsync(1);
    expect(server.pushes).toHaveLength(1);
    journal.fail = true;
    editor.mutate(doc => documentText(doc, "body").insert(0, "Unsaved "));
    expect(editor.status).toBe("error"); expect(editor.canEdit).toBe(false);
    expect(editor.recoveryJournal?.pending).toHaveLength(1);
    expect(documentText(editor.doc, "body").toString()).toContain("Unsaved");
  });

  it("Retry connects an unopened inactive editor without waiting for a visibility event", async () => {
    const server = new Server(), journal = new Journal();
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      active: false, request: server.request });
    clients.push(editor);
    await editor.start();
    expect(editor.status).toBe("offline"); expect(editor.hasBaseline).toBe(false); expect(server.reads).toBe(0);
    await editor.retry();
    expect(editor.hasBaseline).toBe(true); expect(editor.status).toBe("ready"); expect(server.reads).toBe(1);
    editor.setActive(false);
    const before = server.reads;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.reads).toBe(before);
    await editor.retry(); await vi.advanceTimersByTimeAsync(1);
    expect(server.reads).toBeGreaterThan(before);
  });

  it("opens a retained canonical baseline offline and fences its pending edits when the epoch changes", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); first.destroy();
    const offline = client(server, journal, async () => { throw new Error("Network unavailable"); });
    await offline.start();
    expect(offline.hasBaseline).toBe(true); expect(offline.canEdit).toBe(true); expect(offline.status).toBe("offline");
    offline.mutate(doc => documentText(doc, "body").insert(5, " offline restart"));
    expect(offline.hasPendingChanges).toBe(true); offline.destroy();
    server.state = seedVaultCollaboration(server.bytes, "item-1", 2);
    const resumed = client(server, journal); await resumed.start();
    expect(resumed.status).toBe("recovery"); expect(server.pushes).toHaveLength(0);
    expect(documentText(resumed.doc, "body").toString()).toBe("Hello offline restart");
    resumed.clearRetiredAfterRecovery(); expect(journal.load(resumed.journalKey)).toBeNull();
  });

  it("resumes one cancelled poll after a rapid visibility toggle and backs off failed starts", async () => {
    const server = new Server(), editor = client(server);
    await editor.start(); await vi.advanceTimersByTimeAsync(1);
    editor.setActive(false); editor.setActive(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(server.waiters.size).toBe(1);
    editor.destroy();
    let attempts = 0;
    const failing = client(server, new Journal(), async () => { attempts++; throw new Error("Network down"); });
    await failing.start(); await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBeLessThanOrEqual(8); expect(attempts).toBeGreaterThan(2);
    failing.destroy(); expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps oversized unqueued local edits dirty across retirement and restart", async () => {
    const server = new Server(), journal = new Journal();
    let observed = "";
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: server.request, onChange: snapshot => { observed = snapshot.content.body; } });
    clients.push(editor); await editor.start();
    const large = "x".repeat(400_000);
    editor.mutate(doc => documentText(doc, "body").insert(5, large));
    expect(editor.status).toBe("recovery"); expect(editor.hasPendingChanges).toBe(true);
    expect(editor.recoveryJournal?.pending).toEqual([]); expect(editor.recoveryJournal?.unqueuedDirty).toBe(true);
    expect(observed).toBe("Hello" + large); expect(server.pushes).toHaveLength(0);
    editor.destroy();
    const reopened = client(server, journal); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.hasPendingChanges).toBe(true);
    expect(documentText(reopened.doc, "body").toString()).toBe("Hello" + large);
    reopened.clearRetiredAfterRecovery(); expect(reopened.hasPendingChanges).toBe(false);
  });

  it("preserves a corrupt encoded Yjs state before adopting or overwriting its journal", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); const value = JSON.parse(journal.load(first.journalKey)!); first.destroy();
    value.update = "AA==";
    const damaged = JSON.stringify(value); journal.values.set(first.journalKey, damaged);
    const reopened = client(server, journal); await reopened.start();
    expect(reopened.status).toBe("error"); expect(reopened.hasPendingChanges).toBe(true);
    expect(reopened.hasUnreadableJournal).toBe(true); expect(reopened.recoveryRawJournal).toBe(damaged);
    expect(journal.load(reopened.journalKey)).toBe(damaged);
  });

  it("treats inaccessible durable storage as potentially dirty instead of offering a destructive reopen", async () => {
    const server = new Server();
    const journal: FileCollaborationJournalStore = { load: () => { throw new Error("Storage disabled"); }, save: () => {}, remove: vi.fn() };
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request });
    clients.push(editor); await editor.start();
    expect(editor.status).toBe("error"); expect(editor.hasUnreadableJournal).toBe(true); expect(editor.hasPendingChanges).toBe(true);
    expect(editor.recoveryRawJournal).toBeNull(); expect(server.reads).toBe(0);
    expect(() => editor.clearRetiredAfterRecovery()).toThrow(); expect(journal.remove).not.toHaveBeenCalled();
  });

  it("serializes immutable offline checkpoints, coalesces queued changes and finishes them after destroy", async () => {
    const server = new Server(), journal = new Journal(), saved: FileCollaborationCheckpoint[] = [];
    let block = false, release!: () => void;
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async value => { saved.push(value); if (block) { block = false; await new Promise<void>(resolve => { release = resolve; }); } } });
    clients.push(editor); await editor.start(); expect(await editor.flushLocal()).toBe(true);
    editor.setActive(false); block = true;
    editor.mutate(doc => documentText(doc, "body").insert(5, " A"));
    const draining = editor.flushLocal();
    editor.mutate(doc => documentText(doc, "body").insert(7, " B"));
    editor.mutate(doc => documentText(doc, "body").insert(9, " C"));
    expect(saved.at(-1)?.document.content.body).toBe("Hello A");
    expect(Object.isFrozen(saved.at(-1)!.journal.pending)).toBe(true);
    editor.destroy(); release(); expect(await draining).toBe(true); expect(await editor.flushLocal()).toBe(true);
    expect(saved.map(value => value.document.content.body)).toEqual(["Hello", "Hello A", "Hello A B C"]);
    expect(saved.at(-1)!.journal.journalGeneration).toBeGreaterThan(saved.at(-2)!.journal.journalGeneration!);
    expect(server.pushes).toHaveLength(0);
  });

  it("debounces a typing burst into one latest native projection while journaling every edit immediately", async () => {
    const server = new Server(), journal = new Journal(), saved: FileCollaborationCheckpoint[] = [];
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async value => { saved.push(value); } });
    clients.push(editor); await editor.start(); await editor.flushLocal(); editor.setActive(false);
    for (let i = 0; i < 10; i++) editor.mutate(doc => documentText(doc, "body").insert(5 + i, "x"));
    expect(saved).toHaveLength(1); expect(JSON.parse(journal.load(editor.journalKey)!).journalGeneration).toBe(11);
    await vi.advanceTimersByTimeAsync(199); expect(saved).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(saved).toHaveLength(2);
    expect(saved.at(-1)?.document.content.body).toBe("Helloxxxxxxxxxx");
    await vi.advanceTimersByTimeAsync(10_000); expect(saved).toHaveLength(2);
  });

  it("waits for immutable batch disk checkpoint before remote upload and learns authoritative revision before clean checkpoint", async () => {
    const server = new Server(), journal = new Journal(), saved: FileCollaborationCheckpoint[] = [];
    let release!: () => void, blocked = false;
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async value => { saved.push(value); if (value.journal.batch && !blocked) { blocked = true; await new Promise<void>(resolve => { release = resolve; }); } } });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    editor.mutate(doc => documentText(doc, "body").insert(5, " disk first"));
    const flushing = editor.flush();
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
    expect(release).toBeTypeOf("function"); expect(server.pushes).toHaveLength(0);
    release(); expect(await flushing).toBe(true);
    const clean = saved.at(-1)!;
    expect(clean.journal.batch).toBeNull(); expect(clean.journal.pending).toEqual([]);
    expect(clean.journal.revision).toBe(server.state.revision); expect(clean.journal.seq).toBe(server.state.seq);
    expect(clean.document.content.body).toBe("Hello disk first");
  });

  it("freezes before remote upload if the native checkpoint fails", async () => {
    const server = new Server(), editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal: new Journal(), request: server.request,
      checkpoint: async value => { if (value.journal.batch) throw new Error("Disk unavailable"); } });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    editor.mutate(doc => documentText(doc, "body").insert(5, " retained"));
    expect(await editor.flush()).toBe(false); expect(await editor.flushLocal()).toBe(false);
    expect(editor.status).toBe("error"); expect(editor.hasPendingChanges).toBe(true); expect(editor.canEdit).toBe(false);
    expect(server.pushes).toHaveLength(0);
  });

  it("offers a clean external file change for reopening without retiring its journal", async () => {
    const server = new Server(), journal = new Journal();
    let changed = false;
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async () => { if (changed) throw Object.assign(new Error("Changed outside TextText"), { code: "local_changed" }); } });
    clients.push(editor); await editor.start();
    expect(await editor.flushLocal()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    changed = true;
    server.state = { ...server.state, seq: 1, revision: "a".repeat(64) }; server.wake();
    await vi.advanceTimersByTimeAsync(250);
    expect(editor.status).toBe("stale-file"); expect(editor.canEdit).toBe(false);
    expect(editor.hasPendingChanges).toBe(false); expect(editor.recoveryJournal?.retired).toBeUndefined();
    expect(() => editor.discardCleanJournal()).not.toThrow();
    expect(journal.load(editor.journalKey)).toBeNull();
    expect(server.pushes).toHaveLength(0);
  });

  it("refreshes a clean externally changed file before a checkpoint, while retaining newer human edits", async () => {
    const server = new Server(), cleanJournal = new Journal(), clean = client(server, cleanJournal);
    await clean.start();
    clean.notifyExternalFileChange();
    expect(clean.status).toBe("stale-file");
    expect(clean.canEdit).toBe(false);
    expect(clean.hasPendingChanges).toBe(false);
    expect(() => clean.discardCleanJournal()).not.toThrow();
    expect(cleanJournal.load(clean.journalKey)).toBeNull();

    const pendingJournal = new Journal(), pending = client(server, pendingJournal);
    await pending.start();
    pending.mutate(doc => documentText(doc, "body").insert(5, " human edit"));
    pending.notifyExternalFileChange();
    expect(pending.status).toBe("recovery");
    expect(pending.canEdit).toBe(false);
    expect(pending.hasPendingChanges).toBe(true);
    expect(pending.recoveryJournal?.pending).toHaveLength(1);
    expect(pendingJournal.load(pending.journalKey)).not.toBeNull();
    expect(documentText(pending.doc, "body").toString()).toBe("Hello human edit");
    expect(server.pushes).toHaveLength(0);
  });

  it("preserves pending edits when the native file changes during a checkpoint", async () => {
    const server = new Server(), journal = new Journal();
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async value => { if (value.journal.batch) throw Object.assign(new Error("Changed outside TextText"), { code: "local_changed" }); } });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    editor.mutate(doc => documentText(doc, "body").insert(5, " human edit"));
    expect(await editor.flush()).toBe(false);
    expect(editor.status).toBe("error"); expect(editor.hasPendingChanges).toBe(true);
    expect(() => editor.discardCleanJournal()).toThrow();
    expect(journal.load(editor.journalKey)).not.toBeNull();
    expect(documentText(editor.doc, "body").toString()).toContain("human edit");
    expect(server.pushes).toHaveLength(0);
  });

  it("does not treat an old clean checkpoint as disposable after a newer local edit", async () => {
    const server = new Server(), journal = new Journal();
    let rejectCheckpoint: ((error: Error) => void) | null = null;
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async value => {
        if (value.journal.seq === 1 && !value.journal.pending.length) {
          await new Promise<void>((_resolve, reject) => { rejectCheckpoint = reject; });
        }
      } });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    await vi.advanceTimersByTimeAsync(1);
    server.state = { ...server.state, seq: 1, revision: "b".repeat(64) }; server.wake();
    await vi.advanceTimersByTimeAsync(250);
    expect(rejectCheckpoint).not.toBeNull();
    editor.mutate(doc => documentText(doc, "body").insert(5, " newer local edit"));
    rejectCheckpoint!(Object.assign(new Error("Changed outside TextText"), { code: "local_changed" }));
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.status).toBe("error"); expect(editor.hasPendingChanges).toBe(true);
    expect(editor.recoveryJournal?.pending).toHaveLength(1);
    expect(journal.load(editor.journalKey)).not.toBeNull();
    expect(() => editor.discardCleanJournal()).toThrow();
    expect(server.pushes).toHaveLength(0);
  });

  it("keeps an acknowledged batch pending until authoritative read and retains later edits", async () => {
    const server = new Server(), saved: FileCollaborationCheckpoint[] = [];
    let failRead = false, acknowledged = false;
    const request: FileCollaborationRequest = async (method, params, signal) => {
      if (method === "read" && failRead && acknowledged) throw new Error("Network down after acknowledgement");
      const result = await server.request(method, params, signal);
      if (method === "push") acknowledged = true;
      return result;
    };
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal: new Journal(), request, checkpoint: async value => { saved.push(value); } });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    editor.mutate(doc => documentText(doc, "body").insert(5, " first")); failRead = true;
    expect(await editor.flush()).toBe(false); await editor.flushLocal();
    expect(editor.recoveryJournal?.batch?.acknowledged).toBe(true); expect(editor.hasPendingChanges).toBe(true);
    expect(saved.at(-1)?.journal.batch?.acknowledged).toBe(true);
    editor.mutate(doc => documentText(doc, "body").insert(11, " later"));
    failRead = false; expect(await editor.flush()).toBe(true);
    expect(server.pushes).toHaveLength(2); // The already acknowledged batch was not uploaded again.
    expect(saved.at(-1)?.document.content.body).toBe("Hello first later");
    expect(saved.at(-1)?.journal.revision).toBe(server.state.revision);
    expect(editor.hasPendingChanges).toBe(false);
  });

  it("cold-opens the newer native journal offline and rejects equal-generation divergence without overwriting either", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start(); const older = journal.load(original.journalKey)!;
    original.mutate(doc => documentText(doc, "body").insert(5, " native"));
    const newer = journal.load(original.journalKey)!; original.destroy(); journal.values.set(original.journalKey, older);
    expect(selectFileCollaborationJournal(older, newer)).toBe(newer);
    const readCount = server.reads, saved: FileCollaborationCheckpoint[] = [];
    const offline = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", active: false, journal, retainedJournal: newer,
      request: server.request, checkpoint: async value => { saved.push(value); } });
    clients.push(offline); await offline.start(); await offline.flushLocal();
    expect(offline.hasBaseline).toBe(true); expect(offline.canEdit).toBe(true); expect(server.reads).toBe(readCount);
    expect(saved.at(-1)?.document.content.body).toBe("Hello native");
    expect(saved.at(-1)?.journal.journalGeneration).toBeGreaterThan(JSON.parse(newer).journalGeneration);
    offline.destroy();
    const changed = JSON.stringify({ ...JSON.parse(newer), relativePath: "Other.textpack" });
    expect(() => selectFileCollaborationJournal(newer, changed)).toThrow(/diverged/);
    expect(() => selectFileCollaborationJournal("broken", newer)).toThrow();
    journal.values.set(original.journalKey, newer);
    const conflict = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, retainedJournal: changed, request: server.request });
    clients.push(conflict); await conflict.start();
    expect(conflict.status).toBe("error"); expect(conflict.hasUnreadableJournal).toBe(true);
    expect(JSON.parse(conflict.recoveryRawJournal!)).toEqual({ browser: newer, native: changed });
    expect(journal.load(conflict.journalKey)).toBe(newer);
  });

  it("exposes native retirement without rewriting or projecting the retained journal", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start(); const retained = journal.load(original.journalKey)!; original.destroy();
    const checkpoint = vi.fn(async () => {}), reads = server.reads;
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, retainedJournal: retained,
      initialRetirement: "Disk file changed externally", request: server.request, checkpoint });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.canEdit).toBe(false); expect(reopened.hasPendingChanges).toBe(false);
    expect(journal.load(reopened.journalKey)).toBe(retained); expect(checkpoint).not.toHaveBeenCalled(); expect(server.reads).toBe(reads);
  });

  it("preserves malformed stored journals and refuses unknown server envelopes", async () => {
    const server = new Server(), journal = new Journal(), editor = client(server, journal);
    journal.values.set(editor.journalKey, '{"bad":true}');
    await editor.start(); expect(editor.status).toBe("error");
    expect(editor.hasPendingChanges).toBe(true); expect(editor.hasUnreadableJournal).toBe(true);
    expect(editor.recoveryRawJournal).toBe('{"bad":true}');
    expect(() => editor.clearRetiredAfterRecovery()).toThrow();
    expect(journal.load(editor.journalKey)).toBe('{"bad":true}'); expect(server.reads).toBe(0);
    const malformed = client(server, new Journal(), async () => ({ surprise: true }));
    await malformed.start(); expect(malformed.status).toBe("error"); expect(malformed.canEdit).toBe(false);
  });
  it("reports local journal failures during an offline cold open", async () => {
    const server = new Server(), journal = new Journal();
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", active: false, journal, request: server.request });
    clients.push(editor); journal.values.set(editor.journalKey, "broken");
    await editor.start();
    expect(editor.status).toBe("error"); expect(editor.hasUnreadableJournal).toBe(true);
    expect(editor.recoveryRawJournal).toBe("broken"); expect(journal.load(editor.journalKey)).toBe("broken");
    const original = client(server, new Journal()); await original.start();
    const retained = JSON.stringify(original.recoveryJournal); original.destroy();
    journal.values.set(editor.journalKey, retained); journal.fail = true;
    const failing = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", active: false, journal, request: server.request });
    clients.push(failing); const reads = server.reads; await failing.start();
    expect(failing.status).toBe("error"); expect(failing.canEdit).toBe(false); expect(server.reads).toBe(reads);
    expect(journal.load(editor.journalKey)).toBe(retained);
  });

  it("accepts an unchanged response for its requested cursor after an acknowledgement advances the document", async () => {
    const server = new Server(); let release!: (value: unknown) => void;
    const request: FileCollaborationRequest = (method, params, signal) => {
      if (method === "read" && params.waitMs) return new Promise(resolve => { release = resolve; });
      return server.request(method, params, signal);
    };
    const editor = client(server, new Journal(), request); await editor.start();
    await vi.advanceTimersByTimeAsync(1);
    editor.mutate(doc => documentText(doc, "body").insert(5, " newer"));
    expect(await editor.flush()).toBe(true); expect(editor.recoveryJournal?.seq).toBe(1);
    release({ unchanged: true, epoch: 1, seq: 0, canEditContent: true, canComment: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(editor.status).toBe("ready"); expect(editor.canEdit).toBe(true);
    expect(editor.recoveryJournal?.seq).toBe(1); expect(editor.revision).toBe(server.state.revision);
    await vi.advanceTimersByTimeAsync(251);
    release({ unchanged: true, epoch: 1, seq: 99, canEditContent: true, canComment: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(editor.status).toBe("error");
  });

  it("does not project stale clean or pending journals over a newer local file", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start(); const clean = journal.load(original.journalKey)!;
    original.mutate(doc => documentText(doc, "body").insert(5, " pending"));
    const pending = journal.load(original.journalKey)!; original.destroy();
    for (const [raw, expected] of [[clean, "offline"], [pending, "recovery"]] as const) {
      journal.values.set(original.journalKey, raw); const checkpoint = vi.fn(async () => {});
      const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", active: false,
        journal, request: server.request, localRevision: "f".repeat(64), checkpoint });
      clients.push(editor); await editor.start(); await editor.flushLocal();
      expect(editor.status).toBe(expected); expect(editor.canEdit).toBe(false);
      expect(editor.hasBaseline).toBe(expected === "recovery");
      expect(journal.load(editor.journalKey)).toBe(raw); expect(checkpoint).not.toHaveBeenCalled();
      if (expected === "recovery") { expect(editor.hasPendingChanges).toBe(true); expect(documentText(editor.doc, "body").toString()).toBe("Hello pending"); }
      editor.destroy();
    }
  });

  it("isolates concurrent tab journals, resumes reloads and discovers closed-tab pending journals", async () => {
    const server = new Server(), journal = new Journal(), locks = new Set<string>();
    const sessionA = new Map<string, string>(), sessionB = new Map<string, string>();
    const owned = (session: Map<string, string>) => createFileCollaborationOwnership({
      storage: { get length() { return journal.values.size; }, key: index => [...journal.values.keys()][index] ?? null, getItem: key => journal.load(key) },
      session: { getItem: key => session.get(key) ?? null, setItem: (key, value) => { session.set(key, value); } },
      tryLock: async key => { if (locks.has(key)) return null; locks.add(key); return () => { locks.delete(key); }; },
    });
    const make = (session: Map<string, string>) => {
      const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, ownership: owned(session), request: server.request });
      clients.push(editor); return editor;
    };
    const alice = make(sessionA); await alice.start();
    for (const [key, value] of sessionA) sessionB.set(key, value); // Duplicate-tab sessionStorage clone.
    const bob = make(sessionB); await bob.start();
    expect(bob.journalKey).not.toBe(alice.journalKey);
    alice.setActive(false); bob.setActive(false);
    alice.mutate(doc => documentText(doc, "body").insert(5, " Alice"));
    const aliceRaw = journal.load(alice.journalKey);
    bob.mutate(doc => documentText(doc, "body").insert(0, "Bob "));
    expect(journal.load(alice.journalKey)).toBe(aliceRaw);
    const bobRaw = journal.load(bob.journalKey), aliceKey = alice.journalKey;
    expect(() => alice.discardCleanJournal()).toThrow();
    alice.destroy();
    const reloaded = make(sessionA); await reloaded.start();
    expect(reloaded.journalKey).toBe(aliceKey); expect(await reloaded.flush()).toBe(true);
    expect(journal.load(bob.journalKey)).toBe(bobRaw);
    reloaded.destroy(); bob.destroy(); sessionB.clear();
    const orphan = make(new Map()); await orphan.start();
    expect(orphan.journalKey).toBe(bob.journalKey); expect(await orphan.flush()).toBe(true);
    expect(documentText(orphan.doc, "body").toString()).toBe("Bob Hello Alice");
    orphan.discardCleanJournal(); expect(journal.load(orphan.journalKey)).toBeNull();
    orphan.destroy(); expect(locks.size).toBe(0);
    expect(() => orphan.discardCleanJournal()).toThrow();
  });

  it("preserves a malformed orphan journal under exclusive ownership for recovery", async () => {
    const server = new Server(), journal = new Journal(), seed = client(server, journal);
    const legacyKey = seed.journalKey; seed.destroy(); journal.values.set(legacyKey, "damaged bytes");
    let held = false;
    const ownership = createFileCollaborationOwnership({
      storage: { get length() { return journal.values.size; }, key: index => [...journal.values.keys()][index] ?? null, getItem: key => journal.load(key) },
      session: { getItem: () => null, setItem: () => {} },
      tryLock: async () => { held = true; return () => { held = false; }; },
    });
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, ownership, request: server.request });
    clients.push(editor); await editor.start();
    expect(editor.status).toBe("error"); expect(editor.recoveryRawJournal).toBe("damaged bytes");
    expect(editor.journalKey).toBe(legacyKey); expect(held).toBe(true);
    expect(() => editor.discardCleanJournal()).toThrow(); expect(journal.load(legacyKey)).toBe("damaged bytes");
    editor.destroy(); expect(held).toBe(false); expect(server.reads).toBe(0);
  });

});
