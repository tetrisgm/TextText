// A minimal Yjs provider over the HTTP relay (src/app/api/collab). It carries
// a Y.Doc's updates to the server (POST) and applies everyone else's by
// long-polling (GET ?since&wait), so TipTap's Collaboration extension gets a
// converging shared document without a websocket server. Presence heartbeats
// ride alongside. Browser-only (uses fetch/btoa); import from client code.

import * as Y from "yjs";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from "y-protocols/awareness";

const REMOTE_ORIGIN = "collab-remote";
const REMOTE_AWARENESS_ORIGIN = "collab-awareness-remote";
const CLIENT_ID_STORAGE_PREFIX = "texttext:collab:client:";
const PUSH_DEBOUNCE_MS = 250;
const PUSH_RETRY_MS = 1500;
const PUSH_MAX_RETRY_MS = 30_000;
const POLL_RETRY_MS = 2000;
const POLL_MAX_RETRY_MS = 30_000;
const MAX_PUSH_BATCH = 64;

/** 401/403: this session no longer has access to the post. Retrying is futile
 * and just hammers the server, so every collab loop must stop hard. */
function isAccessLoss(status: number): boolean {
  // 410 is "this item was moved to Trash": also fatal for the session, but a
  // different thing to say to the person holding it open.
  return status === 401 || status === 403 || status === 410;
}

function accessLossMessage(status: number): string {
  return status === 410
    ? "This item was moved to Trash."
    : "You no longer have access to this item.";
}

/** A payload the server will never accept (malformed / too large / not an
 * editor). Retrying the SAME batch loops forever; drop it instead. */
function isPermanentPushError(status: number): boolean {
  return status === 400 || status === 413 || status === 422;
}

/** Capped exponential backoff with equal jitter, so a flapping server or a
 * network blip is retried gently instead of in a tight flat-interval loop. The
 * first retry (attempt 1) lands within [base/2, base); each further attempt
 * doubles, capped at maxMs. */
function backoff(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(Math.max(attempt - 1, 0), 8));
  return exp / 2 + Math.random() * (exp / 2);
}

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

export type PresencePeer = {
  clientId: string;
  userName: string;
  color: string;
  awareness: string | null;
  participantType?: "person" | "agent";
  provider?: string;
};

export type CollabStartResult =
  | { authoritative: true; remoteEmpty: boolean; baselineRevision: number }
  | { authoritative: false; remoteEmpty: false };

export type CollabProviderOptions = {
  postId: string;
  userName: string;
  color: string;
  canPush: boolean;
  awareness?: Awareness;
  onPresence?: (peers: PresencePeer[]) => void;
  onError?: (message: string) => void;
  expectedBaselineRevision?: number;
  onBaselineMismatch?: (serverRevision: number) => void;
  /** The server retired this document's log generation (its stale between-
   * sessions log was reset from posts.body). The local Y.Doc is now stale and
   * must be rebuilt: the editor discards it and remounts a fresh doc that
   * re-catches-up and reseeds. Any un-materialized local edit is intentionally
   * dropped rather than merged over the authoritative body. */
  onRetired?: () => void;
};

/** Transport boundary for the editor. The HTTP relay is the baseline, while a
 * future websocket or local peer fast path can implement the same contract. */
export interface CollaborationTransport {
  start(): Promise<CollabStartResult>;
  enqueueCurrentState(): void;
  destroy(): void;
}

type OutboxSubscriber = {
  onError?: CollabProviderOptions["onError"];
  /** Called when the relay reports this session lost access (401/403), so the
   * subscribing provider tears its poll/heartbeat loops down too. */
  onFatal?: () => void;
  /** Called when a push is fenced out because the log generation was retired. */
  onRetired?: () => void;
};

type Outbox = {
  base: string;
  flushing: boolean;
  pending: Uint8Array[];
  subscribers: Map<symbol, OutboxSubscriber>;
  timer: ReturnType<typeof setTimeout> | null;
  /** Consecutive transient failures, for backoff. Reset on any success. */
  retries: number;
  /** The log generation this client caught up under; sent on every push and
   * FENCED server-side. A push against a stale epoch is retired. */
  epoch: number;
  /** Whether `epoch` has actually been learned from a server response. Until it
   * has, a poll returning epoch >= 1 must be LEARNED, not mistaken for a
   * generation change (which would spuriously retire an un-caught-up client). */
  epochKnown: boolean;
  /** Canonical document revision used to seed queued offline operations. */
  baselineRevision: number | null;
  /** Restores edits that survived a tab or app process restart. */
  hydrated: Promise<void>;
};

// A provider is tied to a mounted editor, but unsent edits are tied to the
// post. Keeping the queue and its retry timer here lets teardown stop polling
// and presence without dropping edits that still need to reach the relay.
const outboxes = new Map<string, Outbox>();

const OUTBOX_DB = "texttext-collab";
const OUTBOX_STORE = "outboxes";

type StoredOutbox = {
  postId: string;
  updates: string[];
  epoch: number;
  epochKnown: boolean;
  baselineRevision: number | null;
};

function openOutboxDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(OUTBOX_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OUTBOX_STORE)) {
        request.result.createObjectStore(OUTBOX_STORE, { keyPath: "postId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readStoredOutbox(postId: string): Promise<StoredOutbox | null> {
  const database = await openOutboxDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    const transaction = database.transaction(OUTBOX_STORE, "readonly");
    const request = transaction.objectStore(OUTBOX_STORE).get(postId);
    request.onsuccess = () => resolve((request.result as StoredOutbox | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
  });
}

async function persistOutbox(postId: string, outbox: Outbox): Promise<void> {
  const database = await openOutboxDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const store = transaction.objectStore(OUTBOX_STORE);
    if (outbox.pending.length === 0) {
      store.delete(postId);
    } else {
      store.put({
        postId,
        updates: outbox.pending.map(u8ToBase64),
        epoch: outbox.epoch,
        epochKnown: outbox.epochKnown,
        baselineRevision: outbox.baselineRevision,
      } satisfies StoredOutbox);
    }
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

async function hydrateOutbox(postId: string, outbox: Outbox): Promise<void> {
  const stored = await readStoredOutbox(postId);
  if (!stored || outboxes.get(postId) !== outbox) return;
  const restored: Uint8Array[] = [];
  for (const value of stored.updates) {
    try {
      restored.push(base64ToU8(value));
    } catch {
      // Skip corrupt local data. Valid later updates still get a chance to sync.
    }
  }
  outbox.pending.unshift(...restored);
  if (!outbox.epochKnown && stored.epochKnown) {
    outbox.epoch = stored.epoch;
    outbox.epochKnown = true;
  }
  if (outbox.baselineRevision == null && Number.isInteger(stored.baselineRevision)) {
    outbox.baselineRevision = stored.baselineRevision;
  }
}

function outboxFor(postId: string, base: string): Outbox {
  const existing = outboxes.get(postId);
  if (existing) return existing;
  const created: Outbox = {
    base,
    flushing: false,
    pending: [],
    subscribers: new Map(),
    timer: null,
    retries: 0,
    epoch: 0,
    epochKnown: false,
    baselineRevision: null,
    hydrated: Promise.resolve(),
  };
  outboxes.set(postId, created);
  created.hydrated = hydrateOutbox(postId, created);
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

function removePendingBatch(outbox: Outbox, batch: Uint8Array[]) {
  for (const update of batch) {
    const index = outbox.pending.indexOf(update);
    if (index >= 0) outbox.pending.splice(index, 1);
  }
}

function retireOutbox(outbox: Outbox, epoch: number) {
  outbox.pending.length = 0;
  outbox.retries = 0;
  outbox.epoch = epoch;
  outbox.epochKnown = true;
  const postId = Array.from(outboxes.entries()).find(([, value]) => value === outbox)?.[0];
  if (postId) void persistOutbox(postId, outbox);
  if (outbox.timer) {
    clearTimeout(outbox.timer);
    outbox.timer = null;
  }
  for (const sub of outbox.subscribers.values()) {
    try {
      sub.onRetired?.();
    } catch {
      // teardown of one subscriber must not block the others
    }
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
  // A new provider can capture edits before its initial catch-up returns. Keep
  // them queued until the relay tells us which epoch to fence them on, or a
  // retired post would reject fresh edits sent with the default epoch 0.
  if (!outbox.epochKnown) return;

  const report = (message: string) => {
    for (const sub of outbox.subscribers.values()) {
      try {
        sub.onError?.(message);
      } catch {
        // A reporting callback must not interrupt delivery retries.
      }
    }
  };

  outbox.flushing = true;
  const batch = outbox.pending.slice(0, MAX_PUSH_BATCH);
  const batchEpoch = outbox.epoch;
  let nextDelay = PUSH_DEBOUNCE_MS;
  try {
    const res = await fetch(outbox.base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: batch.map(u8ToBase64), epoch: batchEpoch }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        retired?: boolean;
        epoch?: number;
      };
      // A poll or catch-up may have observed a retirement while this request was
      // in flight. Its response belongs to the old generation and must not
      // restore that epoch or remove newer queued edits.
      if (outbox.epoch !== batchEpoch) {
        // retirement already handled by the response that advanced the epoch
      } else if (data.retired) {
        // The log generation was retired (a stale between-sessions log reset from
        // posts.body). This client's queued edits are now stale: drop them so
        // they can never merge over the reseeded body, and tell every provider on
        // this post to remount onto a fresh doc.
        retireOutbox(outbox, typeof data.epoch === "number" ? data.epoch : batchEpoch);
      } else {
        // A pagehide beacon can remove this in-flight batch while the request is
        // pending. Remove the exact update objects that this response delivered,
        // never a positional prefix that may now contain newer edits.
        removePendingBatch(outbox, batch);
        outbox.retries = 0;
        if (typeof data.epoch === "number") {
          outbox.epoch = data.epoch;
          outbox.epochKnown = true;
        }
      }
    } else if (isAccessLoss(res.status)) {
      // Fatal: this session lost access. Drop the queue (it can never be
      // delivered) and stop every provider on this post, instead of spamming
      // the relay every retry interval.
      outbox.pending.length = 0;
      report("You no longer have edit access to this item.");
      for (const sub of outbox.subscribers.values()) {
        try {
          sub.onFatal?.();
        } catch {
          // teardown of one subscriber must not block the others
        }
      }
    } else if (isPermanentPushError(res.status)) {
      // This batch will never be accepted (malformed / too large). Drop just
      // it so it can never poison-pill the queue, and keep delivering the rest.
      removePendingBatch(outbox, batch);
      outbox.retries = 0;
      report("Some edits could not be synced and were dropped.");
    } else {
      // Transient (5xx / rate limit): keep the batch and back off.
      outbox.retries += 1;
      nextDelay = backoff(outbox.retries, PUSH_RETRY_MS, PUSH_MAX_RETRY_MS);
      report(`collab push failed (${res.status})`);
    }
  } catch (error) {
    // Network error: keep the batch and back off.
    outbox.retries += 1;
    nextDelay = backoff(outbox.retries, PUSH_RETRY_MS, PUSH_MAX_RETRY_MS);
    report(error instanceof Error ? error.message : "collab push failed");
  } finally {
    outbox.flushing = false;
    void persistOutbox(postId, outbox);
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

export class CollabProvider implements CollaborationTransport {
  readonly clientId: string;
  private lastSeq = 0;
  private stopped = false;
  private started = false;
  private startPromise: Promise<CollabStartResult> | null = null;
  private capturedLocalUpdate = false;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly base: string;
  private readonly outboxSubscriber = Symbol("collab-provider");
  private outbox: Outbox | null = null;
  // Aborts the in-flight 25s long-poll immediately on teardown so a destroyed
  // provider does not hold a connection open for up to the full wait window.
  private readonly abort = new AbortController();
  private pollRetries = 0;
  private baselineApplied = false;

  constructor(
    private readonly doc: Y.Doc,
    private readonly opts: CollabProviderOptions,
  ) {
    this.clientId = stableSessionClientId(opts.postId);
    this.base = `/api/collab/${encodeURIComponent(opts.postId)}`;
    this.onDocUpdate = this.onDocUpdate.bind(this);
    this.onAwarenessUpdate = this.onAwarenessUpdate.bind(this);
    this.onPageHide = this.onPageHide.bind(this);
    this.opts.awareness?.setLocalStateField("user", {
      name: opts.userName,
      color: opts.color,
      clientId: this.clientId,
    });
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
    this.opts.awareness?.on("update", this.onAwarenessUpdate);
    // A tab close aborts the async outbox flush mid-flight; sendBeacon on
    // pagehide gives any queued edits one last delivery that survives unload.
    if (this.opts.canPush && typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onPageHide);
    }

    const outbox = outboxFor(this.opts.postId, this.base);
    this.outbox = outbox;
    if (
      outbox.baselineRevision == null &&
      Number.isInteger(this.opts.expectedBaselineRevision)
    ) {
      outbox.baselineRevision = this.opts.expectedBaselineRevision ?? null;
    }
    outbox.subscribers.set(this.outboxSubscriber, {
      onError: this.opts.onError,
      // A push that 401/403s means this session lost access; tear down this
      // provider's poll + heartbeat loops too, not just the outbox.
      onFatal: () => this.stop(),
      // The generation was retired: signal the editor to remount onto a fresh
      // doc (which reseeds from posts.body), then stop this provider.
      onRetired: () => {
        this.opts.onRetired?.();
        this.stop();
      },
    });
    this.startPromise = this.finishStart(outbox);
    return this.startPromise;
  }

  /** Enqueue one complete, idempotent Yjs state update. Call this after an
   * authoritative empty catch-up so a new document has a durable baseline
   * before incremental edits are sent. */
  enqueueCurrentState(): void {
    if (!this.opts.canPush || this.stopped) return;
    const outbox = this.outbox ?? outboxFor(this.opts.postId, this.base);
    this.outbox = outbox;
    outbox.pending.push(Y.encodeStateAsUpdate(this.doc));
    void outbox.hydrated.then(() => persistOutbox(this.opts.postId, outbox));
    scheduleOutbox(this.opts.postId, outbox, 0);
  }

  destroy(): void {
    if (this.stopped) return; // already stopped (e.g. after an access-loss)
    // NOTE: do NOT beacon-flush here. destroy() is a React unmount with the tab
    // still open, where the module-level outbox survives and keeps flushing (or
    // a remount replays it); draining it here would defeat that. The beacon is
    // for pagehide only, where the whole JS context is going away.
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      navigator.sendBeacon(
        `${this.base}/presence`,
        JSON.stringify({ clientId: this.clientId, userName: this.opts.userName, color: this.opts.color, leave: true }),
      );
    }
    this.stop();
  }

  private onPageHide(): void {
    // A tab close / bfcache navigation aborts the async flush; sendBeacon is
    // the only push that survives unload.
    this.flushPendingViaBeacon();
  }

  /** Last-resort delivery of queued edits over sendBeacon (survives page
   * unload, when a normal fetch would be cancelled). A keepalive fetch carries
   * any over-limit tail or retries a rejected beacon. Delivered beacon updates
   * are dropped from the queue so a following normal flush cannot double-send
   * them. */
  private flushPendingViaBeacon(): void {
    if (
      !this.opts.canPush ||
      !this.outbox ||
      !this.outbox.epochKnown ||
      this.outbox.pending.length === 0 ||
      typeof navigator === "undefined" ||
      typeof navigator.sendBeacon !== "function"
    ) {
      return;
    }
    const batch = this.outbox.pending.slice(0, MAX_PUSH_BATCH);
    // sendBeacon silently drops an over-limit body. Instead of skipping the
    // whole batch (which loses every queued edit when the tab dies), deliver
    // the largest PREFIX that fits: updates are ordered, so a prefix is always
    // a consistent partial flush and strictly better than nothing. Size the
    // prefix analytically from the base64 lengths (envelope + per-item quotes
    // and comma) instead of re-stringifying per candidate.
    const encoded = batch.map(u8ToBase64);
    const envelope = JSON.stringify({ updates: [], epoch: this.outbox.epoch }).length;
    let fit = 0;
    let size = envelope;
    for (const b64 of encoded) {
      const next = size + b64.length + 3; // quotes + comma
      if (next > 60_000) break;
      size = next;
      fit += 1;
    }
    const keepalive = (updates: string[]) => {
      if (updates.length === 0) return;
      const payload = JSON.stringify({
        updates,
        epoch: this.outbox!.epoch,
      });
      try {
        fetch(this.base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Best-effort only. The page is already leaving.
      }
    };
    if (fit === 0) {
      keepalive(encoded);
      return;
    }
    // Fence the unload append on the same generation as the normal push, or a
    // retired post (epoch >= 1) would reject it (absent epoch is treated as 0).
    const payload = JSON.stringify({
      updates: encoded.slice(0, fit),
      epoch: this.outbox.epoch,
    });
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(this.base, blob)) {
      this.outbox.pending.splice(0, fit);
      void persistOutbox(this.opts.postId, this.outbox);
      keepalive(encoded.slice(fit));
    } else {
      keepalive(encoded);
    }
  }

  /** Tear down every loop and release shared state. Idempotent. Invoked by
   * destroy() (editor unmount) and by an access-loss (401/403) on any loop, so
   * a mid-session revoke stops the push/poll/heartbeat hammering at once. */
  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onPageHide);
    }
    if (this.started) this.doc.off("update", this.onDocUpdate);
    this.opts.awareness?.off("update", this.onAwarenessUpdate);
    if (this.awarenessTimer) {
      clearTimeout(this.awarenessTimer);
      this.awarenessTimer = null;
    }
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.outbox) {
      this.outbox.subscribers.delete(this.outboxSubscriber);
      releaseOutbox(this.opts.postId, this.outbox);
    }
    if (this.opts.awareness) {
      const remoteIds = Array.from(this.opts.awareness.getStates().keys());
      removeAwarenessStates(this.opts.awareness, remoteIds, "collab-stop");
    }
  }

  private onDocUpdate(update: Uint8Array, origin: unknown) {
    if (origin === REMOTE_ORIGIN) return; // do not echo what we just applied
    if (!this.opts.canPush) return; // viewers never write
    this.capturedLocalUpdate = true;
    const outbox = this.outbox ?? outboxFor(this.opts.postId, this.base);
    this.outbox = outbox;
    outbox.pending.push(update.slice());
    void outbox.hydrated.then(() => persistOutbox(this.opts.postId, outbox));
    scheduleOutbox(this.opts.postId, outbox, PUSH_DEBOUNCE_MS);
  }

  private onAwarenessUpdate(
    _changes: unknown,
    origin: unknown,
  ): void {
    if (this.stopped || origin === REMOTE_AWARENESS_ORIGIN) return;
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null;
      void this.heartbeat();
    }, 75);
  }

  private async finishStart(outbox: Outbox): Promise<CollabStartResult> {
    await outbox.hydrated;
    const hadPendingUpdates = outbox.pending.length > 0;
    const caughtUp = await this.catchUp();
    // A remounted editor gets every durable local operation after the canonical
    // baseline. This ordering prevents two independent seed histories from
    // duplicating the document when the device reconnects.
    for (const update of outbox.pending) {
      try {
        Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
      } catch {
        // Keep the row durable; a later app version may still understand it.
      }
    }
    if (outbox.epochKnown) scheduleOutbox(this.opts.postId, outbox, 0);
    const result: CollabStartResult = caughtUp.authoritative
      ? {
          authoritative: true,
          // Existing or newly captured local operations mean this is not a
          // pristine document that the unified editor may safely initialize.
          remoteEmpty:
            caughtUp.remoteEmpty &&
            !hadPendingUpdates &&
            !this.capturedLocalUpdate,
          baselineRevision: caughtUp.baselineRevision,
        }
      : caughtUp;

    if (this.stopped) return result;
    void this.pollLoop();
    void this.heartbeat();
    this.presenceTimer = setInterval(() => void this.heartbeat(), 8000);
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

  private applyBaseline(data: {
    update?: unknown;
    revision?: unknown;
  }): number | null {
    if (
      typeof data.update !== "string" ||
      !Number.isSafeInteger(data.revision) ||
      Number(data.revision) < 0
    ) {
      return null;
    }
    const revision = Number(data.revision);
    const outbox = this.outbox;
    if (
      outbox &&
      outbox.pending.length > 0 &&
      outbox.baselineRevision != null &&
      outbox.baselineRevision !== revision
    ) {
      this.opts.onBaselineMismatch?.(revision);
      this.opts.onError?.(
        "This document changed while this device was offline. Local edits were kept for recovery.",
      );
      this.stop();
      return null;
    }
    try {
      Y.applyUpdate(this.doc, base64ToU8(data.update), REMOTE_ORIGIN);
    } catch {
      return null;
    }
    this.baselineApplied = true;
    if (outbox) {
      outbox.baselineRevision = revision;
      void persistOutbox(this.opts.postId, outbox);
    }
    return revision;
  }

  private async catchUp(): Promise<CollabStartResult> {
    let sawRemoteUpdate = false;
    let baselineRevision: number | null = null;
    try {
      while (!this.stopped) {
        const previousSeq = this.lastSeq;
        const res = await fetch(`${this.base}?since=${previousSeq}&wait=0`, {
          signal: this.abort.signal,
        });
        if (isAccessLoss(res.status)) {
          this.opts.onError?.(accessLossMessage(res.status));
          this.stop();
          return { authoritative: false, remoteEmpty: false };
        }
        if (!res.ok) {
          return { authoritative: false, remoteEmpty: false };
        }
        const data = (await res.json()) as {
          updates?: unknown;
          seq?: unknown;
          epoch?: unknown;
          baseline?: { update?: unknown; revision?: unknown };
        };
        if (!Array.isArray(data.updates) || !Number.isSafeInteger(data.seq)) {
          return { authoritative: false, remoteEmpty: false };
        }
        if (!this.baselineApplied) {
          baselineRevision = this.applyBaseline(data.baseline ?? {});
          if (baselineRevision == null) {
            return { authoritative: false, remoteEmpty: false };
          }
        }
        // Record the generation we are catching up under; every push is fenced
        // on it so a stale offline flush after a retirement is rejected. A
        // shared outbox that already knows a different epoch contains edits
        // from the retired document and must be discarded, never relabeled as
        // belonging to the new generation.
        if (this.outbox) {
          const responseEpoch =
            typeof data.epoch === "number" &&
            Number.isSafeInteger(data.epoch) &&
            data.epoch >= 0
              ? data.epoch
              : 0;
          if (this.outbox.epochKnown && responseEpoch !== this.outbox.epoch) {
            retireOutbox(this.outbox, responseEpoch);
            return { authoritative: false, remoteEmpty: false };
          }
          this.outbox.epoch = responseEpoch;
          this.outbox.epochKnown = true;
          scheduleOutbox(this.opts.postId, this.outbox, 0);
        }
        if (data.updates.length === 0) {
          return {
            authoritative: true,
            remoteEmpty:
              !sawRemoteUpdate && previousSeq === 0 && data.seq === 0,
            baselineRevision: baselineRevision ?? 0,
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

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async pollLoop() {
    while (!this.stopped) {
      try {
        const res = await fetch(`${this.base}?since=${this.lastSeq}&wait=25`, {
          signal: this.abort.signal,
        });
        if (isAccessLoss(res.status)) {
          this.opts.onError?.(accessLossMessage(res.status));
          this.stop();
          return;
        }
        if (!res.ok) {
          this.pollRetries += 1;
          await this.sleep(backoff(this.pollRetries, POLL_RETRY_MS, POLL_MAX_RETRY_MS));
          continue;
        }
        this.pollRetries = 0;
        const data = (await res.json()) as {
          updates: Array<{ seq: number; update: string }>;
          seq: number;
          epoch?: number;
          baseline?: { update?: unknown; revision?: unknown };
        };
        if (!this.baselineApplied && this.lastSeq === 0) {
          const revision = this.applyBaseline(data.baseline ?? {});
          if (revision == null) {
            if (this.stopped) return;
            this.pollRetries += 1;
            await this.sleep(
              backoff(this.pollRetries, POLL_RETRY_MS, POLL_MAX_RETRY_MS),
            );
            continue;
          }
        }
        // Epoch handling. If we never recorded an epoch (a transient catch-up
        // failure), LEARN it from the poll rather than mistake it for a change.
        // Once known, a different epoch means the generation was retired under
        // us: our Y.Doc is based on the retired epoch, so do NOT apply the new
        // epoch's rows (that would corrupt it); signal a remount and stop.
        if (!this.stopped && this.outbox && typeof data.epoch === "number") {
          if (!this.outbox.epochKnown) {
            this.outbox.epoch = data.epoch;
            this.outbox.epochKnown = true;
            scheduleOutbox(this.opts.postId, this.outbox, 0);
          } else if (data.epoch !== this.outbox.epoch) {
            retireOutbox(this.outbox, data.epoch);
            return;
          }
        }
        // Same corruption-tolerant path as catchUp: applyRow advances past a
        // row even if applying it throws, so one bad update can never stall
        // the loop by making it re-fetch the same seq forever.
        for (const row of data.updates) this.applyRow(row);
      } catch (error) {
        // A torn-down provider's aborted fetch is expected, not a failure.
        if (this.stopped || (error as { name?: string })?.name === "AbortError") return;
        this.pollRetries += 1;
        await this.sleep(backoff(this.pollRetries, POLL_RETRY_MS, POLL_MAX_RETRY_MS));
      }
    }
  }

  private async heartbeat() {
    try {
      const awareness = this.opts.awareness;
      const awarenessPayload = awareness
        ? u8ToBase64(
            encodeAwarenessUpdate(awareness, [awareness.clientID]),
          )
        : null;
      const res = await fetch(`${this.base}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: this.clientId,
          userName: this.opts.userName,
          color: this.opts.color,
          awareness: awarenessPayload,
        }),
        signal: this.abort.signal,
      });
      if (isAccessLoss(res.status)) {
        this.opts.onError?.(accessLossMessage(res.status));
        this.stop();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { presence: PresencePeer[] };
      if (awareness) {
        const activeClientIds = new Set(
          data.presence.map((peer) => peer.clientId),
        );
        for (const peer of data.presence) {
          if (peer.clientId === this.clientId || !peer.awareness) continue;
          try {
            applyAwarenessUpdate(
              awareness,
              base64ToU8(peer.awareness),
              REMOTE_AWARENESS_ORIGIN,
            );
          } catch {
            // One invalid ephemeral update must not block other collaborators.
          }
        }
        const staleAwarenessIds: number[] = [];
        for (const [clientId, state] of awareness.getStates()) {
          if (clientId === awareness.clientID) continue;
          const sessionClientId =
            typeof state.user === "object" && state.user
              ? (state.user as { clientId?: unknown }).clientId
              : null;
          if (
            typeof sessionClientId === "string" &&
            !activeClientIds.has(sessionClientId)
          ) {
            staleAwarenessIds.push(clientId);
          }
        }
        if (staleAwarenessIds.length > 0) {
          removeAwarenessStates(
            awareness,
            staleAwarenessIds,
            REMOTE_AWARENESS_ORIGIN,
          );
        }
      }
      this.opts.onPresence?.(
        data.presence.filter((peer) => peer.clientId !== this.clientId),
      );
    } catch {
      // presence is best-effort (an aborted heartbeat on teardown is expected)
    }
  }
}
