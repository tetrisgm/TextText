import { describe, expect, it } from "vitest";
import {
  assistantOwnerScopeMatches,
  nativeEventMatchesTurnFence,
  type NativeTurnFence,
} from "../native-turn-fence";

const fence: NativeTurnFence = {
  conversationId: "conversation-a",
  handle: "owner-workspace",
  ownerScopeKey: "owner-workspace:opaque-owner",
  threadKey: "owner-workspace:opaque-owner\u001fconversation-a",
};

describe("native assistant turn fencing", () => {
  it("invalidates prompt preparation as soon as owner scope changes", () => {
    const expected = {
      handle: "owner-workspace",
      ownerScopeKey: "owner-workspace:opaque-owner",
    };
    expect(assistantOwnerScopeMatches(expected, expected)).toBe(true);
    expect(
      assistantOwnerScopeMatches(
        { ...expected, handle: "collaborator-workspace" },
        expected,
      ),
    ).toBe(false);
    expect(
      assistantOwnerScopeMatches(
        { handle: "owner-workspace", ownerScopeKey: null },
        expected,
      ),
    ).toBe(false);
  });

  it("accepts only the exact active owner, workspace, and conversation", () => {
    expect(
      nativeEventMatchesTurnFence({
        currentHandle: "owner-workspace",
        currentOwnerScopeKey: "owner-workspace:opaque-owner",
        eventConversationId: "conversation-a",
        fence,
      }),
    ).toBe(true);
  });

  it.each([
    ["missing event id", undefined, "owner-workspace", "owner-workspace:opaque-owner"],
    ["other conversation", "conversation-b", "owner-workspace", "owner-workspace:opaque-owner"],
    ["other workspace", "conversation-a", "other-workspace", "owner-workspace:opaque-owner"],
    ["other owner scope", "conversation-a", "owner-workspace", "owner-workspace:other-owner"],
    ["unresolved owner", "conversation-a", "owner-workspace", null],
  ])("rejects %s", (_label, eventConversationId, currentHandle, currentOwnerScopeKey) => {
    expect(
      nativeEventMatchesTurnFence({
        currentHandle,
        currentOwnerScopeKey,
        eventConversationId,
        fence,
      }),
    ).toBe(false);
  });

  it("rejects every event when there is no active turn", () => {
    expect(
      nativeEventMatchesTurnFence({
        currentHandle: "owner-workspace",
        currentOwnerScopeKey: "owner-workspace:opaque-owner",
        eventConversationId: "conversation-a",
        fence: null,
      }),
    ).toBe(false);
  });
});
