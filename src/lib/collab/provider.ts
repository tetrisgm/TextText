// A minimal Yjs provider over the HTTP relay (src/app/api/collab). It carries
// a Y.Doc's updates to the server (POST) and applies everyone else's by
// long-polling (GET ?since&wait), so TipTap's Collaboration extension gets a
// converging shared document without a websocket server. Presence heartbeats
// ride alongside. Browser-only (uses fetch/btoa); import from client code.

import * as Y from "yjs";

const REMOTE_ORIGIN = "collab-remote";
const CLIENT_ID_STORAGE_PREFIX = "write:collab:client:";

function u8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToU8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type PresencePeer = { clientId: string; userName: string; color: string };

export type CollabProviderOptions = {
  postId: string;
  userName: string;
  color: string;
  canPush: boolean;
  onPresence?: (peers: PresencePeer[]) => void;
  onError?: (message: string) => void;
};

function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `c-${crypto.randomUUID()}`;
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function stableSessionClientId(postId: string): string {
  const key = `${CLIENT_ID_STORAGE_PREFIX}${postId}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next = createClientId();
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return createClientId();
  }
}

export class CollabProvider {
  readonly clientId: string;
  private lastSeq = 0;
  private stopped = false;
  private flushing = false;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly base: string;

  constructor(
    private readonly doc: Y.Doc,
    private readonly opts: CollabProviderOptions,
  ) {
    this.clientId = stableSessionClientId(opts.postId);
    this.base = `/api/collab/${encodeURIComponent(opts.postId)}`;
    this.onDocUpdate = this.onDocUpdate.bind(this);
  }

  /** Resolves once the initial history has been applied (doc is caught up). */
  async start(): Promise<void> {
    await this.catchUp();
    this.doc.on("update", this.onDocUpdate);
    void this.pollLoop();
    if (this.opts.canPush) {
      this.heartbeat();
      this.presenceTimer = setInterval(() => this.heartbeat(), 8000);
    }
  }

  destroy(): void {
    this.stopped = true;
    this.doc.off("update", this.onDocUpdate);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    // Best-effort leave so peers drop us promptly.
    if (this.opts.canPush && navigator.sendBeacon) {
      navigator.sendBeacon(
        `${this.base}/presence`,
        JSON.stringify({ clientId: this.clientId, userName: this.opts.userName, color: this.opts.color, leave: true }),
      );
    }
  }

  private onDocUpdate(update: Uint8Array, origin: unknown) {
    if (origin === REMOTE_ORIGIN) return; // do not echo what we just applied
    if (!this.opts.canPush) return; // viewers never write
    this.pending.push(update);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), 250);
    }
  }

  private async flush() {
    this.flushTimer = null;
    if (this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    const batch = this.pending;
    this.pending = [];
    try {
      const res = await fetch(this.base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: batch.map(u8ToBase64) }),
      });
      if (!res.ok) throw new Error(`push ${res.status}`);
    } catch (error) {
      // Requeue and retry on the next tick so a transient failure never drops
      // a local edit.
      this.pending.unshift(...batch);
      this.opts.onError?.(error instanceof Error ? error.message : "collab push failed");
      if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 1500);
    } finally {
      this.flushing = false;
      if (this.pending.length > 0 && !this.flushTimer) {
        this.flushTimer = setTimeout(() => void this.flush(), 250);
      }
    }
  }

  // Apply a remote row, but ALWAYS advance past it even if the update fails
  // to decode. Otherwise a single bad row (which the server now rejects, but
  // defense in depth) would be re-fetched every poll forever, permanently
  // stalling convergence.
  private applyRow(row: { seq: number; update: string }) {
    try {
      Y.applyUpdate(this.doc, base64ToU8(row.update), REMOTE_ORIGIN);
    } catch {
      // skip a corrupt update rather than replay it forever
    }
    this.lastSeq = Math.max(this.lastSeq, row.seq);
  }

  private async catchUp() {
    try {
      const res = await fetch(`${this.base}?since=0&wait=0`);
      if (!res.ok) return;
      const data = (await res.json()) as { updates: Array<{ seq: number; update: string }>; seq: number };
      for (const row of data.updates) this.applyRow(row);
    } catch {
      // Offline start: the editor still works locally; the poll loop retries.
    }
  }

  private async pollLoop() {
    while (!this.stopped) {
      try {
        const res = await fetch(`${this.base}?since=${this.lastSeq}&wait=25`);
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        const data = (await res.json()) as { updates: Array<{ seq: number; update: string }>; seq: number };
        // Same corruption-tolerant path as catchUp: applyRow advances past a
        // row even if applying it throws, so one bad update can never stall
        // the loop by making it re-fetch the same seq forever.
        for (const row of data.updates) this.applyRow(row);
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async heartbeat() {
    try {
      const res = await fetch(`${this.base}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: this.clientId, userName: this.opts.userName, color: this.opts.color }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { presence: PresencePeer[] };
      this.opts.onPresence?.(data.presence);
    } catch {
      // presence is best-effort
    }
  }
}
