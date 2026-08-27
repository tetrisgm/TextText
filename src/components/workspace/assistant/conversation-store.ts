import type { AssistantMessage } from "./useNativeAssistant";
import {
  MAX_SYNCED_ASSISTANT_CONVERSATIONS,
  MAX_SYNCED_ASSISTANT_MESSAGES,
  assistantConversationSyncFingerprint,
  cleanAssistantConversationSyncPayload,
  mergeAssistantConversationSyncPayloads,
  type SyncedAssistantConversation,
} from "@/lib/ai/assistant-conversation-sync";

/** A lightweight record for the history picker. Message bodies stay internal. */
export type AssistantConversationSummary = {
  id: string;
  title: string;
  contextKey: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type AssistantConversation = Omit<
  AssistantConversationSummary,
  "messageCount"
> & {
  metadataUpdatedAt: string;
  messages: AssistantMessage[];
};

type StoredWorkspaceConversations = {
  version: 1;
  activeByContext: Record<string, string>;
  conversations: AssistantConversation[];
};

type WorkspaceConversationState = StoredWorkspaceConversations & {
  loaded: boolean;
  revision: number;
};

const STORE_VERSION = 1;
const MAX_CONVERSATIONS = MAX_SYNCED_ASSISTANT_CONVERSATIONS;
export const MAX_MESSAGES_PER_CONVERSATION = MAX_SYNCED_ASSISTANT_MESSAGES;
const DEFAULT_TITLE = "New chat";
const EMPTY_MESSAGES: AssistantMessage[] = [];
const EMPTY_SUMMARIES: AssistantConversationSummary[] = [];

const workspaces = new Map<string, WorkspaceConversationState>();
const legacyHandlesByScope = new Map<string, string>();
const listeners = new Set<() => void>();
let fallbackId = 0;

function storageKey(handle: string): string {
  return `texttext:assistant-conversations:v1:${handle}`;
}

function legacyStorageKey(handle: string, contextKey: string): string {
  return `texttext:assistant:${handle}:${contextKey}`;
}

function now(): string {
  return new Date().toISOString();
}

function nextConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `chat_${Date.now().toString(36)}_${fallbackId.toString(36)}`;
}

function isMessage(value: unknown): value is AssistantMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === "string" &&
    typeof message.text === "string" &&
    (message.role === "user" ||
      message.role === "assistant" ||
      message.role === "progress" ||
      message.role === "error")
  );
}

function cleanConversation(value: unknown): AssistantConversation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const conversation = value as Record<string, unknown>;
  if (
    typeof conversation.id !== "string" ||
    typeof conversation.contextKey !== "string" ||
    typeof conversation.title !== "string" ||
    typeof conversation.createdAt !== "string" ||
    typeof conversation.updatedAt !== "string" ||
    !Array.isArray(conversation.messages)
  ) {
    return null;
  }
  const conversationUpdatedAt = conversation.updatedAt;
  return {
    id: conversation.id,
    contextKey: conversation.contextKey,
    title: conversation.title.trim().slice(0, 80) || DEFAULT_TITLE,
    pinned: conversation.pinned === true,
    metadataUpdatedAt:
      typeof conversation.metadataUpdatedAt === "string"
        ? conversation.metadataUpdatedAt
        : conversation.updatedAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages
      .filter(isMessage)
      .map((message) => {
        const typed = message as AssistantMessage;
        return {
          ...typed,
          updatedAt:
            typeof typed.updatedAt === "string"
              ? typed.updatedAt
              : conversationUpdatedAt,
        };
      })
      .slice(-MAX_MESSAGES_PER_CONVERSATION),
  };
}

function emptyState(): WorkspaceConversationState {
  return {
    loaded: true,
    revision: 0,
    version: STORE_VERSION,
    activeByContext: {},
    conversations: [],
  };
}

function loadWorkspace(handle: string): WorkspaceConversationState {
  const existing = workspaces.get(handle);
  if (existing) return existing;

  const state = emptyState();
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(storageKey(handle));
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredWorkspaceConversations>;
        if (stored.version === STORE_VERSION) {
          state.conversations = Array.isArray(stored.conversations)
            ? stored.conversations
                .map(cleanConversation)
                .filter(
                  (conversation): conversation is AssistantConversation =>
                    conversation !== null,
                )
                .slice(0, MAX_CONVERSATIONS)
            : [];
          state.activeByContext =
            stored.activeByContext &&
            typeof stored.activeByContext === "object" &&
            !Array.isArray(stored.activeByContext)
              ? Object.fromEntries(
                  Object.entries(stored.activeByContext).filter(
                    ([contextKey, id]) =>
                      typeof contextKey === "string" && typeof id === "string",
                  ),
                )
              : {};
        }
      }
    } catch {
      // Corrupt or unavailable storage starts with a clean local history.
    }
  }
  workspaces.set(handle, state);
  return state;
}

function saveWorkspace(handle: string, state: WorkspaceConversationState) {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredWorkspaceConversations = {
      version: STORE_VERSION,
      activeByContext: state.activeByContext,
      conversations: state.conversations,
    };
    window.localStorage.setItem(storageKey(handle), JSON.stringify(stored));
  } catch {
    // The in-memory history remains usable when storage is unavailable.
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function markChanged(state: WorkspaceConversationState) {
  state.revision += 1;
}

function titleFromMessages(messages: readonly AssistantMessage[]): string {
  const prompt = messages.find((message) => message.role === "user")?.text;
  return prompt ? conversationTitle(prompt) : DEFAULT_TITLE;
}

function migrateLegacyMessages(
  handle: string,
  contextKey: string,
): AssistantMessage[] {
  if (typeof window === "undefined") return EMPTY_MESSAGES;
  try {
    const legacyHandle = legacyHandlesByScope.get(handle) ?? handle;
    const raw = window.sessionStorage.getItem(
      legacyStorageKey(legacyHandle, contextKey),
    );
    if (!raw) return EMPTY_MESSAGES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isMessage).slice(-MAX_MESSAGES_PER_CONVERSATION)
      : EMPTY_MESSAGES;
  } catch {
    return EMPTY_MESSAGES;
  }
}

/**
 * Moves the old handle-only cache only after the server has proved this
 * browser session is the workspace owner. Removing the unscoped copy prevents
 * a collaborator or a later account from discovering the prior owner's chat.
 */
export function migrateAssistantConversationOwnerScope(
  scopedKey: string,
  legacyHandle: string,
) {
  if (typeof window === "undefined" || !scopedKey || !legacyHandle) return;
  legacyHandlesByScope.set(scopedKey, legacyHandle);
  const scopedStorageKey = storageKey(scopedKey);
  const legacyKey = storageKey(legacyHandle);
  try {
    if (!window.localStorage.getItem(scopedStorageKey)) {
      const inMemory = workspaces.get(legacyHandle);
      const legacyRaw = inMemory
        ? JSON.stringify({
            version: STORE_VERSION,
            activeByContext: inMemory.activeByContext,
            conversations: inMemory.conversations,
          } satisfies StoredWorkspaceConversations)
        : window.localStorage.getItem(legacyKey);
      if (legacyRaw) window.localStorage.setItem(scopedStorageKey, legacyRaw);
    }
    window.localStorage.removeItem(legacyKey);
  } catch {
    // The scoped in-memory replica still starts clean if migration is blocked.
  }
  workspaces.delete(legacyHandle);
  workspaces.delete(scopedKey);
}

function createConversationRecord(
  contextKey: string,
  messages: AssistantMessage[] = [],
): AssistantConversation {
  const timestamp = now();
  return {
    id: nextConversationId(),
    contextKey,
    title: titleFromMessages(messages),
    pinned: false,
    metadataUpdatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages,
  };
}

function trimConversations(
  conversations: AssistantConversation[],
): AssistantConversation[] {
  if (conversations.length <= MAX_CONVERSATIONS) return conversations;
  return [...conversations]
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, MAX_CONVERSATIONS);
}

function ensureActiveConversation(
  handle: string,
  contextKey: string,
): AssistantConversation | null {
  if (typeof window === "undefined") return null;
  const state = loadWorkspace(handle);
  const activeId = state.activeByContext[contextKey];
  const active = state.conversations.find(
    (conversation) =>
      conversation.id === activeId && conversation.contextKey === contextKey,
  );
  if (active) return active;

  const existing = state.conversations
    .filter((conversation) => conversation.contextKey === contextKey)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (existing) {
    state.activeByContext = {
      ...state.activeByContext,
      [contextKey]: existing.id,
    };
    markChanged(state);
    saveWorkspace(handle, state);
    return existing;
  }

  const created = createConversationRecord(
    contextKey,
    migrateLegacyMessages(handle, contextKey),
  );
  state.conversations = trimConversations([created, ...state.conversations]);
  state.activeByContext = {
    ...state.activeByContext,
    [contextKey]: created.id,
  };
  markChanged(state);
  saveWorkspace(handle, state);
  return created;
}

function replaceConversation(
  handle: string,
  id: string,
  update: (conversation: AssistantConversation) => AssistantConversation,
): boolean {
  const state = loadWorkspace(handle);
  let changed = false;
  const conversations = state.conversations.map((conversation) => {
    if (conversation.id !== id) return conversation;
    changed = true;
    return update(conversation);
  });
  if (!changed) return false;
  state.conversations = conversations;
  markChanged(state);
  saveWorkspace(handle, state);
  notify();
  return true;
}

export function conversationTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return DEFAULT_TITLE;
  if (compact.length <= 56) return compact;
  const candidate = compact.slice(0, 56);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary >= 32 ? boundary : 56).trim()}…`;
}

export function subscribeAssistantConversations(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assistantConversationRevision(handle: string): number {
  return typeof window === "undefined" ? -1 : loadWorkspace(handle).revision;
}

export function serverAssistantConversationRevision(): number {
  return -1;
}

export function activeAssistantConversation(
  handle: string,
  contextKey: string,
): AssistantConversationSummary | null {
  const conversation = ensureActiveConversation(handle, contextKey);
  return conversation
    ? {
        id: conversation.id,
        title: conversation.title,
        contextKey: conversation.contextKey,
        pinned: conversation.pinned,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
      }
    : null;
}

export function assistantConversationMessages(
  handle: string,
  conversationId: string,
): AssistantMessage[] {
  return (
    loadWorkspace(handle).conversations.find(
      (conversation) => conversation.id === conversationId,
    )?.messages ?? EMPTY_MESSAGES
  );
}

export function assistantConversationSummaries(
  handle: string,
  contextKey: string,
  query = "",
): AssistantConversationSummary[] {
  if (typeof window === "undefined") return EMPTY_SUMMARIES;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return loadWorkspace(handle).conversations
    .filter((conversation) => conversation.contextKey === contextKey)
    .filter(
      (conversation) =>
        !normalizedQuery ||
        conversation.title.toLocaleLowerCase().includes(normalizedQuery) ||
        conversation.messages.some((message) =>
          message.text.toLocaleLowerCase().includes(normalizedQuery),
        ),
    )
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      contextKey: conversation.contextKey,
      pinned: conversation.pinned,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
    }));
}

export function createAssistantConversation(
  handle: string,
  contextKey: string,
): string {
  const state = loadWorkspace(handle);
  const active = ensureActiveConversation(handle, contextKey);
  if (active && active.messages.length === 0) return active.id;
  const created = createConversationRecord(contextKey);
  state.conversations = trimConversations([created, ...state.conversations]);
  state.activeByContext = {
    ...state.activeByContext,
    [contextKey]: created.id,
  };
  markChanged(state);
  saveWorkspace(handle, state);
  notify();
  return created.id;
}

export function activateAssistantConversation(
  handle: string,
  contextKey: string,
  conversationId: string,
): boolean {
  const state = loadWorkspace(handle);
  const conversation = state.conversations.find(
    (candidate) =>
      candidate.id === conversationId && candidate.contextKey === contextKey,
  );
  if (!conversation) return false;
  state.activeByContext = {
    ...state.activeByContext,
    [contextKey]: conversationId,
  };
  markChanged(state);
  saveWorkspace(handle, state);
  notify();
  return true;
}

export function toggleAssistantConversationPinned(
  handle: string,
  conversationId: string,
): boolean {
  return replaceConversation(handle, conversationId, (conversation) => {
    const timestamp = now();
    return {
      ...conversation,
      pinned: !conversation.pinned,
      metadataUpdatedAt: timestamp,
    };
  });
}

export function appendAssistantConversationMessage(
  handle: string,
  conversationId: string,
  message: AssistantMessage,
) {
  replaceConversation(handle, conversationId, (conversation) => {
    const timestamp = now();
    const messages = [
      ...conversation.messages,
      { ...message, updatedAt: timestamp },
    ].slice(
      -MAX_MESSAGES_PER_CONVERSATION,
    );
    const generatedTitle =
      conversation.title === DEFAULT_TITLE && message.role === "user"
        ? conversationTitle(message.text)
        : conversation.title;
    return {
      ...conversation,
      title: generatedTitle,
      metadataUpdatedAt:
        generatedTitle !== conversation.title
          ? timestamp
          : conversation.metadataUpdatedAt,
      updatedAt: timestamp,
      messages,
    };
  });
}

export function updateAssistantConversationMessage(
  handle: string,
  conversationId: string,
  messageId: string,
  update: (message: AssistantMessage) => AssistantMessage,
) {
  replaceConversation(handle, conversationId, (conversation) => {
    const timestamp = now();
    return {
      ...conversation,
      updatedAt: timestamp,
      messages: conversation.messages.map((message) =>
        message.id === messageId
          ? { ...update(message), updatedAt: timestamp }
          : message,
      ),
    };
  });
}

/** Bounded, credential-scrubbed snapshot suitable for owner-only sync. */
export function assistantConversationSyncPayload(
  handle: string,
): SyncedAssistantConversation[] {
  return cleanAssistantConversationSyncPayload(
    loadWorkspace(handle).conversations,
  );
}

/**
 * Merge a remote owner replica without disturbing the local active-chat map.
 * Equal replicas are a no-op, preventing a successful sync from scheduling a
 * second identical sync.
 */
/**
 * Put back what the sync copy could not carry.
 *
 * The sync payload is a bounded, redacted copy kept for history, and it
 * refuses to store a write proposal it could not reproduce exactly, which is
 * the right call for a copy: an approval card must never show arguments that
 * differ from the ones that will run. Merging that copy back over live state
 * is a different matter. It used to take the approval card off the screen
 * about a second after it appeared, while the change sat pending on the
 * server, so the person saw a flash and then prose about a change that never
 * happened. What is on screen comes from here, not from the copy.
 */
function keepLocalWriteProposals(
  local: readonly AssistantConversation[],
  next: readonly AssistantConversation[],
): AssistantConversation[] {
  const held = new Map<string, AssistantMessage["writeProposals"]>();
  for (const conversation of local) {
    for (const message of conversation.messages) {
      if (message.writeProposals?.length) {
        held.set(`${conversation.id}\u001f${message.id}`, message.writeProposals);
      }
    }
  }
  if (held.size === 0) return [...next];
  return next.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (message.writeProposals?.length) return message;
      const proposals = held.get(`${conversation.id}\u001f${message.id}`);
      return proposals ? { ...message, writeProposals: proposals } : message;
    }),
  }));
}

export function mergeSyncedAssistantConversations(
  handle: string,
  remoteInput: unknown,
): boolean {
  const state = loadWorkspace(handle);
  const local = state.conversations;
  const merged = mergeAssistantConversationSyncPayloads(
    local,
    remoteInput,
  );
  const next = keepLocalWriteProposals(
    local,
    merged
      .map(cleanConversation)
      .filter(
        (conversation): conversation is AssistantConversation =>
          conversation !== null,
      ),
  );
  if (
    assistantConversationSyncFingerprint(next) ===
    assistantConversationSyncFingerprint(state.conversations)
  ) {
    return false;
  }
  state.conversations = next;
  markChanged(state);
  saveWorkspace(handle, state);
  notify();
  return true;
}

/** Test-only reset for the module cache. */
export function resetAssistantConversationStore() {
  workspaces.clear();
  legacyHandlesByScope.clear();
  listeners.clear();
  fallbackId = 0;
}
