// The MCP reference must stay complete.
//
// The page generates its tool list from the registry precisely so it cannot
// drift, and this is the test that keeps somebody from "simplifying" that into
// a hand-written list later. A reference that silently omits a tool is worse
// than no reference: an agent author trusts it and concludes the tool does not
// exist.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";

const source = readFileSync(
  new URL("../mcp/page.tsx", import.meta.url),
  "utf8",
);

describe("the MCP reference page", () => {
  it("builds its tool list from the registry rather than a copy", () => {
    expect(source).toContain("WORKSPACE_TOOL_NAMES");
    expect(source).toContain("WORKSPACE_TOOL_DEFINITIONS[name].description");
    for (const name of WORKSPACE_TOOL_NAMES) {
      expect(source, `${name} must not be hardcoded`).not.toContain(
        `"${name}"`,
      );
    }
  });

  it("puts every tool in at least one group", () => {
    // Mirrors the page's grouping so a new confirmation kind cannot produce a
    // tool that belongs to no group and silently vanishes from the page.
    const matchers = [
      (name: WorkspaceToolKey) =>
        WORKSPACE_TOOL_DEFINITIONS[name].mutability === "read",
      (name: WorkspaceToolKey) =>
        WORKSPACE_TOOL_DEFINITIONS[name].mutability === "write" &&
        WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "none",
      (name: WorkspaceToolKey) =>
        WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "audience",
      (name: WorkspaceToolKey) =>
        WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "destructive",
    ];
    for (const name of WORKSPACE_TOOL_NAMES) {
      const hits = matchers.filter((match) => match(name)).length;
      expect(hits, `${name} matched no group`).toBeGreaterThanOrEqual(1);
    }
  });

  it("documents both directions without promising unsupported authentication", () => {
    for (const client of ["Codex", "Claude Code", "Cursor", "VS Code"]) {
      expect(source).toContain(`name: "${client}"`);
    }
    expect(source).toContain("Claude and Claude Desktop connectors");
    expect(source).toContain("Another bearer-authenticated MCP client");
    expect(source).toContain("OAuth-only");
    expect(source).toContain("AGENT_CONNECTION_CHECK_PROMPT");
    expect(source).toContain("exact receipt with title, item id");
    expect(source).toContain("same idempotency key");
    expect(source).toContain("token-free");
    expect(source).not.toContain('name: "ChatGPT"');
    expect(source).toContain("connect a server to TextText");
    expect(source).toContain("figma__create_frame");
    expect(source).toContain("standalone Mac app");
    expect(source).toContain("public https address");
    expect(source).toContain("not offered in Workspace Settings");
    expect(source).not.toContain("loopback connection works only");
  });
});

type WorkspaceToolKey = keyof typeof WORKSPACE_TOOL_DEFINITIONS;
