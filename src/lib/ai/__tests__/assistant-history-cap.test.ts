import { describe, expect, it } from "vitest";
import {
  assistantConversationEvictedByCap,
  capAssistantConversationSyncPayload,
  type SyncedAssistantConversation,
} from "@/lib/ai/assistant-conversation-sync";

function chat(
  id: string,
  updatedAt: string,
  extra: Partial<SyncedAssistantConversation> = {},
): SyncedAssistantConversation {
  return {
    id,
    contextKey: "item:one",
    title: id,
    pinned: false,
    metadataUpdatedAt: updatedAt,
    createdAt: updatedAt,
    updatedAt,
    messages: [{ id: `${id}-m`, role: "user", text: "hello" } as SyncedAssistantConversation["messages"][number]],
    ...extra,
  };
}

describe("assistant history cap", () => {
  it("leaves a history under the limit untouched", () => {
    const list = [chat("a", "2026-09-01T00:00:00Z"), chat("b", "2026-09-02T00:00:00Z")];
    expect(capAssistantConversationSyncPayload(list, 2)).toBe(list);
  });

  it("always drops empty unpinned placeholders, even under the limit", () => {
    // Every browser profile mints one per context; a shared copy that kept
    // them would grow by one per device per item and fill the stored limit.
    const list = [
      chat("real", "2026-09-05T00:00:00Z"),
      chat("placeholder", "2026-09-05T00:00:00Z", { messages: [] }),
      chat("pinned-empty", "2026-09-05T00:00:00Z", { messages: [], pinned: true }),
      chat("tombstone", "2026-09-05T00:00:00Z", { messages: [], deletedAt: "2026-09-05T00:00:00Z" }),
    ];
    expect(capAssistantConversationSyncPayload(list, 500).map((c) => c.id)).toEqual([
      "real", "pinned-empty", "tombstone",
    ]);
  });

  it("keeps a fresh tombstone over the oldest live chat, and retires only old tombstones", () => {
    const fresh = new Date(Date.now() - 60_000).toISOString();
    const old = "2026-01-01T00:00:00Z";
    const list = [
      chat("recent", "2026-09-05T00:00:00Z"),
      chat("older", "2026-08-01T00:00:00Z"),
      chat("oldest", "2026-07-01T00:00:00Z"),
      chat("deleted-yesterday", fresh, { messages: [], deletedAt: fresh }),
      chat("deleted-in-january", old, { messages: [], deletedAt: old }),
    ];
    // The January tombstone has propagated and goes first; the fresh deletion
    // then survives at the expense of the oldest live chats.
    expect(capAssistantConversationSyncPayload(list, 3).map((c) => c.id)).toEqual([
      "recent", "older", "deleted-yesterday",
    ]);
    expect(capAssistantConversationSyncPayload(list, 2).map((c) => c.id)).toEqual([
      "recent", "deleted-yesterday",
    ]);
  });

  it("recognises a chat the cap could not have kept, so a device stops re-uploading it", () => {
    const retained = Array.from({ length: 3 }, (_, i) => chat(`kept-${i}`, `2026-09-0${i + 1}T00:00:00Z`));
    const ancient = chat("ancient", "2020-01-01T00:00:00Z");
    const newer = chat("newer", "2026-09-09T00:00:00Z");
    expect(assistantConversationEvictedByCap(ancient, retained, 3)).toBe(true);
    // A newer chat missing from the acknowledgement is genuinely unsynced.
    expect(assistantConversationEvictedByCap(newer, retained, 3)).toBe(false);
    expect(assistantConversationEvictedByCap(retained[0], retained, 3)).toBe(false);
  });

  it("drops empty chats first, oldest first, and keeps pinned and recent ones", () => {
    const list = [
      chat("kept-recent", "2026-09-05T00:00:00Z"),
      chat("empty-old", "2026-09-01T00:00:00Z", { messages: [] }),
      chat("empty-new", "2026-09-04T00:00:00Z", { messages: [] }),
      chat("pinned-empty", "2026-08-01T00:00:00Z", { messages: [], pinned: true }),
      chat("tombstone", "2026-08-02T00:00:00Z", { messages: [], deletedAt: "2026-08-02T00:00:00Z" }),
      chat("oldest-real", "2026-07-01T00:00:00Z"),
    ];
    // Placeholders never survive; four remain, so a limit of four cuts nothing more.
    expect(capAssistantConversationSyncPayload(list, 4).map((c) => c.id)).toEqual([
      "kept-recent", "pinned-empty", "tombstone", "oldest-real",
    ]);
    // Then the August tombstone (past the retention window) goes, then the
    // oldest unpinned chat.
    expect(capAssistantConversationSyncPayload(list, 3).map((c) => c.id)).toEqual([
      "kept-recent", "pinned-empty", "oldest-real",
    ]);
    expect(capAssistantConversationSyncPayload(list, 2).map((c) => c.id)).toEqual([
      "kept-recent", "pinned-empty",
    ]);
  });
});
