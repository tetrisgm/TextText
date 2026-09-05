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

type Options = {
  storeKey: string;
  sync: (local: SyncedAssistantConversation[]) => Promise<{
    allowed: boolean;
    conversations: SyncedAssistantConversation[];
  }>;
  onStatus: (status: AssistantHistorySyncStatus) => void;
  /** Commit-time owner fence, in addition to effect cleanup. */
  isCurrent: () => boolean;
};

/** One foreground loop per mounted owner scope, independent of transcript renders. */
export function startAssistantConversationSync({ storeKey, sync, onStatus, isCurrent }: Options) {
  let disposed = false;
  let inFlight = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = assistantConversationLocalRevision(storeKey);
  const current = () => !disposed && isCurrent();
  const online = () => navigator.onLine !== false;
  const foreground = () => document.visibilityState !== "hidden";
  const dirty = () => assistantConversationsNeedSync(storeKey);
  const status = (value: AssistantHistorySyncStatus) => { if (current()) onStatus(value); };
  const clear = () => { clearTimeout(timer); timer = undefined; };

  function schedule(delay: number) {
    clear();
    if (!current() || !online() || !foreground()) return;
    timer = setTimeout(() => { timer = undefined; void run(); }, delay);
  }

  async function run() {
    if (!current() || inFlight || !foreground()) return;
    if (!online()) { status("offline"); return; }
    clear();
    inFlight = true;
    status("syncing");
    const sentRevision = assistantConversationLocalRevision(storeKey);
    try {
      const result = await sync(assistantConversationSyncPayload(storeKey));
      if (!current()) return;
      // The action fails closed for both access denial and transient server errors.
      if (!result.allowed) throw new Error("History sync unavailable");
      acknowledgeAssistantConversationSync(storeKey, result.conversations);
      revision = assistantConversationLocalRevision(storeKey);
      failures = 0;
      status(!online() ? "offline" : dirty() ? "local" : "synced");
      if (dirty()) schedule(DEBOUNCE_MS);
    } catch {
      if (!current()) return;
      status(online() ? "error" : "offline");
      if (assistantConversationLocalRevision(storeKey) !== sentRevision) failures = 0;
      const delay = ASSISTANT_HISTORY_RETRY_MS[failures++];
      if (dirty() && delay !== undefined) schedule(delay);
    } finally {
      inFlight = false;
    }
  }

  function refresh() {
    if (!current()) return;
    if (!online()) { clear(); status("offline"); return; }
    if (!foreground() || inFlight) return;
    failures = 0;
    void run();
  }
  function visibilityChanged() {
    if (foreground()) refresh();
    else clear();
  }
  function offline() { clear(); status("offline"); }
  const unsubscribe = subscribeAssistantConversations(() => {
    if (!current()) return;
    const next = assistantConversationLocalRevision(storeKey);
    if (next === revision) return;
    revision = next;
    if (inFlight) return; // Completion checks the merged replica for newer edits.
    failures = 0;
    status(!online() ? "offline" : dirty() ? "local" : "synced");
    if (dirty()) schedule(DEBOUNCE_MS);
  });
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", visibilityChanged);
  const interval = setInterval(() => {
    // Do not let polling bypass backoff or restart an exhausted dirty revision.
    if (current() && foreground() && online() && !inFlight && !timer && !(dirty() && failures)) {
      void run();
    }
  }, REFRESH_MS);
  status(!online() ? "offline" : dirty() ? "local" : "synced");
  schedule(DEBOUNCE_MS);
  return {
    retry: refresh,
    dispose() {
      disposed = true;
      clear();
      clearInterval(interval);
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibilityChanged);
      // Next Server Actions expose no AbortSignal. Fence the pending completion
      // so it cannot merge, acknowledge, publish status, or schedule more work.
    },
  };
}
