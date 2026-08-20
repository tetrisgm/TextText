import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/keyboard/CommandLayer", () => ({
  useEscapeLayer: () => {},
}));

import {
  AssistantSidebar,
  isAssistantToggleShortcut,
  resolveAssistantSidebarDimensions,
} from "@/components/workspace/assistant/AssistantSidebar";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";

describe("assistant sidebar UI", () => {
  it("renders contextual, resizable, hideable, and attach controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AssistantSidebar,
        {
          state: "pinned",
          onStateChange: () => {},
          width: 420,
          onWidthChange: () => {},
          composerValue: "",
          onComposerChange: () => {},
          onSubmit: () => {},
          onFilesSelected: () => {},
          onRemoveAttachment: () => {},
          context: { kind: "folder", label: "Notes", detail: "Folder" },
        },
        React.createElement("p", null, "Conversation"),
      ),
    );

    expect(html).toContain('data-state="pinned"');
    expect(html).toContain('aria-label="Context: Notes, Folder"');
    expect(html).toContain('aria-label="Resize assistant sidebar"');
    // No pin control: the rail is open or closed, and the X is the whole
    // close story.
    expect(html).not.toContain("pin assistant");
    expect(html).toContain('aria-label="Hide assistant"');
    expect(html).toContain('aria-label="Add attachment"');
    expect(html).toContain('aria-label="Message assistant"');
    expect(html).toContain('aria-keyshortcuts="Meta+Shift+A Control+Shift+A"');
  });

  it("clamps the rendered and accessible width to narrow viewports", () => {
    expect(
      resolveAssistantSidebarDimensions({
        availableWidth: 240,
        maxWidth: 600,
        minWidth: 280,
        width: 520,
      }),
    ).toEqual({
      resolvedMaxWidth: 240,
      resolvedMinWidth: 240,
      resolvedWidth: 240,
    });
    expect(
      resolveAssistantSidebarDimensions({
        availableWidth: 1_200,
        maxWidth: 600,
        minWidth: 280,
        width: 720,
      }).resolvedWidth,
    ).toBe(600);
  });

  it("recognizes only the documented modified toggle", () => {
    expect(
      isAssistantToggleShortcut({
        altKey: false,
        ctrlKey: false,
        key: "A",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      isAssistantToggleShortcut({
        altKey: false,
        ctrlKey: true,
        key: "a",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      isAssistantToggleShortcut({
        altKey: false,
        ctrlKey: false,
        key: "a",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("renders provider quick actions and an undoable edit preview", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: "Anthropic",
        messages: [
          {
            id: "proposal-1",
            role: "assistant",
            text: "Suggested title",
            proposal: {
              itemId: "post-1",
              field: "title",
              label: "Suggested title",
              before: "Draft",
              after: "A clearer title",
              source: "Draft",
              result: "A clearer title",
              range: { start: 0, end: 5 },
              scope: "selection",
              canApply: true,
              status: "pending",
            },
          },
        ],
        quickActions: [
          {
            id: "summarize",
            label: "Summarize",
            description: "Summarize selected text with Anthropic",
          },
          { id: "title", label: "Title", description: "Suggest a title" },
        ],
        submitting: false,
      }),
    );

    expect(html).toContain('aria-label="Assistant actions"');
    expect(html).toContain('title="Summarize selected text with Anthropic"');
    expect(html).toContain('role="log"');
    expect(html).toContain("Summarize");
    expect(html).toContain("title selection, source offsets 0 to 5");
    expect(html).toContain("Original");
    expect(html).toContain("Draft");
    expect(html).toContain("Replacement");
    expect(html).toContain("A clearer title");
    expect(html).toContain(">Apply<");
  });

  it("labels provider work and answers", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        activeCloudProvider: "OpenAI",
        cloudProvider: "OpenAI",
        messages: [
          {
            id: "cloud-1",
            role: "assistant",
            text: "Cloud answer",
            provider: "OpenAI",
          },
        ],
        submitting: true,
      }),
    );

    expect(html).toContain("Answered by OpenAI");
    expect(html).toContain("Thinking with OpenAI");
    expect(html).not.toContain("off this Mac");
  });

  it("greets the reader and offers starters that name the open item", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: "Anthropic",
        messages: [],
        submitting: false,
        onUsePrompt: () => {},
        viewerName: "Ramine Darabiha",
        starterContext: { level: "item", label: "The Invisible Hand of Super Metroid" },
      }),
    );

    expect(html).toContain('aria-label="Prompt starters"');
    // The greeting leads, not which provider happens to be wired up.
    expect(html).toMatch(/Good (morning|afternoon|evening), Ramine/);
    expect(html).not.toContain("Using Anthropic");
    // Naming the item is the whole point of the starters.
    expect(html).toContain("Super Metroid");
    expect(html).toContain("Challenge my thinking");
  });

  it("leads with one connect action when no AI is wired up", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: null,
        messages: [],
        submitting: false,
        onUsePrompt: () => {},
        viewerName: "Ramine",
      }),
    );

    // Every service is a row that opens into its numbered steps; the closed
    // row states the service and where it runs, never a bare glyph.
    expect(html).toContain("Write with your AI");
    expect(html).toContain('aria-label="Ways to connect"');
    expect(html).toContain("Claude");
    expect(html).toContain("Codex");
    expect(html).toContain("ChatGPT");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Set up the in-app assistant");
    expect(html).not.toMatch(/Good (morning|afternoon|evening)/);
    expect(html).not.toContain('aria-label="Prompt starters"');
    expect(html).not.toContain("Catch me up");
  });

  it("does not offer embedded ChatGPT when the native channel cannot run it", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: null,
        messages: [],
        submitting: false,
        nativeConnection: {
          state: "unavailable",
          kind: "native-codex",
          providerLabel: "Codex with ChatGPT",
          accountEmail: null,
          planLabel: null,
          runtimeVersion: null,
          rateLimitResetAt: null,
          lastHealthCheckAt: null,
          embeddedChatSupported: false,
          recoveryAction: "open-settings",
        },
        onConnectNative: () => {},
        aiSettingsHref: "/@writer?view=settings#api-key-connections",
      }),
    );

    expect(html).toContain("Use an API key for the in-app assistant");
    expect(html).not.toContain("Continue with ChatGPT");
    expect(html).toContain('aria-label="Ways to connect"');
    expect(html).toContain('href="/@writer?view=settings#api-key-connections"');
  });

  it("explains selected-text context and unavailable attachments", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantSidebar, {
        state: "open",
        onStateChange: () => {},
        width: 360,
        onWidthChange: () => {},
        composerValue: "",
        onComposerChange: () => {},
        onSubmit: () => {},
        onFilesSelected: () => {},
        onRemoveAttachment: () => {},
        context: {
          kind: "item",
          label: "Draft",
          detail: "Selected body text",
        },
        attachmentDisabled: true,
        attachmentTitle: "Attachments are not available for provider connections yet",
      }),
    );

    expect(html).toContain('aria-label="Context: Draft, Selected body text"');
    expect(html).toContain(
      'title="Attachments are not available for provider connections yet"',
    );
    expect(html).toContain('aria-label="Choose assistant attachments"');
    expect(html).toContain('aria-keyshortcuts="Enter"');
  });
});

describe("starting a new chat", () => {
  it("offers New chat only when there is a transcript to clear", () => {
    const base = {
      state: "open" as const,
      onStateChange: () => {},
      width: 360,
      onWidthChange: () => {},
      composerValue: "",
      onComposerChange: () => {},
      onSubmit: () => {},
      onFilesSelected: () => {},
      onRemoveAttachment: () => {},
      onNewConversation: () => {},
    };
    const withTranscript = renderToStaticMarkup(
      React.createElement(AssistantSidebar, { ...base, hasConversation: true }),
    );
    const empty = renderToStaticMarkup(
      React.createElement(AssistantSidebar, { ...base, hasConversation: false }),
    );
    expect(withTranscript).toContain('aria-label="New chat"');
    expect(empty).not.toContain('aria-label="New chat"');
  });

  it("shows nothing when the caller cannot clear a conversation", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantSidebar, {
        state: "open",
        onStateChange: () => {},
        width: 360,
        onWidthChange: () => {},
        composerValue: "",
        onComposerChange: () => {},
        onSubmit: () => {},
        onFilesSelected: () => {},
        onRemoveAttachment: () => {},
        hasConversation: true,
      }),
    );
    expect(html).not.toContain('aria-label="New chat"');
  });
});
