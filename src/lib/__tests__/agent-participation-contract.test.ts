// The invariants behind "an agent participates exactly the way a human does".
//
// `scripts/verify-live-collaboration.ts` proves these in real browsers against
// a real server. That run needs Postgres, a build, and Chromium, so it is not
// something a unit suite can call. These assertions pin the pieces it depends
// on, so a regression is caught in seconds rather than at the next live run.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agentIdentity,
  agentProviderColor,
} from "@/lib/collab/agent-identity";
import {
  UNKNOWN_AGENT_CONNECTION_NAME,
  agentConnectionName,
  agentPresenceClientId,
} from "@/lib/collab/agent-presence.server";
import { WORKSPACE_TOOL_NAMES } from "@/lib/ai/tools";

const presenceRouteSource = readFileSync(
  new URL("../../app/api/agent/presence/route.ts", import.meta.url),
  "utf8",
);
const assistantRouteSource = readFileSync(
  new URL("../../app/api/ai/tools/route.ts", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../components/document/UnifiedDocumentEditor.tsx", import.meta.url),
  "utf8",
);

describe("agents participate the way people do", () => {
  it("names each documented client as itself, not as a generic agent", () => {
    // What a person reads in the presence row when Codex or ChatGPT joins.
    expect(agentIdentity("Codex").displayName).toBe("Codex");
    expect(agentIdentity("ChatGPT").displayName).toBe("ChatGPT");
    expect(agentIdentity("Claude Code").displayName).toBe("Claude");
    expect(agentIdentity("Cursor").displayName).toBe("Cursor");
    // A self-reported name is used verbatim rather than flattened away.
    expect(agentIdentity("Acme Writer").displayName).toBe("Acme Writer");
    // Only a client that identifies itself as nothing becomes the fallback.
    expect(agentConnectionName("   ")).toBe(UNKNOWN_AGENT_CONNECTION_NAME);
  });

  it("gives each provider its own colour, the way a person has one", () => {
    const colors = (["chatgpt", "claude", "codex", "cursor"] as const).map(
      (provider) => agentProviderColor(provider),
    );
    expect(colors.every(Boolean)).toBe(true);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("keeps one agent one collaborator, and two agents two", () => {
    const user = "user-1";
    expect(agentPresenceClientId(user, "Codex")).toBe(
      agentPresenceClientId(user, "Codex"),
    );
    expect(agentPresenceClientId(user, "Codex")).not.toBe(
      agentPresenceClientId(user, "ChatGPT"),
    );
    // The same agent in two workspaces is not one shared presence row.
    expect(agentPresenceClientId(user, "Codex")).not.toBe(
      agentPresenceClientId("user-2", "Codex"),
    );
  });

  it("gives a working agent a caret, not only an avatar", () => {
    // Presence carries a selection, which is what paints a cursor in the text.
    expect(presenceRouteSource).toContain("agentSelectionAtEnd");
    // And it sits where the work is when the agent names a section, rather
    // than parking every agent at the end of the document.
    expect(presenceRouteSource).toContain("agentSelectionAtSection");
    // And it is removed rather than blanked, so an agent does not linger with
    // a cursor after its command finished.
    expect(presenceRouteSource).toContain("removePresence");
  });

  it("renders remote people and remote agents through one presence surface", () => {
    expect(editorSource).toContain("tt-remote-caret");
    expect(editorSource).toContain("tt-person-presence");
    expect(editorSource).toContain("tt-agent-presence");
  });

  it("runs the sidebar assistant through the shared workspace executor", () => {
    // Not a second command surface, and not an internal MCP hop: the same
    // executor the hosted adapter uses, so an assistant edit takes the path
    // the live run proves is visible to everyone watching.
    expect(assistantRouteSource).toContain("runWorkspaceToolForSession");
    expect(assistantRouteSource).toContain("isWorkspaceToolName");
    expect(assistantRouteSource).not.toContain("/api/mcp");
  });

  it("exposes the content verbs an agent needs to match a person", () => {
    for (const verb of [
      "create_item",
      "read_item",
      "update_item",
      "append_to_item",
      "delete_item",
      "restore_item",
    ]) {
      expect(WORKSPACE_TOOL_NAMES).toContain(verb);
    }
  });
});
