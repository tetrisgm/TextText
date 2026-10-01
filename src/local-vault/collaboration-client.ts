import * as Y from "yjs";
import { documentSnapshotFromYDoc, hasDocumentSnapshot } from "@/lib/collab/document";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { MAX_UPDATE_CHARS } from "@/lib/collab/limits";

const REMOTE = Symbol("file-collaboration-remote");
const LIMIT = 4 * 1024 * 1024;
export type FileCollaborationStatus = "ready" | "saving" | "offline" | "recovery" | "error";
export type FileCollaborationRequest = (method: "read" | "push", params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export interface FileCollaborationJournalStore { load(key: string): string | null; save(key: string, value: string): void; remove(key: string): void }
type Batch = { operationId: string; updates: string[] };
type Cursor = { epoch: number; seq: number; revision: string; relativePath: string };
export type FileCollaborationJournal = Cursor & { version: 1; canEditContent?: boolean; canComment?: boolean; update: string; pending: string[]; batch: Batch | null; unqueuedDirty?: boolean; retired?: string };
type StateResponse = Cursor & { update: string; canEditContent: boolean; canComment: boolean };
export type FileCollaborationOptions = {
  server: string; workspaceId: string; itemId: string; request: FileCollaborationRequest;
  journal?: FileCollaborationJournalStore; active?: boolean;
  onChange?: (snapshot: DocumentSnapshot) => void;
  onStatus?: (status: FileCollaborationStatus, detail?: string) => void;
};
function encode(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
function decode(value: unknown, max = LIMIT): Uint8Array {
  if (typeof value !== "string" || !value.length || value.length > max || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid collaboration update.");
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Invalid collaboration update.");
  return bytes;
}
function cursor(value: unknown): Cursor {
  const data = value as Partial<Cursor> | null;
  if (!data || !Number.isSafeInteger(data.epoch) || data.epoch! < 1 || !Number.isSafeInteger(data.seq) || data.seq! < 0 ||
    typeof data.revision !== "string" || !/^[a-f0-9]{64}$/.test(data.revision) || typeof data.relativePath !== "string" || data.relativePath.length > 4096) throw new Error("Invalid collaboration response.");
  return data as Cursor;
}
class RequestFailure { constructor(readonly cause: unknown) {} }
const localJournal: FileCollaborationJournalStore = {
  load: key => localStorage.getItem(key), save: (key, value) => localStorage.setItem(key, value), remove: key => localStorage.removeItem(key),
};

/** One canonical server baseline, one durable upload queue, and one visible long poll. */
export class FileCollaborationClient {
  readonly doc = new Y.Doc();
  readonly journalKey: string;
  canEdit = false;
  canComment = false;
  status: FileCollaborationStatus = "offline";
  private readonly storage: FileCollaborationJournalStore;
  private readonly options: FileCollaborationOptions;
  private active: boolean;
  private dead = false;
  private initialized = false;
  private frozen = false;
  private current: Cursor | null = null;
  private pending: string[] = [];
  private unqueuedDirty = false;
  private unreadableJournal = false;
  private rawRecoveryJournal: string | null = null;
  private batch: Batch | null = null;
  private saved: FileCollaborationJournal | null = null;
  private starting: Promise<void> | null = null;
  private flushing: Promise<boolean> | null = null;
  private controllers = new Set<AbortController>();
  private pollController: AbortController | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;

  constructor(options: FileCollaborationOptions) {
    this.options = options; this.storage = options.journal ?? localJournal; this.active = options.active ?? true;
    this.journalKey = `texttext:file-collaboration:v1:${JSON.stringify([options.server.replace(/\/$/, ""), options.workspaceId, options.itemId])}`;
    this.doc.on("update", this.changed);
  }
  get recoveryJournal(): FileCollaborationJournal | null { return this.saved; }
  get hasUnreadableJournal(): boolean { return this.unreadableJournal; }
  get recoveryRawJournal(): string | null { return this.rawRecoveryJournal; }
  get hasPendingChanges(): boolean { return Boolean(this.unreadableJournal || this.unqueuedDirty || this.batch || this.pending.length); }
  get hasBaseline(): boolean { return this.initialized; }
  get revision(): string | null { return this.current?.revision ?? null; }
  get relativePath(): string | null { return this.current?.relativePath ?? null; }
  private report(status: FileCollaborationStatus, detail?: string) {
    this.status = status; this.options.onStatus?.(status, detail);
  }
  private snapshot(): DocumentSnapshot {
    if (!hasDocumentSnapshot(this.doc)) throw new Error("Invalid collaboration document.");
    if (this.doc.store.pendingStructs || this.doc.store.pendingDs) throw new Error("Incomplete collaboration update.");
    const snapshot = documentSnapshotFromYDoc(this.doc);
    if (snapshot.content.assets.some(asset => asset.src.startsWith("blob:") || asset.poster?.startsWith("blob:")) ||
        (typeof snapshot.content.fields.cover === "string" && snapshot.content.fields.cover.startsWith("blob:"))) throw new Error("Invalid temporary asset URL in the shared document.");
    return snapshot;
  }
  private persist(retired?: string): void {
    if (!this.current) return;
    const saved: FileCollaborationJournal = { version: 1, ...this.current, canEditContent: this.canEdit, canComment: this.canComment, unqueuedDirty: this.unqueuedDirty, update: encode(Y.encodeStateAsUpdate(this.doc)), pending: [...this.pending], batch: this.batch ? { ...this.batch, updates: [...this.batch.updates] } : null,
      ...(retired || this.saved?.retired ? { retired: retired ?? this.saved?.retired } : {}) };
    this.saved = saved; // Keep recoverable in memory even when browser storage fails.
    const value = JSON.stringify(saved);
    if (new TextEncoder().encode(value).byteLength > LIMIT) throw new Error("Unsaved collaboration history exceeds 4 MiB. Keep this window open and recover your edits.");
    try { this.storage.save(this.journalKey, value); }
    catch (error) { throw new Error(`Collaboration journal could not be saved. Keep this window open to recover your edits. ${String(error)}`); }
  }
  private notifyRecoverableSnapshot(): void {
    try { this.options.onChange?.(this.snapshot()); }
    catch { /* Invalid document states still remain available in the recovery journal. */ }
  }
  private retire(reason: string): void {
    this.frozen = true; this.canEdit = false; this.cancelWork();
    try { this.persist(reason); this.notifyRecoverableSnapshot(); this.report("recovery", reason); }
    catch (error) { this.notifyRecoverableSnapshot(); this.report("error", `${reason} ${String(error)}`); }
  }
  private fatal(error: unknown): void {
    this.frozen = true; this.canEdit = false; this.cancelWork();
    const detail = error instanceof Error ? error.message : String(error);
    try { this.persist(detail); } catch { /* The status and in-memory journal expose the storage failure. */ }
    this.notifyRecoverableSnapshot(); this.report("error", detail);
  }
  private changed = (update: Uint8Array, origin: unknown): void => {
    if (this.dead || origin === REMOTE) return;
    this.unqueuedDirty = true;
    if (!this.initialized || !this.canEdit || this.frozen) { this.retire("Editing access changed. Your local document is kept for recovery."); return; }
    try {
      const encoded = encode(update);
      if (encoded.length > MAX_UPDATE_CHARS) { this.retire("This edit exceeds the collaboration limit. Your document is kept for recovery."); return; }
      const previous = this.pending.at(-1);
      const merged = previous ? encode(Y.mergeUpdates([decode(previous, MAX_UPDATE_CHARS), update])) : encoded;
      if (previous && merged.length <= MAX_UPDATE_CHARS) this.pending[this.pending.length - 1] = merged;
      else this.pending.push(encoded);
      this.unqueuedDirty = false;
      this.persist();
      this.options.onChange?.(this.snapshot());
      this.report(this.active ? "saving" : "offline");
      this.schedulePush(250);
    } catch (error) { this.fatal(error); }
  };
  mutate(change: (doc: Y.Doc) => void): void {
    if (!this.initialized || !this.canEdit || this.frozen || this.dead) throw new Error("This collaboration document is not editable.");
    change(this.doc);
  }
  private load(): FileCollaborationJournal | null {
    try { return this.loadJournal(); }
    catch (error) { this.unreadableJournal = true; throw error; }
  }
  private loadJournal(): FileCollaborationJournal | null {
    let raw: string | null;
    try { raw = this.storage.load(this.journalKey); } catch (error) { throw new Error(`Collaboration journal could not be read. ${String(error)}`); }
    if (!raw) return null;
    this.rawRecoveryJournal = raw;
    if (new TextEncoder().encode(raw).byteLength > LIMIT) throw new Error("Saved collaboration history exceeds its limit. It has been preserved for recovery.");
    const parsed = JSON.parse(raw) as FileCollaborationJournal;
    cursor(parsed);
    if (parsed.version !== 1 || !Array.isArray(parsed.pending) || parsed.pending.length > 1024 || (parsed.retired !== undefined && typeof parsed.retired !== "string")) throw new Error("Invalid saved collaboration journal. It has been preserved.");
    if ((parsed.canEditContent !== undefined && typeof parsed.canEditContent !== "boolean") || (parsed.canComment !== undefined && typeof parsed.canComment !== "boolean")) throw new Error("Invalid saved collaboration permissions.");
    if (parsed.unqueuedDirty !== undefined && typeof parsed.unqueuedDirty !== "boolean") throw new Error("Invalid saved collaboration dirty marker.");
    decode(parsed.update);
    for (const update of parsed.pending) decode(update, MAX_UPDATE_CHARS);
    if (parsed.batch !== null) {
      if (!parsed.batch || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.batch.operationId) || !Array.isArray(parsed.batch.updates) || !parsed.batch.updates.length || parsed.batch.updates.length > 64) throw new Error("Invalid saved upload batch. It has been preserved.");
      for (const update of parsed.batch.updates) decode(update, MAX_UPDATE_CHARS);
    }
    // Validate the complete retained state before adopting or rewriting any of it.
    const probe = new Y.Doc();
    try {
      Y.applyUpdate(probe, decode(parsed.update), REMOTE);
      if (probe.store.pendingStructs || probe.store.pendingDs || !hasDocumentSnapshot(probe)) throw new Error("Invalid saved collaboration document.");
      const beforeProjection = encode(Y.encodeStateAsUpdate(probe));
      documentSnapshotFromYDoc(probe);
      if (encode(Y.encodeStateAsUpdate(probe)) !== beforeProjection) throw new Error("Invalid saved collaboration shape.");
      for (const update of [...parsed.pending, ...(parsed.batch?.updates ?? [])]) Y.decodeUpdate(decode(update, MAX_UPDATE_CHARS));
    } finally { probe.destroy(); }
    this.rawRecoveryJournal = null;
    return parsed;
  }
  private async request(method: "read" | "push", params: Record<string, unknown>, poll = false): Promise<unknown> {
    const controller = new AbortController(); this.controllers.add(controller);
    if (poll) this.pollController = controller;
    try { return await this.options.request(method, params, controller.signal); }
    catch (error) { throw new RequestFailure(error); }
    finally { this.controllers.delete(controller); if (this.pollController === controller) this.pollController = null; }
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.dead || this.frozen || !this.active || this.initialized) return Promise.resolve();
    this.starting = this.begin().finally(() => { this.starting = null; if (!this.initialized) this.schedulePoll(1000); });
    return this.starting;
  }
  private async begin(): Promise<void> {
    try {
      const retained = this.load();
      if (retained) {
        this.current = cursor(retained); this.pending = retained.pending; this.batch = retained.batch; this.unqueuedDirty = retained.unqueuedDirty === true; this.saved = retained;
        Y.applyUpdate(this.doc, decode(retained.update), REMOTE); this.snapshot();
        this.initialized = true; this.canEdit = retained.canEditContent === true; this.canComment = retained.canComment === true;
        this.options.onChange?.(this.snapshot());
        if (retained.retired || this.unqueuedDirty) { this.retire(retained.retired ?? "Unsubmitted local edits are kept for recovery."); return; }
      }
      const value = await this.request("read", {});
      if (this.dead || !this.active) return;
      const remote = value as StateResponse; cursor(remote);
      if (typeof remote.canEditContent !== "boolean" || typeof remote.canComment !== "boolean") throw new Error("Invalid collaboration permissions.");
      this.current = cursor(remote);
      if (retained) {
        this.current = cursor(retained);
        if (retained.retired || retained.epoch !== remote.epoch || (!remote.canEditContent && (this.canEdit || this.pending.length || this.batch))) {
          this.retire(retained.retired ?? "This file or its access changed. Recover your saved edits before reopening."); return;
        }
      }
      Y.applyUpdate(this.doc, decode(remote.update), REMOTE);
      this.snapshot();
      this.current = cursor(remote); this.canEdit = remote.canEditContent; this.canComment = remote.canComment; this.initialized = true;
      this.persist(); this.failures = 0; this.options.onChange?.(this.snapshot());
      this.report(this.pending.length || this.batch ? "saving" : "ready");
      if (this.pending.length || this.batch) this.schedulePush(0);
      this.schedulePoll(0);
    } catch (error) { this.handleFailure(error); }
  }
  private handleFailure(error: unknown): void {
    if (this.dead || !this.active || this.frozen) return;
    if (!(error instanceof RequestFailure)) { this.fatal(error); return; }
    error = error.cause;
    const detail = error as { status?: number; code?: string; name?: string };
    if (detail?.name === "AbortError") return;
    if ([401, 403, 404].includes(detail?.status ?? 0) || detail?.code === "epoch_changed" || detail?.status === 409) { this.retire("This file or your access changed. Pending edits are kept for recovery."); return; }
    if ([400, 413, 422].includes(detail?.status ?? 0)) { this.retire("The server rejected this edit. Your pending document is kept for recovery."); return; }
    // Local validation/storage failures are terminal; network errors may retry.
    if (error instanceof Error && /Invalid|Incomplete|Saved|history|storage|quota|Quota|localStorage|journal/i.test(error.message)) { this.fatal(error); return; }
    this.report("offline", "Waiting for the connection. Pending edits are saved on this device.");
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5));
    if (this.initialized) { this.schedulePush(delay); this.schedulePoll(delay); }
    else this.schedulePoll(delay);
  }
  private schedulePush(delay: number): void {
    if (!this.active || this.dead || this.frozen || !this.canEdit || (!this.pending.length && !this.batch) || this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; void this.flush(); }, delay);
  }
  private schedulePoll(delay: number): void {
    if (!this.active || this.dead || this.frozen || this.pollTimer || this.pollController) return;
    this.pollTimer = setTimeout(() => { this.pollTimer = null; void (this.initialized ? this.poll() : this.start()); }, delay);
  }
  private async poll(): Promise<void> {
    if (!this.current || !this.active || this.dead || this.frozen) return;
    try {
      const remote = await this.request("read", { epoch: this.current.epoch, seq: this.current.seq, waitMs: 25_000 }, true) as Partial<StateResponse> & { unchanged?: boolean };
      if (this.dead || !this.active) return;
      if (!remote || !Number.isSafeInteger(remote.epoch) || !Number.isSafeInteger(remote.seq) || remote.seq! < 0 ||
          (remote.unchanged !== undefined && remote.unchanged !== true)) throw new Error("Invalid collaboration response.");
      if (remote.unchanged && remote.seq !== this.current.seq) throw new Error("Invalid unchanged collaboration cursor.");
      if (remote.epoch !== this.current.epoch) { this.retire("This file changed outside the shared editor. Your document is kept for recovery."); return; }
      if (typeof remote.canEditContent !== "boolean" || typeof remote.canComment !== "boolean") throw new Error("Invalid collaboration permissions.");
      if (this.canEdit && !remote.canEditContent) { this.retire("Editing access was removed. Your document is kept for recovery."); return; }
      this.canEdit = remote.canEditContent; this.canComment = remote.canComment;
      if (!remote.unchanged && remote.seq! >= this.current.seq) {
        cursor(remote); Y.applyUpdate(this.doc, decode(remote.update), REMOTE); this.snapshot(); this.current = cursor(remote); this.persist(); this.options.onChange?.(this.snapshot());
      }
      this.failures = 0; this.report(this.pending.length || this.batch ? "saving" : "ready"); this.schedulePoll(250);
    } catch (error) { this.handleFailure(error); }
    finally { this.schedulePoll(250); }
  }
  flush(): Promise<boolean> {
    if (this.flushing) return this.flushing;
    if (this.dead || this.frozen || !this.active || !this.initialized || !this.canEdit) return Promise.resolve(false);
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
    this.flushing = this.upload().finally(() => { this.flushing = null; this.schedulePush(250); });
    return this.flushing;
  }
  private async upload(): Promise<boolean> {
    try {
      while ((this.batch || this.pending.length) && this.active && !this.dead && !this.frozen) {
        if (!this.batch) {
          this.batch = { operationId: crypto.randomUUID(), updates: this.pending.splice(0, 64) };
          this.persist();
        }
        const sent = this.batch;
        this.report("saving");
        const result = await this.request("push", { operationId: sent.operationId, epoch: this.current!.epoch, updates: sent.updates }) as { status?: string };
        if (this.dead || !this.active || this.frozen) return false;
        if (result.status === "conflict") { this.retire("The file changed during save. Your edits are kept for recovery."); return false; }
        if (result.status !== "written") throw new Error("Invalid collaboration acknowledgement.");
        this.batch = null;
        try { this.persist(); } catch (error) { this.batch = sent; throw error; }
        this.failures = 0;
      }
      if (!this.dead && !this.frozen) this.report("ready");
      return !this.batch && !this.pending.length;
    } catch (error) { this.handleFailure(error); return false; }
  }
  setActive(active: boolean): void {
    if (this.dead || active === this.active) return;
    this.active = active;
    if (!active) { this.cancelWork(); this.report("offline"); }
    else if (!this.frozen) { if (!this.initialized) void this.start(); else { this.schedulePoll(0); this.schedulePush(0); } }
  }
  private cancelWork(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pushTimer = null; this.pollTimer = null;
    for (const controller of this.controllers) controller.abort();
  }
  /** Call only after the caller has durably saved the recovered document copy. */
  clearRetiredAfterRecovery(): void {
    if (this.unreadableJournal) throw new Error("The unreadable recovery journal must be preserved until its contents are recovered.");
    if (!this.frozen || !this.saved?.retired) throw new Error("There is no retired journal to clear.");
    try { this.storage.remove(this.journalKey); this.saved = null; this.pending = []; this.batch = null; this.unqueuedDirty = false; }
    catch (error) { this.fatal(new Error(`Recovery journal could not be removed. ${String(error)}`)); throw error; }
  }
  destroy(): void {
    if (this.dead) return;
    this.dead = true; this.canEdit = false; this.cancelWork(); this.doc.off("update", this.changed); this.doc.destroy();
  }
}
