import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/keyboard/CommandLayer", () => ({
  useEscapeLayer: () => {},
}));
vi.mock("@/app/editor/mcp-connection-actions", () => ({
  getMcpConnectionsAction: async () => [],
}));

import { AssistantSidebar } from "@/components/workspace/assistant/AssistantSidebar";
import { useNativeAssistant } from "@/components/workspace/assistant/useNativeAssistant";

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

  return React.createElement(AssistantSidebar, {
    state: "pinned",
    onStateChange: () => {},
    width: 360,
    onWidthChange: () => {},
    composerValue: "",
    onComposerChange: () => {},
    onSubmit: () => {},
    onFilesSelected: () => {},
    onRemoveAttachment: () => {},
    onNewConversation: assistant.startNewConversation,
    hasConversation: assistant.messages.length > 0,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assistant transcript hydration", () => {
  it("renders the server snapshot before restoring a stored conversation", () => {
    const sessionStorage = {
      getItem: vi.fn(() =>
        JSON.stringify([
          { id: "saved-message", role: "user", text: "Saved question" },
        ]),
      ),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    vi.stubGlobal("sessionStorage", sessionStorage);

    const html = renderToStaticMarkup(
      React.createElement(HydrationTranscriptSidebar),
    );

    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(html).toContain('aria-label="Hide assistant"');
    expect(html).not.toContain('aria-label="New chat"');
  });
});
