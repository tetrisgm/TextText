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
import { FileCollaborationClient, type FileCollaborationJournalStore, type FileCollaborationRequest, type FileCollaborationCheckpoint, type FileCollaborationOptions } from "./collaboration-client";

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
  request: FileCollaborationRequest = async (method, params) => {
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
async function settled(target: FileCollaborationClient, status: string) {
  await vi.waitFor(() => expect(target.status).toBe(status), { timeout: 10_000, interval: 20 });
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
    await vi.waitFor(() => expect(store.pushes).toHaveLength(1));
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
    const reopened = client(store, journal, { checkpoint: async value => {
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
