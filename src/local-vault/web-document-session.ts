import * as Y from "yjs";
import { FileCollaborationClient, type FileCollaborationStatus } from "./collaboration-client";
import { SessionOwner, type SessionHandle } from "@/sync/session-owner";
import { VaultError, captureVaultRequest, type VaultFile } from "./bridge";
import { readDocument } from "./model";
import { refreshBinaryOnlyFile } from "./binary-refresh";
import { packIdentity } from "./pack";
import { currentVaultWindowActive } from "./window-activity";
import type { DocumentSnapshot } from "@/lib/documents/model";

export type WebSessionIdentity = { namespace: string; workspaceId: string; itemId: string; accountId?: string };
export type WebSessionView = {
  changed(session: WebDocumentSession): void;
  replaced(next: Y.Doc, previous: Y.Doc): Promise<void>;
};
/** Owns persistence, transport and projection refresh independently of React. */
export class WebDocumentSession {
  readonly client: FileCollaborationClient;
  file: VaultFile;
  snapshot: DocumentSnapshot;
  status: FileCollaborationStatus = "reconnecting";
  detail = "";
  private readonly request = captureVaultRequest();
  private attached = false;
  private closed = false;
  private views = new Set<WebSessionView>();
  private assetGeneration = 0;
  private assetRetry: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly identity: WebSessionIdentity, initial: VaultFile) {
    this.file = initial; this.snapshot = readDocument(initial);
    this.client = new FileCollaborationClient({
      server: identity.namespace, workspaceId: identity.workspaceId, itemId: identity.itemId, accountId: identity.accountId,
      active: false, supportsEpochRecovery: true,
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
      onStatus: (status, detail) => { if (!this.closed) { this.status = status; this.detail = detail ?? ""; this.emit(); } },
      onDocumentReplaced: async (next, previous) => {
        // All still-bound views must release the old Y.Doc before the client
        // destroys it. No view is a valid state while a local save drains.
        await Promise.all([...this.views].map(view => view.replaced(next, previous)));
      },
    });
  }
  get connected() { return this.status === "ready" || this.status === "saving"; }
  subscribe(view: WebSessionView) { this.views.add(view); view.changed(this); return () => this.views.delete(view); }
  private emit() { for (const view of this.views) view.changed(this); }
  replaceFile(file: VaultFile) { this.file = file; this.emit(); }
  private visibility = () => this.client.setActive(this.attached && currentVaultWindowActive(), navigator.onLine ? "paused" : "offline");
  setAttached(attached: boolean) { this.attached = attached; this.visibility(); }
  async start() {
    document.addEventListener("visibilitychange", this.visibility);
    for (const name of ["online", "offline", "focus", "blur"]) window.addEventListener(name, this.visibility);
    await this.client.start();
  }
  async save() {
    if (!this.client.hasBaseline && !this.client.hasPendingChanges && !this.client.hasUnreadableJournal) return true;
    // Retry the existing persistence path after a transient storage failure.
    // flushLocalResult intentionally reports an already-known failure early.
    return this.client.flushLocal();
  }
  close() {
    this.closed = true; this.assetGeneration++;
    if (this.assetRetry) clearTimeout(this.assetRetry);
    document.removeEventListener("visibilitychange", this.visibility);
    for (const name of ["online", "offline", "focus", "blur"]) window.removeEventListener(name, this.visibility);
    this.client.destroy(); this.views.clear();
  }
  private refreshAssets(attempt = 0) {
    if (this.closed) return;
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
const owner = new SessionOwner<WebDocumentSession>();
export type WebDocumentHandle = SessionHandle<WebDocumentSession>;
export function acquireWebDocument(identity: WebSessionIdentity, initial: VaultFile): WebDocumentHandle {
  const key = JSON.stringify([identity.namespace.replace(/\/$/, ""), identity.accountId ?? null, identity.workspaceId, identity.itemId]);
  return owner.acquire(key, () => new WebDocumentSession(identity, initial));
}
