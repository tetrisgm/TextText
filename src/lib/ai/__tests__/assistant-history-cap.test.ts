import { describe, expect, it } from "vitest";
import {
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
    // Then the oldest tombstone goes, then the oldest unpinned chat.
    expect(capAssistantConversationSyncPayload(list, 3).map((c) => c.id)).toEqual([
      "kept-recent", "pinned-empty", "oldest-real",
    ]);
    expect(capAssistantConversationSyncPayload(list, 2).map((c) => c.id)).toEqual([
      "kept-recent", "pinned-empty",
    ]);
  });
});
