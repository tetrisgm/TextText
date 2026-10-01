import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentText } from "@/lib/collab/document";
import { applyVaultCollaboration, seedVaultCollaboration } from "@/lib/vault/collaboration";
import { FileCollaborationClient, type FileCollaborationJournalStore, type FileCollaborationRequest } from "./collaboration-client";

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
    await vi.advanceTimersByTimeAsync(300);
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
});
