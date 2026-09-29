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
const REFRESH_MS = 30_000;
const ACTIVE_WINDOW_MS = 2 * 60_000;

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

/** One foreground loop per mounted owner scope, independent of transcript renders. */
export function startAssistantConversationSync({ storeKey, assistantVisible: initiallyVisible, sync, onStatus, isCurrent }: Options) {
  let disposed = false;
  let inFlight = false;
  let assistantVisible = initiallyVisible;
  let failures = 0;
  let lastInteractionAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
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
        if (uploading && assistantConversationLocalRevision(storeKey) === sentRevision) localOnlyRevision = sentRevision;
        status("local");
        return;
      }
      acknowledgeAssistantConversationSync(storeKey, result.conversations);
      revision = assistantConversationLocalRevision(storeKey);
      failures = 0;
      const stillLocal = needsUpload();
      if (stillLocal && assistantConversationLocalRevision(storeKey) === sentRevision) localOnlyRevision = sentRevision;
      else if (!stillLocal) localOnlyRevision = null;
      status(!online() ? "offline" : stillLocal ? "local" : "synced");
      if (pendingUpload()) schedule(DEBOUNCE_MS);
    } catch {
      if (!current()) return;
      status(online() ? "error" : "offline");
      if (assistantConversationLocalRevision(storeKey) !== sentRevision) failures = 0;
      const delay = ASSISTANT_HISTORY_RETRY_MS[failures++];
      if ((assistantVisible || pendingUpload()) && delay !== undefined) schedule(delay);
    } finally {
      inFlight = false;
    }
  }

  function refresh() {
    lastInteractionAt = Date.now();
    if (!current()) return;
    if (!online()) { clear(); status("offline"); return; }
    if (!foreground() || inFlight || (!assistantVisible && !pendingUpload())) return;
    failures = 0;
    void run();
  }
  function visibilityChanged() {
    if (foreground()) {
      if (assistantVisible) startPolling();
      refresh();
    } else {
      clear();
      stopPolling();
    }
  }
  function interacted() {
    if (!assistantVisible) return;
    const wasIdle = Date.now() - lastInteractionAt >= ACTIVE_WINDOW_MS;
    lastInteractionAt = Date.now();
    if (wasIdle && !timer && !inFlight && !failures) refresh();
  }
  function offline() { clear(); status("offline"); }
  const unsubscribe = subscribeAssistantConversations(() => {
    if (!current()) return;
    const next = assistantConversationLocalRevision(storeKey);
    if (next === revision) return;
    revision = next;
    localOnlyRevision = null;
    lastInteractionAt = Date.now();
    if (inFlight) return; // Completion checks the merged replica for newer edits.
    failures = 0;
    status(!online() ? "offline" : needsUpload() ? "local" : "synced");
    if (pendingUpload()) schedule(DEBOUNCE_MS);
  });
  window.addEventListener("pointerdown", interacted);
  window.addEventListener("keydown", interacted);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", visibilityChanged);
  function poll() {
    // An unattended visible window must stop waking the database. Local edits
    // still flush independently; interaction resumes remote-history discovery.
    // Polling must not bypass backoff or restart an exhausted dirty revision.
    if (current() && assistantVisible && foreground() && online() && !inFlight && !timer &&
      Date.now() - lastInteractionAt < ACTIVE_WINDOW_MS && !failures) {
      void run();
    }
  }
  function startPolling() {
    if (interval === undefined) interval = setInterval(poll, REFRESH_MS);
  }
  function stopPolling() {
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
  }
  if (assistantVisible && foreground()) startPolling();
  status(!online() ? "offline" : needsUpload() ? "local" : "synced");
  schedule(DEBOUNCE_MS);
  return {
    retry: refresh,
    setAssistantVisible(visible: boolean) {
      if (assistantVisible === visible) return;
      assistantVisible = visible;
      if (visible) {
        if (foreground()) startPolling();
        refresh();
      } else {
        stopPolling();
        if (!pendingUpload()) clear();
      }
    },
    dispose() {
      disposed = true;
      clear();
      stopPolling();
      unsubscribe();
      window.removeEventListener("pointerdown", interacted);
      window.removeEventListener("keydown", interacted);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibilityChanged);
      // Next Server Actions expose no AbortSignal. Fence the pending completion
      // so it cannot merge, acknowledge, publish status, or schedule more work.
    },
  };
}
