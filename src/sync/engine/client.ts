import * as Y from "yjs";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, documentText, hasDocumentSnapshot } from "@/lib/collab/document";
import { replaceSharedText } from "@/lib/collab/text-transactions";
import { externalBodyEdits, reconcileDocumentSnapshots } from "./reconcile";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { authoringSourceSchema } from "@/lib/presentation/authoring-source";
import { MAX_UPDATE_CHARS } from "@/lib/collab/limits";

const REMOTE = Symbol("file-collaboration-remote");
const LIMIT = 4 * 1024 * 1024;
export type FileCollaborationStatus = "ready" | "saving" | "paused" | "reconnecting" | "offline" | "stale-file" | "stale-session" | "recovery" | "error";
export type FileCollaborationRequest = (method: "read" | "push", params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export interface FileCollaborationJournalStore { load(key: string): string | null; save(key: string, value: string): void; remove(key: string): void }
type Batch = { operationId: string; updates: string[]; acknowledged?: boolean; revision?: string };
export type FileCollaborationPresentation = { templateJSON: string | null; templateAuthoringSourceJSON: string | null };
function presentation(value: unknown): FileCollaborationPresentation | undefined {
  if (value === undefined) return undefined;
  const data = value as FileCollaborationPresentation;
  if (!data || ![data.templateJSON, data.templateAuthoringSourceJSON].every(entry => entry === null || (typeof entry === "string" && entry.length <= 1024 * 1024))) throw new Error("Invalid collaboration template metadata.");
  if (data.templateJSON !== null) validateTemplateDefinition(JSON.parse(data.templateJSON));
  if (data.templateAuthoringSourceJSON !== null) authoringSourceSchema.parse(JSON.parse(data.templateAuthoringSourceJSON));
  return { templateJSON: data.templateJSON, templateAuthoringSourceJSON: data.templateAuthoringSourceJSON };
}
type Cursor = { epoch: number; seq: number; revision: string; relativePath: string };
/** One durable epoch-recovery intent. `update` is the exact complete Yjs state
 * sent to the server; its bytes and operation id never change across retries
 * or restarts, so the server receipt stays idempotent. `adopted` marks that the
 * authoritative replacement epoch was persisted but native adoption is unproven. */
export type FileCollaborationRecovery = { operationId: string; epoch: number; update: string; adopted?: boolean };
export type FileCollaborationJournal = Cursor & { version: 1; presentation?: FileCollaborationPresentation; journalGeneration?: number; canEditContent?: boolean; canComment?: boolean; update: string; pending: string[]; batch: Batch | null; unqueuedDirty?: boolean; retired?: string; recovery?: FileCollaborationRecovery };
export type FileCollaborationCheckpoint = { journal: FileCollaborationJournal; document: DocumentSnapshot };
type StateResponse = Cursor & { presentation?: FileCollaborationPresentation; update: string; canEditContent: boolean; canComment: boolean };
export type FileCollaborationOptions = {
  server: string; workspaceId: string; itemId: string; request: FileCollaborationRequest;
  journal?: FileCollaborationJournalStore; active?: boolean; inactiveReason?: "paused" | "offline";
  ownership?: FileCollaborationOwnership;
  retainedJournal?: string | null;
  /** Current path attested by the native same-item open session. */
  retainedJournalPath?: string;
  initialRetirement?: string;
  localRevision?: string;
  /** Same-item file changed while closed. The native journal describes the
   * exact last projection, which can be older than the browser journal. */
  initialFileChange?: { journal: string; document: DocumentSnapshot; presentation?: FileCollaborationPresentation };
  checkpoint?: (value: FileCollaborationCheckpoint) => Promise<void>;
  /** Reconcile a failed native compare-and-swap before retrying the latest journal.
   * Must retain the native lease and adopt only a freshly read file revision. */
  reconcileCheckpoint?: (error: unknown) => Promise<boolean>;
  onChange?: (snapshot: DocumentSnapshot, presentation?: FileCollaborationPresentation) => void;
  onStatus?: (status: FileCollaborationStatus, detail?: string) => void;
  /** Live epoch adoption contract. After automatic recovery the server owns new
   * Yjs identities, so `client.doc` becomes a different Y.Doc holding the same
   * text. The callback runs after the swap and is awaited before the previous
   * document is destroyed and before the adoption is proven locally; the UI
   * must rebind its editor and awareness to `client.doc` and may restore the
   * caret by text offset. Edits typed on the new document during the await are
   * journaled. A rejected callback keeps the durable adoption and asks to
   * reopen the note instead. Without this callback the client freezes after
   * recovery and asks to reopen the note. */
  onDocumentReplaced?: (next: Y.Doc, previous: Y.Doc) => void | Promise<void>;
  /** Whether pending edits may be recovered automatically into a replaced
   * epoch. Defaults to true without a native `checkpoint` (web) and false with
   * one: a native store must advertise `epoch-adoption` before it accepts the
   * replacement epoch over a pending journal. When false, a replaced epoch
   * retires pending edits for manual recovery as before. */
  supportsEpochRecovery?: boolean;
};
/** Retirements written by a known older fatal path over a valid pending journal.
 * Every edit in such a journal is replayable: unsent updates go as new batches,
 * an acknowledged batch replays its receipt, and a replaced epoch goes through
 * server-validated recovery. The server still decides access and history. */
const REVIVABLE_RETIREMENTS = [
  // Native checkpoint failure (Mac 0.204 builds 1237-1239, e.g. a Finder rename
  // under a pending journal) retired the browser journal with its edits intact.
  "This note needs to be reopened. Your edits are saved for recovery.",
];
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
  return { epoch: data.epoch!, seq: data.seq!, revision: data.revision, relativePath: data.relativePath };
}
function parseJournal(raw: string): FileCollaborationJournal {
  if (new TextEncoder().encode(raw).byteLength > LIMIT) throw new Error("Saved collaboration history exceeds its limit. It has been preserved for recovery.");
  const parsed = JSON.parse(raw) as FileCollaborationJournal;
  cursor(parsed);
  presentation(parsed.presentation);
  const generation = parsed.journalGeneration ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error("Invalid saved journal generation.");
  if (parsed.version !== 1 || !Array.isArray(parsed.pending) || parsed.pending.length > 1024 || (parsed.retired !== undefined && typeof parsed.retired !== "string")) throw new Error("Invalid saved collaboration journal. It has been preserved.");
  if ((parsed.canEditContent !== undefined && typeof parsed.canEditContent !== "boolean") || (parsed.canComment !== undefined && typeof parsed.canComment !== "boolean")) throw new Error("Invalid saved collaboration permissions.");
  if (parsed.unqueuedDirty !== undefined && typeof parsed.unqueuedDirty !== "boolean") throw new Error("Invalid saved collaboration dirty marker.");
  if (parsed.recovery !== undefined) {
    const recovery = parsed.recovery;
    if (!recovery || typeof recovery !== "object" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(recovery.operationId) ||
        !Number.isSafeInteger(recovery.epoch) || recovery.epoch < 1 || recovery.epoch > parsed.epoch ||
        (recovery.adopted !== undefined && typeof recovery.adopted !== "boolean")) throw new Error("Invalid saved recovery intent. It has been preserved.");
    decode(recovery.update);
  }
  decode(parsed.update);
  for (const update of parsed.pending) decode(update, MAX_UPDATE_CHARS);
  if (parsed.batch !== null) {
    if (!parsed.batch || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.batch.operationId) || !Array.isArray(parsed.batch.updates) || !parsed.batch.updates.length || parsed.batch.updates.length > 64) throw new Error("Invalid saved upload batch. It has been preserved.");
    if ((parsed.batch.acknowledged !== undefined && typeof parsed.batch.acknowledged !== "boolean") ||
        (parsed.batch.acknowledged && (typeof parsed.batch.revision !== "string" || !/^[a-f0-9]{64}$/.test(parsed.batch.revision)))) throw new Error("Invalid saved acknowledgement.");
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
  return parsed;
}
function comparableJournal(value: FileCollaborationJournal): string {
  return JSON.stringify({ ...value, journalGeneration: value.journalGeneration ?? 0 }, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
}
/** Validate both copies before choosing; never overwrite an unreadable or divergent peer journal. */
export function selectFileCollaborationJournal(browser: string | null, native: string | null, nativePath?: string): string | null {
  const left = browser === null ? null : parseJournal(browser);
  const right = native === null ? null : parseJournal(native);
  if (!left) return native;
  if (!right) return browser;
  const a = left.journalGeneration ?? 0, b = right.journalGeneration ?? 0;
  if (a === b && comparableJournal(left) !== comparableJournal(right)) {
    // A native relocation preserves the journal generation and all CRDT state.
    // Only its attested path may differ; every other field must still match.
    if (nativePath === right.relativePath && comparableJournal({ ...left, relativePath: nativePath }) === comparableJournal(right)) return native;
    throw new Error("Recovery journals diverged at the same generation. Both copies are preserved.");
  }
  return b > a ? native : browser;
}
function immutableCheckpoint(value: FileCollaborationCheckpoint): FileCollaborationCheckpoint {
  const copy = JSON.parse(JSON.stringify(value)) as FileCollaborationCheckpoint;
  const freeze = (entry: unknown): void => {
    if (entry && typeof entry === "object") { for (const child of Object.values(entry)) freeze(child); Object.freeze(entry); }
  };
  freeze(copy); return copy;
}
class RequestFailure { constructor(readonly cause: unknown) {} }
const localJournal: FileCollaborationJournalStore = {
  load: key => localStorage.getItem(key), save: (key, value) => localStorage.setItem(key, value), remove: key => localStorage.removeItem(key),
};

export type FileCollaborationLease = { key: string; release: () => void };
export type FileCollaborationOwnership = { acquire: (namespace: string) => Promise<FileCollaborationLease> };

/** Each live browser document owns a separate durable record. Orphans are resumed under the same lock. */
export function createFileCollaborationOwnership(options: {
  storage: Pick<Storage, "length" | "key" | "getItem">;
  session: Pick<Storage, "getItem" | "setItem">;
  tryLock: (name: string) => Promise<(() => void) | null>;
}): FileCollaborationOwnership {
  return { async acquire(namespace) {
    const prefix = `${namespace}:owner:`, sessionKey = `${namespace}:owner`;
    const preferred = options.session.getItem(sessionKey);
    const candidates: string[] = [];
    if (preferred && (preferred === namespace || preferred.startsWith(prefix))) candidates.push(preferred);
    if (options.storage.length > 10_000) throw new Error("Collaboration storage contains too many entries to inspect safely.");
    for (let index = 0; index < options.storage.length; index++) {
      const key = options.storage.key(index);
      if (key && (key === namespace || key.startsWith(prefix)) && !candidates.includes(key)) candidates.push(key);
      if (candidates.length > 256) throw new Error("Too many collaboration recovery journals. Existing records are preserved.");
    }
    // Resume unsent or unreadable orphan records before reusing a clean record.
    const needsRecovery = (key: string): boolean => {
      const raw = options.storage.getItem(key);
      if (!raw) return false;
      try {
        if (raw.length > LIMIT) return true;
        const value = JSON.parse(raw) as Partial<FileCollaborationJournal>;
        return value.version !== 1 || !Array.isArray(value.pending) || Boolean(value.pending.length || value.batch || value.unqueuedDirty || value.retired || value.recovery);
      }
      catch { return true; }
    };
    const priorities = new Map(candidates.map(key => [key, needsRecovery(key)]));
    candidates.sort((a, b) => Number(priorities.get(b)) - Number(priorities.get(a)));
    candidates.push(`${prefix}${crypto.randomUUID()}`);
    for (const key of candidates) {
      const release = await options.tryLock(key);
      if (!release) continue;
      try { options.session.setItem(sessionKey, key); }
      catch (error) { release(); throw error; }
      return { key, release };
    }
    throw new Error("Unable to own a collaboration recovery journal.");
  } };
}
function browserOwnership(): FileCollaborationOwnership {
  if (!navigator.locks) throw new Error("This browser cannot safely retain concurrent shared editing sessions.");
  return createFileCollaborationOwnership({ storage: localStorage, session: sessionStorage,
    tryLock: name => new Promise((resolve, reject) => {
      void navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, lock => {
        if (!lock) { resolve(null); return; }
        return new Promise<void>(release => { resolve(release); });
      }).catch(reject);
    }),
  });
}

/** One canonical server baseline, one durable upload queue, and one visible long poll. */
export class FileCollaborationClient {
  private liveDoc = new Y.Doc();
  /** The current shared document. Automatic epoch recovery replaces it; see `onDocumentReplaced`. */
  get doc(): Y.Doc { return this.liveDoc; }
  private ownedJournalKey: string;
  get journalKey(): string { return this.ownedJournalKey; }
  private lease: FileCollaborationLease | null = null;
  canEdit = false;
  canComment = false;
  status: FileCollaborationStatus = "reconnecting";
  private readonly storage: FileCollaborationJournalStore;
  private readonly options: FileCollaborationOptions;
  private active: boolean;
  private inactiveReason: "paused" | "offline";
  private dead = false;
  private initialized = false;
  private authoritative = false;
  private connectionProbePending = false;
  private frozen = false;
  private current: Cursor | null = null;
  private pending: string[] = [];
  private unqueuedDirty = false;
  private unreadableJournal = false;
  private rawRecoveryJournal: string | null = null;
  private batch: Batch | null = null;
  private recovery: FileCollaborationRecovery | null = null;
  private recovering: Promise<void> | null = null;
  private saved: FileCollaborationJournal | null = null;
  private starting: Promise<void> | null = null;
  private flushing: Promise<boolean> | null = null;
  private controllers = new Set<AbortController>();
  private pollController: AbortController | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private uploadFailures = 0;
  private journalGeneration = 0;
  private presentation: FileCollaborationPresentation | undefined;
  private initialRetirement: string | null = null;
  private checkpointQueued: FileCollaborationCheckpoint | null = null;
  private checkpointRunning: Promise<void> | null = null;
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  private checkpointError: unknown = null;
  private checkpointSavedGeneration = -1;
  private initialFileReconciled: boolean;
  private readonly supportsEpochRecovery: boolean;
  /** Original retirement of a revived journal, restored if the server refuses it. */
  private revivedRetirement: string | null = null;

  constructor(options: FileCollaborationOptions) {
    this.options = options; this.storage = options.journal ?? localJournal; this.active = options.active ?? true; this.inactiveReason = options.inactiveReason ?? "paused";
    this.supportsEpochRecovery = options.supportsEpochRecovery ?? !options.checkpoint;
    this.initialFileReconciled = !options.initialFileChange;
    this.ownedJournalKey = `texttext:file-collaboration:v1:${JSON.stringify([options.server.replace(/\/$/, ""), options.workspaceId, options.itemId])}`;
    this.doc.on("update", this.changed);
  }
  get recoveryJournal(): FileCollaborationJournal | null { return this.saved; }
  get hasUnreadableJournal(): boolean { return this.unreadableJournal; }
  get recoveryRawJournal(): string | null { return this.rawRecoveryJournal; }
  get hasPendingChanges(): boolean { return Boolean((this.initialRetirement && !this.saved) || this.unreadableJournal || this.unqueuedDirty || this.batch || this.pending.length || (this.recovery && !this.recovery.adopted)); }
  /** A durable recovery intent exists and the replacement epoch is not yet proven adopted. */
  get isRecovering(): boolean { return this.recovering !== null; }
  get hasBaseline(): boolean { return this.initialized; }
  get epoch(): number | null { return this.current?.epoch ?? null; }
  get sequence(): number | null { return this.current?.seq ?? null; }
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
  private adoptPresentation(value: unknown): void {
    const incoming = presentation(value);
    if (!incoming) return; // Compatible with older servers and retained journals.
    const reference = this.snapshot().presentation.template;
    const matches = (candidate: FileCollaborationPresentation | undefined) => {
      if (!candidate?.templateJSON) return false;
      const definition = validateTemplateDefinition(JSON.parse(candidate.templateJSON));
      return definition.id === reference.id && definition.version === reference.version;
    };
    if (matches(incoming) || (!incoming.templateJSON && getBuiltinTemplate(reference.id, reference.version))) this.presentation = incoming;
    else if (!matches(this.presentation)) throw new Error("The shared template definition does not match the document. Your journal is preserved.");
  }
  private persist(retired?: string): void {
    if (!this.current) return;
    if (!Number.isSafeInteger(this.journalGeneration) || this.journalGeneration >= Number.MAX_SAFE_INTEGER) throw new Error("Collaboration journal generation limit reached.");
    const saved: FileCollaborationJournal = { version: 1, ...(this.presentation ? { presentation: this.presentation } : {}), journalGeneration: ++this.journalGeneration, ...this.current, canEditContent: this.canEdit, canComment: this.canComment, unqueuedDirty: this.unqueuedDirty, update: encode(Y.encodeStateAsUpdate(this.doc)), pending: [...this.pending], batch: this.batch ? { ...this.batch, updates: [...this.batch.updates] } : null,
      ...(retired || this.saved?.retired ? { retired: retired ?? this.saved?.retired } : {}),
      ...(this.recovery ? { recovery: { ...this.recovery } } : {}) };
    this.saved = saved; // Keep recoverable in memory even when browser storage fails.
    const value = JSON.stringify(saved);
    if (new TextEncoder().encode(value).byteLength > LIMIT) throw new Error("Unsaved collaboration history exceeds 4 MiB. Keep this window open and recover your edits.");
    let storageError: unknown;
    try { this.storage.save(this.journalKey, value); } catch (error) { storageError = error; }
    if (this.options.checkpoint && !this.checkpointError && this.initialFileReconciled) this.queueCheckpoint(immutableCheckpoint({ journal: saved, document: this.snapshot() }));
    if (storageError) throw new Error(`Collaboration journal could not be saved. Keep this window open to recover your edits. ${String(storageError)}`);
  }
  private queueCheckpoint(value: FileCollaborationCheckpoint): void {
    this.checkpointQueued = value;
    if (this.checkpointRunning || this.checkpointTimer) return;
    this.checkpointTimer = setTimeout(() => { this.checkpointTimer = null; this.startCheckpointDrain(); }, 200);
  }
  private startCheckpointDrain(): void {
    if (this.checkpointTimer) { clearTimeout(this.checkpointTimer); this.checkpointTimer = null; }
    if (this.checkpointRunning || !this.checkpointQueued || this.checkpointError) return;
    this.checkpointRunning = this.drainCheckpoints().finally(() => {
      this.checkpointRunning = null;
      if (this.checkpointQueued && !this.checkpointError) this.startCheckpointDrain();
    });
  }
  private async drainCheckpoints(): Promise<void> {
    while (this.checkpointQueued && !this.checkpointError) {
      const value = this.checkpointQueued; this.checkpointQueued = null;
      try { await this.options.checkpoint!(value); this.checkpointSavedGeneration = value.journal.journalGeneration!; }
      catch (error) {
        if ((error as { code?: string } | null)?.code === "local_changed" && this.options.reconcileCheckpoint && !this.dead && !this.frozen) {
          try {
            if (await this.options.reconcileCheckpoint(error)) {
              this.persist();
              continue;
            }
          } catch { /* Keep the original failed checkpoint and its recoverable journal. */ }
        }
        this.checkpointError = error; this.checkpointQueued = null;
        if (this.dead) continue;
        const clean = !this.hasPendingChanges && !this.saved?.retired && !this.initialRetirement &&
          !value.journal.pending.length && !value.journal.batch && !value.journal.unqueuedDirty && !value.journal.retired;
        if ((error as { code?: string } | null)?.code === "session_closed" && clean) {
          this.frozen = true; this.canEdit = false; this.cancelWork();
          this.report("stale-session", "Reopening this note…");
        } else if ((error as { code?: string } | null)?.code === "local_changed" && clean) {
          this.notifyExternalFileChange();
        } else this.fatal(new Error("This note needs to be reopened. Your edits are saved for recovery."));
      }
    }
  }
  /** Called after a native read proves the TextPack changed outside this shared session. */
  notifyExternalFileChange(): void {
    if (this.dead || this.frozen) return;
    if (this.options.reconcileCheckpoint && this.options.checkpoint) {
      // The checkpoint drain serializes external reads with native writes. A
      // watcher must not advance the expected hash under an in-flight write.
      try { this.persist(); this.startCheckpointDrain(); } catch (error) { this.fatal(error); }
      return;
    }
    if (this.hasPendingChanges || this.saved?.retired || this.initialRetirement) {
      this.retire("The file changed outside shared editing. Your pending edits are kept for recovery.");
      return;
    }
    this.frozen = true; this.canEdit = false; this.cancelWork();
    this.report("stale-file", "Refreshing the file changed outside TextText…");
  }
  async flushLocal(): Promise<boolean> {
    if (!this.options.checkpoint) return !this.unreadableJournal;
    this.startCheckpointDrain();
    while (this.checkpointRunning) { await this.checkpointRunning; this.startCheckpointDrain(); }
    return !this.checkpointError && !this.unreadableJournal && this.checkpointSavedGeneration >= this.journalGeneration;
  }
  private notifyRecoverableSnapshot(): void {
    try { this.options.onChange?.(this.snapshot(), this.presentation); }
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
      this.options.onChange?.(this.snapshot(), this.presentation);
      this.report(this.active ? "saving" : this.inactiveReason);
      this.schedulePush(250);
    } catch (error) { this.fatal(error); }
  };
  mutate(change: (doc: Y.Doc) => void): void {
    if (!this.initialized || !this.canEdit || this.frozen || this.dead) throw new Error("This collaboration document is not editable.");
    change(this.doc);
  }
  /** Merge a native file revision without replacing the Y.Doc or editor binding. */
  reconcileExternalDocument(base: DocumentSnapshot, external: DocumentSnapshot): boolean {
    if (!this.initialized || !this.canEdit || this.frozen || this.dead) return false;
    const current = this.snapshot();
    const result = reconcileDocumentSnapshots(base, current, external, { concurrentInsertions: "remote-first" });
    if (result.status !== "merged") return false;
    const bodyEdits = externalBodyEdits(base.content.body, current.content.body, external.content.body, result.document.content.body);
    if (!bodyEdits) return false;
    this.mutate(doc => {
      applyDocumentSnapshot(doc, { ...result.document, content: { ...result.document.content, body: current.content.body } }, "external-file");
      for (const bodyEdit of bodyEdits) replaceSharedText(documentText(doc, "body"), bodyEdit.start, bodyEdit.end - bodyEdit.start, bodyEdit.replacement, "external-file");
    });
    return !this.frozen;
  }
  private load(): FileCollaborationJournal | null {
    try { return this.loadJournal(); }
    catch (error) { this.unreadableJournal = true; throw error; }
  }
  private loadJournal(): FileCollaborationJournal | null {
    let raw: string | null;
    try { raw = this.storage.load(this.journalKey); } catch (error) { throw new Error(`Collaboration journal could not be read. ${String(error)}`); }
    this.rawRecoveryJournal = this.options.retainedJournal !== undefined
      ? JSON.stringify({ browser: raw, native: this.options.retainedJournal }) : raw;
    raw = selectFileCollaborationJournal(raw, this.options.retainedJournal ?? null, this.options.retainedJournalPath);
    if (raw === null) { this.rawRecoveryJournal = null; return null; }
    const parsed = parseJournal(raw);
    this.rawRecoveryJournal = null;
    return parsed;
  }
  private restoreRetained(retained: FileCollaborationJournal): void {
    this.presentation = presentation(retained.presentation);
    this.current = cursor(retained); this.pending = retained.pending; this.batch = retained.batch;
    this.unqueuedDirty = retained.unqueuedDirty === true; this.saved = retained;
    this.recovery = retained.recovery ? { ...retained.recovery } : null;
    this.journalGeneration = retained.journalGeneration ?? 0;
    Y.applyUpdate(this.doc, decode(retained.update), REMOTE);
    const snapshot = this.snapshot();
    this.initialized = true; this.canEdit = retained.canEditContent === true; this.canComment = retained.canComment === true;
    this.options.onChange?.(snapshot, this.presentation);
  }
  private async request(method: "read" | "push", params: Record<string, unknown>, poll = false): Promise<unknown> {
    const controller = new AbortController(); this.controllers.add(controller);
    if (poll) this.pollController = controller;
    // Browser networking can remain unsettled after a server restart or a
    // suspended tab. Bound our own wait even if the transport ignores abort.
    const timeoutMs = poll ? 35_000 : method === "push" ? 30_000 : 15_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted: (() => void) | undefined;
    const canceled = new Promise<never>((_, reject) => {
      aborted = () => { clearTimeout(timer); reject(new DOMException("Request canceled", "AbortError")); };
      controller.signal.addEventListener("abort", aborted, { once: true });
      timer = setTimeout(() => {
        reject(Object.assign(new Error("The connection timed out."), { status: 503 }));
        controller.abort();
      }, timeoutMs);
    });
    try { return await Promise.race([this.options.request(method, params, controller.signal), canceled]); }
    catch (error) {
      // A 204/canceled response without our own cancellation is a transient
      // service interruption, not permission to silently stop reconnecting.
      if (!controller.signal.aborted && (error as { name?: string })?.name === "AbortError") {
        error = Object.assign(new Error("The connection was interrupted."), { status: 503 });
      }
      throw new RequestFailure(error);
    } finally {
      clearTimeout(timer);
      if (aborted) controller.signal.removeEventListener("abort", aborted);
      this.controllers.delete(controller); if (this.pollController === controller) this.pollController = null;
    }
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.dead || this.frozen || this.initialized) return Promise.resolve();
    this.starting = this.begin().finally(() => { this.starting = null; if (!this.initialized || !this.authoritative) this.schedulePoll(1000); });
    return this.starting;
  }
  private async begin(): Promise<void> {
    let cleanWebFallback: FileCollaborationJournal | null = null;
    let cleanRetiredRefresh: FileCollaborationJournal | null = null;
    try {
      if (!this.lease && (this.options.ownership || (!this.options.journal && !this.options.checkpoint))) {
        const lease = await (this.options.ownership ?? browserOwnership()).acquire(this.journalKey);
        if (this.dead) { lease.release(); return; }
        this.lease = lease; this.ownedJournalKey = lease.key;
      }
      let retained = this.load();
      // A replacement epoch persisted by adoptEpoch whose native checkpoint never
      // ran. It is not a clean baseline until the native store adopts it.
      const unprovenAdoption = Boolean(this.options.checkpoint && retained?.recovery?.adopted);
      // Reopening a retired journal under an older build checkpointed it with
      // its `retired` text, so the native store now reports that same text as
      // its retirement. That mirror is the browser's own revivable retirement,
      // not a native finding about the file; the native store lifts it on the
      // next unretired checkpoint. Native-originated reasons stay manual.
      const mirroredRetirement = this.options.initialRetirement !== undefined && retained?.retired === this.options.initialRetirement &&
        REVIVABLE_RETIREMENTS.includes(this.options.initialRetirement) && !retained.unqueuedDirty &&
        Boolean(retained.pending.length || retained.batch || unprovenAdoption);
      const initialRetirement = mirroredRetirement ? undefined : this.options.initialRetirement;
      if (retained?.retired && REVIVABLE_RETIREMENTS.includes(retained.retired) && !initialRetirement &&
          !retained.unqueuedDirty && (retained.pending.length || retained.batch || unprovenAdoption)) {
        // Resume the journal as live pending work. A fresh read below decides
        // access; the server validates history and lifecycle before any merge.
        this.revivedRetirement = retained.retired;
        retained = { ...retained, retired: undefined };
        delete retained.retired;
      }
      if (retained && !initialRetirement && !retained.pending.length &&
          !retained.batch && !retained.unqueuedDirty && !unprovenAdoption && [
            "This file or its access changed. Recover your saved edits before reopening.",
            "This file or your access changed. Pending edits are kept for recovery.",
            // Native checkpoint failure on a renamed file (Mac 0.204 build 1237)
            // retired the browser journal although every edit was acknowledged.
            "This note needs to be reopened. Your edits are saved for recovery.",
          ].includes(retained.retired ?? "")) {
        // Older clients retired even a fully acknowledged epoch. Keep that
        // record untouched until a fresh read proves current access, then adopt
        // that baseline. Never replay its old Yjs IDs into a replacement epoch.
        cleanRetiredRefresh = retained;
        this.saved = retained; this.journalGeneration = retained.journalGeneration ?? 0;
        retained = null;
      }
      // The native acknowledged revision lags one epoch when the process died
      // after adoptEpoch persisted the replacement but before its checkpoint ran.
      // That is only a missing checkpoint, not a changed file, when the native
      // journal still holds the exact unadopted intent this journal adopted.
      const staleLocal = retained && this.options.localRevision !== undefined && retained.revision !== this.options.localRevision &&
        !this.nativeAwaitsAdoption(retained);
      if (staleLocal && !initialRetirement && !retained!.pending.length && !retained!.batch && !retained!.unqueuedDirty && !retained!.retired && !unprovenAdoption) {
        // A clean old journal must never project over a file downloaded while closed.
        this.journalGeneration = retained!.journalGeneration ?? 0;
        retained = null;
      }
      if (retained && !initialRetirement && !this.options.initialFileChange &&
          !retained.pending.length && !retained.batch && !retained.unqueuedDirty && !retained.retired && !unprovenAdoption) {
        // A clean journal is a fallback, not a live baseline or access grant.
        // Native checkpoints also need fresh Yjs IDs after an epoch replacement,
        // including replacements that leave the TextPack hash unchanged.
        cleanWebFallback = retained;
        this.journalGeneration = retained.journalGeneration ?? 0;
        retained = null;
      }
      if (this.options.checkpoint && retained?.retired?.startsWith("The local document checkpoint could not be saved.") &&
          retained.retired.includes("This shared editing session has closed.") && !initialRetirement &&
          !retained.pending.length && !retained.batch && !retained.unqueuedDirty) {
        // An old interrupted session can leave a retired browser journal even
        // though its native checkpoint and document are clean. Reopen the file
        // instead of presenting recovery controls for edits that do not exist.
        this.saved = retained; this.current = cursor(retained);
        this.journalGeneration = retained.journalGeneration ?? 0;
        this.frozen = true; this.canEdit = false;
        this.report("stale-session", "Reopening this note…"); return;
      }
      if (retained) {
        this.restoreRetained(retained);
        if (initialRetirement) {
          this.initialRetirement = initialRetirement; this.frozen = true; this.canEdit = false;
          this.report("recovery", this.initialRetirement); return;
        }
        if (staleLocal) {
          this.initialRetirement = "The local file changed while shared edits were pending. Recover your saved edits before reopening.";
          this.frozen = true; this.canEdit = false;
          this.report("recovery", this.initialRetirement); return;
        }
        if (this.options.initialFileChange && !retained.retired && !this.unqueuedDirty) {
          const external = this.options.initialFileChange;
          const baseline = parseJournal(external.journal);
          if (baseline.epoch !== retained.epoch || baseline.relativePath !== retained.relativePath ||
              JSON.stringify(baseline.presentation ?? null) !== JSON.stringify(external.presentation ?? null)) {
            this.frozen = true; this.canEdit = false;
            this.report("recovery", "The saved document and file need reconciliation."); return;
          }
          const projected = new Y.Doc();
          try {
            Y.applyUpdate(projected, decode(baseline.update));
            if (!this.reconcileExternalDocument(documentSnapshotFromYDoc(projected), external.document)) {
              // Do not checkpoint the old projection over the external file.
              this.frozen = true; this.canEdit = false;
              this.report("recovery", "The saved document and file need reconciliation."); return;
            }
          } finally { projected.destroy(); }
          this.initialFileReconciled = true;
        }
        this.persist();
        if (retained.retired || this.unqueuedDirty) { this.retire(retained.retired ?? "Unsubmitted local edits are kept for recovery."); return; }
      }
      if (initialRetirement) {
        this.initialRetirement = initialRetirement; this.frozen = true; this.canEdit = false;
        this.report("recovery", this.initialRetirement); return;
      }
      if (!this.active) { this.report(this.inactiveReason); return; }
      const value = await this.request("read", {});
      if (this.dead || !this.active || this.frozen) return;
      const remote = value as StateResponse; cursor(remote);
      presentation(remote.presentation);
      if (typeof remote.canEditContent !== "boolean" || typeof remote.canComment !== "boolean") throw new Error("Invalid collaboration permissions.");
      if (cleanRetiredRefresh) this.saved = null;
      this.current = cursor(remote);
      if (retained) {
        this.current = cursor(retained);
        if (retained.epoch !== remote.epoch && !this.hasPendingChanges && !retained.retired) {
          if (this.recovery?.adopted) {
            // The adopted epoch was replaced again before its native checkpoint
            // ran. Prove the adoption, then reopen from the clean replacement
            // rather than merging two unrelated Yjs identities into one doc.
            if (!await this.flushLocal() || this.dead || !this.active || this.frozen) return;
            this.recovery = null; this.persist();
            this.frozen = true; this.canEdit = false; this.cancelWork();
            this.report("stale-session", "Reopening this note…"); return;
          }
          this.notifyExternalFileChange(); return;
        }
        if (retained.retired || (!remote.canEditContent && this.hasPendingChanges)) {
          this.retire(retained.retired ?? this.revivedRetirement ?? "This file or its access changed. Recover your saved edits before reopening."); return;
        }
        if (retained.epoch !== remote.epoch) {
          // Pending edits met a replaced epoch. Ask the server to merge them
          // against its retained history instead of retiring the journal.
          this.canEdit = true; this.canComment = remote.canComment;
          if (!this.supportsEpochRecovery) { this.retire(this.revivedRetirement ?? "This file or its access changed. Recover your saved edits before reopening."); return; }
          this.beginRecovery(); return;
        }
      }
      Y.applyUpdate(this.doc, decode(remote.update), REMOTE);
      this.adoptPresentation(remote.presentation);
      this.snapshot();
      this.current = cursor(remote); this.canEdit = remote.canEditContent; this.canComment = remote.canComment; this.initialized = true; this.authoritative = true;
      this.persist(); this.failures = 0;
      if (this.recovery?.adopted) {
        // Replacement epoch confirmed live again. The native store must adopt
        // it before the intent is dropped, or a restart could not prove it.
        if (!await this.flushLocal() || this.dead || !this.active || this.frozen) return;
        this.recovery = null; this.persist();
      }
      this.options.onChange?.(this.snapshot(), this.presentation);
      this.report(this.pending.length || this.batch ? "saving" : "ready");
      if (this.pending.length || this.batch) this.schedulePush(0);
      this.schedulePoll(0);
    } catch (error) {
      if (cleanWebFallback && error instanceof RequestFailure && this.active && !this.dead && !this.frozen && !this.initialized) {
        const detail = error.cause as { status?: number; code?: string } | null;
        if ((detail as { name?: string } | null)?.name === "AbortError") { this.handleFailure(error); return; }
        if ([401, 403, 404, 409].includes(detail?.status ?? 0) || detail?.code === "epoch_changed") {
          this.frozen = true; this.canEdit = false; this.cancelWork();
          this.report("error", "This file or your access changed. Reopen it.");
          return;
        }
        // A connection failure keeps the existing offline-editing behavior.
        // The retained bytes remain local and are fenced on the next live read.
        try { this.restoreRetained(cleanWebFallback); this.persist(); }
        catch (restoreError) { this.fatal(restoreError); return; }
      }
      this.handleFailure(error);
    }
  }
  private handleFailure(error: unknown, uploading = false): void {
    if (this.dead || this.frozen) return;
    if (!(error instanceof RequestFailure)) { this.fatal(error); return; }
    if (!this.active) return;
    error = error.cause;
    const detail = error as { status?: number; code?: string; name?: string };
    if (detail?.name === "AbortError") return;
    if ((detail?.code === "epoch_changed" || detail?.status === 409) &&
        this.initialized && !this.hasPendingChanges && !this.saved?.retired && !this.initialRetirement) {
      this.notifyExternalFileChange(); return;
    }
    if (detail?.code === "epoch_changed" && this.canRecover()) { this.beginRecovery(); return; }
    if (["recovery_unavailable", "recovery_conflict", "recovery_lifecycle"].includes(detail?.code ?? "")) { this.retire("The changed file could not absorb your saved edits automatically. They are kept for recovery."); return; }
    if ([401, 403, 404].includes(detail?.status ?? 0) || detail?.code === "epoch_changed" || detail?.status === 409) { this.retire("This file or your access changed. Pending edits are kept for recovery."); return; }
    if ([400, 413, 422].includes(detail?.status ?? 0)) { this.retire("The server rejected this edit. Your pending document is kept for recovery."); return; }
    // HTTP service failures remain retryable regardless of server message wording.
    // Native bridge validation errors without an HTTP retry status still fail closed.
    const retryableStatus = detail?.status === 429 || (detail?.status !== undefined && detail.status >= 500 && detail.status <= 599);
    if (!retryableStatus && error instanceof Error && /Invalid|Incomplete|Saved|history|storage|quota|Quota|localStorage|journal/i.test(error.message)) { this.fatal(error); return; }
    this.report("offline", "Waiting for the connection. Pending edits are saved on this device.");
    this.connectionProbePending = true;
    const failures = uploading ? this.uploadFailures++ : this.failures++;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
    if (this.initialized) { this.schedulePush(delay); this.schedulePoll(delay); }
    else this.schedulePoll(delay);
  }
  private schedulePush(delay: number): void {
    if (!this.active || this.dead || this.frozen || this.recovering || !this.canEdit || !this.authoritative || (!this.pending.length && !this.batch) || this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; void this.flush(); }, delay);
  }
  private schedulePoll(delay: number): void {
    if (!this.active || this.dead || this.frozen || this.recovering || this.pollTimer || this.pollController) return;
    this.pollTimer = setTimeout(() => { this.pollTimer = null; void (this.initialized ? this.poll() : this.start()); }, delay);
  }
  private async poll(): Promise<void> {
    if (!this.current || !this.active || this.dead || this.frozen || this.recovering) return;
    try {
      // Recovery must confirm availability immediately, even when no one edited
      // the document while disconnected. Resume long polling after that proof.
      const requested = this.authoritative ? { epoch: this.current.epoch, seq: this.current.seq, waitMs: this.connectionProbePending ? 0 : 25_000 } : null;
      const remote = await this.request("read", requested ?? {}, true) as Partial<StateResponse> & { unchanged?: boolean };
      if (this.dead || !this.active || this.frozen) return;
      if (!remote || !Number.isSafeInteger(remote.epoch) || !Number.isSafeInteger(remote.seq) || remote.seq! < 0 ||
          (remote.unchanged !== undefined && remote.unchanged !== true)) throw new Error("Invalid collaboration response.");
      if (remote.unchanged && (!requested || remote.epoch !== requested.epoch || remote.seq !== requested.seq)) throw new Error("Invalid unchanged collaboration cursor.");
      if (remote.epoch !== this.current.epoch) {
        if (remote.canEditContent === true && this.canRecover()) this.beginRecovery();
        else this.notifyExternalFileChange();
        return;
      }
      if (typeof remote.canEditContent !== "boolean" || typeof remote.canComment !== "boolean") throw new Error("Invalid collaboration permissions.");
      if (remote.seq! < this.current.seq) return;
      if (this.canEdit && !remote.canEditContent && this.hasPendingChanges) { this.retire("Editing access was removed. Your document is kept for recovery."); return; }
      this.canEdit = remote.canEditContent; this.canComment = remote.canComment;
      if (!remote.unchanged && remote.seq! >= this.current.seq) {
        cursor(remote); presentation(remote.presentation); Y.applyUpdate(this.doc, decode(remote.update), REMOTE); this.adoptPresentation(remote.presentation); this.snapshot(); this.current = cursor(remote); this.persist(); this.options.onChange?.(this.snapshot(), this.presentation);
      }
      this.connectionProbePending = false;
      this.authoritative = true; this.failures = 0; this.report(this.uploadFailures ? "offline" : this.pending.length || this.batch ? "saving" : "ready"); this.schedulePush(0); this.schedulePoll(250);
    } catch (error) { this.handleFailure(error); }
    finally { this.schedulePoll(250); }
  }
  flush(): Promise<boolean> {
    if (this.flushing) return this.flushing;
    if (this.recovering) return this.recovering.then(() => this.flush());
    if (this.dead || this.frozen || !this.active || !this.initialized || !this.canEdit || !this.authoritative) return Promise.resolve(false);
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
        if (!await this.flushLocal() || this.dead || !this.active || this.frozen) return false;
        this.report("saving");
        if (!sent.acknowledged) {
          const result = await this.request("push", { operationId: sent.operationId, epoch: this.current!.epoch, updates: sent.updates }) as { status?: string; revision?: string };
          if (this.dead || !this.active || this.frozen) return false;
          if (result.status === "conflict") { this.retire("The file changed during save. Your edits are kept for recovery."); return false; }
          if (result.status !== "written" || typeof result.revision !== "string" || !/^[a-f0-9]{64}$/.test(result.revision)) throw new Error("Invalid collaboration acknowledgement.");
          this.batch = { ...sent, acknowledged: true, revision: result.revision };
          this.persist();
        }
        // An acknowledgement alone does not identify the full converged file.
        // Retain the batch as pending until a subsequent authoritative read.
        const remote = await this.request("read", {}) as StateResponse;
        if (this.dead || !this.active || this.frozen) return false;
        cursor(remote);
        if (typeof remote.canEditContent !== "boolean" || typeof remote.canComment !== "boolean") throw new Error("Invalid collaboration permissions.");
        if (!remote.canEditContent) { this.retire("Editing access was removed. Your document is kept for recovery."); return false; }
        if (remote.epoch !== this.current!.epoch) {
          // The acknowledged batch is part of this document's state; the server
          // deduplicates it from the retained epoch during recovery.
          if (this.canRecover()) this.beginRecovery();
          else this.retire("This file changed after acknowledgement. Your document is kept for recovery.");
          return false;
        }
        presentation(remote.presentation);
        Y.applyUpdate(this.doc, decode(remote.update), REMOTE); this.adoptPresentation(remote.presentation); this.snapshot();
        if (remote.seq >= this.current!.seq) this.current = cursor(remote);
        this.canComment = remote.canComment;
        const acknowledged = this.batch;
        this.batch = null;
        try { this.persist(); } catch (error) { this.batch = acknowledged; throw error; }
        this.options.onChange?.(this.snapshot(), this.presentation);
        if (!await this.flushLocal() || this.dead || !this.active || this.frozen) return false;
        this.uploadFailures = 0;
      }
      if (!this.dead && !this.frozen) this.report("ready");
      return !this.batch && !this.pending.length;
    } catch (error) { this.handleFailure(error, true); return false; }
  }
  setActive(active: boolean, inactiveReason: "paused" | "offline" = "paused"): void {
    if (this.dead) return;
    const reasonChanged = this.inactiveReason !== inactiveReason;
    this.inactiveReason = inactiveReason;
    if (active === this.active) {
      if (!active && reasonChanged && !this.frozen) this.report(inactiveReason);
      return;
    }
    this.active = active;
    if (!active) { this.authoritative = false; this.cancelWork(); if (!this.frozen) this.report(inactiveReason); }
    else if (!this.frozen) {
      this.report("reconnecting");
      if (!this.initialized) void this.start();
      else { this.schedulePoll(0); this.schedulePush(0); }
    }
  }
  /** A deliberate Retry may test the connection even while WebKit reports the window hidden. */
  async retry(): Promise<void> {
    if (this.dead || this.frozen) return;
    this.active = true;
    this.authoritative = false;
    this.failures = 0; this.uploadFailures = 0;
    this.cancelWork();
    this.report("reconnecting");
    if (!this.initialized) {
      if (this.starting) await this.starting;
      if (!this.dead && !this.frozen && !this.initialized) await this.start();
    } else {
      this.schedulePoll(0);
      this.schedulePush(0);
    }
  }
  private cancelWork(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pushTimer = null; this.pollTimer = null;
    for (const controller of this.controllers) controller.abort();
  }
  /** Remove only while this client still owns the record, before destroy releases its lock. */
  discardCleanJournal(): void {
    if (this.dead || this.hasPendingChanges || ((this.options.ownership || (!this.options.journal && !this.options.checkpoint)) && !this.lease)) throw new Error("Pending or unowned collaboration history cannot be removed.");
    this.storage.remove(this.journalKey);
  }
  /** Call only after the caller has durably saved the recovered document copy. */
  clearRetiredAfterRecovery(): void {
    if (this.dead) throw new Error("The journal is no longer owned by this editor.");
    if (this.unreadableJournal) throw new Error("The unreadable recovery journal must be preserved until its contents are recovered.");
    if (!this.frozen || (!this.saved?.retired && !this.initialRetirement)) throw new Error("There is no retired journal to clear.");
    try { this.storage.remove(this.journalKey); this.saved = null; this.pending = []; this.batch = null; this.unqueuedDirty = false; this.initialRetirement = null; }
    catch (error) { this.fatal(new Error(`Recovery journal could not be removed. ${String(error)}`)); throw error; }
  }
  /** Pending edits exist, no retirement fences them, and nothing else owns the journal. */
  private canRecover(): boolean {
    return this.supportsEpochRecovery && this.initialized && this.canEdit && this.active && !this.dead && !this.frozen && !this.recovering &&
      !this.unreadableJournal && !this.initialRetirement && !this.saved?.retired && !this.unqueuedDirty && this.hasPendingChanges;
  }
  private beginRecovery(): void {
    if (this.recovering || this.dead || this.frozen) return;
    this.cancelWork();
    this.recovering = this.recoverEpoch().finally(() => {
      this.recovering = null;
      // A failed attempt re-enters through the poll with upload backoff, never a tight loop.
      const delay = this.uploadFailures ? Math.min(30_000, 1000 * 2 ** Math.min(this.uploadFailures - 1, 5)) : 0;
      if (!this.dead && !this.frozen && this.active) { this.schedulePoll(delay); this.schedulePush(delay); }
    });
  }
  /** Send the exact persisted recovery intent; durable before the first send and
   * reused unchanged on every retry, so a lost acknowledgement replays its receipt. */
  private async recoverEpoch(): Promise<void> {
    try {
      if (!this.current) return;
      if (this.recovery?.adopted) {
        // A later epoch replaced an adopted one. The native store accepts a new
        // intent only over the epoch it has adopted, so prove that one first.
        if (!await this.flushLocal() || this.dead || !this.active || this.frozen) return;
        this.recovery = null;
      }
      if (!this.recovery) {
        this.recovery = { operationId: crypto.randomUUID(), epoch: this.current.epoch, update: encode(Y.encodeStateAsUpdate(this.doc)) };
        this.persist();
      }
      const intent = this.recovery;
      this.report("saving", "Merging saved edits with the changed file…");
      if (!await this.flushLocal() || this.dead || !this.active || this.frozen) return;
      const result = await this.request("push", { operationId: intent.operationId, epoch: intent.epoch, recoveryUpdate: intent.update }) as { status?: string; revision?: string };
      if (this.dead || !this.active || this.frozen) return;
      if (result.status === "conflict") { this.retire("The file changed during recovery. Your edits are kept for recovery."); return; }
      if (result.status !== "written" || typeof result.revision !== "string" || !/^[a-f0-9]{64}$/.test(result.revision)) throw new Error("Invalid collaboration acknowledgement.");
      const remote = await this.request("read", {}) as StateResponse;
      if (this.dead || !this.active || this.frozen) return;
      cursor(remote); presentation(remote.presentation);
      if (typeof remote.canEditContent !== "boolean" || typeof remote.canComment !== "boolean") throw new Error("Invalid collaboration permissions.");
      if (remote.epoch <= intent.epoch) throw new Error("Invalid collaboration recovery epoch.");
      if (!remote.canEditContent) { this.retire("Editing access was removed. Your document is kept for recovery."); return; }
      await this.adoptEpoch(intent, remote);
    } catch (error) { this.handleFailure(error, true); }
  }
  /** Replace the live Y.Doc with the authoritative epoch. Edits typed since the
   * intent was captured are re-expressed with the new identities and queued. */
  private async adoptEpoch(intent: FileCollaborationRecovery, remote: StateResponse): Promise<void> {
    const next = new Y.Doc(), captured = new Y.Doc();
    let swapped = false;
    try {
      Y.applyUpdate(next, decode(remote.update), REMOTE);
      if (next.store.pendingStructs || next.store.pendingDs || !hasDocumentSnapshot(next)) throw new Error("Invalid collaboration document.");
      const remoteSnapshot = documentSnapshotFromYDoc(next);
      Y.applyUpdate(captured, decode(intent.update), REMOTE);
      const base = documentSnapshotFromYDoc(captured), local = this.snapshot();
      let late: string | null = null;
      if (JSON.stringify(base) !== JSON.stringify(local)) {
        const merged = reconcileDocumentSnapshots(base, local, remoteSnapshot, { concurrentInsertions: "remote-first" });
        if (merged.status !== "merged") { this.retireAfterCommit("Edits made during recovery conflict with the recovered file. Your document is kept for recovery."); return; }
        if (JSON.stringify(merged.document) !== JSON.stringify(remoteSnapshot)) {
          const vector = Y.encodeStateVector(next);
          applyDocumentSnapshot(next, merged.document, "epoch-recovery");
          late = encode(Y.encodeStateAsUpdate(next, vector));
          if (late.length > MAX_UPDATE_CHARS) { this.retireAfterCommit("Edits made during recovery exceed the collaboration limit. Your document is kept for recovery."); return; }
        }
      }
      const previous = this.liveDoc;
      const rollback = { current: this.current, pending: this.pending, batch: this.batch, recovery: this.recovery, canComment: this.canComment, presentation: this.presentation };
      previous.off("update", this.changed); next.on("update", this.changed);
      this.liveDoc = next; swapped = true;
      this.current = cursor(remote); this.pending = late ? [late] : []; this.batch = null; this.unqueuedDirty = false;
      this.recovery = { ...intent, adopted: true }; this.canComment = remote.canComment;
      try { this.adoptPresentation(remote.presentation); this.persist(); }
      catch (error) {
        next.off("update", this.changed); previous.on("update", this.changed); this.liveDoc = previous; swapped = false;
        Object.assign(this, rollback); throw error;
      }
      // From here the previous document is retired: it is destroyed on every
      // exit, but only after the UI had its chance to move off it.
      try {
        let rebound = false;
        if (this.options.onDocumentReplaced) {
          try { await this.options.onDocumentReplaced(next, previous); rebound = true; }
          catch { /* The adoption is durable; the editor reopens from it below. */ }
        }
        if (this.dead || this.frozen) return;
        this.notifyRecoverableSnapshot();
        // Native adoption of the replacement epoch must succeed before the old
        // pending state is dropped from the journal.
        if (!await this.flushLocal() || this.dead || !this.active || this.frozen) return;
        this.recovery = null; this.persist();
        this.authoritative = true; this.failures = 0; this.uploadFailures = 0;
        if (!rebound) {
          // No live rebinding: the mounted editor still shows the old document,
          // so stop editing and reopen from the clean replacement.
          this.frozen = true; this.canEdit = false; this.cancelWork();
          this.report(this.options.checkpoint ? "stale-session" : "stale-file", "Reopening this note…");
          return;
        }
        this.report(this.pending.length ? "saving" : "ready");
      } finally { previous.destroy(); }
    } finally { captured.destroy(); if (!swapped) next.destroy(); }
  }
  /** The server has committed the recovery intent, so every queued update is
   * already part of the replacement epoch. Only the document itself, with the
   * edits typed during recovery, still needs manual recovery; the intent stays
   * unadopted so the native store keeps fencing the old epoch. */
  private retireAfterCommit(reason: string): void {
    this.pending = []; this.batch = null; this.unqueuedDirty = true;
    this.retire(reason);
  }
  /** The native journal still holds, unadopted, the exact intent this journal
   * marks adopted at its old revision: the file did not change, only the
   * adoption checkpoint never ran. Mirrors the native authorization check. */
  private nativeAwaitsAdoption(retained: FileCollaborationJournal): boolean {
    const intent = retained.recovery;
    if (!this.options.checkpoint || !intent?.adopted || retained.epoch <= intent.epoch || typeof this.options.retainedJournal !== "string") return false;
    try {
      const native = parseJournal(this.options.retainedJournal);
      return native.epoch === intent.epoch && native.revision === this.options.localRevision && native.relativePath === retained.relativePath &&
        native.recovery?.operationId === intent.operationId && !native.recovery.adopted && native.recovery.update === intent.update &&
        (native.journalGeneration ?? 0) < (retained.journalGeneration ?? 0);
    } catch { return false; }
  }
  destroy(): void {
    if (this.dead) return;
    this.dead = true; this.canEdit = false; this.cancelWork(); this.startCheckpointDrain(); this.doc.off("update", this.changed); this.doc.destroy();
    this.lease?.release(); this.lease = null;
  }
}
