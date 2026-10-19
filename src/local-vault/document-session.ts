import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { FilePresenceClient } from "./presence-client";
import type { PresencePeer } from "@/lib/collab/provider";
import { FileCollaborationClient, type FileCollaborationStatus } from "./collaboration-client";
import { SessionOwner, type SessionHandle } from "@/sync/session-owner";
import { VaultError, captureVaultRequest, vaultRequest, type VaultFile } from "./bridge";
import { externalFileReconciliationBase, readDocument, writePayload } from "./model";
import { refreshBinaryOnlyFile } from "./binary-refresh";
import { packIdentity } from "./pack";
import { currentVaultWindowActive } from "./window-activity";
import { HandoffNotOpenedError, openLocalSharedSession, type NativeSharedSession } from "./shared-open";
import type { DocumentSnapshot } from "@/lib/documents/model";

export type VaultSessionIdentity = { requireLocalHandoff?: boolean; assertHandoffCurrent?: () => void; namespace: string; workspaceId: string; itemId: string; accountId?: string; localFiles?: boolean };
export type VaultSessionView = {
  changed(session: VaultDocumentSession): void;
  replaced(next: Y.Doc, previous: Y.Doc, awareness: Awareness): Promise<void>;
};
/** Owns persistence, transport and projection refresh independently of React. */
export class VaultDocumentSession {
  private shared: FileCollaborationClient | null = null;
  private unpublishedOpen: HandoffNotOpenedError | null = null;
  get canRetryUnpublishedOpen() {
    if (!this.identity.requireLocalHandoff || this.closed || this.native || this.shared || !this.unpublishedOpen?.matches(this.identity.itemId, this.file)) return false;
    try { this.identity.assertHandoffCurrent?.(); return true; } catch { return false; }
  }
  native: NativeSharedSession | null = null;
  awareness: Awareness | null = null;
  peers: PresencePeer[] = [];
  private presence: FilePresenceClient | null = null;
  private presencePaused = false;
  private rebinding = false;
  private recoverySaved = false;
  get hasClient() { return this.shared !== null; }
  get client() { if (!this.shared) throw new Error("The shared document is still opening."); return this.shared; }
  file: VaultFile;
  snapshot: DocumentSnapshot;
  status: FileCollaborationStatus = "reconnecting";
  detail = "";
  private readonly request: typeof vaultRequest;
  private reading = false;
  private queued = false;
  private attached = false;
  private closed = false;
  private views = new Set<VaultSessionView>();
  private assetGeneration = 0;
  private assetRetry: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly identity: VaultSessionIdentity, initial: VaultFile) {
    this.request = identity.localFiles ? vaultRequest : captureVaultRequest();
    this.file = initial; this.snapshot = readDocument(initial);
  }
  private createClient() {
    const identity = this.identity, native = this.native;
    this.shared = new FileCollaborationClient({
      server: identity.namespace, workspaceId: identity.workspaceId, itemId: identity.itemId, accountId: identity.accountId,
      active: false,
      supportsEpochRecovery: native ? Boolean(native.capabilities?.includes("epoch-adoption")) : true,
      retainedJournal: native?.journal, retainedJournalPath: native?.path, localRevision: native?.acknowledgedRevision,
      initialRetirement: native?.retiredReason ?? undefined,
      initialFileChange: native?.journal && native.projectedHash && native.projectedHash !== this.file.hash ? {
        journal: native.journal, document: readDocument(this.file),
        presentation: { templateJSON: this.file.templateJSON ?? null, templateAuthoringSourceJSON: this.file.templateAuthoringSourceJSON ?? null },
      } : undefined,
      reconcileCheckpoint: native ? async error => {
        const before = this.file;
        const moved = error instanceof VaultError && error.path && error.path !== before.path ? error.path : undefined;
        const fresh = await this.request<VaultFile>("read", { path: moved ?? before.path });
        if (this.closed || !this.native || fresh.hash === before.hash || packIdentity(fresh.markdown) !== identity.itemId) return false;
        if (fresh.templateJSON !== before.templateJSON || fresh.templateAuthoringSourceJSON !== before.templateAuthoringSourceJSON) return false;
        if (!this.client.reconcileExternalDocument(externalFileReconciliationBase(before, fresh, identity.itemId), readDocument(fresh))) return false;
        this.replaceFile(fresh); return true;
      } : undefined,
      checkpoint: native ? async ({ journal, document }) => {
        const active = this.native;
        if (!active) throw new Error("The local shared file session has closed. Your journal is kept.");
        const payload = writePayload({ ...this.file, ...journal.presentation }, document);
        const saved = await this.request<{ path: string; hash: string }>("collaborationCheckpoint", {
          itemId: identity.itemId, sessionToken: active.sessionToken, hash: this.file.hash,
          epoch: journal.epoch, seq: journal.seq, revision: journal.revision,
          journalGeneration: journal.journalGeneration, journal: JSON.stringify(journal),
          pending: Boolean(journal.batch || journal.pending.length || journal.unqueuedDirty),
          markdown: payload.markdown, documentJSON: payload.documentJSON,
        });
        this.replaceFile({ ...this.file, ...journal.presentation, ...saved, markdown: payload.markdown, documentJSON: payload.documentJSON });
      } : undefined,
      request: async (method, params, signal) => {
        try { return await this.request(method === "read" ? "collaborationRead" : "collaborationPush", { ...params, itemId: identity.itemId }, signal); }
        catch (error) {
          if (error instanceof VaultError && !("status" in error)) Object.assign(error, { status: error.code === "unauthorized" ? 401 : Number(error.code) || undefined });
          throw error;
        }
      },
      onChange: (next, presentation) => {
        if (this.closed) return;
        if (presentation) this.file = { ...this.file, ...presentation };
        if (JSON.stringify(this.snapshot.content.assets) !== JSON.stringify(next.content.assets)) this.refreshAssets();
        this.snapshot = next; this.emit();
      },
      onRemoteNonTextRevision: () => this.refreshAssets(),
      onStatus: (status, detail) => { if (!this.closed) { this.status = status; this.detail = detail ?? ""; this.updatePresence(); this.emit(); } },
      onDocumentReplaced: async (next, previous) => {
        // All still-bound views must release the old Y.Doc before the client
        // destroys it. No view is a valid state while a local save drains.
        const oldAwareness = this.awareness;
        this.rebinding = true;
        try {
          this.configurePresence(next);
          await Promise.all([...this.views].map(view => view.replaced(next, previous, this.awareness!)));
        } finally { this.rebinding = false; this.emit(); oldAwareness?.destroy(); }
      },
    });
    this.configurePresence(this.shared.doc);
  }
  get connected() { return this.status === "ready" || this.status === "saving"; }
  subscribe(view: VaultSessionView) { this.views.add(view); view.changed(this); return () => this.views.delete(view); }
  private emit() { if (!this.closed && !this.rebinding) for (const view of this.views) view.changed(this); }
  replaceFile(file: VaultFile) { this.file = file; this.emit(); }
  private visibility = () => {
    this.shared?.setActive(this.attached && currentVaultWindowActive(), navigator.onLine ? "paused" : "offline");
    this.updatePresence();
  };
  private configurePresence(doc: Y.Doc) {
    this.presence?.destroy();
    this.awareness = new Awareness(doc);
    this.presence = new FilePresenceClient({ itemId: this.identity.itemId, awareness: this.awareness,
      request: (method, params, signal) => this.request(method, params, signal),
      onPresence: peers => { this.peers = peers; this.emit(); },
    });
    this.updatePresence();
  }
  private updatePresence() { this.presence?.setActive(this.attached && !this.presencePaused && this.status === "ready" && currentVaultWindowActive()); }
  pausePresence(paused: boolean) { this.presencePaused = paused; this.updatePresence(); }
  setAttached(attached: boolean) { this.attached = attached; this.visibility(); }
  async start() {
    document.addEventListener("visibilitychange", this.visibility);
    for (const name of ["online", "offline", "focus", "blur"]) window.addEventListener(name, this.visibility);
    if (this.identity.localFiles) window.addEventListener("texttext:vault-changed", this.changed);
    try {
      if (this.identity.localFiles) {
        const opened = await openLocalSharedSession(this.identity.itemId, this.file, this.request, 20_000, this.identity.requireLocalHandoff ? { version: 1, profileVersion: 4 } : undefined,
          1_000, this.identity.assertHandoffCurrent);
        this.native = opened.native; this.replaceFile(opened.file);
        if (this.native.hash !== this.file.hash || this.native.path !== this.file.path)
          this.replaceFile(await this.request<VaultFile>("read", { path: this.native.path }));
      }
      this.createClient(); this.visibility(); this.emit(); await this.client.start();
    } catch (error) {
      if (error instanceof HandoffNotOpenedError && this.identity.requireLocalHandoff && error.matches(this.identity.itemId, this.file)) this.unpublishedOpen = error;
      this.status = "error"; this.detail = error instanceof Error ? error.message : "Could not open the shared file."; this.emit(); throw error;
    }
  }
  async save() {
    if (this.recoverySaved) return true;
    if (!this.shared) return true;
    if (!this.client.hasBaseline && !this.client.hasPendingChanges && !this.client.hasUnreadableJournal) return true;
    // Retry recoverable browser storage failures. Native checkpoint failures
    // keep their existing fence until explicit durable-copy recovery.
    if (await this.client.flushLocal()) return true;
    return Boolean(this.identity.localFiles && ["stale-file", "stale-session"].includes(this.client.status) &&
      !this.client.hasPendingChanges && !this.client.hasUnreadableJournal);
  }
  async closeNative() {
    const native = this.native;
    if (!native) return;
    await this.request("collaborationClose", { itemId: this.identity.itemId, sessionToken: native.sessionToken });
    if (this.native === native) this.native = null;
    this.emit();
  }
  async recoverTo(recovered: VaultFile) {
    if (!recovered.hash || recovered.path === this.file.path ||
        JSON.stringify(readDocument(recovered)) !== JSON.stringify(this.snapshot)) {
      throw new Error("The recovery copy did not preserve this document. The original session remains open.");
    }
    if (this.native) {
      const native = this.native;
      await this.client.flushLocal();
      await this.request("collaborationRecover", { itemId: this.identity.itemId, sessionToken: native.sessionToken,
        recoveryPath: recovered.path, recoveryHash: recovered.hash });
      // Native recovery validates the durable copy and releases this lease.
      if (this.native === native) this.native = null;
    }
    this.recoverySaved = true; this.emit();
  }
  async close() {
    await this.closeNative();
    this.closed = true; this.assetGeneration++;
    if (this.assetRetry) clearTimeout(this.assetRetry);
    document.removeEventListener("visibilitychange", this.visibility);
    for (const name of ["online", "offline", "focus", "blur"]) window.removeEventListener(name, this.visibility);
    window.removeEventListener("texttext:vault-changed", this.changed);
    this.presence?.destroy(); this.presence = null; this.awareness?.destroy(); this.awareness = null;
    this.shared?.destroy(); this.views.clear();
  }
  private changed = () => { if (this.attached) { this.queued = true; void this.checkFile(); } };
  private async checkFile() {
    if (this.reading) return;
    this.reading = true;
    try {
      while (this.queued && !this.closed && this.attached) {
        this.queued = false;
        if (!this.shared?.hasBaseline || this.shared.status === "stale-file") return;
        try {
          const latest = await this.request<VaultFile>("read", { path: this.file.path });
          if (!this.closed && this.attached && latest.hash !== this.file.hash) {
            const refreshed = refreshBinaryOnlyFile(this.file, latest, this.identity.itemId, true);
            if (refreshed) this.replaceFile(refreshed); else this.shared.notifyExternalFileChange();
          }
        } catch { /* Unavailable bytes keep the existing recovery path. */ }
      }
    } finally { this.reading = false; }
  }
  private refreshAssets(attempt = 0) {
    if (this.closed || this.identity.localFiles) return;
    if (this.assetRetry) { clearTimeout(this.assetRetry); this.assetRetry = null; }
    const generation = ++this.assetGeneration, path = this.file.path;
    void this.request<VaultFile>("read", { path }).then(fresh => {
      if (this.closed || generation !== this.assetGeneration || fresh.path !== this.file.path || packIdentity(fresh.markdown) !== this.identity.itemId) return;
      const refreshed = refreshBinaryOnlyFile(this.file, fresh, this.identity.itemId, false);
      if (refreshed) this.replaceFile(refreshed);
    }).catch(() => {
      if (!this.closed && generation === this.assetGeneration && attempt < 5)
        this.assetRetry = setTimeout(() => this.refreshAssets(attempt + 1), Math.min(1000 * 2 ** attempt, 8000));
    });
  }
}
const owner = new SessionOwner<VaultDocumentSession>();
export const flushDocumentSessions = () => owner.flushAll();
export type VaultDocumentHandle = SessionHandle<VaultDocumentSession>;
export function acquireVaultDocument(identity: VaultSessionIdentity, initial: VaultFile, root = ""): VaultDocumentHandle {
  const key = JSON.stringify([identity.namespace.replace(/\/$/, ""), identity.accountId ?? null, identity.workspaceId, identity.itemId, identity.localFiles ? root : null]);
  return owner.acquire(key, () => new VaultDocumentSession(identity, initial));
}
