import { describe, expect, it } from "vitest";
import {
  cleanAssistantConversationSyncPayload,
  mergeAssistantConversationSyncPayloads,
} from "@/lib/ai/assistant-conversation-sync";

function chat(
  id: string,
  options: {
    messages?: Array<Record<string, unknown>>;
    pinned?: boolean;
    metadataUpdatedAt?: string;
    title?: string;
    updatedAt?: string;
  } = {},
) {
  const updatedAt = options.updatedAt ?? "2026-08-24T12:00:00.000Z";
  return {
    id,
    contextKey: "root",
    title: options.title ?? `Chat ${id}`,
    pinned: options.pinned ?? false,
    metadataUpdatedAt: options.metadataUpdatedAt ?? updatedAt,
    createdAt: "2026-08-24T10:00:00.000Z",
    updatedAt,
    messages: options.messages ?? [],
  };
}

describe("assistant conversation replica merge", () => {
  it("merges independent messages deterministically", () => {
    const left = [
      chat("chat-1", {
        messages: [
          {
            id: "message-a",
            role: "user",
            text: "Question from the Mac",
            updatedAt: "2026-08-24T12:01:00.000Z",
          },
        ],
      }),
    ];
    const right = [
      chat("chat-1", {
        messages: [
          {
            id: "message-b",
            role: "assistant",
            text: "Answer from the phone",
            updatedAt: "2026-08-24T12:02:00.000Z",
          },
        ],
      }),
    ];

    const forward = mergeAssistantConversationSyncPayloads(left, right);
    const reverse = mergeAssistantConversationSyncPayloads(right, left);

    expect(forward).toEqual(reverse);
    expect(forward[0]?.messages.map((message) => message.id)).toEqual([
      "message-a",
      "message-b",
    ]);
  });

  it("uses message and metadata clocks to resolve conflicts", () => {
    const older = [
      chat("chat-1", {
        title: "Old title",
        pinned: false,
        metadataUpdatedAt: "2026-08-24T12:00:00.000Z",
        messages: [
          {
            id: "same-message",
            role: "assistant",
            text: "Partial answer",
            updatedAt: "2026-08-24T12:01:00.000Z",
          },
        ],
      }),
    ];
    const newer = [
      chat("chat-1", {
        title: "Pinned research",
        pinned: true,
        metadataUpdatedAt: "2026-08-24T12:03:00.000Z",
        messages: [
          {
            id: "same-message",
            role: "assistant",
            text: "Finished answer",
            updatedAt: "2026-08-24T12:02:00.000Z",
          },
        ],
      }),
    ];

    expect(mergeAssistantConversationSyncPayloads(older, newer)[0]).toMatchObject({
      title: "Pinned research",
      pinned: true,
      messages: [{ text: "Finished answer" }],
    });
  });

  it("lets a deletion tombstone win the merge in both directions", () => {
    const live = [
      chat("chat-1", {
        title: "Garbage chat",
        updatedAt: "2026-08-24T14:00:00.000Z",
        messages: [
          {
            id: "message-a",
            role: "user",
            text: "Old content that should stop existing",
            updatedAt: "2026-08-24T14:00:00.000Z",
          },
        ],
      }),
    ];
    const deleted = [
      {
        ...chat("chat-1", { updatedAt: "2026-08-24T13:00:00.000Z" }),
        deletedAt: "2026-08-24T13:00:00.000Z",
      },
    ];

    const forward = mergeAssistantConversationSyncPayloads(live, deleted);
    const reverse = mergeAssistantConversationSyncPayloads(deleted, live);

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({
      id: "chat-1",
      title: "Deleted chat",
      deletedAt: "2026-08-24T13:00:00.000Z",
      messages: [],
    });
  });

  it("keeps tombstones from evicting live chats and vice versa", () => {
    const live = Array.from({ length: 60 }, (_, index) =>
      chat(`live-${index.toString().padStart(2, "0")}`, {
        updatedAt: `2026-08-24T12:${index.toString().padStart(2, "0")}:00.000Z`,
      }),
    );
    const tombstones = Array.from({ length: 10 }, (_, index) => ({
      ...chat(`gone-${index}`, { updatedAt: "2026-08-24T14:00:00.000Z" }),
      deletedAt: "2026-08-24T14:00:00.000Z",
    }));

    const cleaned = cleanAssistantConversationSyncPayload([
      ...tombstones,
      ...live,
    ]);

    expect(
      cleaned.filter((conversation) => !conversation.deletedAt),
    ).toHaveLength(60);
    expect(
      cleaned.filter((conversation) => conversation.deletedAt),
    ).toHaveLength(10);
  });

  it("enforces 60 chats and 200 messages", () => {
    const conversations = Array.from({ length: 65 }, (_, chatIndex) =>
      chat(`chat-${chatIndex.toString().padStart(2, "0")}`, {
        updatedAt: `2026-08-24T12:${chatIndex.toString().padStart(2, "0")}:00.000Z`,
        messages: Array.from({ length: 205 }, (_, messageIndex) => ({
          id: `message-${messageIndex}`,
          role: messageIndex % 2 ? "assistant" : "user",
          text: `Message ${messageIndex}`,
          updatedAt: `2026-08-24T12:00:${(messageIndex % 60).toString().padStart(2, "0")}.000Z`,
        })),
      }),
    );

    const cleaned = cleanAssistantConversationSyncPayload(conversations);

    expect(cleaned).toHaveLength(60);
    expect(cleaned.every((conversation) => conversation.messages.length <= 200)).toBe(true);
  });

  it("removes credential fields and redacts token-shaped text", () => {
    const cleaned = cleanAssistantConversationSyncPayload([
      chat("chat-1", {
        messages: [
          {
            id: "message-1",
            role: "user",
            text:
              "Use api key = sk-supersecret123 or wsk_workspace-token-123 for this",
            updatedAt: "2026-08-24T12:00:00.000Z",
            accessToken: "never-sync-this",
            nested: { password: "also-never", safe: "kept" },
          },
        ],
      }),
    ]);
    const serialized = JSON.stringify(cleaned);

    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("workspace-token");
    expect(serialized).not.toContain("never-sync");
    expect(serialized).not.toContain("also-never");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("kept");
  });

  it("omits an approval preview when sync scrubs any proposal argument", () => {
    const cleaned = cleanAssistantConversationSyncPayload([
      chat("chat-1", {
        messages: [
          {
            id: "proposal-message",
            role: "assistant",
            text: "Review the proposed change.",
            updatedAt: "2026-08-24T12:00:00.000Z",
            writeProposals: [
              {
                id: "proposal-1",
                status: "pending",
                tool: "update_item",
                title: "Update Draft",
                summary: "Update the body",
                arguments: { id: "post-1", apiKey: "must-not-sync" },
              },
            ],
          },
        ],
      }),
    ]);

    expect(cleaned[0]?.messages[0]?.text).toBe(
      "Review the proposed change.",
    );
    expect(cleaned[0]?.messages[0]?.writeProposals).toBeUndefined();
  });

  it("keeps an exact complete proposal preview", () => {
    const cleaned = cleanAssistantConversationSyncPayload([
      chat("chat-1", {
        messages: [
          {
            id: "proposal-message",
            role: "assistant",
            text: "Review the proposed change.",
            updatedAt: "2026-08-24T12:00:00.000Z",
            writeProposals: [
              {
                id: "proposal-1",
                status: "pending",
                tool: "update_item",
                title: "Update Draft",
                summary: "Update the body",
                arguments: { id: "post-1", body: "Safe exact preview" },
              },
            ],
          },
        ],
      }),
    ]);

    expect(cleaned[0]?.messages[0]?.writeProposals).toMatchObject([
      { id: "proposal-1", arguments: { body: "Safe exact preview" } },
    ]);
  });

  it("rejects a far-future clock instead of letting it dominate", () => {
    const legitimate = [
      chat("chat-1", {
        title: "Current title",
        metadataUpdatedAt: new Date().toISOString(),
      }),
    ];
    const hostile = [
      chat("chat-1", {
        title: "Future title",
        createdAt: "2099-01-01T00:00:00.000Z",
        updatedAt: "2099-01-01T00:00:00.000Z",
        metadataUpdatedAt: "2099-01-01T00:00:00.000Z",
      } as never),
    ];

    expect(
      mergeAssistantConversationSyncPayloads(legitimate, hostile)[0]?.title,
    ).toBe("Current title");
  });

  it("enforces workspace size using UTF-8 bytes", () => {
    const cleaned = cleanAssistantConversationSyncPayload(
      Array.from({ length: 60 }, (_, index) =>
        chat(`emoji-${index}`, {
          messages: [
            {
              id: `message-${index}`,
              role: "user",
              text: "😀".repeat(16_000),
              updatedAt: "2026-08-24T12:00:00.000Z",
            },
          ],
        }),
      ),
    );
    const bytes = new TextEncoder().encode(JSON.stringify(cleaned)).byteLength;
    expect(bytes).toBeLessThanOrEqual(4_000_000);
  });
});

describe("what a synced message can carry", () => {
  /** A staged item type: the deepest thing a real proposal nests. */
  const blueprintProposal = {
    id: "proposal-1",
    kind: "workspace",
    status: "pending",
    tool: "create_item_type",
    title: "Create item type",
    summary: "Create item type: blog/reading-log",
    arguments: {
      folder_path: "blog/reading-log",
      blueprint: {
        name: "Reading log",
        fields: [
          {
            id: "verdict",
            type: "enum",
            options: [
              { value: "keep", label: "Keep" },
              { value: "pass", label: "Pass" },
            ],
          },
        ],
      },
    },
    createdAt: "2026-08-27T09:00:00.000Z",
    expiresAt: "2026-08-27T09:15:00.000Z",
  };

  it("keeps a write proposal whose arguments nest as deeply as a blueprint", () => {
    const [conversation] = cleanAssistantConversationSyncPayload([
      chat("c1", {
        messages: [
          {
            id: "m1",
            role: "assistant",
            text: "Review the proposed change.",
            updatedAt: "2026-08-27T09:00:00.000Z",
            writeProposals: [blueprintProposal],
          },
        ],
      }),
    ]);
    const proposals = conversation?.messages[0]?.writeProposals as
      | Array<Record<string, unknown>>
      | undefined;
    expect(proposals?.[0]?.id).toBe("proposal-1");
    const args = proposals?.[0]?.arguments as Record<string, unknown>;
    const blueprint = args.blueprint as Record<string, unknown>;
    const fields = blueprint.fields as Array<Record<string, unknown>>;
    const options = fields[0].options as Array<Record<string, unknown>>;
    expect(options[0]).toEqual({ value: "keep", label: "Keep" });
  });
});
