import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  syncHistory: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/ai/assistant-conversation-history.server", () => ({
  syncWorkspaceAssistantConversationHistory: mocks.syncHistory,
}));

import {
  getAssistantConversationCacheScopeAction,
  syncAssistantConversationsAction,
} from "@/app/editor/assistant-conversation-actions";

describe("assistant conversation sync action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-1",
      ownerId: "owner-1",
    });
    mocks.syncHistory.mockResolvedValue([]);
  });

  it("syncs only through the exact owned workspace id", async () => {
    await expect(
      syncAssistantConversationsAction("Writer", [{ id: "chat-1" }]),
    ).resolves.toEqual({ allowed: true, conversations: [] });
    expect(mocks.getBlogEditAccess).toHaveBeenCalledWith("writer");
    expect(mocks.syncHistory).toHaveBeenCalledWith("blog-1", [
      { id: "chat-1" },
    ]);
  });

  it("does not expose history to a collaborator", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: false,
      blogId: "blog-1",
      ownerId: "collaborator-1",
    });

    await expect(
      syncAssistantConversationsAction("writer", [{ id: "chat-1" }]),
    ).resolves.toEqual({ allowed: false, conversations: [] });
    expect(mocks.syncHistory).not.toHaveBeenCalled();
    await expect(
      getAssistantConversationCacheScopeAction("writer"),
    ).resolves.toBeNull();
  });

  it("returns an opaque cache scope that changes with the signed-in owner", async () => {
    const first = await getAssistantConversationCacheScopeAction("writer");
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-1",
      ownerId: "owner-2",
    });
    const second = await getAssistantConversationCacheScopeAction("writer");

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
  });

  it("fails closed without blocking the local offline replica", async () => {
    mocks.syncHistory.mockRejectedValue(new Error("offline"));

    await expect(
      syncAssistantConversationsAction("writer", [{ id: "local-chat" }]),
    ).resolves.toEqual({ allowed: false, conversations: [] });
  });
});
