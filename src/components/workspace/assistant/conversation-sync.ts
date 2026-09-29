import type { SyncedAssistantConversation } from "@/lib/ai/assistant-conversation-sync";
import {
  acknowledgeAssistantConversationSync,
  assistantConversationLocalRevision,
  assistantConversationsNeedSync,
  assistantConversationSyncPayload,
  subscribeAssistantConversations,
} from "./conversation-store";

export type AssistantHistorySyncStatus = "local" | "syncing" | "synced" | "offline" | "error";
export const ASSISTANT_HISTORY_RETRY_MS = [1000, 2000, 4000, 8000, 16000] as const;
const DEBOUNCE_MS = 900;
const STALE_READ_MS = 5 * 60_000;

type Options = {
  storeKey: string;
  assistantVisible: boolean;
  sync: (local: SyncedAssistantConversation[]) => Promise<{
    allowed: boolean;
    /** Set when the server failed rather than refused; only then is a retry due. */
    transient?: boolean;
    conversations: SyncedAssistantConversation[];
  }>;
  onStatus: (status: AssistantHistorySyncStatus) => void;
  /** Commit-time owner fence, in addition to effect cleanup. */
  isCurrent: () => boolean;
};

/** Event-driven owner sync. Idle history never starts a recurring cloud request. */
export function startAssistantConversationSync({ storeKey, assistantVisible: initiallyVisible, sync, onStatus, isCurrent }: Options) {
  let disposed = false;
  let inFlight = false;
  let assistantVisible = initiallyVisible;
  let failures = 0;
  let lastReadAt = 0;
  let remotePending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = assistantConversationLocalRevision(storeKey);
  let localOnlyRevision: number | null = null;
  const current = () => !disposed && isCurrent();
  const online = () => navigator.onLine !== false;
  const foreground = () => document.visibilityState !== "hidden";
  const dirty = () => assistantConversationsNeedSync(storeKey);
  // A new empty chat changes the local revision but is not shared history.
  const needsUpload = () => dirty() && assistantConversationSyncPayload(storeKey).length > 0;
  // A successful server response may omit a local-only approval. Retry that
  // replica after a real edit, not on every remote-history poll.
  const pendingUpload = () => needsUpload() && assistantConversationLocalRevision(storeKey) !== localOnlyRevision;
  const status = (value: AssistantHistorySyncStatus) => { if (current()) onStatus(value); };
  const clear = () => { clearTimeout(timer); timer = undefined; };

  function schedule(delay: number) {
    clear();
    if (!current() || !online() || !foreground() || (!assistantVisible && !pendingUpload())) return;
    timer = setTimeout(() => { timer = undefined; void run(); }, delay);
  }

  async function run() {
    if (!current() || inFlight || !foreground()) return;
    if (!online()) { status("offline"); return; }
    const uploading = pendingUpload();
    if (!assistantVisible && !uploading) return;
    clear();
    inFlight = true;
    remotePending = false;
    // A clean remote-history read must not flash Syncing/Synced in the rail.
    if (uploading) status("syncing");
    const sentRevision = assistantConversationLocalRevision(storeKey);
    try {
      const result = await sync(uploading ? assistantConversationSyncPayload(storeKey) : []);
      if (!current()) return;
      if (!result.allowed) {
        // A server failure is retried below; a refusal (a collaborator, a
        // capability viewer) is final: history stays on this device, quietly.
        if (result.transient) throw new Error("History sync unavailable");
        failures = 0;
        lastReadAt = Date.now();
        if (uploading && assistantConversationLocalRevision(storeKey) === sentRevision) localOnlyRevision = sentRevision;
        status("local");
        return;
      }
      acknowledgeAssistantConversationSync(storeKey, result.conversations);
      lastReadAt = Date.now();
      revision = assistantConversationLocalRevision(storeKey);
      failures = 0;
      const stillLocal = needsUpload();
      if (stillLocal && assistantConversationLocalRevision(storeKey) === sentRevision) localOnlyRevision = sentRevision;
      else if (!stillLocal) localOnlyRevision = null;
      status(!online() ? "offline" : stillLocal ? "local" : "synced");
      if (pendingUpload()) schedule(DEBOUNCE_MS);
    } catch {
      if (!current()) return;
      remotePending = true;
      status(online() ? "error" : "offline");
      if (assistantConversationLocalRevision(storeKey) !== sentRevision) failures = 0;
      const delay = ASSISTANT_HISTORY_RETRY_MS[failures++];
      if ((assistantVisible || pendingUpload()) && delay !== undefined) schedule(delay);
    } finally {
      inFlight = false;
      if (remotePending && !timer && failures === 0 && assistantVisible) schedule(0);
    }
  }

  function refresh(force = false) {
    if (!current()) return;
    if (!online()) { clear(); status("offline"); return; }
    if (!foreground() || inFlight || (!assistantVisible && !pendingUpload())) return;
    if (!force && !pendingUpload() && !remotePending && Date.now() - lastReadAt < STALE_READ_MS) return;
    if (!force && failures > 0 && timer) return;
    failures = 0;
    void run();
  }
  function visibilityChanged() {
    if (foreground()) {
      refresh();
    } else {
      clear();
    }
  }
  const focused = () => refresh();
  const reconnected = () => refresh(true);
  function offline() { clear(); status("offline"); }
  const unsubscribe = subscribeAssistantConversations(() => {
    if (!current()) return;
    const next = assistantConversationLocalRevision(storeKey);
    if (next === revision) return;
    revision = next;
    localOnlyRevision = null;
    if (inFlight) return; // Completion checks the merged replica for newer edits.
    failures = 0;
    status(!online() ? "offline" : needsUpload() ? "local" : "synced");
    if (pendingUpload()) schedule(DEBOUNCE_MS);
  });
  window.addEventListener("focus", focused);
  window.addEventListener("online", reconnected);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", visibilityChanged);
  status(!online() ? "offline" : needsUpload() ? "local" : "synced");
  schedule(DEBOUNCE_MS);
  return {
    retry: () => refresh(true),
    remoteChanged() {
      if (!current()) return;
      remotePending = true;
      if (assistantVisible && foreground() && online() && !inFlight) refresh(true);
    },
    setAssistantVisible(visible: boolean) {
      if (assistantVisible === visible) return;
      assistantVisible = visible;
      if (visible) {
        refresh();
      } else {
        if (!pendingUpload()) clear();
      }
    },
    dispose() {
      disposed = true;
      clear();
      unsubscribe();
      window.removeEventListener("focus", focused);
      window.removeEventListener("online", reconnected);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibilityChanged);
      // Next Server Actions expose no AbortSignal. Fence the pending completion
      // so it cannot merge, acknowledge, publish status, or schedule more work.
    },
  };
}
