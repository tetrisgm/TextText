import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentText } from "@/lib/collab/document";
import { readVaultCollaboration, pushVaultCollaboration, writeVaultTextpack, readVaultTextpack, deleteVaultTextpack, restoreVaultTextpack,
  VaultCollaborationEpochError, VaultCollaborationRecoveryError } from "@/lib/vault/server-store";
import { FileCollaborationClient, type FileCollaborationJournal, type FileCollaborationJournalStore, type FileCollaborationRequest, type FileCollaborationCheckpoint, type FileCollaborationOptions } from "./collaboration-client";

/** Automatic pending-edit epoch recovery against the real file-backed store (local temp directory only). */
const workspaceId = "workspace-1", itemId = "item-1", relativePath = "Notes/Shared.textpack";
const audit = { actorUserId: "user-1", actorType: "human" as const };
function pack(body: string, files?: Record<string, Uint8Array>) {
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); document.content.body = body;
  return buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\n${body}`, files });
}
class Journal implements FileCollaborationJournalStore {
  values = new Map<string, string>();
  load(key: string) { return this.values.get(key) ?? null; }
  save(key: string, value: string) { this.values.set(key, value); }
  remove(key: string) { this.values.delete(key); }
}
type Push = { operationId: string; epoch: number; recovery: boolean };
class Store {
  canEdit = true; loseAck = false; pushes: Push[] = []; replacements = 0;
  beforePush: ((push: Push) => Promise<void>) | null = null;
  constructor(readonly root: string) {}
  location() { return { root: this.root, workspaceId, itemId, onReceipt: async () => {} }; }
  async body(): Promise<string> {
    const state = (await readVaultCollaboration(this.location()))!;
    const doc = new Y.Doc();
    try { Y.applyUpdate(doc, Buffer.from(state.update, "base64")); return documentText(doc, "body").toString(); }
    finally { doc.destroy(); }
  }
  async epoch(): Promise<number> { return (await readVaultCollaboration(this.location()))!.epoch; }
  /** A raw TextPack replacement with new opaque bytes starts a new epoch, as an outside writer would. */
  async replace(body: string): Promise<void> {
    const file = (await readVaultTextpack(this.location()))!;
    await writeVaultTextpack({ ...this.location(), relativePath, operationId: `replace-${++this.replacements}`, baseRevision: file.revision,
      bytes: pack(body, { "opaque.bin": new Uint8Array([this.replacements]) }) });
  }
  /** Store calls still running against the temp directory. The client abandons an aborted request
   * (as it would a fetch) but the file store cannot stop mid-write and `setup` re-creates
   * `.texttext/*`; teardown awaits these before removing the directory. */
  inflight = new Set<Promise<unknown>>();
  async settle(): Promise<void> { while (this.inflight.size) await Promise.allSettled([...this.inflight]); }
  request: FileCollaborationRequest = async (method, params, signal) => {
    if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
    const work = this.serve(method, params);
    this.inflight.add(work);
    try { return await work; } finally { this.inflight.delete(work); }
  };
  private async serve(method: "read" | "push", params: Record<string, unknown>): Promise<unknown> {
    if (method === "read") {
      const state = await readVaultCollaboration(this.location());
      if (!state) throw Object.assign(new Error("Missing"), { status: 404 });
      return { ...state, canEditContent: this.canEdit, canComment: true };
    }
    const push: Push = { operationId: params.operationId as string, epoch: params.epoch as number, recovery: params.recoveryUpdate !== undefined };
    this.pushes.push(push);
    if (!this.canEdit) throw Object.assign(new Error("Forbidden"), { status: 403 });
    await this.beforePush?.(push);
    try {
      const result = await pushVaultCollaboration({ ...this.location(), operationId: push.operationId, epoch: push.epoch, audit,
        ...(push.recovery ? { recoveryUpdate: params.recoveryUpdate as string } : { updates: params.updates as string[] }) });
      if (this.loseAck) { this.loseAck = false; throw Object.assign(new Error("Network disconnected"), { status: 503 }); }
      return result;
    } catch (error) {
      if (error instanceof VaultCollaborationEpochError) throw Object.assign(new Error(error.message), { status: 409, code: "epoch_changed" });
      if (error instanceof VaultCollaborationRecoveryError) throw Object.assign(new Error(error.message), { status: 409, code: error.code });
      throw error;
    }
  };
}
const clients: FileCollaborationClient[] = [];
function client(store: Store, journal: Journal, options: Partial<FileCollaborationOptions> = {}) {
  const result = new FileCollaborationClient({ server: "https://texttext.test", workspaceId, itemId, journal, request: store.request,
    onDocumentReplaced: () => {}, ...options });
  clients.push(result); return result;
}
/** Leave " pending" unsent in the journal, then let an outside writer replace the epoch. */
async function pendingThenReplaced(store: Store, journal: Journal, replacement = "Hello remote") {
  const first = client(store, journal); await first.start();
  expect(first.status).toBe("ready");
  first.mutate(doc => documentText(doc, "body").insert(5, " pending"));
  first.destroy();
  const oldEpoch = await store.epoch();
  await store.replace(replacement);
  expect(await store.epoch()).toBe(oldEpoch + 1);
  return oldEpoch;
}
/** Release gates run this file beside the whole suite; the 1s default deadline is too short there. */
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 10_000, interval: 20 });
async function settled(target: FileCollaborationClient, status: string) {
  await waitFor(() => expect(target.status).toBe(status));
}
describe("automatic pending-edit epoch recovery", () => {
  let root: string, store: Store, journal: Journal;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-epoch-recovery-client-"));
    store = new Store(root); journal = new Journal();
    await writeVaultTextpack({ ...store.location(), relativePath, operationId: "initial", baseRevision: null, bytes: pack("Hello") });
  });
  afterEach(async () => {
    for (const entry of clients.splice(0)) entry.destroy();
    await store.settle();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("recovers pending edits automatically after restart into a replaced epoch", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    const replaced: Y.Doc[] = [];
    const reopened = client(store, journal, { onDocumentReplaced: next => { replaced.push(next); } });
    await reopened.start();
    expect(await reopened.flush()).toBe(true);
    expect(reopened.status).toBe("ready"); expect(reopened.canEdit).toBe(true);
    expect(await store.body()).toBe("Hello remote pending");
    expect(documentText(reopened.doc, "body").toString()).toBe("Hello remote pending");
    expect(replaced).toEqual([reopened.doc]);
    expect(reopened.epoch).toBe(oldEpoch + 1);
    expect(store.pushes).toEqual([{ operationId: expect.any(String), epoch: oldEpoch, recovery: true }]);
    expect(reopened.recoveryJournal?.recovery).toBeUndefined();
    expect(reopened.recoveryJournal?.pending).toEqual([]);
    expect(reopened.hasPendingChanges).toBe(false);
    // The replacement epoch stays live for ordinary editing.
    reopened.mutate(doc => documentText(doc, "body").insert(0, "Again "));
    expect(await reopened.flush()).toBe(true);
    expect(await store.body()).toBe("Again Hello remote pending");
  });

  it("persists the recovery intent before sending and replays the same operation after a lost acknowledgement and restart", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    store.loseAck = true;
    const first = client(store, journal); await first.start();
    expect(await first.flush()).toBe(false);
    await settled(first, "offline");
    expect(store.pushes).toHaveLength(1);
    const intent = first.recoveryJournal?.recovery;
    expect(intent).toMatchObject({ operationId: store.pushes[0].operationId, epoch: oldEpoch });
    expect(intent?.adopted).toBeUndefined();
    expect(first.hasPendingChanges).toBe(true);
    first.destroy();
    // The server already committed the intent. A restart must retry the exact
    // same bytes under the same identifier and receive the original receipt.
    const resumed = client(store, journal); await resumed.start();
    expect(await resumed.flush()).toBe(true);
    expect(resumed.status).toBe("ready");
    expect(store.pushes.map(push => push.operationId)).toEqual([intent!.operationId, intent!.operationId]);
    expect(await store.body()).toBe("Hello remote pending");
    expect((await store.body()).split("pending")).toHaveLength(2);
    expect(resumed.recoveryJournal?.recovery).toBeUndefined();
  });

  it("keeps edits typed while the recovery request is in flight", async () => {
    await pendingThenReplaced(store, journal);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let typed = false;
    const editor = client(store, journal);
    store.beforePush = async push => { if (push.recovery && !typed) { typed = true; await held; } };
    await editor.start();
    await waitFor(() => expect(store.pushes).toHaveLength(1));
    editor.mutate(doc => documentText(doc, "body").insert(0, "Late "));
    expect(editor.recoveryJournal?.pending.length).toBeGreaterThan(0);
    release();
    expect(await editor.flush()).toBe(true);
    expect(editor.status).toBe("ready");
    expect(await store.body()).toBe("Late Hello remote pending");
    expect(documentText(editor.doc, "body").toString()).toBe("Late Hello remote pending");
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
    expect(editor.hasPendingChanges).toBe(false);
  });

  it("recovers a live editor whose poll meets a replaced epoch, including a batch whose acknowledgement was lost", async () => {
    const editor = client(store, journal); await editor.start();
    editor.mutate(doc => documentText(doc, "body").insert(5, " once"));
    store.loseAck = true;
    expect(await editor.flush()).toBe(false);
    expect(editor.recoveryJournal?.batch).not.toBeNull();
    await store.replace("Hello once remote");
    await settled(editor, "ready");
    expect(await store.body()).toBe("Hello once remote");
    expect((await store.body()).split("once")).toHaveLength(2);
    expect(editor.recoveryJournal?.batch).toBeNull();
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
  });

  it("retires without sending when editing access was revoked", async () => {
    await pendingThenReplaced(store, journal);
    store.canEdit = false;
    const reopened = client(store, journal); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.canEdit).toBe(false);
    expect(store.pushes).toEqual([]);
    expect(reopened.recoveryJournal?.pending).toHaveLength(1);
    expect(reopened.recoveryJournal?.recovery).toBeUndefined();
    expect(documentText(reopened.doc, "body").toString()).toBe("Hello pending");
    expect(await store.body()).toBe("Hello remote");
  });

  it("fails closed with the intent retained when the native checkpoint of the replacement epoch fails", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    const checkpoints: FileCollaborationCheckpoint[] = [];
    const reopened = client(store, journal, { supportsEpochRecovery: true, checkpoint: async value => {
      checkpoints.push(value);
      if (value.journal.epoch > oldEpoch) throw new Error("disk full");
    } });
    await reopened.start();
    expect(await reopened.flush()).toBe(false);
    await settled(reopened, "error");
    expect(reopened.canEdit).toBe(false);
    expect(await store.body()).toBe("Hello remote pending");
    // The intent reached native storage before the send, and the old state stays in the journal.
    expect(checkpoints.some(value => value.journal.epoch === oldEpoch && value.journal.recovery?.operationId)).toBe(true);
    const retained = reopened.recoveryJournal!;
    expect(retained.recovery).toMatchObject({ epoch: oldEpoch, adopted: true });
    expect(retained.retired).toBeTruthy();
    expect(reopened.hasPendingChanges).toBe(false);
    expect(() => reopened.discardCleanJournal()).not.toThrow();
  });

  it("retires with the journal intact when the server has no retained history or the item lifecycle changed", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    await fs.rm(path.join(root, workspaceId, ".texttext/collaboration", `${itemId}.epochs`, `${oldEpoch}.json`));
    const reopened = client(store, journal); await reopened.start();
    expect(await reopened.flush()).toBe(false);
    await settled(reopened, "recovery");
    expect(reopened.recoveryJournal?.retired).toMatch(/kept for recovery/);
    expect(reopened.recoveryJournal?.pending).toHaveLength(1);
    expect(reopened.recoveryJournal?.recovery).toMatchObject({ epoch: oldEpoch });
    expect(documentText(reopened.doc, "body").toString()).toBe("Hello pending");
    expect(await store.body()).toBe("Hello remote");
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(store.pushes).toHaveLength(1); // No retry loop after a definitive answer.
    reopened.destroy();
    const again = client(store, journal); await again.start();
    expect(again.status).toBe("recovery"); expect(store.pushes).toHaveLength(1);
  });

  it("refuses to cross a deletion barrier", async () => {
    await pendingThenReplaced(store, journal);
    const current = (await readVaultTextpack(store.location()))!;
    await deleteVaultTextpack({ ...store.location(), operationId: "delete", basePath: relativePath, baseRevision: current.revision });
    await restoreVaultTextpack({ ...store.location(), operationId: "restore", basePath: relativePath, relativePath, baseRevision: current.revision });
    const reopened = client(store, journal); await reopened.start();
    expect(await reopened.flush()).toBe(false);
    await settled(reopened, "recovery");
    expect(reopened.recoveryJournal?.pending).toHaveLength(1);
    expect(store.pushes).toHaveLength(1);
    expect(await store.body()).toBe("Hello remote");
  });

  it("keeps a corrupted recovery intent preserved instead of adopting it", async () => {
    await pendingThenReplaced(store, journal);
    const first = client(store, journal); store.loseAck = true; await first.start();
    expect(await first.flush()).toBe(false); first.destroy();
    const key = first.journalKey;
    const corrupted = JSON.parse(journal.load(key)!);
    corrupted.recovery.update = "!!!!";
    journal.save(key, JSON.stringify(corrupted));
    const reopened = client(store, journal); await reopened.start();
    expect(reopened.status).toBe("error"); expect(reopened.hasUnreadableJournal).toBe(true);
    expect(journal.load(key)).toBe(JSON.stringify(corrupted));
    expect(store.pushes).toHaveLength(1);
  });

  it("asks to reopen after a durable recovery when no live document rebinding is available", async () => {
    await pendingThenReplaced(store, journal);
    const reopened = client(store, journal, { onDocumentReplaced: undefined });
    await reopened.start();
    expect(await reopened.flush()).toBe(false);
    await settled(reopened, "stale-file");
    expect(reopened.canEdit).toBe(false);
    expect(await store.body()).toBe("Hello remote pending");
    expect(reopened.hasPendingChanges).toBe(false);
    expect(() => reopened.discardCleanJournal()).not.toThrow();
  });
});

/** Guarded native checkpoint store: the Mac/Windows rules that matter for epoch adoption
 * (`LocalVaultSharedEditing.swift` materialize/authorizedAdoption, `SharedEditingStore.cs`). */
class Native {
  checkpoint: { journal: FileCollaborationJournal; pending: boolean; retired?: string } | null = null;
  archived: FileCollaborationJournal[] = [];
  writes = 0;
  failWith: unknown = null;
  /** Limit `failWith` to matching checkpoints; a plain `failWith` fails every checkpoint. */
  failWhen: ((journal: FileCollaborationJournal) => boolean) | null = null;
  constructor(private baselineRevision: string) {}
  /** What `collaborationOpen` returns for the client's constructor. */
  open(): Pick<FileCollaborationOptions, "retainedJournal" | "retainedJournalPath" | "localRevision" | "initialRetirement" | "checkpoint"> {
    return { retainedJournal: this.checkpoint ? JSON.stringify(this.checkpoint.journal) : null, retainedJournalPath: this.checkpoint?.journal.relativePath,
      localRevision: this.checkpoint?.journal.revision ?? this.baselineRevision, initialRetirement: this.checkpoint?.retired, checkpoint: this.materialize };
  }
  materialize = async ({ journal }: FileCollaborationCheckpoint): Promise<void> => {
    if (this.failWith && (!this.failWhen || this.failWhen(journal))) throw this.failWith;
    const prior = this.checkpoint, closed = Object.assign(new Error("This shared editing session has closed."), { code: "session_closed" });
    const pending = Boolean(journal.batch || journal.pending.length || journal.unqueuedDirty);
    if (prior) {
      // A retirement that only mirrors the retained journal's own `retired` text is lifted by a newer
      // unretired checkpoint of the same epoch and path; native-originated retirements stay fenced.
      if (prior.retired && !(prior.journal.retired === prior.retired && !journal.retired && journal.epoch === prior.journal.epoch &&
        journal.relativePath === prior.journal.relativePath && (journal.journalGeneration ?? 0) > (prior.journal.journalGeneration ?? 0))) throw closed;
      const incoming = journal.journalGeneration ?? 0, retained = prior.journal.journalGeneration ?? 0;
      if (incoming < retained) throw new Error("generation");
      if (incoming === retained) { if (JSON.stringify(journal) !== JSON.stringify(prior.journal)) throw new Error("generation"); return; }
      if (prior.pending && journal.epoch !== prior.journal.epoch) {
        const held = prior.journal.recovery, adopted = journal.recovery;
        const authorized = journal.epoch > prior.journal.epoch && journal.relativePath === prior.journal.relativePath && held && !held.adopted &&
          held.epoch === prior.journal.epoch && adopted?.adopted && adopted.operationId === held.operationId && adopted.epoch === held.epoch && adopted.update === held.update;
        if (!authorized) throw closed;
        this.archived.push(prior.journal);
      }
    }
    this.writes++;
    this.checkpoint = { journal: JSON.parse(JSON.stringify(journal)), pending, retired: journal.retired };
  };
}
describe("epoch adoption against a guarded native checkpoint store", () => {
  let root: string, store: Store, journal: Journal, native: Native;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-epoch-adoption-native-"));
    store = new Store(root); journal = new Journal();
    const written = await writeVaultTextpack({ ...store.location(), relativePath, operationId: "initial", baseRevision: null, bytes: pack("Hello") });
    native = new Native(written.revision!);
  });
  afterEach(async () => {
    for (const entry of clients.splice(0)) entry.destroy();
    await store.settle();
    await fs.rm(root, { recursive: true, force: true });
  });
  const open = (options: Partial<FileCollaborationOptions> = {}) => client(store, journal, { ...native.open(), supportsEpochRecovery: true, ...options });
  /** Hold the recovery push, optionally type, let adoptEpoch persist the replacement, and die before its native checkpoint. */
  async function crashAfterAdoptPersist(late?: string) {
    const oldEpoch = await pendingThenReplaced(store, journal);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    store.beforePush = async push => { if (push.recovery) { store.beforePush = null; await held; } };
    const editor = open({ onDocumentReplaced: () => {} });
    await editor.start();
    await waitFor(() => expect(store.pushes).toHaveLength(1));
    await waitFor(() => expect(native.checkpoint?.journal.recovery?.operationId).toBe(store.pushes[0].operationId));
    if (late) {
      editor.mutate(doc => documentText(doc, "body").insert(0, late));
      // The late edit's own debounced checkpoint lands natively, as it would 200ms after
      // typing. Only the adoption checkpoint dies; a slow push must not let the pending
      // checkpoint meet the crash first, which retires the journal before adoption.
      expect(await editor.flushLocal()).toBe(true);
      expect(native.checkpoint?.pending).toBe(true);
    }
    native.failWith = Object.assign(new Error("process died"), { code: "crash" });
    native.failWhen = journal => journal.epoch > oldEpoch;
    release();
    await waitFor(() => expect(journal.load(editor.journalKey)).toContain('"adopted":true'));
    const persisted = JSON.parse(journal.load(editor.journalKey)!) as FileCollaborationJournal;
    editor.destroy(); native.failWith = null; native.failWhen = null;
    expect(persisted.epoch).toBe(oldEpoch + 1); expect(persisted.recovery).toMatchObject({ epoch: oldEpoch, adopted: true });
    expect(native.checkpoint?.journal.epoch).toBe(oldEpoch); expect(native.checkpoint?.journal.recovery?.adopted).toBeUndefined();
    expect(native.open().localRevision).not.toBe(persisted.revision);
    return { oldEpoch, persisted };
  }

  it("does not read a missing adoption checkpoint as a changed local file when late edits are pending", async () => {
    const { oldEpoch, persisted } = await crashAfterAdoptPersist("Late ");
    expect(persisted.pending).toHaveLength(1);
    const reopened = open();
    await reopened.start();
    expect(reopened.status).not.toBe("recovery");
    expect(await reopened.flush()).toBe(true);
    expect(reopened.status).toBe("ready"); expect(reopened.canEdit).toBe(true);
    expect(reopened.epoch).toBe(oldEpoch + 1);
    expect(await store.body()).toBe("Late Hello remote pending");
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
    expect(native.archived.map(entry => entry.epoch)).toEqual([oldEpoch]);
    expect(native.checkpoint?.journal.epoch).toBe(oldEpoch + 1); expect(native.checkpoint?.pending).toBe(false);
    expect(reopened.recoveryJournal?.recovery).toBeUndefined(); expect(reopened.hasPendingChanges).toBe(false);
  });

  it("proves a clean adopted epoch natively on restart instead of treating it as a fresh baseline", async () => {
    const { oldEpoch } = await crashAfterAdoptPersist();
    const reopened = open();
    await reopened.start();
    expect(reopened.status).toBe("ready");
    expect(await reopened.flushLocal()).toBe(true);
    expect(native.checkpoint?.journal.epoch).toBe(oldEpoch + 1); expect(native.archived).toHaveLength(1);
    expect(reopened.recoveryJournal?.recovery).toBeUndefined();
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
    reopened.mutate(doc => documentText(doc, "body").insert(0, "Again "));
    expect(await reopened.flush()).toBe(true);
    expect(await store.body()).toBe("Again Hello remote pending");
  });

  it("keeps the intent until the native store adopts the epoch, even when the first checkpoint after restart fails", async () => {
    const { oldEpoch } = await crashAfterAdoptPersist("Late ");
    native.failWith = new Error("disk full");
    const reopened = open();
    await reopened.start();
    await settled(reopened, "error");
    expect(reopened.recoveryJournal?.recovery).toMatchObject({ epoch: oldEpoch, adopted: true });
    expect(native.checkpoint?.journal.epoch).toBe(oldEpoch);
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
  });

  it("still fails closed when the local file truly changed under pending edits", async () => {
    await pendingThenReplaced(store, journal);
    const downloaded = await writeVaultTextpack({ ...store.location(), relativePath, operationId: "download", baseRevision: (await readVaultTextpack(store.location()))!.revision, bytes: pack("Downloaded") });
    native = new Native(downloaded.revision!); // No native journal: the app downloaded a new file while closed.
    const reopened = open();
    await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.canEdit).toBe(false);
    expect(store.pushes).toEqual([]); expect(reopened.hasPendingChanges).toBe(true);
    // An adopted intent is no bypass either when the native store never held the matching intent.
    const raw = JSON.parse(journal.load(reopened.journalKey)!) as FileCollaborationJournal;
    reopened.destroy();
    delete raw.retired;
    raw.recovery = { operationId: "forged", epoch: raw.epoch, update: raw.update, adopted: true };
    raw.epoch += 1; raw.journalGeneration = (raw.journalGeneration ?? 0) + 1;
    journal.save(reopened.journalKey, JSON.stringify(raw));
    const again = open();
    await again.start();
    expect(again.status).toBe("recovery"); expect(store.pushes).toEqual([]);
  });

  it("retires pending edits for manual recovery when the native store lacks the epoch-adoption capability", async () => {
    await pendingThenReplaced(store, journal);
    const reopened = client(store, journal, { ...native.open() });
    await reopened.start();
    await settled(reopened, "recovery");
    expect(store.pushes).toEqual([]);
    expect(reopened.recoveryJournal?.pending).toHaveLength(1);
    expect(reopened.recoveryJournal?.recovery).toBeUndefined();
    expect(await store.body()).toBe("Hello remote");
  });

  it("awaits the rebinding callback before destroying the previous document and journals edits typed meanwhile", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const seen: { next: Y.Doc; previous: Y.Doc }[] = [];
    const editor = open({ onDocumentReplaced: async (next, previous) => { seen.push({ next, previous }); await held; } });
    await editor.start();
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].previous.isDestroyed).toBe(false); expect(editor.doc).toBe(seen[0].next);
    expect(editor.recoveryJournal?.recovery).toMatchObject({ epoch: oldEpoch, adopted: true });
    editor.mutate(doc => documentText(doc, "body").insert(0, "Meanwhile "));
    expect(editor.recoveryJournal?.pending).toHaveLength(1);
    expect(editor.recoveryJournal?.recovery?.adopted).toBe(true);
    release();
    expect(await editor.flush()).toBe(true);
    expect(editor.status).toBe("ready");
    expect(seen[0].previous.isDestroyed).toBe(true); expect(seen[0].next.isDestroyed).toBe(false);
    expect(await store.body()).toBe("Meanwhile Hello remote pending");
    expect(native.checkpoint?.journal.epoch).toBe(oldEpoch + 1);
  });

  it("destroys both documents when the client is destroyed during the rebinding callback", async () => {
    await pendingThenReplaced(store, journal);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const seen: { next: Y.Doc; previous: Y.Doc }[] = [];
    const editor = open({ onDocumentReplaced: async (next, previous) => { seen.push({ next, previous }); await held; } });
    await editor.start();
    await waitFor(() => expect(seen).toHaveLength(1));
    editor.destroy(); release();
    await waitFor(() => expect(seen[0].previous.isDestroyed).toBe(true));
    expect(seen[0].next.isDestroyed).toBe(true);
    // The adoption stayed durable for the next open.
    const persisted = JSON.parse(journal.load(editor.journalKey)!) as FileCollaborationJournal;
    expect(persisted.recovery?.adopted).toBe(true);
    const reopened = open(); await reopened.start();
    expect(reopened.status).toBe("ready"); expect(reopened.recoveryJournal?.recovery).toBeUndefined();
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
  });

  it("asks to reopen when the rebinding callback fails, keeping the durable adoption", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    const seen: Y.Doc[] = [];
    const editor = open({ onDocumentReplaced: async (_next, previous) => { seen.push(previous); throw new Error("editor unmounted"); } });
    await editor.start();
    await settled(editor, "stale-session");
    expect(editor.canEdit).toBe(false);
    expect(seen[0].isDestroyed).toBe(true);
    expect(native.checkpoint?.journal.epoch).toBe(oldEpoch + 1);
    expect(editor.recoveryJournal?.recovery).toBeUndefined(); expect(editor.hasPendingChanges).toBe(false);
    expect(await store.body()).toBe("Hello remote pending");
  });

  it("destroys the previous document when the adoption checkpoint fails", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    const seen: Y.Doc[] = [];
    native.failWith = null;
    const editor = client(store, journal, { ...native.open(), supportsEpochRecovery: true, onDocumentReplaced: (_next, previous) => { seen.push(previous); },
      checkpoint: async value => { if (value.journal.epoch > oldEpoch) throw new Error("disk full"); await native.materialize(value); } });
    await editor.start();
    await settled(editor, "error");
    expect(seen[0].isDestroyed).toBe(true); expect(editor.doc.isDestroyed).toBe(false);
  });

  it("keeps only the late edits for manual recovery when they conflict after the server committed the intent", async () => {
    const oldEpoch = await pendingThenReplaced(store, journal);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    store.beforePush = async push => { if (push.recovery) { store.beforePush = null; await held; } };
    const editor = open({ onDocumentReplaced: () => {} });
    await editor.start();
    await waitFor(() => expect(store.pushes).toHaveLength(1));
    // Deleting the whole body spans the replacement's insertion inside it.
    editor.mutate(doc => { const body = documentText(doc, "body"); body.delete(0, body.length); body.insert(0, "Bye"); });
    release();
    expect(await editor.flush()).toBe(false);
    await settled(editor, "recovery");
    expect(await store.body()).toBe("Hello remote pending");
    const retained = editor.recoveryJournal!;
    expect(retained.pending).toEqual([]); expect(retained.batch).toBeNull(); expect(retained.unqueuedDirty).toBe(true);
    expect(retained.epoch).toBe(oldEpoch); expect(retained.recovery).toMatchObject({ epoch: oldEpoch }); expect(retained.recovery?.adopted).toBeUndefined();
    expect(documentText(editor.doc, "body").toString()).toBe("Bye");
    expect(editor.hasPendingChanges).toBe(true);
    editor.destroy();
    const reopened = open(); await reopened.start();
    expect(reopened.status).toBe("recovery");
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
    expect(await store.body()).toBe("Hello remote pending");
  });
});

describe("revival of journals retired by a known older fatal path", () => {
  const RETIRED = "This note needs to be reopened. Your edits are saved for recovery.";
  let root: string, store: Store, journal: Journal;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-epoch-revival-"));
    store = new Store(root); journal = new Journal();
    await writeVaultTextpack({ ...store.location(), relativePath, operationId: "initial", baseRevision: null, bytes: pack("Hello") });
  });
  afterEach(async () => {
    for (const entry of clients.splice(0)) entry.destroy();
    await store.settle();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function retiredPending(reason = RETIRED) {
    const first = client(store, journal); await first.start();
    first.mutate(doc => documentText(doc, "body").insert(5, " pending"));
    first.destroy();
    const raw = JSON.parse(journal.load(first.journalKey)!) as FileCollaborationJournal;
    raw.retired = reason; raw.journalGeneration = (raw.journalGeneration ?? 0) + 1;
    journal.save(first.journalKey, JSON.stringify(raw));
    return first.journalKey;
  }

  it("replays a retired pending journal when the server still accepts it at the same epoch", async () => {
    await retiredPending();
    const reopened = client(store, journal); await reopened.start();
    expect(reopened.status).not.toBe("recovery");
    expect(await reopened.flush()).toBe(true);
    expect(reopened.status).toBe("ready");
    expect(await store.body()).toBe("Hello pending");
    expect(reopened.recoveryJournal?.retired).toBeUndefined(); expect(reopened.hasPendingChanges).toBe(false);
  });

  it("routes a retired pending journal through server-validated recovery when the epoch was replaced", async () => {
    await retiredPending();
    await store.replace("Hello remote");
    const reopened = client(store, journal); await reopened.start();
    expect(await reopened.flush()).toBe(true);
    expect(reopened.status).toBe("ready");
    expect(await store.body()).toBe("Hello remote pending");
    expect(store.pushes.filter(push => push.recovery)).toHaveLength(1);
  });

  it("restores the original retirement when editing access is gone", async () => {
    await retiredPending();
    store.canEdit = false;
    const reopened = client(store, journal); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.recoveryJournal?.retired).toBe(RETIRED);
    expect(store.pushes).toEqual([]); expect(reopened.recoveryJournal?.pending).toHaveLength(1);
  });

  it("never revives unknown retirements, native retirements, or unqueued edits", async () => {
    const key = await retiredPending("Editing access changed. Your local document is kept for recovery.");
    const unknown = client(store, journal); await unknown.start();
    expect(unknown.status).toBe("recovery"); expect(store.pushes).toEqual([]);
    unknown.destroy();
    const raw = JSON.parse(journal.load(key)!) as FileCollaborationJournal;
    raw.retired = RETIRED; raw.journalGeneration = (raw.journalGeneration ?? 0) + 1;
    journal.save(key, JSON.stringify(raw));
    const nativeRetired = client(store, journal, { initialRetirement: "The file changed outside shared editing.", checkpoint: async () => {} });
    await nativeRetired.start();
    expect(nativeRetired.status).toBe("recovery"); expect(store.pushes).toEqual([]);
    nativeRetired.destroy();
    raw.unqueuedDirty = true; raw.journalGeneration = (raw.journalGeneration ?? 0) + 1;
    journal.save(key, JSON.stringify(raw));
    const dirty = client(store, journal); await dirty.start();
    expect(dirty.status).toBe("recovery"); expect(store.pushes).toEqual([]);
    expect(await store.body()).toBe("Hello");
  });
});

describe("revival when the native checkpoint mirrors the browser retirement", () => {
  const RETIRED = "This note needs to be reopened. Your edits are saved for recovery.";
  let root: string, store: Store, journal: Journal, native: Native;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-epoch-mirrored-"));
    store = new Store(root); journal = new Journal();
    const written = await writeVaultTextpack({ ...store.location(), relativePath, operationId: "initial", baseRevision: null, bytes: pack("Hello") });
    native = new Native(written.revision!);
  });
  afterEach(async () => {
    for (const entry of clients.splice(0)) entry.destroy();
    await store.settle();
    await fs.rm(root, { recursive: true, force: true });
  });
  const open = (options: Partial<FileCollaborationOptions> = {}) => client(store, journal, { ...native.open(), supportsEpochRecovery: true, ...options });
  /** Mac 0.204 builds 1237-1239: a retired pending browser journal reopened under the older
   * build was checkpointed with its `retired` text, so the native store now reports it too. */
  async function mirroredRetiredPending() {
    const first = open(); await first.start();
    first.mutate(doc => documentText(doc, "body").insert(5, " pending"));
    await waitFor(() => expect(native.checkpoint?.pending).toBe(true));
    first.destroy();
    const raw = JSON.parse(journal.load(first.journalKey)!) as FileCollaborationJournal;
    raw.retired = RETIRED; raw.journalGeneration = (raw.journalGeneration ?? 0) + 1;
    journal.save(first.journalKey, JSON.stringify(raw));
    native.checkpoint = { journal: JSON.parse(JSON.stringify(raw)), pending: true, retired: RETIRED };
    expect(native.open().initialRetirement).toBe(RETIRED);
    return first.journalKey;
  }

  it("revives the journal, lifts the native mirror and replays the edit", async () => {
    await mirroredRetiredPending();
    const reopened = open(); await reopened.start();
    expect(reopened.status).not.toBe("recovery");
    expect(await reopened.flush()).toBe(true);
    expect(reopened.status).toBe("ready"); expect(reopened.hasPendingChanges).toBe(false);
    expect(await store.body()).toBe("Hello pending");
    expect(native.checkpoint?.retired).toBeUndefined(); expect(native.checkpoint?.journal.retired).toBeUndefined();
    expect(store.pushes).toHaveLength(1);
    const again = open(); await again.start();
    expect(again.status).toBe("ready"); expect(store.pushes).toHaveLength(1);
  });

  it("recovers through the server when the epoch was replaced meanwhile", async () => {
    await mirroredRetiredPending();
    await store.replace("Hello remote");
    const reopened = open(); await reopened.start();
    expect(await reopened.flush()).toBe(true);
    expect(reopened.status).toBe("ready");
    expect(await store.body()).toBe("Hello remote pending");
    expect(native.checkpoint?.retired).toBeUndefined(); expect(native.archived).toHaveLength(1);
  });

  it("restores the retirement on both sides when editing access is gone", async () => {
    const key = await mirroredRetiredPending();
    store.canEdit = false;
    const reopened = open(); await reopened.start();
    expect(reopened.status).toBe("recovery"); expect(reopened.hasPendingChanges).toBe(true);
    expect(store.pushes).toEqual([]); expect(await store.body()).toBe("Hello");
    await waitFor(() => expect(native.checkpoint?.retired).toBe(RETIRED));
    expect((JSON.parse(journal.load(key)!) as FileCollaborationJournal).retired).toBe(RETIRED);
    expect(reopened.recoveryJournal?.pending).toHaveLength(1);
  });

  it("keeps native-originated retirements and unqueued edits manual", async () => {
    const key = await mirroredRetiredPending();
    native.checkpoint!.retired = "The file changed outside shared editing. Its saved shared journal is available for recovery.";
    const nativeRetired = open(); await nativeRetired.start();
    expect(nativeRetired.status).toBe("recovery"); expect(store.pushes).toEqual([]);
    nativeRetired.destroy();
    native.checkpoint!.retired = RETIRED;
    const raw = JSON.parse(journal.load(key)!) as FileCollaborationJournal;
    raw.unqueuedDirty = true; raw.journalGeneration = (raw.journalGeneration ?? 0) + 1;
    journal.save(key, JSON.stringify(raw));
    const dirty = open(); await dirty.start();
    expect(dirty.status).toBe("recovery"); expect(store.pushes).toEqual([]);
    expect(await store.body()).toBe("Hello");
  });
});
