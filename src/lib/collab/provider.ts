// A minimal Yjs provider over the HTTP relay (src/app/api/collab). It carries
// a Y.Doc's updates to the server (POST) and applies everyone else's by
// long-polling (GET ?since&wait), so TipTap's Collaboration extension gets a
// converging shared document without a websocket server. Presence heartbeats
// ride alongside. Browser-only (uses fetch/btoa); import from client code.

import * as Y from "yjs";

const REMOTE_ORIGIN = "collab-remote";
const CLIENT_ID_STORAGE_PREFIX = "write:collab:client:";
const PUSH_DEBOUNCE_MS = 250;
const PUSH_RETRY_MS = 1500;
const MAX_PUSH_BATCH = 64;

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

export type CollabStartResult =
  | { authoritative: true; remoteEmpty: boolean }
  | { authoritative: false; remoteEmpty: false };

export type CollabProviderOptions = {
  postId: string;
  userName: string;
  color: string;
  canPush: boolean;
  onPresence?: (peers: PresencePeer[]) => void;
  onError?: (message: string) => void;
};

type Outbox = {
  base: string;
  flushing: boolean;
  pending: Uint8Array[];
  subscribers: Map<symbol, CollabProviderOptions["onError"]>;
  timer: ReturnType<typeof setTimeout> | null;
};

// A provider is tied to a mounted editor, but unsent edits are tied to the
// post. Keeping the queue and its retry timer here lets teardown stop polling
// and presence without dropping edits that still need to reach the relay.
const outboxes = new Map<string, Outbox>();

function outboxFor(postId: string, base: string): Outbox {
  const existing = outboxes.get(postId);
  if (existing) return existing;
  const created: Outbox = {
    base,
    flushing: false,
    pending: [],
    subscribers: new Map(),
    timer: null,
  };
  outboxes.set(postId, created);
  return created;
}

function releaseOutbox(postId: string, outbox: Outbox) {
  if (
    outbox.pending.length === 0 &&
    !outbox.flushing &&
    !outbox.timer &&
    outbox.subscribers.size === 0 &&
    outboxes.get(postId) === outbox
  ) {
    outboxes.delete(postId);
  }
}

function scheduleOutbox(postId: string, outbox: Outbox, delay: number) {
  if (outbox.timer || outbox.flushing || outbox.pending.length === 0) return;
  outbox.timer = setTimeout(() => {
    outbox.timer = null;
    void flushOutbox(postId, outbox);
  }, delay);
}

async function flushOutbox(postId: string, outbox: Outbox) {
  if (outbox.flushing || outbox.pending.length === 0) {
    releaseOutbox(postId, outbox);
    return;
  }

  outbox.flushing = true;
  const batch = outbox.pending.slice(0, MAX_PUSH_BATCH);
  let nextDelay = PUSH_DEBOUNCE_MS;
  try {
    const res = await fetch(outbox.base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: batch.map(u8ToBase64) }),
    });
    if (!res.ok) throw new Error(`push ${res.status}`);
    outbox.pending.splice(0, batch.length);
  } catch (error) {
    nextDelay = PUSH_RETRY_MS;
    const message =
      error instanceof Error ? error.message : "collab push failed";
    for (const onError of outbox.subscribers.values()) {
      try {
        onError?.(message);
      } catch {
        // A reporting callback must not interrupt delivery retries.
      }
    }
  } finally {
    outbox.flushing = false;
    if (outbox.pending.length > 0) {
      scheduleOutbox(postId, outbox, nextDelay);
    } else {
      releaseOutbox(postId, outbox);
    }
  }
}

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
  private started = false;
  private startPromise: Promise<CollabStartResult> | null = null;
  private capturedLocalUpdate = false;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly base: string;
  private readonly outboxSubscriber = Symbol("collab-provider");
  private outbox: Outbox | null = null;

  constructor(
    private readonly doc: Y.Doc,
    private readonly opts: CollabProviderOptions,
  ) {
    this.clientId = stableSessionClientId(opts.postId);
    this.base = `/api/collab/${encodeURIComponent(opts.postId)}`;
    this.onDocUpdate = this.onDocUpdate.bind(this);
  }

  /** Reports whether an authoritative initial history was applied. */
  start(): Promise<CollabStartResult> {
    if (this.startPromise) return this.startPromise;
    if (this.stopped) {
      return Promise.resolve({ authoritative: false, remoteEmpty: false });
    }

    // Subscribe before the first network await. TipTap can emit edits while
    // initial history is in flight, and those edits must enter the outbox.
    this.started = true;
    this.doc.on("update", this.onDocUpdate);

    const outbox = outboxFor(this.opts.postId, this.base);
    this.outbox = outbox;
    outbox.subscribers.set(this.outboxSubscriber, this.opts.onError);
    const hadPendingUpdates = outbox.pending.length > 0;

    // A remounted editor gets the still-local Yjs operations immediately.
    // Applying them with the remote origin is idempotent and avoids requeueing.
    for (const update of outbox.pending) {
      try {
        Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
      } catch {
        // Locally generated Yjs updates should always decode. Keep any bad
        // entry queued so it is never silently discarded.
      }
    }
    scheduleOutbox(this.opts.postId, outbox, 0);

    this.startPromise = this.finishStart(hadPendingUpdates);
    return this.startPromise;
  }

  destroy(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.started) this.doc.off("update", this.onDocUpdate);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.outbox) {
      this.outbox.subscribers.delete(this.outboxSubscriber);
      releaseOutbox(this.opts.postId, this.outbox);
    }
    // Best-effort leave so peers drop us promptly.
    if (
      this.opts.canPush &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      navigator.sendBeacon(
        `${this.base}/presence`,
        JSON.stringify({ clientId: this.clientId, userName: this.opts.userName, color: this.opts.color, leave: true }),
      );
    }
  }

  private onDocUpdate(update: Uint8Array, origin: unknown) {
    if (origin === REMOTE_ORIGIN) return; // do not echo what we just applied
    if (!this.opts.canPush) return; // viewers never write
    this.capturedLocalUpdate = true;
    const outbox = this.outbox ?? outboxFor(this.opts.postId, this.base);
    this.outbox = outbox;
    outbox.pending.push(update.slice());
    scheduleOutbox(this.opts.postId, outbox, PUSH_DEBOUNCE_MS);
  }

  private async finishStart(
    hadPendingUpdates: boolean,
  ): Promise<CollabStartResult> {
    const caughtUp = await this.catchUp();
    const result: CollabStartResult = caughtUp.authoritative
      ? {
          authoritative: true,
          // Existing or newly captured local operations mean this is not a
          // pristine document that BodyEditor may safely initialize.
          remoteEmpty:
            caughtUp.remoteEmpty &&
            !hadPendingUpdates &&
            !this.capturedLocalUpdate,
        }
      : caughtUp;

    if (this.stopped) return result;
    void this.pollLoop();
    if (this.opts.canPush) {
      void this.heartbeat();
      this.presenceTimer = setInterval(() => void this.heartbeat(), 8000);
    }
    return result;
  }

  // Apply a remote row, but ALWAYS advance past it even if the update fails
  // to decode. Otherwise a single bad row (which the server now rejects, but
  // defense in depth) would be re-fetched every poll forever, permanently
  // stalling convergence.
  private applyRow(row: { seq: number; update: string }): boolean {
    try {
      Y.applyUpdate(this.doc, base64ToU8(row.update), REMOTE_ORIGIN);
    } catch {
      // skip a corrupt update rather than replay it forever
      this.lastSeq = Math.max(this.lastSeq, row.seq);
      return false;
    }
    this.lastSeq = Math.max(this.lastSeq, row.seq);
    return true;
  }

  private async catchUp(): Promise<CollabStartResult> {
    let sawRemoteUpdate = false;
    try {
      while (!this.stopped) {
        const previousSeq = this.lastSeq;
        const res = await fetch(`${this.base}?since=${previousSeq}&wait=0`);
        if (!res.ok) {
          return { authoritative: false, remoteEmpty: false };
        }
        const data = (await res.json()) as {
          updates?: unknown;
          seq?: unknown;
        };
        if (!Array.isArray(data.updates) || !Number.isSafeInteger(data.seq)) {
          return { authoritative: false, remoteEmpty: false };
        }
        if (data.updates.length === 0) {
          return {
            authoritative: true,
            remoteEmpty:
              !sawRemoteUpdate && previousSeq === 0 && data.seq === 0,
          };
        }

        let appliedEveryRow = true;
        for (const candidate of data.updates) {
          if (
            !candidate ||
            typeof candidate !== "object" ||
            !Number.isSafeInteger((candidate as { seq?: unknown }).seq) ||
            typeof (candidate as { update?: unknown }).update !== "string"
          ) {
            return { authoritative: false, remoteEmpty: false };
          }
          sawRemoteUpdate = true;
          if (!this.applyRow(candidate as { seq: number; update: string })) {
            appliedEveryRow = false;
          }
        }
        if (!appliedEveryRow || this.lastSeq <= previousSeq) {
          return { authoritative: false, remoteEmpty: false };
        }
      }
    } catch {
      // Offline start: the editor still works locally; polling retries.
    }
    return { authoritative: false, remoteEmpty: false };
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
