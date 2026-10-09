import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { openPack, encodePack } from "./pack";
import { readDocument, readTemplate, writePayload } from "./model";
import { DetachedFileSaveProof } from "./detached-file-save";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import * as Y from "yjs";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { applyVaultCollaboration, seedVaultCollaboration } from "@/lib/vault/collaboration";
import { FileCollaborationClient, type FileCollaborationJournalStore, type FileCollaborationRequest, type FileCollaborationCheckpoint, selectFileCollaborationJournal, createFileCollaborationOwnership } from "./collaboration-client";

class Journal implements FileCollaborationJournalStore {
  values = new Map<string, string>(); fail = false;
  load(key: string) { return this.values.get(key) ?? null; }
  save(key: string, value: string) { if (this.fail) throw new Error("disk full"); this.values.set(key, value); }
  remove(key: string) { this.values.delete(key); }
}
function pack(body = "Hello") {
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); document.content.body = body;
  return buildTextpack("Shared", { document, markdown: `---\ntextTextId: item-1\n---\n\n${body}` });
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
  it("reconciles a closed-file edit against the native projection and a newer browser journal", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start();
    first.mutate(doc => documentText(doc, "body").insert(5, " saved"));
    const nativeJournal = journal.load(first.journalKey)!;
    const external = documentSnapshotFromYDoc(first.doc); external.content.body += " CLI";
    first.mutate(doc => documentText(doc, "body").insert(documentText(doc, "body").length, " newer"));
    first.destroy();
    const writes: FileCollaborationCheckpoint[] = [];
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1",
      journal, retainedJournal: nativeJournal, request: server.request,
      initialFileChange: { journal: nativeJournal, document: external }, checkpoint: async value => { writes.push(value); } });
    clients.push(reopened); await reopened.start();
    expect(documentSnapshotFromYDoc(reopened.doc).content.body).toBe("Hello saved CLI newer");
    expect(await reopened.flush()).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(value => value.document.content.body === "Hello saved CLI newer")).toBe(true);
    expect(readDocument(openPack(server.bytes, "Shared.textpack", server.state.revision).file).content.body).toBe("Hello saved CLI newer");
  });
  it("never checkpoints over a conflicting file on restart", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); const nativeJournal = journal.load(first.journalKey)!;
    const external = documentSnapshotFromYDoc(first.doc); external.content.body = "CLI replacement";
    first.mutate(doc => { const body = documentText(doc, "body"); body.delete(0, body.length); body.insert(0, "Human replacement"); });
    first.destroy(); const checkpoint = vi.fn(async () => {});
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1",
      journal, retainedJournal: nativeJournal, request: server.request,
      initialFileChange: { journal: nativeJournal, document: external }, checkpoint });
    clients.push(reopened); await reopened.start(); await vi.advanceTimersByTimeAsync(500);
    expect(reopened.status).toBe("recovery"); expect(checkpoint).not.toHaveBeenCalled();
    expect(server.pushes).toHaveLength(0); expect(documentSnapshotFromYDoc(reopened.doc).content.body).toBe("Human replacement");
  });
  it("keeps human undo history separate from an in-place external insertion", async () => {
    const server = new Server(), editor = client(server);
    await editor.start();
    const base = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    base.content.title = "Shared"; base.content.body = "Hello";
    const body = documentText(editor.doc, "body");
    const undo = new Y.UndoManager(body, { captureTimeout: 0 });
    try {
      editor.mutate(() => body.insert(body.length, " human"));
      const external = structuredClone(base); external.content.body += " CLI";
      expect(editor.reconcileExternalDocument(base, external)).toBe(true);
      expect(body.toString()).toBe("Hello CLI human");
      undo.undo();
      expect(body.toString()).toBe("Hello CLI");
      undo.redo();
      expect(body.toString()).toBe("Hello CLI human");
    } finally { undo.destroy(); }
  });
  it("preserves human undo and caret when an external file prepends and appends", async () => {
    const server = new Server(), editor = client(server);
    await editor.start();
    const base = documentSnapshotFromYDoc(editor.doc);
    const body = documentText(editor.doc, "body"), doc = editor.doc;
    const undo = new Y.UndoManager(body, { captureTimeout: 0 });
    try {
      editor.mutate(() => body.insert(body.length, " human"));
      const caret = Y.createRelativePositionFromTypeIndex(body, body.length);
      const external = structuredClone(base);
      external.content.body = "before " + base.content.body + " CLI";
      expect(editor.reconcileExternalDocument(base, external)).toBe(true);
      expect(editor.doc).toBe(doc);
      expect(body.toString()).toBe("before Hello CLI human");
      expect(Y.createAbsolutePositionFromRelativePosition(caret, doc)?.index).toBe(body.length);
      undo.undo();
      expect(body.toString()).toBe("before Hello CLI");
      undo.redo();
      expect(body.toString()).toBe("before Hello CLI human");
      expect(await editor.flush()).toBe(true);
    } finally { undo.destroy(); }
  });
  it("does not overwrite an overlapping external replacement during checkpoint reconciliation", async () => {
    const server = new Server(), journal = new Journal();
    const base = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    base.content.title = "Shared"; base.content.body = "Hello";
    let collision = false;
    const editor: FileCollaborationClient = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async () => { if (collision) throw Object.assign(new Error("File changed"), { code: "local_changed" }); },
      reconcileCheckpoint: async () => {
        const external = structuredClone(base); external.content.body = "Agent replacement";
        return editor.reconcileExternalDocument(base, external);
      },
    });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    editor.mutate(doc => { const body = documentText(doc, "body"); body.delete(0, body.length); body.insert(0, "Human replacement"); });
    collision = true;
    expect(await editor.flushLocal()).toBe(false);
    expect(editor.status).toBe("error");
    expect(documentText(editor.doc, "body").toString()).toBe("Human replacement");
    expect(journal.load(editor.journalKey)).toBeTruthy();
    expect(server.pushes).toHaveLength(0);
  });
  it("merges a CLI append with pending typing through the same document and native lease", async () => {
    const server = new Server(), journal = new Journal();
    const base = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    base.content.title = "Shared"; base.content.body = "Hello";
    let external = false, expectedRevision = 0, diskRevision = 0;
    const saved: FileCollaborationCheckpoint[] = [];
    const editor: FileCollaborationClient = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async value => {
        if (diskRevision !== expectedRevision) throw Object.assign(new Error("File changed"), { code: "local_changed" });
        saved.push(value);
      },
      reconcileCheckpoint: async () => {
        const fresh = structuredClone(base); fresh.content.body += " CLI";
        const merged = editor.reconcileExternalDocument(base, fresh);
        if (merged) { expectedRevision = diskRevision; external = true; }
        return merged;
      },
    });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    const doc = editor.doc, body = documentText(doc, "body");
    editor.mutate(() => body.insert(body.length, " human"));
    const caret = Y.createRelativePositionFromTypeIndex(body, body.length);
    diskRevision++;
    editor.notifyExternalFileChange();
    expect(await editor.flushLocal()).toBe(true);
    expect(external).toBe(true); expect(editor.doc).toBe(doc);
    expect(editor.canEdit).toBe(true);
    expect(body.toString()).toBe("Hello CLI human");
    expect(Y.createAbsolutePositionFromRelativePosition(caret, doc)?.index).toBe(body.length);
    expect(saved.at(-1)?.document.content.body).toBe(body.toString());
    expect(saved.at(-1)?.journal.retired).toBeUndefined();
    expect(await editor.flush()).toBe(true);
    expect(editor.hasPendingChanges).toBe(false);
    expect(readDocument(openPack(server.bytes, "Shared.textpack", server.state.revision).file).content.body).toBe("Hello CLI human");
  });
  it("hands the native refusal to reconciliation so a file renamed and edited outside TextText merges at its new path", async () => {
    // The Mac actor follows a Finder rename; its `local_changed` refusal names the
    // new path. Reconciliation must receive that error, read the moved file,
    // merge it into the same document, and the retried checkpoint lands there.
    const server = new Server(), journal = new Journal();
    const base = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    base.content.title = "Shared"; base.content.body = "Hello";
    const disk = { path: "Notes/Note.textpack", revision: 0, body: "Hello" };
    let expected = { path: disk.path, revision: 0 };
    const saved: { path: string; body: string }[] = [], seen: unknown[] = [];
    const editor: FileCollaborationClient = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async value => {
        if (disk.revision !== expected.revision) {
          throw Object.assign(new Error("The file changed outside shared editing."), { code: "local_changed", path: disk.path });
        }
        saved.push({ path: expected.path, body: value.document.content.body });
      },
      reconcileCheckpoint: async error => {
        seen.push(error);
        const refusal = error as { code?: string; path?: string };
        const fresh = structuredClone(base); fresh.content.body = disk.body;
        const merged = editor.reconcileExternalDocument(base, fresh);
        if (merged) expected = { path: refusal.path ?? expected.path, revision: disk.revision };
        return merged;
      },
    });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    const doc = editor.doc, body = documentText(doc, "body");
    editor.mutate(() => body.insert(body.length, " human"));
    const caret = Y.createRelativePositionFromTypeIndex(body, body.length);
    // Finder rename, then a CLI edit at the new path, while typing is pending.
    disk.path = "Notes/Renamed.textpack"; disk.revision = 1; disk.body = "Hello CLI";
    editor.notifyExternalFileChange();
    expect(await editor.flushLocal()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: "local_changed", path: "Notes/Renamed.textpack" });
    expect(editor.doc).toBe(doc); expect(editor.canEdit).toBe(true); expect(editor.status).not.toBe("error");
    expect(body.toString()).toBe("Hello CLI human");
    expect(Y.createAbsolutePositionFromRelativePosition(caret, doc)?.index).toBe(body.length);
    expect(saved.at(-1)).toEqual({ path: "Notes/Renamed.textpack", body: "Hello CLI human" });
    expect(saved.at(-1)?.body).toBe(body.toString());
    expect(await editor.flush()).toBe(true);
    expect(editor.hasPendingChanges).toBe(false);
  });
  it("delivers custom presentation before checkpoint and retains it through offline reopen", async () => {
    const server = new Server(), journal = new Journal();
    const original = openPack(server.bytes, "Shared.textpack", server.state.revision);
    const template = { ...requireBuiltinTemplate("texttext.note"), id: "custom.live" };
    const snapshot = emptyDocumentSnapshot({ id: template.id, version: template.version }); snapshot.content.body = "Remote custom body";
    const metadata = { templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: null };
    const responseMetadata: { current?: typeof metadata } = {};
    let saved: Uint8Array = server.bytes;
    const seen: string[] = [];
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: async () => ({ ...server.response(), ...(responseMetadata.current ? { presentation: responseMetadata.current } : {}) }),
      checkpoint: async ({ journal: entry, document }) => {
        const current = openPack(saved, "Shared.textpack", "a".repeat(64));
        saved = encodePack(current, writePayload({ ...current.file, ...entry.presentation }, document));
      },
      onChange: (document, presentation) => { seen.push(readTemplate({ ...original.file, ...presentation }, document).id); },
    });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    server.bytes = encodePack(original, { ...original.file, ...metadata });
    const remoteDoc = new Y.Doc(); Y.applyUpdate(remoteDoc, Buffer.from(server.state.update, "base64"));
    const vector = Y.encodeStateVector(remoteDoc); applyDocumentSnapshot(remoteDoc, snapshot, "remote-template");
    const applied = applyVaultCollaboration({ ...server.state, revision: (await import("node:crypto")).createHash("sha256").update(server.bytes).digest("hex") }, server.bytes, [Buffer.from(Y.encodeStateAsUpdate(remoteDoc, vector)).toString("base64")]);
    server.state = applied.state; server.bytes = applied.bytes; remoteDoc.destroy(); responseMetadata.current = metadata;
    await vi.advanceTimersByTimeAsync(250); await editor.flushLocal();
    expect(seen.at(-1)).toBe(template.id);
    const reopenedPack = openPack(saved, "Shared.textpack", "a".repeat(64));
    expect(readTemplate(reopenedPack.file, readDocument(reopenedPack.file)).id).toBe(template.id);
    editor.mutate(doc => documentText(doc, "body").insert(0, "Pending "));
    await editor.flushLocal(); editor.destroy();
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, active: false,
      request: async (method, params, signal) => method === "read" ? ({ ...server.response(), presentation: { templateJSON: JSON.stringify(requireBuiltinTemplate("texttext.note")), templateAuthoringSourceJSON: null } }) : server.request(method, params, signal),
      onChange: (document, presentation) => { expect(readTemplate({ ...original.file, ...presentation }, document).id).toBe(template.id); },
    });
    clients.push(reopened); await reopened.start();
    expect(reopened.recoveryJournal?.presentation).toEqual(metadata);
    expect(reopened.hasPendingChanges).toBe(true);
    reopened.setActive(true); await vi.advanceTimersByTimeAsync(1);
    expect(reopened.recoveryJournal?.presentation).toEqual(metadata);
    expect(reopened.status).not.toBe("error");
  });
  it("rejects invalid remote template metadata without replacing the retained definition", async () => {
    const server = new Server(), metadata = { templateJSON: JSON.stringify(requireBuiltinTemplate("texttext.note")), templateAuthoringSourceJSON: null };
    let invalid = false;
    const editor = client(server, new Journal(), async () => ({ ...server.response(), presentation: invalid ? { ...metadata, templateJSON: "{}" } : metadata }));
    await editor.start(); const retained = editor.recoveryJournal;
    invalid = true; await vi.advanceTimersByTimeAsync(1);
    expect(editor.recoveryJournal?.presentation).toEqual(metadata);
    expect(editor.recoveryJournal?.update).toBe(retained?.update);
  });
  it("backs off failed uploads even while reads succeed", async () => {
    const server = new Server(); const attempts: number[] = []; let unavailable = true;
    const request: FileCollaborationRequest = async (method, params, signal) => {
      if (method === "push" && unavailable) { attempts.push(Date.now()); throw Object.assign(new Error("Unavailable"), { status: 503 }); }
      if (method === "read") return server.response();
      return server.request(method, params, signal);
    };
    const editor = client(server, new Journal(), request); await editor.start();
    editor.mutate(doc => documentText(doc, "body").insert(5, " retained"));
    await editor.flush(); await vi.advanceTimersByTimeAsync(7500);
    expect(attempts.slice(1).map((time, i) => time - attempts[i])).toEqual([1000, 2000, 4000]);
    expect(editor.hasPendingChanges).toBe(true);
    unavailable = false; await vi.advanceTimersByTimeAsync(8000);
    expect(editor.hasPendingChanges).toBe(false);
  });

  it.each([429, 500, 503])("retries temporary HTTP %s storage failures without retiring pending edits", async status => {
    const server = new Server(); let unavailable = true;
    const request: FileCollaborationRequest = async (method, params, signal) => {
      if (method === "push" && unavailable) throw Object.assign(new Error("Storage temporarily unavailable"), { status });
      return server.request(method, params, signal);
    };
    const editor = client(server, new Journal(), request); await editor.start();
    editor.mutate(doc => documentText(doc, "body").insert(5, " retained"));
    expect(await editor.flush()).toBe(false);
    expect(editor.status).toBe("offline"); expect(editor.hasPendingChanges).toBe(true);
    unavailable = false; await vi.advanceTimersByTimeAsync(1100);
    expect(editor.hasPendingChanges).toBe(false);
    expect(editor.status).toBe("ready");
    expect(documentText(editor.doc, "body").toString()).toBe("Hello retained");
    expect(server.pushes).toHaveLength(1);
  });

  it("keeps a clean web journal hidden until a fresh read confirms downgraded access", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); const retained = journal.load(first.journalKey)!; first.destroy();
    let release!: (value: unknown) => void;
    const observed: string[] = [];
    const request: FileCollaborationRequest = async (method, params, signal) => method === "read"
      ? new Promise(resolve => { release = resolve; }) : server.request(method, params, signal);
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request,
      onChange: snapshot => { observed.push(snapshot.content.body); } });
    clients.push(reopened);
    const opening = reopened.start();
    expect(reopened.hasBaseline).toBe(false); expect(reopened.canEdit).toBe(false);
    expect(observed).toEqual([]); expect(journal.load(first.journalKey)).toBe(retained);
    server.canEdit = false; release(server.response()); await opening;
    expect(reopened.status).toBe("ready"); expect(reopened.canEdit).toBe(false);
    expect(observed).toEqual(["Hello"]); expect(server.pushes).toEqual([]);
    expect(JSON.parse(journal.load(reopened.journalKey)!).canEditContent).toBe(false);
  });

  it("never projects a clean web journal after read access is revoked", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); const retained = journal.load(first.journalKey)!; first.destroy();
    const observed = vi.fn();
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); }, onChange: observed });
    clients.push(reopened); await reopened.start();
    expect(reopened.hasBaseline).toBe(false); expect(reopened.canEdit).toBe(false);
    expect(reopened.status).toBe("error"); expect(observed).not.toHaveBeenCalled();
    expect(journal.load(reopened.journalKey)).toBe(retained); expect(server.pushes).toEqual([]);
  });

  it("adopts a newer server epoch and external text instead of the clean retained baseline", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); first.destroy();
    server.bytes = pack("External edit"); server.state = seedVaultCollaboration(server.bytes, "item-1", 2);
    const observed: string[] = [];
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: server.request, onChange: snapshot => { observed.push(snapshot.content.body); } });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("ready"); expect(reopened.epoch).toBe(2);
    expect(observed).toEqual(["External edit"]); expect(server.pushes).toEqual([]);
  });

  it("preserves a pending web journal for recovery when its epoch changes during restart", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); first.mutate(doc => documentText(doc, "body").insert(5, " pending")); first.destroy();
    server.state = seedVaultCollaboration(server.bytes, "item-1", 2);
    const reopened = client(server, journal); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.canEdit).toBe(false);
    expect(reopened.recoveryJournal?.pending).toHaveLength(1);
    expect(documentText(reopened.doc, "body").toString()).toBe("Hello pending");
    expect(server.pushes).toEqual([]);
  });

  it("does not expose or overwrite a clean journal after the initial read is canceled", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); const retained = journal.load(first.journalKey)!; first.destroy();
    const signals: AbortSignal[] = [];
    const observed = vi.fn();
    const request: FileCollaborationRequest = async (_method, _params, signal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true }));
    };
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request, onChange: observed });
    clients.push(reopened); const opening = reopened.start(); reopened.destroy(); await opening;
    expect(signals[0]?.aborted).toBe(true); expect(observed).not.toHaveBeenCalled();
    expect(journal.load(reopened.journalKey)).toBe(retained); expect(server.pushes).toEqual([]);
  });

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
      server.wake(); await vi.advanceTimersByTimeAsync(0);
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

  it("offers a clean server epoch replacement for reopening without retiring its journal", async () => {
    const server = new Server(), journal = new Journal(), editor = client(server, journal);
    await editor.start(); await vi.advanceTimersByTimeAsync(1);
    server.state = seedVaultCollaboration(server.bytes, "item-1", 2);
    server.wake(); await vi.advanceTimersByTimeAsync(250);
    expect(editor.status).toBe("stale-file"); expect(editor.canEdit).toBe(false);
    expect(editor.hasPendingChanges).toBe(false); expect(editor.recoveryJournal?.retired).toBeUndefined();
    expect(() => editor.discardCleanJournal()).not.toThrow();
    expect(journal.load(editor.journalKey)).toBeNull();
    editor.destroy();
    const reopened = client(server, journal); await reopened.start();
    expect(reopened.status).toBe("ready"); expect(reopened.epoch).toBe(2);
    expect(server.pushes).toHaveLength(0);
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

  it("distinguishes a quiet pause from offline and revalidates before sending pending edits", async () => {
    const server = new Server(), journal = new Journal(), editor = client(server, journal);
    await editor.start(); await vi.advanceTimersByTimeAsync(1);
    editor.setActive(false);
    expect(editor.status).toBe("paused");
    editor.mutate(doc => documentText(doc, "body").insert(5, " kept"));
    expect(editor.status).toBe("paused"); expect(editor.hasPendingChanges).toBe(true);
    const reads = server.reads;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.reads).toBe(reads); expect(server.pushes).toHaveLength(0);
    editor.setActive(false, "offline"); expect(editor.status).toBe("offline");
    editor.setActive(false, "paused"); expect(editor.status).toBe("paused");
    editor.setActive(true); expect(editor.status).toBe("reconnecting");
    expect(server.pushes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(editor.status).toBe("ready"); expect(editor.hasPendingChanges).toBe(false);
    expect(server.pushes).toHaveLength(1);
  });

  it("Retry connects an unopened inactive editor without waiting for a visibility event", async () => {
    const server = new Server(), journal = new Journal();
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      active: false, request: server.request });
    clients.push(editor);
    await editor.start();
    expect(editor.status).toBe("paused"); expect(editor.hasBaseline).toBe(false); expect(server.reads).toBe(0);
    const retry = editor.retry();
    expect(editor.status).toBe("reconnecting");
    await retry;
    expect(editor.hasBaseline).toBe(true); expect(editor.status).toBe("ready"); expect(server.reads).toBe(1);
    editor.setActive(false);
    const before = server.reads;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.reads).toBe(before);
    await editor.retry(); await vi.advanceTimersByTimeAsync(1);
    expect(server.reads).toBeGreaterThan(before);
  });

  it("automatically retries a hung initial read even when fetch ignores abort", async () => {
    const server = new Server(); let attempts = 0;
    const editor = client(server, new Journal(), (method, params, signal) => {
      if (++attempts === 1) return new Promise(() => {});
      return server.request(method, params, signal);
    });
    const starting = editor.start();
    await vi.advanceTimersByTimeAsync(15_000); await starting;
    expect(editor.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(1001);
    expect(editor.status).toBe("ready"); expect(editor.hasBaseline).toBe(true);
  });

  it("automatically replaces a stalled long poll after its bounded grace period", async () => {
    const server = new Server(); let stall = true, polls = 0;
    const editor = client(server, new Journal(), (method, params, signal) => {
      if (method === "read" && params.waitMs) {
        polls++;
        if (stall) { stall = false; return new Promise(() => {}); }
        return Promise.resolve(server.response());
      }
      return server.request(method, params, signal);
    });
    await editor.start(); await vi.advanceTimersByTimeAsync(1);
    expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(34_998); expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(2); expect(editor.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(1000);
    expect(editor.status).toBe("ready"); expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(250); expect(polls).toBe(2);
    expect(server.pushes).toHaveLength(0);
  });

  it("confirms automatic reconnection without waiting for another document edit", async () => {
    const server = new Server(); const waits: unknown[] = []; let disconnect = true;
    const editor = client(server, new Journal(), (method, params, signal) => {
      if (method === "read") {
        waits.push(params.waitMs);
        if (params.waitMs && disconnect) {
          disconnect = false;
          return Promise.reject(Object.assign(new Error("Service restarting"), { status: 503 }));
        }
      }
      return server.request(method, params, signal);
    });
    await editor.start(); await vi.advanceTimersByTimeAsync(1);
    expect(editor.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(1000);
    expect(editor.status).toBe("ready");
    expect(waits).toEqual([undefined, 25_000, 0]);
    await vi.advanceTimersByTimeAsync(250);
    expect(waits).toEqual([undefined, 25_000, 0, 25_000]);
    expect(server.waiters.size).toBe(1);
    expect(server.pushes).toHaveLength(0);
  });

  it("Retry cancels a hung start immediately without waiting for its deadline", async () => {
    const server = new Server(); let attempts = 0;
    const editor = client(server, new Journal(), (method, params, signal) => {
      if (++attempts === 1) return new Promise(() => {});
      return server.request(method, params, signal);
    });
    const starting = editor.start(); await vi.advanceTimersByTimeAsync(1);
    await editor.retry(); await starting;
    expect(editor.status).toBe("ready"); expect(attempts).toBe(2);
  });

  it("unsolicited transport cancellation automatically reconnects a pending retained journal", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); first.setActive(false);
    first.mutate(doc => documentText(doc, "body").insert(5, " kept")); first.destroy();
    let interrupted = true;
    const editor = client(server, journal, (method, params, signal) => {
      if (interrupted) { interrupted = false; return Promise.reject(new DOMException("Server interrupted", "AbortError")); }
      return server.request(method, params, signal);
    });
    await editor.start(); expect(editor.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(1500);
    expect(editor.status).toBe("ready"); expect(editor.hasPendingChanges).toBe(false);
    expect(documentText(editor.doc, "body").toString()).toBe("Hello kept");
  });

  it("rapid resume retries a canceled retained initial read without losing pending edits", async () => {
    const server = new Server(), journal = new Journal(), first = client(server, journal);
    await first.start(); first.setActive(false);
    first.mutate(doc => documentText(doc, "body").insert(5, " resumed")); first.destroy();
    let attempts = 0;
    const editor = client(server, journal, (method, params, signal) => {
      if (++attempts === 1) return new Promise(() => {});
      return server.request(method, params, signal);
    });
    const starting = editor.start(); await vi.advanceTimersByTimeAsync(1);
    editor.setActive(false); editor.setActive(true);
    await starting; await vi.advanceTimersByTimeAsync(1500);
    expect(editor.status).toBe("ready"); expect(editor.hasPendingChanges).toBe(false);
    expect(documentText(editor.doc, "body").toString()).toBe("Hello resumed");
  });

  it("a timed out committed upload retries the same durable operation exactly once", async () => {
    const server = new Server(); let lost = true;
    const editor = client(server, new Journal(), async (method, params, signal) => {
      const response = await server.request(method, params, signal);
      if (method === "push" && lost) { lost = false; return new Promise(() => {}); }
      return response;
    });
    await editor.start(); editor.mutate(doc => documentText(doc, "body").insert(5, " once"));
    const pushing = editor.flush(); await vi.advanceTimersByTimeAsync(30_000);
    expect(await pushing).toBe(false); expect(editor.hasPendingChanges).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(editor.status).toBe("ready"); expect(editor.hasPendingChanges).toBe(false);
    expect(server.pushes).toHaveLength(2); expect(server.pushes[1]).toBe(server.pushes[0]);
    expect(documentText(editor.doc, "body").toString()).toBe("Hello once");
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

  it("reopens a clean note when its native editing session closes", async () => {
    const server = new Server(), journal = new Journal();
    let closed = false;
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async () => { if (closed) throw Object.assign(new Error("Session closed"), { code: "session_closed" }); } });
    clients.push(editor); await editor.start(); expect(await editor.flushLocal()).toBe(true);
    closed = true;
    server.state = { ...server.state, seq: 1, revision: "a".repeat(64) }; server.wake();
    await vi.advanceTimersByTimeAsync(250);
    expect(editor.status).toBe("stale-session"); expect(editor.hasPendingChanges).toBe(false);
    expect(() => editor.discardCleanJournal()).not.toThrow();
  });

  it("does not show recovery for an old clean retired session", async () => {
    const server = new Server(), journal = new Journal();
    const original = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async () => {} });
    clients.push(original); await original.start(); expect(await original.flushLocal()).toBe(true);
    const retained = JSON.parse(journal.load(original.journalKey)!);
    retained.retired = "The local document checkpoint could not be saved. Pending edits are kept for recovery. Error: This shared editing session has closed. Your recovery journal is kept.";
    journal.save(original.journalKey, JSON.stringify(retained)); original.destroy();
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      localRevision: server.state.revision, checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("stale-session"); expect(reopened.hasPendingChanges).toBe(false);
    expect(() => reopened.discardCleanJournal()).not.toThrow();
  });

  it("reopens a clean note whose browser journal an older native session retired after a rename", async () => {
    // Installed 0.204 (1237): a Finder rename failed the native checkpoint, the
    // web client retired its own clean journal with this message, and the native
    // checkpoint was archived clean. The next launch must not demand recovery.
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start(); expect(await original.flushLocal()).toBe(true);
    const retained = JSON.parse(journal.load(original.journalKey)!);
    retained.retired = "This note needs to be reopened. Your edits are saved for recovery.";
    journal.save(original.journalKey, JSON.stringify(retained)); original.destroy();
    let permit = false;
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      localRevision: server.state.revision,
      request: async (...args) => { if (!permit) throw new Error("temporarily offline"); return server.request(...args); }, checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("offline"); expect(reopened.hasBaseline).toBe(false);
    expect(JSON.parse(journal.load(original.journalKey)!)).toEqual(retained);
    permit = true; await reopened.retry();
    expect(reopened.status).toBe("ready"); expect(reopened.canEdit).toBe(true);
    expect(reopened.hasPendingChanges).toBe(false); expect(reopened.recoveryJournal?.retired).toBeUndefined();
    expect(server.pushes).toEqual([]);
  });

  it("keeps recovery for that retirement when edits are still pending", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start();
    const retained = JSON.parse(journal.load(original.journalKey)!);
    retained.retired = "This note needs to be reopened. Your edits are saved for recovery."; retained.unqueuedDirty = true;
    journal.save(original.journalKey, JSON.stringify(retained)); original.destroy();
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      localRevision: server.state.revision, request: server.request, checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.recoveryJournal?.retired).toBe(retained.retired);
    expect(server.pushes).toEqual([]);
  });

  it("does not discard a clean journal retired for a different reason", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start();
    const retained = JSON.parse(journal.load(original.journalKey)!);
    retained.retired = "This file or its access changed.";
    journal.save(original.journalKey, JSON.stringify(retained)); original.destroy();
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.recoveryJournal?.retired).toBe(retained.retired);
  });

  it("refreshes an acknowledged native epoch on cold reopen without inventing pending edits", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start(); original.destroy();
    server.bytes = pack("New file epoch"); server.state = seedVaultCollaboration(server.bytes, "item-1", 2);
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: server.request, checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("ready"); expect(reopened.hasPendingChanges).toBe(false);
    expect(documentText(reopened.doc, "body").toString()).toBe("New file epoch");
    expect(reopened.epoch).toBe(2);
    expect(reopened.recoveryJournal?.retired).toBeUndefined(); expect(server.pushes).toEqual([]);
  });

  it("rechecks live access before refreshing the old clean Windows retirement", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start();
    const retained = JSON.parse(journal.load(original.journalKey)!);
    retained.retired = "This file or its access changed. Recover your saved edits before reopening.";
    journal.save(original.journalKey, JSON.stringify(retained)); original.destroy();
    let permit = false;
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: async (...args) => { if (!permit) throw new Error("temporarily offline"); return server.request(...args); }, checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("offline"); expect(reopened.hasBaseline).toBe(false);
    expect(JSON.parse(journal.load(original.journalKey)!)).toEqual(retained);
    permit = true; await reopened.retry();
    expect(reopened.status).toBe("ready"); expect(reopened.hasPendingChanges).toBe(false);
    expect(reopened.recoveryJournal?.retired).toBeUndefined();
    expect(server.pushes).toEqual([]);
  });

  it("rebases a clean native checkpoint when the epoch changes without changing file bytes", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start(); original.destroy();
    const oldRevision = server.state.revision;
    server.state = seedVaultCollaboration(server.bytes, "item-1", 2);
    expect(server.state.revision).toBe(oldRevision);
    const checkpoints: FileCollaborationCheckpoint[] = [];
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: server.request, localRevision: oldRevision, checkpoint: async value => { checkpoints.push(value); } });
    clients.push(reopened); await reopened.start(); await reopened.flushLocal();
    expect(reopened.status).toBe("ready"); expect(reopened.epoch).toBe(2);
    expect(reopened.recoveryJournal?.update).toBe(server.state.update);
    expect(checkpoints.at(-1)?.journal.epoch).toBe(2);
    reopened.mutate(doc => documentText(doc, "body").insert(5, " after fresh epoch"));
    expect(await reopened.flush()).toBe(true);
    const converged = new Y.Doc();
    try {
      Y.applyUpdate(converged, Uint8Array.from(atob(server.state.update), c => c.charCodeAt(0)));
      expect(documentText(converged, "body").toString()).toBe("Hello after fresh epoch");
    } finally { converged.destroy(); }
  });

  it("keeps pending updates in an old Windows retirement protected", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start(); original.setActive(false);
    original.mutate(doc => documentText(doc, "body").insert(5, " unsaved"));
    const retained = JSON.parse(journal.load(original.journalKey)!);
    retained.retired = "This file or its access changed. Recover your saved edits before reopening.";
    journal.save(original.journalKey, JSON.stringify(retained)); original.destroy();
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: server.request, checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.hasPendingChanges).toBe(true);
    expect(documentText(reopened.doc, "body").toString()).toBe("Hello unsaved");
    expect(() => reopened.discardCleanJournal()).toThrow();
  });

  it("does not resume a clean Windows retirement when live read access was revoked", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start();
    const retained = JSON.parse(journal.load(original.journalKey)!);
    retained.retired = "This file or its access changed. Recover your saved edits before reopening.";
    const bytes = JSON.stringify(retained); journal.save(original.journalKey, bytes); original.destroy();
    const observed = vi.fn();
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); }, checkpoint: async () => {}, onChange: observed });
    clients.push(reopened); await reopened.start();
    expect(reopened.hasBaseline).toBe(false); expect(reopened.canEdit).toBe(false);
    expect(observed).not.toHaveBeenCalled(); expect(journal.load(original.journalKey)).toBe(bytes);
  });

  it("adopts read-only permissions without recovery controls when no edits are pending", async () => {
    const server = new Server(), journal = new Journal();
    const original = client(server, journal); await original.start(); original.destroy();
    server.canEdit = false;
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal,
      request: server.request, checkpoint: async () => {} });
    clients.push(reopened); await reopened.start();
    expect(reopened.status).toBe("ready"); expect(reopened.canEdit).toBe(false);
    expect(reopened.hasPendingChanges).toBe(false); expect(server.pushes).toEqual([]);
  });

  it("keeps pending edits if an unexpected native session loss still occurs", async () => {
    const server = new Server(), journal = new Journal();
    let closed = false;
    const editor = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", journal, request: server.request,
      checkpoint: async () => { if (closed) throw Object.assign(new Error("Session closed"), { code: "session_closed" }); } });
    clients.push(editor); await editor.start(); await editor.flushLocal();
    closed = true;
    editor.mutate(doc => documentText(doc, "body").insert(5, " still here"));
    expect(await editor.flush()).toBe(false);
    expect(editor.status).toBe("error"); expect(editor.hasPendingChanges).toBe(true);
    expect(documentText(editor.doc, "body").toString()).toBe("Hello still here");
    expect(server.pushes).toHaveLength(0);
    expect(() => editor.discardCleanJournal()).toThrow();
    expect(journal.load(editor.journalKey)).toBeTruthy();
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

  it("reopens a native-attested relocation without treating path-only changes as divergent edits", async () => {
    const server = new Server(), journal = new Journal(), original = client(server, journal);
    await original.start();
    original.mutate(doc => documentText(doc, "body").insert(5, " retained"));
    const browser = journal.load(original.journalKey)!;
    original.destroy();
    const relocated = JSON.stringify({ ...JSON.parse(browser), relativePath: "Moved/Note.textpack" });
    let observedBody = "";
    const reopened = new FileCollaborationClient({ server: "https://texttext.test", workspaceId: "workspace", itemId: "item-1", active: false, journal, retainedJournal: relocated, retainedJournalPath: "Moved/Note.textpack", request: server.request, onChange: snapshot => { observedBody = snapshot.content.body; } });
    clients.push(reopened); await reopened.start();
    expect(reopened.hasUnreadableJournal).toBe(false);
    expect(reopened.hasBaseline).toBe(true);
    expect(observedBody).toBe("Hello retained");
    expect(reopened.recoveryJournal?.relativePath).toBe("Moved/Note.textpack");
    expect(reopened.hasPendingChanges).toBe(true);
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
    expect(selectFileCollaborationJournal(newer, changed, "Other.textpack")).toBe(changed);
    expect(() => selectFileCollaborationJournal(newer, changed, "Unattested.textpack")).toThrow(/diverged/);
    const changedState = JSON.stringify({ ...JSON.parse(changed), seq: JSON.parse(changed).seq + 1 });
    expect(() => selectFileCollaborationJournal(newer, changedState, "Other.textpack")).toThrow(/diverged/);
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
    original.mutate(doc => documentText(doc, "body").insert(5, " pending"));
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
    for (const [raw, expected] of [[clean, "paused"], [pending, "recovery"]] as const) {
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


describe("durable detached external-file navigation", () => {
  it("allows a clean externally replaced file to close without waiting for its cloud upload", async () => {
    const server = new Server(), journal = new Journal();
    const editor = client(server, journal); await editor.start();
    editor.notifyExternalFileChange(); expect(editor.status).toBe("stale-file");
    const savedFile = { path: "Shared.textpack", hash: "saved-external-file" };
    const proof = new DetachedFileSaveProof();
    proof.retire(editor, savedFile); editor.destroy();
    expect(proof.matches(savedFile)).toBe(true);
    expect(journal.values.size).toBe(0);
    expect(proof.matches({ ...savedFile, path: "Other.textpack" })).toBe(false);
    expect(proof.matches({ ...savedFile, hash: "later-file" })).toBe(false);
    proof.clear(); expect(proof.matches(savedFile)).toBe(false);
  });

  it("never allows pending edits, unreadable journals or failed journal removal to become detached save proof", async () => {
    const savedFile = { path: "Shared.textpack", hash: "disk-file" };
    const pending = client(new Server()); await pending.start();
    pending.mutate(doc => documentText(doc, "body").insert(5, " unsaved"));
    pending.notifyExternalFileChange();
    const proof = new DetachedFileSaveProof();
    expect(() => proof.retire(pending, savedFile)).toThrow(); expect(proof.matches(savedFile)).toBe(false);
    const brokenJournal = new Journal(); const clean = client(new Server(), brokenJournal); await clean.start();
    vi.spyOn(brokenJournal, "remove").mockImplementation(() => { throw new Error("disk denied"); });
    expect(() => proof.retire(clean, savedFile)).toThrow("disk denied"); expect(proof.matches(savedFile)).toBe(false);
    const unreadableJournal = new Journal(), unreadable = client(new Server(), unreadableJournal);
    unreadableJournal.values.set(unreadable.journalKey, "damaged journal"); await unreadable.start();
    expect(unreadable.hasUnreadableJournal).toBe(true);
    expect(() => proof.retire(unreadable, savedFile)).toThrow("Pending collaboration");
    expect(unreadableJournal.load(unreadable.journalKey)).toBe("damaged journal");
    expect(proof.matches(savedFile)).toBe(false);
  });
});
