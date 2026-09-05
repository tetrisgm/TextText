// A read-only look at the persisted conversation replica.
//
// The rail renders a static shell before its controller loads. That shell
// shows the idle greeting, which is right for a workspace with no active
// chat. A returning owner whose active chat already holds messages would
// otherwise see the greeting for a few seconds and then their messages, so
// the shell peeks at the replica and, when messages are waiting, loads the
// controller at once. The replica's key is owner-scoped (see
// migrateAssistantConversationOwnerScope in conversation-store), so the
// scan matches every replica for the handle rather than computing the key.

const REPLICA_PREFIX = "texttext:assistant-conversations:v1:";

/** Pure: does this raw replica's active chat for the context hold messages? */
export function replicaHasActiveMessages(
  raw: string | null,
  contextKey: string,
): boolean {
  if (!raw) return false;
  try {
    const stored = JSON.parse(raw) as {
      conversations?: Array<{ id?: unknown; messages?: unknown }>;
      activeByContext?: Record<string, unknown>;
    };
    const activeId = stored.activeByContext?.[contextKey];
    if (typeof activeId !== "string" || !Array.isArray(stored.conversations)) {
      return false;
    }
    const active = stored.conversations.find(
      (conversation) => conversation?.id === activeId,
    );
    return Array.isArray(active?.messages) && active.messages.length > 0;
  } catch {
    return false;
  }
}

/** Browser: any replica for the handle whose active chat holds messages. */
export function persistedAssistantMessagesFor(
  handle: string,
  contextKey: string,
): boolean {
  if (typeof window === "undefined" || !handle || !contextKey) return false;
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(REPLICA_PREFIX) || !key.includes(handle)) {
        continue;
      }
      if (replicaHasActiveMessages(storage.getItem(key), contextKey)) return true;
    }
  } catch {
    // Storage may be unavailable; the shell then behaves as a fresh start.
  }
  return false;
}
