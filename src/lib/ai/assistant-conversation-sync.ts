// Generous counts, because losing an old discussion is worse than holding
// it: the real protection is the byte budget below (and the store's own
// storage budget), which evicts by recency instead of an arbitrary count.
export const MAX_SYNCED_ASSISTANT_CONVERSATIONS = 500;
export const MAX_SYNCED_ASSISTANT_MESSAGES = 2_000;
const MAX_SYNCED_ASSISTANT_MESSAGE_TEXT = 16_000;
const MAX_SYNCED_ASSISTANT_CONVERSATION_BYTES = 512_000;
const MAX_SYNCED_ASSISTANT_WORKSPACE_BYTES = 4_000_000;

type SyncedAssistantMessage = Record<string, unknown> & {
  id: string;
  role: "user" | "assistant" | "progress" | "error";
  text: string;
  updatedAt: string;
};

export type SyncedAssistantConversation = {
  id: string;
  contextKey: string;
  title: string;
  pinned: boolean;
  metadataUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  messages: SyncedAssistantMessage[];
  /**
   * A deletion tombstone. The merge is a union by id, so removing a
   * conversation from one replica would be resurrected by every other copy
   * within a sync cycle. A tombstone survives the merge, wins over any later
   * edit, and carries no title or messages, so a deleted chat's content stops
   * existing everywhere instead of merely hiding on one device.
   */
  deletedAt?: string;
};

const DELETED_TITLE = "Deleted chat";

function tombstone(
  conversation: SyncedAssistantConversation,
  deletedAt: string,
): SyncedAssistantConversation {
  return {
    id: conversation.id,
    contextKey: conversation.contextKey,
    title: DELETED_TITLE,
    pinned: false,
    metadataUpdatedAt: conversation.metadataUpdatedAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: [],
    deletedAt,
  };
}

const SECRET_KEY =
  /(?:authorization|credential|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const SECRET_VALUE =
  /\b(?:bearer\s+[a-z0-9._~+/=-]{8,}|sk-[a-z0-9_-]{8,}|wsk_[a-z0-9_-]{8,}|(?:api[_ -]?key|password|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+)/gi;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validTimestamp(value: unknown, fallback: string): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (
    !Number.isFinite(parsed) ||
    parsed > Date.now() + MAX_FUTURE_CLOCK_SKEW_MS
  ) {
    return fallback;
  }
  return new Date(parsed).toISOString();
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

// How deep a message may nest before the cleaner gives up.
//
// Eight was too shallow for the things this actually carries. A staged
// create_item_type sits nine levels down from the message root (proposals ->
// proposal -> arguments -> blueprint -> fields -> field -> options -> option
// -> value), so its leaf values were dropped, the cleaned copy no longer
// matched the original, and cleanMessage discarded the whole proposal.
const MAX_MESSAGE_DEPTH = 16;

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_MESSAGE_DEPTH) return undefined;
  if (typeof value === "string") {
    return value.slice(0, 32_000).replace(SECRET_VALUE, "[redacted]");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((entry) => safeValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY.test(key))
      .slice(0, 100)
      .flatMap(([key, entry]) => {
        const cleaned = safeValue(entry, depth + 1);
        return cleaned === undefined ? [] : [[key.slice(0, 80), cleaned]];
      }),
  );
}

function cleanMessage(
  value: unknown,
  fallbackTimestamp: string,
): SyncedAssistantMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !record.id.trim() ||
    typeof record.text !== "string" ||
    (record.role !== "user" &&
      record.role !== "assistant" &&
      record.role !== "progress" &&
      record.role !== "error")
  ) {
    return null;
  }
  const safe = safeValue(record) as Record<string, unknown>;
  if (
    record.writeProposals !== undefined &&
    (!validProposalPreviews(record.writeProposals) ||
      canonical(safe.writeProposals) !== canonical(record.writeProposals))
  ) {
    delete safe.writeProposals;
  }
  return {
    ...safe,
    id: record.id.slice(0, 128),
    role: record.role,
    text: record.text
      .slice(0, MAX_SYNCED_ASSISTANT_MESSAGE_TEXT)
      .replace(SECRET_VALUE, "[redacted]"),
    updatedAt: validTimestamp(record.updatedAt, fallbackTimestamp),
  };
}

function validProposalPreviews(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const proposal = entry as Record<string, unknown>;
    return (
      typeof proposal.id === "string" &&
      typeof proposal.tool === "string" &&
      typeof proposal.title === "string" &&
      typeof proposal.summary === "string" &&
      proposal.arguments !== null &&
      typeof proposal.arguments === "object" &&
      !Array.isArray(proposal.arguments) &&
      (proposal.status === "pending" ||
        proposal.status === "approved" ||
        proposal.status === "denied" ||
        proposal.status === "error")
    );
  });
}

function boundMessages(messages: SyncedAssistantMessage[]) {
  const bounded: SyncedAssistantMessage[] = [];
  let bytes = 2;
  for (
    let index = messages.length - 1;
    index >= 0 && bounded.length < MAX_SYNCED_ASSISTANT_MESSAGES;
    index -= 1
  ) {
    const message = messages[index]!;
    const nextBytes = utf8Bytes(JSON.stringify(message)) + 1;
    if (bytes + nextBytes > MAX_SYNCED_ASSISTANT_CONVERSATION_BYTES) break;
    bounded.unshift(message);
    bytes += nextBytes;
  }
  return bounded;
}

function cleanConversation(value: unknown): SyncedAssistantConversation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !record.id.trim() ||
    typeof record.contextKey !== "string" ||
    !record.contextKey.trim() ||
    typeof record.title !== "string" ||
    !Array.isArray(record.messages)
  ) {
    return null;
  }
  const fallback = new Date(0).toISOString();
  const createdAt = validTimestamp(record.createdAt, fallback);
  const updatedAt = validTimestamp(record.updatedAt, createdAt);
  const cleaned: SyncedAssistantConversation = {
    id: record.id.slice(0, 128),
    contextKey: record.contextKey.slice(0, 512),
    title: record.title.trim().replace(SECRET_VALUE, "[redacted]").slice(0, 80) || "New chat",
    pinned: record.pinned === true,
    metadataUpdatedAt: validTimestamp(record.metadataUpdatedAt, updatedAt),
    createdAt,
    updatedAt,
    messages: boundMessages(
      record.messages
        .map((message) => cleanMessage(message, updatedAt))
        .filter((message): message is SyncedAssistantMessage => message !== null)
        .slice(-MAX_SYNCED_ASSISTANT_MESSAGES),
    ),
  };
  if (typeof record.deletedAt === "string") {
    return tombstone(cleaned, validTimestamp(record.deletedAt, updatedAt));
  }
  return cleaned;
}

function conversationOrder(
  left: SyncedAssistantConversation,
  right: SyncedAssistantConversation,
) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const activity = right.updatedAt.localeCompare(left.updatedAt);
  return activity || left.id.localeCompare(right.id);
}

function boundWorkspace(conversations: SyncedAssistantConversation[]) {
  // Tombstones are bounded separately from live chats: a burst of deletions
  // must not evict live history from the cap, and live history must not push
  // out the tombstones that keep those deletions from resurrecting.
  const live = conversations.filter((conversation) => !conversation.deletedAt);
  const deleted = conversations.filter((conversation) =>
    Boolean(conversation.deletedAt),
  );
  const bounded: SyncedAssistantConversation[] = [];
  let bytes = 2;
  for (const conversation of [...live].sort(conversationOrder)) {
    if (bounded.length >= MAX_SYNCED_ASSISTANT_CONVERSATIONS) break;
    const nextBytes = utf8Bytes(JSON.stringify(conversation)) + 1;
    if (bytes + nextBytes > MAX_SYNCED_ASSISTANT_WORKSPACE_BYTES) break;
    bounded.push(conversation);
    bytes += nextBytes;
  }
  let tombstones = 0;
  for (const conversation of [...deleted].sort(conversationOrder)) {
    if (tombstones >= MAX_SYNCED_ASSISTANT_CONVERSATIONS) break;
    const nextBytes = utf8Bytes(JSON.stringify(conversation)) + 1;
    if (bytes + nextBytes > MAX_SYNCED_ASSISTANT_WORKSPACE_BYTES) break;
    bounded.push(conversation);
    bytes += nextBytes;
    tombstones += 1;
  }
  return bounded;
}

export function cleanAssistantConversationSyncPayload(
  value: unknown,
): SyncedAssistantConversation[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, SyncedAssistantConversation>();
  for (const entry of value) {
    const conversation = cleanConversation(entry);
    if (!conversation) continue;
    const existing = unique.get(conversation.id);
    if (
      !existing ||
      (Boolean(conversation.deletedAt) !== Boolean(existing.deletedAt)
        ? Boolean(conversation.deletedAt)
        : canonical(conversation) > canonical(existing))
    ) {
      unique.set(conversation.id, conversation);
    }
  }
  return boundWorkspace([...unique.values()]);
}

export function assistantConversationSyncFingerprint(value: unknown): string {
  return canonical(cleanAssistantConversationSyncPayload(value));
}

// Inline previews have one irreversible decision per message. A delayed
// generating/ready replica must not resurrect a discarded suggestion. An
// acknowledged write takes precedence if a conflicting decision arrives.
function inlineDecisionRank(message: SyncedAssistantMessage): number {
  const preview = message.inlinePreview;
  if (!preview || typeof preview !== "object") return 0;
  const status = (preview as Record<string, unknown>).status;
  return status === "undone" ? 4 : status === "applied" ? 3 : status === "discarded" ? 2 : 0;
}

function mergeMessages(
  left: readonly SyncedAssistantMessage[],
  right: readonly SyncedAssistantMessage[],
) {
  const messages = new Map<string, SyncedAssistantMessage>();
  for (const message of [...left, ...right]) {
    const existing = messages.get(message.id);
    if (
      !existing ||
      (inlineDecisionRank(message) !== inlineDecisionRank(existing)
        ? inlineDecisionRank(message) > inlineDecisionRank(existing)
        : message.updatedAt > existing.updatedAt ||
          (message.updatedAt === existing.updatedAt && canonical(message) > canonical(existing)))
    ) {
      messages.set(message.id, message);
    }
  }
  return boundMessages(
    [...messages.values()].sort(
      (a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id),
    ),
  );
}

function mergeConversation(
  left: SyncedAssistantConversation,
  right: SyncedAssistantConversation,
): SyncedAssistantConversation {
  // Deletion is final: a tombstone on either side wins over any concurrent
  // edit, using the earliest deletion time so the merge stays commutative.
  if (left.deletedAt || right.deletedAt) {
    const deletedAt =
      left.deletedAt && right.deletedAt
        ? left.deletedAt < right.deletedAt
          ? left.deletedAt
          : right.deletedAt
        : (left.deletedAt ?? right.deletedAt!);
    return tombstone(
      {
        ...left,
        createdAt:
          left.createdAt < right.createdAt ? left.createdAt : right.createdAt,
        updatedAt:
          left.updatedAt > right.updatedAt ? left.updatedAt : right.updatedAt,
        metadataUpdatedAt:
          left.metadataUpdatedAt > right.metadataUpdatedAt
            ? left.metadataUpdatedAt
            : right.metadataUpdatedAt,
        contextKey:
          left.contextKey === right.contextKey
            ? left.contextKey
            : [left.contextKey, right.contextKey].sort()[0]!,
      },
      deletedAt,
    );
  }
  const rightMetadataWins =
    right.metadataUpdatedAt > left.metadataUpdatedAt ||
    (right.metadataUpdatedAt === left.metadataUpdatedAt &&
      canonical({ title: right.title, pinned: right.pinned }) >
        canonical({ title: left.title, pinned: left.pinned }));
  return {
    id: left.id,
    contextKey:
      left.contextKey === right.contextKey
        ? left.contextKey
        : [left.contextKey, right.contextKey].sort()[0]!,
    title: rightMetadataWins ? right.title : left.title,
    pinned: rightMetadataWins ? right.pinned : left.pinned,
    metadataUpdatedAt:
      right.metadataUpdatedAt > left.metadataUpdatedAt
        ? right.metadataUpdatedAt
        : left.metadataUpdatedAt,
    createdAt: left.createdAt < right.createdAt ? left.createdAt : right.createdAt,
    updatedAt: left.updatedAt > right.updatedAt ? left.updatedAt : right.updatedAt,
    messages: mergeMessages(left.messages, right.messages),
  };
}

/** Commutative, idempotent merge for independently edited offline replicas. */
export function mergeAssistantConversationSyncPayloads(
  leftInput: unknown,
  rightInput: unknown,
): SyncedAssistantConversation[] {
  const merged = new Map<string, SyncedAssistantConversation>();
  for (const conversation of [
    ...cleanAssistantConversationSyncPayload(leftInput),
    ...cleanAssistantConversationSyncPayload(rightInput),
  ]) {
    const existing = merged.get(conversation.id);
    merged.set(
      conversation.id,
      existing ? mergeConversation(existing, conversation) : conversation,
    );
  }
  return boundWorkspace([...merged.values()]);
}

/** The database keeps at most this many conversations per workspace. */
export const ASSISTANT_HISTORY_MAX_CONVERSATIONS = 500;
/** How long a deletion tombstone is kept before capacity pruning may drop it. */
export const ASSISTANT_HISTORY_TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether the shared copy could have kept `conversation` at all, given what it
 * did keep. A device whose oldest chats fall past the retention cap must not
 * treat their absence from the acknowledgement as unsynced work, or it would
 * upload the same history forever.
 */
export function assistantConversationEvictedByCap(
  conversation: SyncedAssistantConversation,
  retained: readonly SyncedAssistantConversation[],
  limit = ASSISTANT_HISTORY_MAX_CONVERSATIONS,
): boolean {
  if (retained.some((candidate) => candidate.id === conversation.id)) return false;
  return !capAssistantConversationSyncPayload([...retained, conversation], limit).some(
    (candidate) => candidate.id === conversation.id,
  );
}

/**
 * An empty, unpinned, undeleted chat is a context's placeholder, never
 * history. Each browser profile keeps its own; none belongs in the shared copy.
 */
export function isAssistantConversationHistory<
  T extends { deletedAt?: string; pinned: boolean; messages: readonly unknown[] },
>(conversation: T): boolean {
  return Boolean(conversation.deletedAt) || conversation.pinned || conversation.messages.length > 0;
}

/**
 * Keep a merged history under the stored limit instead of failing the write.
 * Every fresh browser profile mints an empty chat per context, and a merge is
 * a union by id, so a workspace opened on enough devices would otherwise hit
 * the limit and never sync again. Empty chats go first, then old deletion
 * tombstones (they have propagated by then), then the oldest unpinned chats.
 */
export function capAssistantConversationSyncPayload(
  conversations: SyncedAssistantConversation[],
  limit = ASSISTANT_HISTORY_MAX_CONVERSATIONS,
): SyncedAssistantConversation[] {
  const history = conversations.filter(isAssistantConversationHistory);
  if (history.length <= limit) return history.length === conversations.length ? conversations : history;
  conversations = history;
  const stamp = (c: SyncedAssistantConversation) =>
    Date.parse(c.updatedAt || c.metadataUpdatedAt || c.createdAt || "") || 0;
  const oldestFirst = (a: SyncedAssistantConversation, b: SyncedAssistantConversation) =>
    stamp(a) - stamp(b);
  const tombstone = (c: SyncedAssistantConversation) => Boolean(c.deletedAt);
  const empty = (c: SyncedAssistantConversation) =>
    !tombstone(c) && !c.pinned && c.messages.length === 0;
  // A deletion must outlive every replica that could still hold the chat:
  // a fresh tombstone is never evicted (dropping it would let a device that
  // reconnects with an old copy bring the chat back). Tombstones older than
  // the retention window have propagated to any device that synced within it,
  // so they go before the oldest live chats do.
  const retirable = (c: SyncedAssistantConversation) =>
    tombstone(c) && Date.now() - (Date.parse(c.deletedAt ?? "") || 0) > ASSISTANT_HISTORY_TOMBSTONE_MS;
  const pools = [
    conversations.filter(empty).sort(oldestFirst),
    conversations.filter(retirable).sort(oldestFirst),
    conversations.filter((c) => !empty(c) && !tombstone(c) && !c.pinned).sort(oldestFirst),
  ];
  const dropped = new Set<string>();
  let excess = conversations.length - limit;
  for (const pool of pools) {
    for (const conversation of pool) {
      if (excess <= 0) break;
      dropped.add(conversation.id);
      excess -= 1;
    }
  }
  return conversations.filter((c) => !dropped.has(c.id));
}
