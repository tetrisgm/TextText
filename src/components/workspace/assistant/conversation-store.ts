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

export type AssistantPendingConversationSummary = AssistantConversationSummary & {
  pendingProposalCount: number;
};

type AssistantConversation = Omit<
  AssistantConversationSummary,
  "messageCount"
> & {
  metadataUpdatedAt: string;
  messages: AssistantMessage[];
  /** Deletion tombstone; kept so the server merge cannot resurrect the chat. */
  deletedAt?: string;
};

type StoredWorkspaceConversations = {
  version: 1;
  activeByContext: Record<string, string>;
  conversations: AssistantConversation[];
};

type WorkspaceConversationState = StoredWorkspaceConversations & {
  loaded: boolean;
  revision: number;
  /** Content changes only; selection and remote merges do not dirty an upload. */
  localRevision: number;
  syncedLocalRevision: number;
};

const STORE_VERSION = 1;
const MAX_CONVERSATIONS = MAX_SYNCED_ASSISTANT_CONVERSATIONS;
const MAX_MESSAGES_PER_CONVERSATION = MAX_SYNCED_ASSISTANT_MESSAGES;
const DEFAULT_TITLE = "New chat";
const EMPTY_MESSAGES: AssistantMessage[] = [];
const EMPTY_SUMMARIES: AssistantConversationSummary[] = [];

const workspaces = new Map<string, WorkspaceConversationState>();
const pendingWorkspaceSaveTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
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
  if (typeof conversation.deletedAt === "string") {
    return {
      id: conversation.id,
      contextKey: conversation.contextKey,
      title: "Deleted chat",
      pinned: false,
      metadataUpdatedAt:
        typeof conversation.metadataUpdatedAt === "string"
          ? conversation.metadataUpdatedAt
          : conversation.updatedAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: [],
      deletedAt: conversation.deletedAt,
    };
  }
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
    localRevision: 0,
    syncedLocalRevision: -1,
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

/**
 * What the browser will hold for one workspace's history. The conversation
 * and message counts are deliberately generous, so this budget - not an
 * arbitrary count - is what actually bounds storage, and it evicts the
 * oldest unpinned chats rather than failing the write. Without it a large
 * history would exceed the origin's quota, setItem would throw, and the
 * whole history would silently stop persisting.
 */
const MAX_STORED_BYTES = 3_000_000;

/** Oldest-first eviction order: pinned last, then least recently updated. */
function evictionOrder(
  conversations: AssistantConversation[],
): AssistantConversation[] {
  return [...conversations].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? 1 : -1;
    return left.updatedAt.localeCompare(right.updatedAt);
  });
}

function serializeWithinBudget(
  state: WorkspaceConversationState,
  budget: number,
): string {
  const encode = (conversations: AssistantConversation[]) =>
    JSON.stringify({
      version: STORE_VERSION,
      activeByContext: state.activeByContext,
      conversations,
    } satisfies StoredWorkspaceConversations);

  let conversations = state.conversations;
  let payload = encode(conversations);
  if (payload.length <= budget) return payload;

  // Drop tombstones first (they carry no content anyone can read), then the
  // oldest unpinned live chats, until the payload fits.
  const droppable = evictionOrder(conversations).sort((left, right) => {
    const leftDeleted = left.deletedAt ? 0 : 1;
    const rightDeleted = right.deletedAt ? 0 : 1;
    if (leftDeleted !== rightDeleted) return leftDeleted - rightDeleted;
    return 0;
  });
  const doomed = new Set<string>();
  for (const conversation of droppable) {
    doomed.add(conversation.id);
    conversations = state.conversations.filter(
      (candidate) => !doomed.has(candidate.id),
    );
    payload = encode(conversations);
    if (payload.length <= budget) break;
  }
  return payload;
}

function saveWorkspace(handle: string, state: WorkspaceConversationState) {
  if (typeof window === "undefined") return;
  const write = (budget: number) => {
    window.localStorage.setItem(
      storageKey(handle),
      serializeWithinBudget(state, budget),
    );
  };
  try {
    write(MAX_STORED_BYTES);
  } catch {
    // Quota is per origin and shared, so the budget can still be too
    // generous on a full profile. Give up half of it once before falling
    // back to memory alone, so a long history keeps persisting something.
    try {
      write(Math.floor(MAX_STORED_BYTES / 2));
    } catch {
      // The in-memory history remains usable when storage is unavailable.
    }
  }
}

function persistWorkspace(
  handle: string,
  state: WorkspaceConversationState,
  deferred: boolean,
) {
  if (!deferred) {
    const pending = pendingWorkspaceSaveTimers.get(handle);
    if (pending) clearTimeout(pending);
    pendingWorkspaceSaveTimers.delete(handle);
    saveWorkspace(handle, state);
    return;
  }
  if (pendingWorkspaceSaveTimers.has(handle)) return;
  const timer = setTimeout(() => {
    pendingWorkspaceSaveTimers.delete(handle);
    const current = workspaces.get(handle);
    if (current) saveWorkspace(handle, current);
  }, 1000);
  pendingWorkspaceSaveTimers.set(handle, timer);
}

function notify() {
  for (const listener of listeners) listener();
}

function markChanged(state: WorkspaceConversationState, localChange = true) {
  state.revision += 1;
  if (localChange) state.localRevision += 1;
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
  // Live chats and deletion tombstones are trimmed separately so a burst of
  // deletions cannot evict live history, and vice versa.
  const live = conversations.filter((conversation) => !conversation.deletedAt);
  const deleted = conversations.filter((conversation) =>
    Boolean(conversation.deletedAt),
  );
  const byRecency = (left: AssistantConversation, right: AssistantConversation) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  };
  if (live.length <= MAX_CONVERSATIONS && deleted.length <= MAX_CONVERSATIONS) {
    return conversations;
  }
  return [
    ...[...live].sort(byRecency).slice(0, MAX_CONVERSATIONS),
    ...[...deleted].sort(byRecency).slice(0, MAX_CONVERSATIONS),
  ];
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
      conversation.id === activeId &&
      conversation.contextKey === contextKey &&
      !conversation.deletedAt,
  );
  if (active) return active;

  const existing = state.conversations
    .filter(
      (conversation) =>
        conversation.contextKey === contextKey && !conversation.deletedAt,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (existing) {
    state.activeByContext = {
      ...state.activeByContext,
      [contextKey]: existing.id,
    };
    markChanged(state, false);
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
  options: { deferredPersistence?: boolean } = {},
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
  persistWorkspace(handle, state, options.deferredPersistence === true);
  notify();
  return true;
}

function conversationTitle(prompt: string): string {
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

/**
 * Stable selector for controllers that only need to address the active chat.
 *
 * Message streaming changes the conversation revision and summary on every
 * visible flush. Returning only the id lets `useSyncExternalStore` skip those
 * updates while still waking the controller when the person changes chats.
 */
export function activeAssistantConversationId(
  handle: string,
  contextKey: string,
): string | null {
  return ensureActiveConversation(handle, contextKey)?.id ?? null;
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

/** Pending owner decisions across every context in this workspace. */
export function pendingAssistantProposalCount(handle: string): number {
  if (typeof window === "undefined") return 0;
  return pendingAssistantConversationSummaries(handle).reduce(
    (total, conversation) => total + conversation.pendingProposalCount,
    0,
  );
}

/** Chats with live proposals, regardless of where in the workspace they began. */
export function pendingAssistantConversationSummaries(
  handle: string,
): AssistantPendingConversationSummary[] {
  if (typeof window === "undefined") return [];
  return loadWorkspace(handle).conversations
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      contextKey: conversation.contextKey,
      pinned: conversation.pinned,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
      pendingProposalCount: conversation.messages.reduce(
        (total, message) =>
          total +
          (message.writeProposals?.filter(
            (proposal) => proposal.status === "pending" && !proposal.terminal,
          ).length ?? 0),
        0,
      ),
    }))
    .filter((conversation) => conversation.pendingProposalCount > 0)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function assistantConversationSummaries(
  handle: string,
  contextKey: string,
  query = "",
): AssistantConversationSummary[] {
  if (typeof window === "undefined") return EMPTY_SUMMARIES;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return loadWorkspace(handle).conversations
    .filter(
      (conversation) =>
        conversation.contextKey === contextKey && !conversation.deletedAt,
    )
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
      candidate.id === conversationId &&
      candidate.contextKey === contextKey &&
      !candidate.deletedAt,
  );
  if (!conversation) return false;
  state.activeByContext = {
    ...state.activeByContext,
    [contextKey]: conversationId,
  };
  markChanged(state, false);
  saveWorkspace(handle, state);
  notify();
  return true;
}

/**
 * Deletes a chat by leaving a tombstone in its place. The synced replica is a
 * union merge, so a plain removal would come back from the server within a
 * sync cycle; the tombstone survives the merge and sheds the chat's title and
 * messages everywhere. If the deleted chat was active anywhere, the pointer
 * is dropped so the next look at that context lands on a live chat.
 */
export function deleteAssistantConversation(
  handle: string,
  conversationId: string,
): boolean {
  const state = loadWorkspace(handle);
  const target = state.conversations.find(
    (conversation) =>
      conversation.id === conversationId && !conversation.deletedAt,
  );
  if (!target) return false;
  const timestamp = now();
  state.conversations = state.conversations.map((conversation) =>
    conversation.id === conversationId
      ? {
          id: conversation.id,
          contextKey: conversation.contextKey,
          title: "Deleted chat",
          pinned: false,
          metadataUpdatedAt: timestamp,
          createdAt: conversation.createdAt,
          updatedAt: timestamp,
          messages: [],
          deletedAt: timestamp,
        }
      : conversation,
  );
  state.activeByContext = Object.fromEntries(
    Object.entries(state.activeByContext).filter(
      ([, activeId]) => activeId !== conversationId,
    ),
  );
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
    if (conversation.deletedAt) return conversation;
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
  options: { deferredPersistence?: boolean } = {},
) {
  replaceConversation(
    handle,
    conversationId,
    (conversation) => {
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
    },
    options,
  );
}

/** Bounded, credential-scrubbed snapshot suitable for owner-only sync. */
export function assistantConversationSyncPayload(
  handle: string,
): SyncedAssistantConversation[] {
  return cleanAssistantConversationSyncPayload(
    loadWorkspace(handle).conversations,
  );
}

/** Cheap enough for streamed updates; payloads are compared only after sync. */
export function assistantConversationLocalRevision(handle: string): number {
  return loadWorkspace(handle).localRevision;
}

export function assistantConversationsNeedSync(handle: string): boolean {
  const state = loadWorkspace(handle);
  return state.localRevision !== state.syncedLocalRevision;
}

/** A response acknowledges its replica, not edits made while awaiting it. */
export function acknowledgeAssistantConversationSync(handle: string, remote: unknown) {
  const state = loadWorkspace(handle);
  mergeSyncedAssistantConversations(handle, remote);
  // Compare the bounded copy: live proposals omitted by sync must remain local.
  // A newer local revision is only clean if the server actually has its content.
  state.syncedLocalRevision =
    assistantConversationSyncFingerprint(state.conversations) ===
    assistantConversationSyncFingerprint(remote)
      ? state.localRevision
      : -1;
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
  markChanged(state, false);
  saveWorkspace(handle, state);
  notify();
  return true;
}

/** Test-only reset for the module cache. */
export function resetAssistantConversationStore() {
  for (const timer of pendingWorkspaceSaveTimers.values()) clearTimeout(timer);
  pendingWorkspaceSaveTimers.clear();
  workspaces.clear();
  legacyHandlesByScope.clear();
  listeners.clear();
  fallbackId = 0;
}
