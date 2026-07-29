import { applyAwarenessUpdate, Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  agentConnectionName,
  agentPresenceClientId,
  buildAgentPresence,
} from "@/lib/collab/agent-presence.server";

/**
 * Decode the agent's own awareness state. The local Awareness instance also
 * holds an entry for its own client id, so pick the state that actually
 * carries a user rather than the first one.
 */
function awarenessState(encoded: string | null): Record<string, unknown> {
  const document = new Y.Doc();
  const awareness = new Awareness(document);
  try {
    applyAwarenessUpdate(
      awareness,
      Uint8Array.from(Buffer.from(encoded ?? "", "base64")),
      "test",
    );
    for (const state of awareness.getStates().values()) {
      const candidate = state as Record<string, unknown> | undefined;
      if (candidate?.user) return candidate;
    }
    return {};
  } finally {
    awareness.destroy();
    document.destroy();
  }
}

function awarenessUser(encoded: string | null): Record<string, unknown> {
  return (awarenessState(encoded).user as Record<string, unknown>) ?? {};
}

describe("shared agent presence construction", () => {
  it("canonicalizes the provider name and color for a known client", () => {
    const presence = buildAgentPresence({
      userId: "user-1",
      connectionName: "codex-cli",
    });

    expect(presence?.userName).toBe("Codex");
    expect(presence?.color).toBe("#111827");
    expect(awarenessUser(presence?.awareness ?? null)).toMatchObject({
      name: "Codex",
      participantType: "agent",
      provider: "codex",
    });
  });

  it("derives a stable client id from the user and connection name", () => {
    const first = buildAgentPresence({
      userId: "user-1",
      connectionName: "Claude Code",
    });
    const again = buildAgentPresence({
      userId: "user-1",
      connectionName: "Claude Code",
    });

    expect(first?.clientId).toBe(again?.clientId);
    expect(first?.clientId).toBe(
      agentPresenceClientId("user-1", "Claude Code"),
    );
    expect(first?.clientId).toMatch(/^agent-[0-9a-f]{16}$/);
  });

  it("keeps two agent identities from collapsing into one collaborator", () => {
    const codex = buildAgentPresence({
      userId: "user-1",
      connectionName: "codex-cli",
    });
    const claude = buildAgentPresence({
      userId: "user-1",
      connectionName: "Claude Code",
    });

    expect(codex?.clientId).not.toBe(claude?.clientId);
    expect(codex?.userName).toBe("Codex");
    expect(claude?.userName).toBe("Claude");
    expect(codex?.color).not.toBe(claude?.color);
  });

  it("separates the same agent name across two users", () => {
    expect(agentPresenceClientId("user-1", "codex-cli")).not.toBe(
      agentPresenceClientId("user-2", "codex-cli"),
    );
  });

  it("falls back to a neutral agent identity for an unknown client", () => {
    const presence = buildAgentPresence({
      userId: "user-1",
      connectionName: "  ",
    });

    expect(agentConnectionName("  ")).toBe("AI agent");
    expect(presence?.userName).toBe("AI agent");
    // No brand color for an unrecognized provider; a deterministic one instead.
    expect(presence?.color).toMatch(/^#/);
  });

  it("carries the selection into awareness so the agent shows a cursor", () => {
    const presence = buildAgentPresence(
      { userId: "user-1", connectionName: "codex-cli" },
      { selection: { field: "body", anchor: "AQI=", head: "AQI=" } },
    );

    expect(awarenessState(presence?.awareness ?? null).selection).toEqual({
      field: "body",
      anchor: "AQI=",
      head: "AQI=",
    });
  });

  it("refuses to build presence without a user to attribute it to", () => {
    expect(
      buildAgentPresence({ userId: "", connectionName: "codex-cli" }),
    ).toBeNull();
  });
});
