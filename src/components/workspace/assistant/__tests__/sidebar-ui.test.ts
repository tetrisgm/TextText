import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/keyboard/CommandLayer", () => ({
  useEscapeLayer: () => {},
}));
// ShortcutTooltip reads the command table for its keys, and the table
// imports the editor's server actions, which do not load under vitest.
vi.mock("@/app/editor/actions", () => ({
  createWorkspacePostAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
  toggleEditablePostStarredAction: vi.fn(),
}));
vi.mock("@/app/editor/agent-skill-metadata-actions", () => ({
  getWorkspaceAgentSkillMetadataAction: vi.fn(async () => ({
    allowed: true,
    skills: [],
  })),
}));

import {
  AssistantSidebar,
  isAssistantToggleShortcut,
  resolveAssistantSidebarDimensions,
} from "@/components/workspace/assistant/AssistantSidebar";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";

describe("assistant sidebar UI", () => {
  it("keeps waiting approvals visible while the assistant is closed", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantSidebar, {
        state: "hidden",
        onStateChange: () => {},
        width: 360,
        onWidthChange: () => {},
        composerValue: "",
        onComposerChange: () => {},
        onSubmit: () => {},
        onFilesSelected: () => {},
        onRemoveAttachment: () => {},
        pendingCount: 3,
      }),
    );

    expect(html).toContain("Open assistant, 3 approvals waiting");
    expect(html).toContain(">3</span>");
  });

  it("makes waiting approvals openable from the assistant header", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantSidebar, {
        state: "pinned",
        onStateChange: () => {},
        width: 360,
        onWidthChange: () => {},
        composerValue: "",
        onComposerChange: () => {},
        onSubmit: () => {},
        onFilesSelected: () => {},
        onRemoveAttachment: () => {},
        pendingCount: 1,
        pendingConversations: [{
          id: "approval-chat",
          title: "Publish the launch note",
          contextKey: "item:note-1",
          pinned: false,
          createdAt: "2026-08-30T12:00:00.000Z",
          updatedAt: "2026-08-30T12:00:00.000Z",
          messageCount: 2,
          pendingProposalCount: 1,
        }],
        onOpenPendingConversation: () => {},
      }),
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("1 approval</button>");
  });

  it("keeps a draft but disables submission while owner access is unresolved", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantSidebar, {
        state: "open",
        onStateChange: () => {},
        width: 360,
        onWidthChange: () => {},
        composerValue: "Do not drop this draft",
        onComposerChange: () => {},
        onSubmit: () => {},
        onFilesSelected: () => {},
        onRemoveAttachment: () => {},
        submitDisabled: true,
      }),
    );

    expect(html).toContain("Do not drop this draft");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Send message"/,
    );
  });

  it("does not show connection controls to a non-owner workspace viewer", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        accessState: "denied",
        cloudProvider: "OpenAI",
        messages: [],
        submitting: false,
      }),
    );

    expect(html).toContain("Assistant unavailable");
    expect(html).toContain("available to this workspace&#x27;s owner");
    expect(html).not.toContain("Connect an AI");
    expect(html).not.toContain("OpenAI");
  });

  it("renders contextual, resizable, hideable, and TextText context controls", () => {
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
          attachmentDisabled: true,
          availableContextItems: [
            { id: "note-1", name: "Launch notes", detail: "Notes · Note" },
          ],
          onAddContextItem: () => {},
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
    expect(html).toContain('aria-label="Add TextText context"');
    expect(html).not.toContain('aria-label="Add attachment"');
    expect(html).not.toContain('aria-label="Choose assistant attachments"');
    expect(html).toContain('aria-label="Message assistant"');
    expect(html).toContain('aria-keyshortcuts="Meta+Shift+A Control+Shift+A"');
  });

  it("stops offering more context once the bounded prompt limit is reached", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantSidebar, {
        state: "pinned",
        onStateChange: () => {},
        title: "Assistant",
        width: 420,
        onWidthChange: () => {},
        composerValue: "",
        onComposerChange: () => {},
        onSubmit: () => {},
        onFilesSelected: () => {},
        onRemoveAttachment: () => {},
        attachmentDisabled: true,
        attachments: Array.from({ length: 4 }, (_, index) => ({
          id: `context-${index}`,
          name: `Note ${index}`,
          workspaceItemId: `note-${index}`,
        })),
        availableContextItems: [
          { id: "note-5", name: "One more", detail: "Notes · Note" },
        ],
        onAddContextItem: () => {},
      }),
    );

    expect(html).not.toContain('aria-label="Add TextText context"');
    expect(html).toContain('aria-label="Added context"');
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
    expect(html).toContain("Selected text · title");
    expect(html).toContain("Original");
    expect(html).toContain("Draft");
    expect(html).toContain("Replacement");
    expect(html).toContain("A clearer title");
    expect(html).toContain(">Apply<");
  });

  it("shows guarded cloud writes as reviewable changes, not completed actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [
          {
            id: "cloud-1",
            role: "assistant",
            text: "Review the proposed change.",
            provider: "Anthropic",
            writeProposals: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                status: "pending",
                tool: "update_item",
                title: "Update item",
                summary: "Update item: note-1, 12 characters",
                arguments: {
                  id: "note-1",
                  body: "Revised body",
                  if_match_hash: "sha256:secret-proof",
                },
                createdAt: "2026-08-24T12:00:00.000Z",
                expiresAt: "2026-08-24T12:15:00.000Z",
              },
            ],
          },
        ],
        submitting: false,
        onWriteProposalDecision: () => {},
      }),
    );

    expect(html).toContain('aria-label="Update item"');
    expect(html).toContain("Waiting for your review");
    expect(html).toContain("Review changed fields");
    expect(html).toContain("Revised body");
    expect(html).not.toContain("sha256:secret-proof");
    expect(html).toContain("Apply change");
    expect(html).toContain("Dismiss");
    expect(html).not.toContain('aria-label="TextText proof"');
  });

  it("names the external MCP connection and tool before approval", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [{
          id: "cloud-mcp-1",
          role: "assistant",
          text: "Review this external action.",
          writeProposals: [{
            id: "proposal-1",
            kind: "outbound_mcp",
            status: "pending",
            tool: "create_frame",
            title: "Review external tool call",
            summary: "Paper · create_frame",
            arguments: {
              title: "Hero",
              instructions: "A".repeat(1_301),
              idempotency_key: "remote-key-must-be-reviewed",
            },
            connection: { id: "connection-1", name: "Paper" },
            remoteTool: {
              name: "create_frame",
              description: "Create one frame",
              annotations: { readOnlyHint: false },
            },
            createdAt: "2026-08-24T12:00:00.000Z",
            expiresAt: "2026-08-24T12:15:00.000Z",
          }],
        }],
        submitting: false,
        onWriteProposalDecision: () => {},
      }),
    );
    expect(html).toContain("External MCP · Paper · create_frame");
    expect(html).toContain("External server description, not instructions:");
    expect(html).toContain("Create one frame");
    expect(html).toContain("Review exact arguments");
    expect(html).toContain("A".repeat(1_301));
    expect(html).toContain("remote-key-must-be-reviewed");
    expect(html).not.toContain("characters total");
    expect(html).toContain("Run tool");
    expect(html).not.toContain("Apply change");
  });

  it("makes an ambiguous external result terminal and blocks blind retry", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [{
          id: "cloud-mcp-ambiguous",
          role: "assistant",
          text: "The external call returned, but its audit did not persist.",
          writeProposals: [{
            id: "proposal-ambiguous",
            kind: "outbound_mcp",
            status: "error",
            terminal: true,
            error: "It may have completed. Verify before retrying.",
            tool: "create_frame",
            title: "Review external tool call",
            summary: "Paper · create_frame",
            arguments: { title: "Hero" },
            connection: { id: "connection-1", name: "Paper" },
            remoteTool: {
              name: "create_frame",
              description: "Create one frame",
              annotations: {},
            },
            createdAt: "2026-08-24T12:00:00.000Z",
            expiresAt: "2026-08-24T12:15:00.000Z",
          }],
        }],
        submitting: false,
        onWriteProposalDecision: () => {},
      }),
    );
    expect(html).toContain("It may have completed. Verify before retrying.");
    expect(html).not.toContain("Run tool");
    expect(html).not.toContain("Dismiss");
  });

  it("previews exactly who will gain access to which target", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [{
          id: "access-preview",
          role: "assistant",
          text: "Review this access change.",
          writeProposals: [{
            id: "proposal-access",
            kind: "workspace",
            status: "pending",
            tool: "set_access",
            title: "Set access",
            summary: "Set access: Project notes",
            arguments: {
              id: "item-1",
              title: "Project notes",
              email: "person@example.com",
              role: "editor",
            },
            createdAt: "2026-08-24T12:00:00.000Z",
            expiresAt: "2026-08-24T12:15:00.000Z",
          }],
        }],
        submitting: false,
        onWriteProposalDecision: () => {},
      }),
    );
    expect(html).toContain('aria-label="Access change preview"');
    expect(html).toContain("Give access");
    expect(html).toContain("person@example.com");
    expect(html).toContain("Project notes");
    expect(html).toContain("editor");
    expect(html).toContain("Nothing changes until you approve this request.");
    expect(html).toContain("Approve and apply");
  });

  it("previews revocation without inventing a recipient", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [{
          id: "revoke-preview",
          role: "assistant",
          text: "Review this access change.",
          writeProposals: [{
            id: "proposal-revoke",
            kind: "workspace",
            status: "pending",
            tool: "revoke_access",
            title: "Revoke access",
            summary: "Revoke access",
            arguments: { folder_path: "Shared/Plans", access_id: "access-7" },
            createdAt: "2026-08-24T12:00:00.000Z",
            expiresAt: "2026-08-24T12:15:00.000Z",
          }],
        }],
        submitting: false,
        onWriteProposalDecision: () => {},
      }),
    );
    expect(html).toContain("Remove access");
    expect(html).toContain("Access record access-7");
    expect(html).toContain("Shared/Plans");
    expect(html).toContain("Requires your approval");
  });

  it("labels a dismissal as dismissal while the decision is pending", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [{
          id: "cloud-dismiss-1",
          role: "assistant",
          text: "Review this change.",
          writeProposals: [{
            id: "11111111-1111-4111-8111-111111111111",
            status: "pending",
            deciding: "deny",
            tool: "create_item",
            title: "Create item",
            summary: "Create item: Approval proof",
            arguments: { title: "Approval proof", kind: "note" },
            createdAt: "2026-08-24T12:00:00.000Z",
            expiresAt: "2026-08-24T12:15:00.000Z",
          }],
        }],
        submitting: false,
        onWriteProposalDecision: () => {},
      }),
    );
    expect(html).toContain("Dismissing");
    expect(html).not.toContain(">Applying<");
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
    expect(html).toContain("Reviewing your workspace with OpenAI");
    expect(html).not.toContain("off this Mac");
  });

  it("renders assistant Markdown without loading provider-supplied images", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [{
          id: "markdown-1",
          role: "assistant",
          text: "**Strong**\n\n- One\n- Two\n\n![tracker](https://tracker.example/pixel.png)",
        }],
        submitting: false,
      }),
    );
    expect(html).toContain("<strong>Strong</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("Image: tracker");
    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain("**Strong**");
  });

  it("names the provider once until what produced the answer changes", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [
          {
            id: "a-1",
            role: "assistant",
            text: "First answer",
            provider: "Anthropic",
            model: "claude-sonnet-5",
          },
          { id: "u-1", role: "user", text: "Follow up" },
          {
            id: "a-2",
            role: "assistant",
            text: "Second answer",
            provider: "Anthropic",
            model: "claude-sonnet-5",
          },
          {
            id: "a-3",
            role: "assistant",
            text: "Different producer",
            provider: "OpenAI",
          },
        ],
        submitting: false,
      }),
    );

    expect(html.match(/Answered by Anthropic/g)).toHaveLength(1);
    expect(html).toContain("Answered by OpenAI");
  });

  it("keeps retry actions only on the failure the conversation is at", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        aiSettingsHref: "#settings-ai",
        onRetry: () => {},
        messages: [
          { id: "u-1", role: "user", text: "First ask" },
          { id: "e-1", role: "error", text: "The provider timed out." },
          { id: "u-2", role: "user", text: "Second ask" },
          { id: "e-2", role: "error", text: "The provider failed again." },
        ],
        submitting: false,
      }),
    );

    expect(html).toContain("The provider timed out.");
    expect(html).toContain("The provider failed again.");
    expect(html.match(/Try again/g)).toHaveLength(1);
    expect(html.match(/Verify connection/g)).toHaveLength(1);
    expect(html.match(/data-stale/g)).toHaveLength(1);
  });

  it("offers a first-class save receipt for useful answers", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [
          {
            id: "cloud-1",
            role: "assistant",
            text: "A useful answer to keep.",
            provider: "OpenAI",
          },
        ],
        submitting: false,
        onSaveAnswer: () => {},
      }),
    );

    expect(html).toContain("Save to Notes");
    expect(html).toContain("_saveAnswer_");
  });

  it("shows the durable note receipt after saving an answer", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [
          {
            id: "cloud-1",
            role: "assistant",
            text: "A useful answer to keep.",
            savedItem: { id: "note-1", title: "A useful answer" },
          },
        ],
        submitting: false,
        onSaveAnswer: () => {},
      }),
    );

    expect(html).toContain("Saved to Notes · A useful answer");
    expect(html).not.toContain("Save to Notes");
  });

  it("keeps answer feedback beside the save action", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        messages: [{ id: "cloud-1", role: "assistant", text: "Answer" }],
        submitting: false,
        onSaveAnswer: () => {},
        onRateAnswer: () => {},
      }),
    );

    expect(html).toContain('aria-label="Rate answer"');
    expect(html).toContain('aria-label="Helpful answer"');
    expect(html).toContain('aria-label="Unhelpful answer"');
  });

  it("ends a completed turn with compact inspectable TextText proof", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: "OpenAI",
        messages: [
          {
            id: "cloud-1",
            role: "assistant",
            text: "I tightened the opening.",
            provider: "OpenAI",
            artifactProofs: [
              {
                operation: "Updated",
                itemId: "note-1",
                title: "Launch notes",
                folderPath: "notes",
                href: "/@writer/notes/launch-notes",
              },
            ],
          },
        ],
        submitting: false,
      }),
    );

    expect(html).toContain('aria-label="TextText proof"');
    expect(html).toContain("Updated");
    expect(html).toContain("Launch notes");
    expect(html).toContain("notes");
    expect(html).toContain('href="/@writer/notes/launch-notes"');
    expect(html).toContain(">Open<");
    expect(html).not.toContain("Undo");
  });

  it("collapses multi-item source proof instead of filling the rail", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: "OpenAI",
        messages: [
          {
            id: "cloud-1",
            role: "assistant",
            text: "These notes cover the launch.",
            artifactProofs: [
              {
                operation: "Found",
                itemId: "note-1",
                title: "Launch notes",
                folderPath: "notes",
                href: "/@writer/notes/launch-notes",
              },
              {
                operation: "Found",
                itemId: "note-2",
                title: "Launch checklist",
                folderPath: "notes",
                href: "/@writer/notes/launch-checklist",
              },
            ],
          },
        ],
        submitting: false,
      }),
    );

    expect(html).toContain("<details");
    expect(html).toContain("Found 2 items");
    expect(html.match(/>Open</g)).toHaveLength(2);
  });

  it("greets the reader and offers starters that name the open item", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: "Anthropic",
        messages: [],
        submitting: false,
        onUsePrompt: () => {},
        viewerName: "Ramine Darabiha",
        starterContext: {
          level: "item",
          label: "The Invisible Hand of Super Metroid",
        },
      }),
    );

    expect(html).toContain('aria-label="Suggested workflows"');
    // The greeting leads, not which provider happens to be wired up.
    expect(html).toMatch(/Good (morning|afternoon|evening), Ramine/);
    expect(html).not.toContain("Using Anthropic");
    // Naming the item is the whole point of the starters.
    expect(html).toContain("Super Metroid");
    expect(html).toContain("Challenge my thinking");
  });

  it("leads with one in-app setup action when no AI is wired up", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: null,
        messages: [],
        submitting: false,
        onUsePrompt: () => {},
        viewerName: "Ramine",
      }),
    );

    // Provider-specific setup stays out of the narrow rail. One recommended
    // path leads; the external-app path remains a quiet alternative.
    expect(html).toContain("Write with your AI");
    expect(html).toContain('aria-label="Connect an AI"');
    expect(html).toContain("Set up the in-app assistant");
    expect(html).toContain("Connect your AI app instead");
    expect(html).toContain("Read the setup guide");
    expect(html).not.toContain("another MCP client");
    expect(html).not.toContain('aria-expanded="false"');
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

    expect(html).toContain("Set up the in-app assistant once");
    expect(html).not.toContain("Continue with ChatGPT");
    expect(html).toContain('aria-label="Connect an AI"');
    expect(html).toContain('href="/@writer?view=settings#api-key-connections"');
  });

  it("keeps progress to one useful contextual line", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        cloudProvider: "OpenAI",
        messages: [
          { id: "user-1", role: "user", text: "Summarize recent work" },
          {
            id: "progress-1",
            role: "progress",
            text: "I am using the workspace skill to inspect your documents.",
          },
          {
            id: "progress-2",
            role: "progress",
            text: "The index is responding slowly; I am waiting and will make one last attempt.",
          },
        ],
        starterContext: { level: "folder", label: "Notes" },
        submitting: true,
      }),
    );

    expect(html).toContain("Reviewing Notes");
    expect(html).not.toContain("workspace skill");
    expect(html).not.toContain("one last attempt");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("turns a long failure into one reason with recovery actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantConversation, {
        aiSettingsHref: "/@writer?view=settings#api-key-connections",
        messages: [
          { id: "user-1", role: "user", text: "Tighten this paragraph" },
          {
            id: "error-1",
            role: "error",
            text: "The provider did not answer. I am making another attempt and waiting for the workspace index.",
          },
        ],
        onRetry: () => {},
        submitting: false,
      }),
    );

    expect(html).toContain("The provider did not answer.");
    expect(html).not.toContain("another attempt");
    expect(html).toContain("Try again");
    expect(html).toContain("Verify connection");
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
        attachmentTitle:
          "Attachments are not available for provider connections yet",
      }),
    );

    expect(html).toContain('aria-label="Context: Draft, Selected body text"');
    expect(html).not.toContain('aria-label="Add attachment"');
    expect(html).toContain('placeholder="Ask or change this item"');
    expect(html).not.toContain('aria-label="Choose assistant attachments"');
    expect(html).toContain('aria-keyshortcuts="Enter"');
  });
});

describe("starting a new chat", () => {
  it("shows an allowlisted compact model selector", () => {
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
        modelChoices: [
          { id: "gpt-5.6", label: "GPT-5.6" },
          { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
        ],
        selectedModel: "gpt-5.6-luna",
        onModelChange: () => {},
      }),
    );

    expect(html).toContain('aria-label="Assistant model"');
    expect(html).toContain('value="gpt-5.6-luna" selected=""');
  });

  it("offers durable conversation history when handlers are connected", () => {
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
        onNewConversation: () => {},
        onOpenConversation: () => {},
        onToggleConversationPinned: () => {},
        activeConversationId: "chat-1",
        conversations: [
          {
            id: "chat-1",
            title: "Review the launch plan",
            contextKey: "root",
            pinned: true,
            createdAt: "2026-08-24T12:00:00.000Z",
            updatedAt: "2026-08-24T12:00:00.000Z",
            messageCount: 4,
          },
        ],
      }),
    );

    expect(html).toContain('aria-label="Conversation history"');
    expect(html).toContain('aria-expanded="false"');
  });

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
      React.createElement(AssistantSidebar, {
        ...base,
        hasConversation: false,
      }),
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
