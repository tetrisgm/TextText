import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/keyboard/CommandLayer", () => ({
  useEscapeLayer: () => {},
}));
vi.mock("@/app/editor/mcp-connection-actions", () => ({
  getMcpConnectionsAction: async () => [],
}));
vi.mock("@/app/editor/agent-instructions-actions", () => ({
  getWorkspaceAgentPromptAction: async () => "",
}));
vi.mock("@/app/editor/assistant-conversation-actions", () => ({
  getAssistantConversationCacheScopeAction: async () => null,
  syncAssistantConversationsAction: async () => ({
    allowed: false,
    conversations: [],
  }),
}));
vi.mock("@/app/editor/agent-skill-metadata-actions", () => ({
  getWorkspaceAgentSkillMetadataAction: async () => [],
}));

import { AssistantSidebar } from "@/components/workspace/assistant/AssistantSidebar";
import {
  AssistantConversationState,
  type AssistantConversationView,
} from "@/components/workspace/assistant/AssistantConversationState";
import { useNativeAssistant } from "@/components/workspace/assistant/useNativeAssistant";
import { resetAssistantConversationStore } from "@/components/workspace/assistant/conversation-store";

function HydrationTranscriptSidebar() {
  const assistant = useNativeAssistant({
    handle: "hydration-writer",
    contextKey: "place:/hydration-proof",
    getPool: () => null,
    getView: () => ({ level: "root" }),
    openItem: () => {},
    readItemText: async () => ({ body: "", excerpt: "", title: "" }),
    applyItemPatch: () => {},
  });

  // A render function is the state boundary's public child API. This test is
  // plain `.ts`, so JSX cannot express it as nested content.
  // eslint-disable-next-line react/no-children-prop
  return React.createElement(AssistantConversationState, {
    activeConversationId: assistant.activeConversationId,
    contextKey: assistant.conversationContextKey,
    handle: "hydration-writer",
    ownerScopeReady: assistant.ownerScopeReady,
    storeKey: assistant.conversationStoreKey,
    children: (conversation: AssistantConversationView) =>
      React.createElement(AssistantSidebar, {
        state: "pinned",
        onStateChange: () => {},
        width: 360,
        onWidthChange: () => {},
        composerValue: "Draft kept while access resolves",
        onComposerChange: () => {},
        onSubmit: () => {},
        onFilesSelected: () => {},
        onRemoveAttachment: () => {},
        onNewConversation: assistant.startNewConversation,
        hasConversation: conversation.messages.length > 0,
        submitDisabled: !assistant.ownerScopeReady,
      }),
  });
}

afterEach(() => {
  resetAssistantConversationStore();
  vi.unstubAllGlobals();
});

describe("assistant transcript hydration", () => {
  it("renders the server snapshot before restoring a stored conversation", () => {
    const localStorage = {
      getItem: vi.fn(() =>
        JSON.stringify({
          version: 1,
          activeByContext: { "place:/hydration-proof": "saved-chat" },
          conversations: [
            {
              id: "saved-chat",
              contextKey: "place:/hydration-proof",
              title: "Saved question",
              pinned: false,
              createdAt: "2026-08-24T12:00:00.000Z",
              updatedAt: "2026-08-24T12:00:00.000Z",
              messages: [
                { id: "saved-message", role: "user", text: "Saved question" },
              ],
            },
          ],
        }),
      ),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage: {
        getItem: vi.fn(),
        removeItem: vi.fn(),
        setItem: vi.fn(),
      },
    });

    const html = renderToStaticMarkup(
      React.createElement(HydrationTranscriptSidebar),
    );

    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(html).toContain('aria-label="Hide assistant"');
    expect(html).not.toContain('aria-label="New chat"');
    expect(html).toContain("Draft kept while access resolves");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Send message"/,
    );
  });
});
