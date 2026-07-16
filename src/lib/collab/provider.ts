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
const PUSH_MAX_RETRY_MS = 30_000;
const POLL_RETRY_MS = 2000;
const POLL_MAX_RETRY_MS = 30_000;
const MAX_PUSH_BATCH = 64;

/** 401/403: this session no longer has access to the post. Retrying is futile
 * and just hammers the server, so every collab loop must stop hard. */
function isAccessLoss(status: number): boolean {
  return status === 401 || status === 403;
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
  /** The server retired this document's log generation (its stale between-
   * sessions log was reset from posts.body). The local Y.Doc is now stale and
   * must be rebuilt: the editor discards it and remounts a fresh doc that
   * re-catches-up and reseeds. Any un-materialized local edit is intentionally
   * dropped rather than merged over the authoritative body. */
  onRetired?: () => void;
};

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
    retries: 0,
    epoch: 0,
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
  let nextDelay = PUSH_DEBOUNCE_MS;
  try {
    const res = await fetch(outbox.base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: batch.map(u8ToBase64), epoch: outbox.epoch }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        retired?: boolean;
        epoch?: number;
      };
      if (data.retired) {
        // The log generation was retired (a stale between-sessions log reset from
        // posts.body). This client's queued edits are now stale: drop them so
        // they can never merge over the reseeded body, and tell every provider on
        // this post to remount onto a fresh doc.
        outbox.pending.length = 0;
        if (typeof data.epoch === "number") outbox.epoch = data.epoch;
        for (const sub of outbox.subscribers.values()) {
          try {
            sub.onRetired?.();
          } catch {
            // teardown of one subscriber must not block the others
          }
        }
      } else {
        outbox.pending.splice(0, batch.length);
        outbox.retries = 0;
        if (typeof data.epoch === "number") outbox.epoch = data.epoch;
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
      outbox.pending.splice(0, batch.length);
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
  // Aborts the in-flight 25s long-poll immediately on teardown so a destroyed
  // provider does not hold a connection open for up to the full wait window.
  private readonly abort = new AbortController();
  private pollRetries = 0;

  constructor(
    private readonly doc: Y.Doc,
    private readonly opts: CollabProviderOptions,
  ) {
    this.clientId = stableSessionClientId(opts.postId);
    this.base = `/api/collab/${encodeURIComponent(opts.postId)}`;
    this.onDocUpdate = this.onDocUpdate.bind(this);
    this.onPageHide = this.onPageHide.bind(this);
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
    // A tab close aborts the async outbox flush mid-flight; sendBeacon on
    // pagehide gives any queued edits one last delivery that survives unload.
    if (this.opts.canPush && typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onPageHide);
    }

    const outbox = outboxFor(this.opts.postId, this.base);
    this.outbox = outbox;
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
    if (this.stopped) return; // already stopped (e.g. after an access-loss)
    // NOTE: do NOT beacon-flush here. destroy() is a React unmount with the tab
    // still open, where the module-level outbox survives and keeps flushing (or
    // a remount replays it); draining it here would defeat that. The beacon is
    // for pagehide only, where the whole JS context is going away.
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
    this.stop();
  }

  private onPageHide(): void {
    // A tab close / bfcache navigation aborts the async flush; sendBeacon is
    // the only push that survives unload.
    this.flushPendingViaBeacon();
  }

  /** Last-resort delivery of queued edits over sendBeacon (survives page
   * unload, when a normal fetch would be cancelled). Best-effort: the server
   * appends what it receives; if the payload exceeds the beacon limit it is
   * left in the outbox for the next normal flush. Delivered updates are dropped
   * from the queue so a following normal flush cannot double-send them. */
  private flushPendingViaBeacon(): void {
    if (
      !this.opts.canPush ||
      !this.outbox ||
      this.outbox.pending.length === 0 ||
      typeof navigator === "undefined" ||
      typeof navigator.sendBeacon !== "function"
    ) {
      return;
    }
    const batch = this.outbox.pending.slice(0, MAX_PUSH_BATCH);
    const payload = JSON.stringify({ updates: batch.map(u8ToBase64) });
    // sendBeacon silently drops an over-limit body; skip so the normal flush
    // (which chunks and retries) still owns those bytes.
    if (payload.length > 60_000) return;
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(this.base, blob)) {
      this.outbox.pending.splice(0, batch.length);
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
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.outbox) {
      this.outbox.subscribers.delete(this.outboxSubscriber);
      releaseOutbox(this.opts.postId, this.outbox);
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
        const res = await fetch(`${this.base}?since=${previousSeq}&wait=0`, {
          signal: this.abort.signal,
        });
        if (isAccessLoss(res.status)) {
          this.opts.onError?.("You no longer have access to this item.");
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
        };
        if (!Array.isArray(data.updates) || !Number.isSafeInteger(data.seq)) {
          return { authoritative: false, remoteEmpty: false };
        }
        // Record the generation we are catching up under; every push is fenced
        // on it so a stale offline flush after a retirement is rejected.
        if (this.outbox && typeof data.epoch === "number") {
          this.outbox.epoch = data.epoch;
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
          this.opts.onError?.("You no longer have access to this item.");
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
        };
        // The generation changed under us: our Y.Doc is based on the retired
        // epoch. Do NOT apply the new epoch's rows into it (that would corrupt
        // it); signal a remount onto a fresh doc and stop.
        if (
          !this.stopped &&
          this.outbox &&
          typeof data.epoch === "number" &&
          data.epoch !== this.outbox.epoch
        ) {
          this.opts.onRetired?.();
          this.stop();
          return;
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
      const res = await fetch(`${this.base}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: this.clientId, userName: this.opts.userName, color: this.opts.color }),
        signal: this.abort.signal,
      });
      if (isAccessLoss(res.status)) {
        this.opts.onError?.("You no longer have access to this item.");
        this.stop();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { presence: PresencePeer[] };
      this.opts.onPresence?.(data.presence);
    } catch {
      // presence is best-effort (an aborted heartbeat on teardown is expected)
    }
  }
}
