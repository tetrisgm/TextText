// The MCP reference must stay complete.
//
// The page generates its tool list from the registry precisely so it cannot
// drift, and this is the test that keeps somebody from "simplifying" that into
// a hand-written list later. A reference that silently omits a tool is worse
// than no reference: an agent author trusts it and concludes the tool does not
// exist.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WORKSPACE_TOOL_DEFINITIONS, WORKSPACE_TOOL_NAMES } from "@/lib/ai/tools";

const source = readFileSync(new URL("../mcp/page.tsx", import.meta.url), "utf8");

describe("the MCP reference page", () => {
  it("builds its tool list from the registry rather than a copy", () => {
    expect(source).toContain("WORKSPACE_TOOL_NAMES");
    expect(source).toContain("WORKSPACE_TOOL_DEFINITIONS[name].description");
    for (const name of WORKSPACE_TOOL_NAMES) {
      expect(source, `${name} must not be hardcoded`).not.toContain(`"${name}"`);
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

  it("documents both directions and every client it claims to support", () => {
    for (const client of [
      "Claude Code",
      "Claude Desktop",
      "Codex",
      "Cursor",
      "Copilot",
      "ChatGPT",
      "Windsurf",
    ]) {
      expect(source, `${client} setup missing`).toContain(client);
    }
    expect(source).toContain("connect a server to TextText");
    expect(source).toContain("figma__create_frame");
  });
});

type WorkspaceToolKey = keyof typeof WORKSPACE_TOOL_DEFINITIONS;
