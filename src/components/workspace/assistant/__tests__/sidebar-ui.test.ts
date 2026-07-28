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
  shouldRetractAssistantSidebar,
} from "@/components/workspace/assistant/AssistantSidebar";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";

describe("assistant sidebar UI", () => {
  it("renders pinned, contextual, resizable, hideable, and attach controls", () => {
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
    expect(html).toContain('aria-label="Unpin assistant"');
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

  it("retracts only an idle unpinned assistant", () => {
    expect(
      shouldRetractAssistantSidebar({
        state: "open",
        pointerWithin: false,
        focusWithin: false,
      }),
    ).toBe(true);
    expect(
      shouldRetractAssistantSidebar({
        state: "open",
        pointerWithin: true,
        focusWithin: false,
      }),
    ).toBe(false);
    expect(
      shouldRetractAssistantSidebar({
        state: "open",
        pointerWithin: false,
        focusWithin: true,
      }),
    ).toBe(false);
    expect(
      shouldRetractAssistantSidebar({
        state: "pinned",
        pointerWithin: false,
        focusWithin: false,
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

  it("offers concise prompt starters that fill the composer", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: "Anthropic",
        messages: [],
        submitting: false,
        onUsePrompt: () => {},
      }),
    );

    expect(html).toContain('aria-label="Prompt starters"');
    expect(html).toContain("Using Anthropic");
    expect(html).toContain("Improve title");
    expect(html).toContain("Summarize page");
    expect(html).toContain("Draft follow-ups");
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
