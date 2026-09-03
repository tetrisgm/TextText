import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateAssistantConversation,
  activeAssistantConversation,
  activeAssistantConversationId,
  appendAssistantConversationMessage,
  assistantConversationMessages,
  assistantConversationSyncPayload,
  assistantConversationSummaries,
  createAssistantConversation,
  deleteAssistantConversation,
  mergeSyncedAssistantConversations,
  migrateAssistantConversationOwnerScope,
  pendingAssistantConversationSummaries,
  pendingAssistantProposalCount,
  resetAssistantConversationStore,
  toggleAssistantConversationPinned,
  updateAssistantConversationMessage,
} from "@/components/workspace/assistant/conversation-store";

function browserStorage(initialSession: Record<string, string> = {}) {
  const local = new Map<string, string>();
  const session = new Map(Object.entries(initialSession));
  const setLocalItem = vi.fn((key: string, value: string) =>
    local.set(key, value),
  );
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      removeItem: (key: string) => local.delete(key),
      setItem: setLocalItem,
    },
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      removeItem: (key: string) => session.delete(key),
      setItem: (key: string, value: string) => session.set(key, value),
    },
  });
  return { local, session, setLocalItem };
}

beforeEach(() => {
  resetAssistantConversationStore();
});

afterEach(() => {
  resetAssistantConversationStore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("assistant conversation history", () => {
  it("migrates the prior session transcript into durable storage", () => {
    const legacyKey = "texttext:assistant:writer:item:one";
    const { local } = browserStorage({
      [legacyKey]: JSON.stringify([
        { id: "old-user", role: "user", text: "Plan the launch notes" },
        { id: "old-answer", role: "assistant", text: "Start with scope" },
      ]),
    });

    const active = activeAssistantConversation("writer", "item:one");

    expect(active?.title).toBe("Plan the launch notes");
    expect(active?.messageCount).toBe(2);
    expect(local.has("texttext:assistant-conversations:v1:writer")).toBe(true);
  });

  it("moves a handle-only cache into one verified owner scope", () => {
    const { local } = browserStorage();
    local.set(
      "texttext:assistant-conversations:v1:writer",
      JSON.stringify({
        version: 1,
        activeByContext: { root: "owner-chat" },
        conversations: [
          {
            id: "owner-chat",
            contextKey: "root",
            title: "Private owner chat",
            pinned: false,
            createdAt: "2026-08-24T12:00:00.000Z",
            updatedAt: "2026-08-24T12:00:00.000Z",
            messages: [
              {
                id: "private-message",
                role: "user",
                text: "Owner-only history",
              },
            ],
          },
        ],
      }),
    );

    migrateAssistantConversationOwnerScope("writer:owner-a", "writer");

    expect(local.has("texttext:assistant-conversations:v1:writer")).toBe(false);
    expect(activeAssistantConversation("writer:owner-a", "root")).toMatchObject({
      id: "owner-chat",
      title: "Private owner chat",
    });
    expect(activeAssistantConversation("writer:owner-b", "root")?.id).not.toBe(
      "owner-chat",
    );
  });

  it("keeps multiple stable conversations and reopens the selected one", () => {
    browserStorage();
    const first = activeAssistantConversation("writer", "folder:drafts");
    expect(first).not.toBeNull();
    const controllerId = activeAssistantConversationId(
      "writer",
      "folder:drafts",
    );
    appendAssistantConversationMessage("writer", first!.id, {
      id: "first-user",
      role: "user",
      text: "Review the product narrative for clarity",
    });
    appendAssistantConversationMessage("writer", first!.id, {
      id: "first-answer",
      role: "assistant",
      text: "The middle section repeats the positioning claim.",
    });
    expect(activeAssistantConversationId("writer", "folder:drafts")).toBe(
      controllerId,
    );

    const secondId = createAssistantConversation("writer", "folder:drafts");
    appendAssistantConversationMessage("writer", secondId, {
      id: "second-user",
      role: "user",
      text: "Draft release notes",
    });

    expect(secondId).not.toBe(first!.id);
    expect(activeAssistantConversationId("writer", "folder:drafts")).toBe(
      secondId,
    );
    expect(activeAssistantConversation("writer", "folder:drafts")?.id).toBe(
      secondId,
    );
    expect(
      activateAssistantConversation("writer", "folder:drafts", first!.id),
    ).toBe(true);
    expect(activeAssistantConversation("writer", "folder:drafts")?.id).toBe(
      first!.id,
    );
    expect(assistantConversationMessages("writer", first!.id)).toHaveLength(2);
  });

  it("keeps a separate remembered chat per item and reopens each one", () => {
    // Walking between items is the common case: every view carries its own
    // discussion, and coming back to one shows that discussion again rather
    // than a blank thread or the neighbour's.
    const storage = browserStorage();
    const itemA = "item:post-a";
    const itemB = "item:post-b";

    const first = activeAssistantConversation("writer", itemA);
    appendAssistantConversationMessage("writer", first!.id, {
      id: "a-user",
      role: "user",
      text: "Tighten the opening paragraph",
    });
    appendAssistantConversationMessage("writer", first!.id, {
      id: "a-answer",
      role: "assistant",
      text: "The first two sentences make the same promise.",
    });

    // Move to another item: a fresh thread, not the previous item's.
    const second = activeAssistantConversation("writer", itemB);
    expect(second!.id).not.toBe(first!.id);
    expect(assistantConversationMessages("writer", second!.id)).toHaveLength(0);
    appendAssistantConversationMessage("writer", second!.id, {
      id: "b-user",
      role: "user",
      text: "What is missing from this outline?",
    });

    // Back to the first item: its own transcript, intact.
    const reopened = activeAssistantConversation("writer", itemA);
    expect(reopened!.id).toBe(first!.id);
    expect(assistantConversationMessages("writer", first!.id)).toHaveLength(2);
    expect(assistantConversationMessages("writer", second!.id)).toHaveLength(1);
    expect(
      assistantConversationSummaries("writer", itemA).map(
        (conversation) => conversation.id,
      ),
    ).toEqual([first!.id]);

    // And after the app is closed and reopened (module cache gone, browser
    // storage kept), each item still has its own discussion.
    resetAssistantConversationStore();
    browserStorage();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.local.get(key) ?? null,
        removeItem: (key: string) => storage.local.delete(key),
        setItem: (key: string, value: string) => storage.local.set(key, value),
      },
      sessionStorage: {
        getItem: () => null,
        removeItem: () => {},
        setItem: () => {},
      },
    });
    expect(activeAssistantConversation("writer", itemA)?.id).toBe(first!.id);
    expect(assistantConversationMessages("writer", first!.id)).toHaveLength(2);
    expect(activeAssistantConversation("writer", itemB)?.id).toBe(second!.id);
    expect(assistantConversationMessages("writer", second!.id)).toHaveLength(1);
  });

  it("deletes a chat so thoroughly the server merge cannot bring it back", () => {
    browserStorage();
    const doomed = activeAssistantConversation("writer", "folder:drafts");
    appendAssistantConversationMessage("writer", doomed!.id, {
      id: "garbage-user",
      role: "user",
      text: "FAIL_STREAM test garbage",
    });
    // The pre-deletion replica, as the server would still hold it.
    const remoteCopy = JSON.parse(
      JSON.stringify(assistantConversationSyncPayload("writer")),
    );

    expect(deleteAssistantConversation("writer", doomed!.id)).toBe(true);

    // The chat is gone from every listing, and its content is gone from the
    // sync payload; only a contentless tombstone remains.
    expect(
      assistantConversationSummaries("writer", "folder:drafts"),
    ).toHaveLength(0);
    expect(assistantConversationMessages("writer", doomed!.id)).toHaveLength(0);
    const payload = assistantConversationSyncPayload("writer");
    const tombstone = payload.find(
      (conversation) => conversation.id === doomed!.id,
    );
    expect(tombstone).toMatchObject({ title: "Deleted chat", messages: [] });
    expect(tombstone?.deletedAt).toBeTruthy();

    // The next look at the context lands on a fresh live chat.
    expect(activeAssistantConversationId("writer", "folder:drafts")).not.toBe(
      doomed!.id,
    );
    expect(
      activateAssistantConversation("writer", "folder:drafts", doomed!.id),
    ).toBe(false);

    // A stale server replica that still carries the live copy merges back in
    // without resurrecting the chat.
    mergeSyncedAssistantConversations("writer", remoteCopy);
    expect(
      assistantConversationSummaries("writer", "folder:drafts").filter(
        (conversation) => conversation.id === doomed!.id,
      ),
    ).toHaveLength(0);
    expect(assistantConversationMessages("writer", doomed!.id)).toHaveLength(0);
  });

  it("bounds streaming persistence and flushes terminal state immediately", () => {
    vi.useFakeTimers();
    const { setLocalItem } = browserStorage();
    const active = activeAssistantConversation("writer", "root")!;
    appendAssistantConversationMessage("writer", active.id, {
      id: "answer",
      role: "assistant",
      text: "first",
    });
    setLocalItem.mockClear();

    for (let index = 0; index < 100; index += 1) {
      updateAssistantConversationMessage(
        "writer",
        active.id,
        "answer",
        (message) => ({ ...message, text: `${message.text}x` }),
        { deferredPersistence: true },
      );
    }
    expect(setLocalItem).not.toHaveBeenCalled();
    expect(
      assistantConversationMessages("writer", active.id)[0]?.text,
    ).toBe(`first${"x".repeat(100)}`);
    vi.advanceTimersByTime(1000);
    expect(setLocalItem).toHaveBeenCalledTimes(1);

    updateAssistantConversationMessage(
      "writer",
      active.id,
      "answer",
      (message) => ({ ...message, text: `${message.text}!` }),
      { deferredPersistence: true },
    );
    updateAssistantConversationMessage(
      "writer",
      active.id,
      "answer",
      (message) => message,
    );
    expect(setLocalItem).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    expect(setLocalItem).toHaveBeenCalledTimes(2);
  });

  it("merges a remote owner replica without changing the active chat", () => {
    browserStorage();
    const active = activeAssistantConversation("writer", "root")!;
    appendAssistantConversationMessage("writer", active.id, {
      id: "local-message",
      role: "user",
      text: "Local question",
    });
    const local = assistantConversationSyncPayload("writer")[0]!;
    const remoteUpdatedAt = new Date(
      Date.parse(local.messages[0]!.updatedAt) + 1_000,
    ).toISOString();
    const remote = {
      ...local,
      updatedAt: remoteUpdatedAt,
      messages: [
        ...local.messages,
        {
          id: "remote-message",
          role: "assistant" as const,
          text: "Remote answer",
          updatedAt: remoteUpdatedAt,
        },
      ],
    };

    expect(mergeSyncedAssistantConversations("writer", [remote])).toBe(true);
    expect(activeAssistantConversation("writer", "root")?.id).toBe(active.id);
    expect(
      assistantConversationMessages("writer", active.id).map(
        (message) => message.id,
      ),
    ).toEqual(["local-message", "remote-message"]);
  });

  it("keeps a staged change on screen when the synced copy cannot carry it", () => {
    browserStorage();
    const active = activeAssistantConversation("writer", "root")!;
    appendAssistantConversationMessage("writer", active.id, {
      id: "staged-message",
      role: "assistant",
      text: "Review the proposed change.",
    });
    updateAssistantConversationMessage(
      "writer",
      active.id,
      "staged-message",
      (message) => ({
        ...message,
        writeProposals: [
          {
            id: "proposal-1",
            kind: "workspace",
            status: "pending",
            tool: "create_item_type",
            title: "Create item type",
            summary: "Create item type: blog/reading-log",
            arguments: { folder_path: "blog/reading-log" },
            createdAt: "2026-08-27T09:00:00.000Z",
            expiresAt: "2026-08-27T09:15:00.000Z",
          },
        ],
      }),
    );

    // What the server can give back: the same message, with the proposal gone,
    // because the sync copy refuses to store one it could not reproduce.
    const local = assistantConversationSyncPayload("writer")[0]!;
    const remote = {
      ...local,
      messages: local.messages.map((message) => {
        const rest = { ...message } as Record<string, unknown>;
        delete rest.writeProposals;
        return rest as typeof message;
      }),
    };
    mergeSyncedAssistantConversations("writer", [remote]);

    const merged = assistantConversationMessages("writer", active.id).find(
      (message) => message.id === "staged-message",
    );
    expect(merged?.writeProposals?.[0]?.id).toBe("proposal-1");
  });

  it("keeps the in-memory chat usable when browser storage is offline", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("storage unavailable");
        },
      },
      sessionStorage: { getItem: () => null },
    });
    const active = activeAssistantConversation("offline-writer", "root")!;

    appendAssistantConversationMessage("offline-writer", active.id, {
      id: "offline-message",
      role: "user",
      text: "Keep this locally",
    });

    expect(
      assistantConversationMessages("offline-writer", active.id)[0]?.text,
    ).toBe("Keep this locally");
  });

  it("searches message content and keeps pinned chats first", () => {
    browserStorage();
    const first = activeAssistantConversation("writer", "root")!;
    appendAssistantConversationMessage("writer", first.id, {
      id: "u1",
      role: "user",
      text: "Review my notes",
    });
    appendAssistantConversationMessage("writer", first.id, {
      id: "a1",
      role: "assistant",
      text: "The roadmap mentions an observability milestone.",
    });
    const secondId = createAssistantConversation("writer", "root");
    appendAssistantConversationMessage("writer", secondId, {
      id: "u2",
      role: "user",
      text: "Write the meeting recap",
    });

    expect(assistantConversationSummaries("writer", "root", "observability"))
      .toMatchObject([{ id: first.id }]);
    expect(toggleAssistantConversationPinned("writer", first.id)).toBe(true);
    expect(assistantConversationSummaries("writer", "root")[0]).toMatchObject({
      id: first.id,
      pinned: true,
    });
  });

  it("restores conversations after the module cache is reset", () => {
    browserStorage();
    const first = activeAssistantConversation("writer", "root")!;
    appendAssistantConversationMessage("writer", first.id, {
      id: "saved-user",
      role: "user",
      text: "A durable question",
    });

    resetAssistantConversationStore();

    expect(activeAssistantConversation("writer", "root")).toMatchObject({
      id: first.id,
      title: "A durable question",
      messageCount: 1,
    });
  });

  it("persists guarded write proposal review state with its answer", () => {
    browserStorage();
    const active = activeAssistantConversation("writer", "root")!;
    appendAssistantConversationMessage("writer", active.id, {
      id: "answer-with-proposal",
      role: "assistant",
      text: "Review the proposed change.",
      writeProposals: [
        {
          id: "proposal-1",
          status: "pending",
          tool: "update_item",
          title: "Update Draft",
          summary: "Replace the introduction",
          arguments: { id: "post-1", body: "New introduction" },
          createdAt: "2026-08-24T12:00:00.000Z",
          expiresAt: "2026-08-24T12:10:00.000Z",
        },
      ],
    });

    resetAssistantConversationStore();

    expect(
      assistantConversationMessages("writer", active.id)[0]?.writeProposals,
    ).toMatchObject([{ id: "proposal-1", status: "pending" }]);
  });

  it("counts only live approvals across every workspace context", () => {
    browserStorage();
    const root = activeAssistantConversation("writer", "root")!;
    appendAssistantConversationMessage("writer", root.id, {
      id: "root-proposals",
      role: "assistant",
      text: "Review these changes.",
      writeProposals: [
        {
          id: "pending-root", status: "pending", tool: "update_item",
          title: "Update item", summary: "Update the introduction",
          arguments: { id: "post-1", body: "New introduction" },
          createdAt: "2026-08-24T12:00:00.000Z",
          expiresAt: "2026-08-24T12:10:00.000Z",
        },
        {
          id: "already-approved", status: "approved", tool: "update_item",
          title: "Update item", summary: "Already approved",
          arguments: { id: "post-2", body: "Done" },
          createdAt: "2026-08-24T12:00:00.000Z",
          expiresAt: "2026-08-24T12:10:00.000Z",
        },
        {
          id: "terminal-pending", status: "pending", terminal: true,
          tool: "update_item", title: "Update item",
          summary: "Cannot be retried",
          arguments: { id: "post-3", body: "Uncertain" },
          createdAt: "2026-08-24T12:00:00.000Z",
          expiresAt: "2026-08-24T12:10:00.000Z",
        },
      ],
    });

    const folder = createAssistantConversation("writer", "folder:notes");
    appendAssistantConversationMessage("writer", folder, {
      id: "folder-proposal", role: "assistant",
      text: "Review the folder change.",
      writeProposals: [{
        id: "pending-folder", status: "pending", tool: "move_item",
        title: "Move item", summary: "Move one note",
        arguments: { id: "post-4", folder_path: "projects" },
        createdAt: "2026-08-24T12:00:00.000Z",
        expiresAt: "2026-08-24T12:10:00.000Z",
      }],
    });

    expect(pendingAssistantProposalCount("writer")).toBe(2);
    expect(pendingAssistantConversationSummaries("writer")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contextKey: "folder:notes",
          pendingProposalCount: 1,
        }),
        expect.objectContaining({
          contextKey: "root",
          pendingProposalCount: 1,
        }),
      ]),
    );
  });

  it("bounds each transcript to the most recent 200 messages", () => {
    browserStorage();
    const active = activeAssistantConversation("writer", "root")!;
    for (let index = 0; index < 205; index += 1) {
      appendAssistantConversationMessage("writer", active.id, {
        id: `message-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `Message ${index}`,
      });
    }

    const messages = assistantConversationMessages("writer", active.id);
    expect(messages).toHaveLength(200);
    expect(messages[0]?.id).toBe("message-5");
    expect(messages.at(-1)?.id).toBe("message-204");
  });

  it("bounds stored history to 60 conversations", () => {
    browserStorage();
    for (let index = 0; index < 65; index += 1) {
      const active = activeAssistantConversation("writer", "root")!;
      appendAssistantConversationMessage("writer", active.id, {
        id: `user-${index}`,
        role: "user",
        text: `Conversation ${index}`,
      });
      createAssistantConversation("writer", "root");
    }

    expect(assistantConversationSummaries("writer", "root")).toHaveLength(60);
  });
});
