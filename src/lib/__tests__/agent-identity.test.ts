import {
  Awareness,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { createAgentAwareness } from "@/lib/collab";
import {
  agentIdentity,
  agentProviderColor,
} from "@/lib/collab/agent-identity";

describe("agent collaborator identity", () => {
  it.each([
    ["Claude Desktop", "claude", "Claude"],
    ["Anthropic connector", "claude", "Claude"],
    ["Codex", "codex", "Codex"],
    ["OpenAI Codex", "codex", "Codex"],
    ["ChatGPT", "chatgpt", "ChatGPT"],
    ["OpenAI connector", "chatgpt", "ChatGPT"],
    ["Cursor", "cursor", "Cursor"],
  ] as const)(
    "maps %s to a named %s collaborator",
    (connectionName, provider, displayName) => {
      expect(agentIdentity(connectionName)).toEqual({
        provider,
        displayName,
      });
    },
  );

  it("keeps an unknown approved connection name as the collaborator name", () => {
    expect(agentIdentity("My research agent")).toEqual({
      provider: "agent",
      displayName: "My research agent",
    });
    expect(agentIdentity("  ")).toEqual({
      provider: "agent",
      displayName: "AI agent",
    });
  });

  it("uses stable provider colors for recognizable agent avatars", () => {
    expect(agentProviderColor("chatgpt")).toBe("#10a37f");
    expect(agentProviderColor("claude")).toBe("#d97757");
    expect(agentProviderColor("codex")).toBe("#111827");
    expect(agentProviderColor("cursor")).toBe("#111111");
    expect(agentProviderColor("agent")).toBeNull();
  });

  it("encodes the provider and agent role in Yjs awareness", () => {
    const encoded = createAgentAwareness({
      clientId: "agent-codex-123",
      userName: "Codex",
      color: "#3c7de0",
      provider: "codex",
    });
    const document = new Y.Doc();
    const awareness = new Awareness(document);

    try {
      applyAwarenessUpdate(
        awareness,
        Uint8Array.from(Buffer.from(encoded, "base64")),
        "test",
      );
      expect(Array.from(awareness.getStates().values())).toContainEqual({
        user: {
          clientId: "agent-codex-123",
          name: "Codex",
          color: "#3c7de0",
          participantType: "agent",
          provider: "codex",
        },
      });
    } finally {
      awareness.destroy();
      document.destroy();
    }
  });
});
