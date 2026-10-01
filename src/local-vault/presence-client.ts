import { decodePresenceAwareness, encodePresenceAwareness } from "@/lib/collab/presence-awareness";
import type { PresencePeer } from "@/lib/collab/provider";
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates, type Awareness } from "y-protocols/awareness";

export type FilePresenceMethod = "presenceRead" | "presenceJoin" | "presenceUpdate" | "presenceLeave";
export type FilePresenceRequest = (method: FilePresenceMethod, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
type Session = { clientId: string; sessionCredential: string; expiresAt: number };
type Result = { epoch: number; presence: PresencePeer[]; session?: Session };
type Options = {
  itemId: string;
  awareness: Awareness;
  request: FilePresenceRequest;
  onPresence: (peers: PresencePeer[]) => void;
  onAccessLost?: () => void;
  onEpochChanged?: () => void;
};

const HEARTBEAT_MS = 10_000;
const PEER_POLL_MS = 3_000;
const CURSOR_MIN_MS = 500;
const REMOTE_ORIGIN = "file-vault-presence-remote";
function encode(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
function decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function status(error: unknown) {
  if (!error || typeof error !== "object") return 0;
  const candidate = error as { status?: number; code?: string };
  return candidate.status ?? (Number(candidate.code) || 0);
}
function validResult(value: unknown): value is Result {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<Result>;
  return Number.isSafeInteger(result.epoch) && Number(result.epoch) >= 1 && Array.isArray(result.presence) && result.presence.length <= 32;
}
function validSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  return typeof session.clientId === "string" && /^p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.clientId) &&
    typeof session.sessionCredential === "string" && session.sessionCredential.startsWith("v1:") &&
    Number.isSafeInteger(session.expiresAt) && Number(session.expiresAt) > Date.now();
}
function peersEqual(left: readonly PresencePeer[], right: readonly PresencePeer[]) {
  return left.length === right.length && left.every((peer, index) => {
    const next = right[index];
    return peer.clientId === next.clientId && peer.userName === next.userName &&
      peer.color === next.color && peer.role === next.role && peer.awareness === next.awareness;
  });
}

/** One visible item owns one short-lived presence session. The idle solo path
 * makes only its 10-second heartbeat; quick cursor reads run while peers exist. */
export class FilePresenceClient {
  private active = false;
  private destroyed = false;
  private fenced = false;
  private generation = 0;
  private abort = new AbortController();
  private session: Session | null = null;
  private epoch: number | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatPending = false;
  private pollPending = false;
  private cursorDirty = false;
  private peers: PresencePeer[] = [];
  private lastSentAt = 0;
  private sequence = 0;
  private appliedSequence = 0;
  private remoteIds = new Map<string, { sourceId: number; localId: number }>();
  private nextRemoteId = 0x100000000;

  constructor(private readonly options: Options) {
    this.onAwarenessUpdate = this.onAwarenessUpdate.bind(this);
    options.awareness.on("update", this.onAwarenessUpdate);
  }
  setActive(active: boolean) {
    if (this.destroyed || (active && this.fenced) || active === this.active) return;
    this.active = active;
    this.generation += 1;
    if (!active) {
      this.clearTimers();
      this.abort.abort();
      this.abort = new AbortController();
      const closing = this.session;
      this.session = null;
      this.epoch = null;
      this.clearPeers();
      this.options.awareness.setLocalStateField("selection", null);
      if (closing) void this.options.request("presenceLeave", { itemId: this.options.itemId,
        clientId: closing.clientId, sessionCredential: closing.sessionCredential }).catch(() => {});
      return;
    }
    if (this.heartbeatPending) this.heartbeatTimer = setTimeout(() => { this.heartbeatTimer = null; void this.heartbeat(); }, 100);
    else void this.heartbeat();
  }
  destroy() {
    if (this.destroyed) return;
    this.setActive(false);
    this.destroyed = true;
    this.options.awareness.off("update", this.onAwarenessUpdate);
  }
  private clearTimers() {
    for (const timer of [this.heartbeatTimer, this.pollTimer, this.cursorTimer]) if (timer) clearTimeout(timer);
    this.heartbeatTimer = this.pollTimer = this.cursorTimer = null;
  }
  private clearPeers() {
    const ids = [...this.remoteIds.values()].map(value => value.localId);
    if (ids.length) {
      removeAwarenessStates(this.options.awareness, ids, REMOTE_ORIGIN);
      for (const id of ids) this.options.awareness.meta.delete(id);
    }
    this.remoteIds.clear();
    this.peers = [];
    this.options.onPresence([]);
  }
  private onAwarenessUpdate(_changes: unknown, origin: unknown) {
    if (!this.active || origin === REMOTE_ORIGIN || this.peers.length === 0) return;
    this.cursorDirty = true;
    this.scheduleCursor();
  }
  private scheduleCursor() {
    if (!this.active || !this.cursorDirty || this.cursorTimer) return;
    const delay = Math.max(120, CURSOR_MIN_MS - (Date.now() - this.lastSentAt));
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      if (this.heartbeatPending) return;
      this.cursorDirty = false;
      void this.heartbeat();
    }, delay);
  }
  private scheduleHeartbeat() {
    if (!this.active) return;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => { this.heartbeatTimer = null; void this.heartbeat(); }, HEARTBEAT_MS);
  }
  private schedulePeerPoll() {
    if (!this.active || this.peers.length === 0 || this.pollTimer) return;
    this.pollTimer = setTimeout(() => { this.pollTimer = null; void this.poll(); }, PEER_POLL_MS);
  }
  private async heartbeat() {
    if (!this.active || this.heartbeatPending) return;
    this.heartbeatPending = true;
    const generation = this.generation, signal = this.abort.signal;
    const current = () => this.active && generation === this.generation && !signal.aborted;
    try {
      if (!this.session || this.session.expiresAt <= Date.now()) {
        const joined = await this.options.request("presenceJoin", { itemId: this.options.itemId, awarenessClientId: this.options.awareness.clientID }, signal);
        if (!current() || !validResult(joined) || !validSession(joined.session)) return;
        this.session = joined.session;
        this.epoch = joined.epoch;
        this.options.awareness.setLocalStateField("user", { clientId: joined.session.clientId });
      }
      if (!current() || !this.session) return;
      const sequence = ++this.sequence;
      const awareness = encode(encodeAwarenessUpdate(this.options.awareness, [this.options.awareness.clientID]));
      const result = await this.options.request("presenceUpdate", { itemId: this.options.itemId,
        clientId: this.session.clientId, sessionCredential: this.session.sessionCredential, awareness }, signal);
      this.lastSentAt = Date.now();
      if (current() && validResult(result) && sequence >= this.appliedSequence) this.applyPresence(result, sequence);
    } catch (error) { this.handleError(error); }
    finally {
      this.heartbeatPending = false;
      if (current()) {
        this.scheduleHeartbeat();
        if (this.cursorDirty) this.scheduleCursor();
      }
    }
  }
  private async poll() {
    if (!this.active || this.pollPending || this.peers.length === 0) return;
    this.pollPending = true;
    const generation = this.generation, signal = this.abort.signal, sequence = ++this.sequence;
    try {
      const result = await this.options.request("presenceRead", { itemId: this.options.itemId }, signal);
      if (this.active && generation === this.generation && !signal.aborted && validResult(result) && sequence >= this.appliedSequence) this.applyPresence(result, sequence);
    } catch (error) { this.handleError(error); }
    finally {
      this.pollPending = false;
      if (this.active && generation === this.generation) this.schedulePeerPoll();
    }
  }
  private handleError(error: unknown) {
    if (!this.active) return;
    const code = status(error);
    if (code === 401 || code === 403 || code === 404 || code === 410) {
      this.fenced = true;
      this.setActive(false);
      this.options.onAccessLost?.();
    } else if (code === 409) {
      this.fenced = true;
      this.setActive(false);
      this.options.onEpochChanged?.();
    }
  }
  private applyPresence(result: Result, sequence: number) {
    if (this.epoch !== null && result.epoch !== this.epoch) {
      this.fenced = true;
      this.setActive(false);
      this.options.onEpochChanged?.();
      return;
    }
    this.appliedSequence = sequence;
    const peers = result.presence.filter(peer => peer && typeof peer.clientId === "string" &&
      peer.clientId !== this.session?.clientId && typeof peer.userName === "string" &&
      typeof peer.color === "string" && /^#[0-9a-f]{6}$/i.test(peer.color));
    const activeIds = new Set(peers.map(peer => peer.clientId));
    for (const peer of peers) {
      if (!peer.awareness) continue;
      try {
        const decoded = decodePresenceAwareness(peer.awareness);
        const user = decoded.state?.user;
        if (!user || typeof user !== "object" || (user as { clientId?: unknown }).clientId !== peer.clientId) continue;
        let identity = this.remoteIds.get(peer.clientId);
        if (!identity || identity.sourceId !== decoded.clientId) {
          if (identity) {
            removeAwarenessStates(this.options.awareness, [identity.localId], REMOTE_ORIGIN);
            this.options.awareness.meta.delete(identity.localId);
          }
          while (this.nextRemoteId === this.options.awareness.clientID || this.options.awareness.meta.has(this.nextRemoteId)) this.nextRemoteId += 1;
          identity = { sourceId: decoded.clientId, localId: this.nextRemoteId++ };
          this.remoteIds.set(peer.clientId, identity);
        }
        applyAwarenessUpdate(this.options.awareness,
          decode(encodePresenceAwareness(identity.localId, decoded.clock, decoded.state)), REMOTE_ORIGIN);
      } catch { /* A malformed peer cannot suppress other people. */ }
    }
    for (const [sessionId, identity] of this.remoteIds) {
      if (activeIds.has(sessionId)) continue;
      removeAwarenessStates(this.options.awareness, [identity.localId], REMOTE_ORIGIN);
      this.options.awareness.meta.delete(identity.localId);
      this.remoteIds.delete(sessionId);
    }
    if (!peersEqual(this.peers, peers)) {
      this.peers = peers;
      this.options.onPresence(peers);
    }
    if (peers.length) this.schedulePeerPoll();
    else if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
  }
}
