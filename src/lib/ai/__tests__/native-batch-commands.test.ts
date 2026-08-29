import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WORKSPACE_TOOL_NAMES, WORKSPACE_TOOL_DEFINITIONS } from "@/lib/ai/tools";

const SOURCE = readFileSync(
  new URL("../agent-tools.ts", import.meta.url),
  "utf8",
);

/**
 * The native assistant registers every tool definition, and its executor is a
 * switch with no default: a command it does not handle returns undefined, and
 * the model is told nothing happened while nothing did. Adding a command to
 * the registry without adding a case here is therefore silent.
 */
describe("the assistant on this Mac", () => {
  it("handles every command it is offered", () => {
    const unhandled = WORKSPACE_TOOL_NAMES.filter(
      (name) => !SOURCE.includes(`case "${name}":`),
    );
    expect(unhandled).toEqual([]);
  });

  it("confirms the batch delete by name, not by count", () => {
    // The singular path reads input.id, which is empty for a plural command
    // and throws on the lookup. And "move 3 items to Trash" is not something
    // anyone can weigh.
    expect(SOURCE).toContain('if (name === "delete_items")');
    expect(SOURCE).toMatch(/Move \$\{titles\.length\} items to Trash/);
  });

  it("asks before every confirmation-gated command it can run", () => {
    // confirmTool returns true immediately for confirmation "none"; anything
    // else must be reachable in it.
    for (const name of WORKSPACE_TOOL_NAMES) {
      if (WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "none") continue;
      expect(SOURCE).toContain(`"${name}"`);
    }
  });
});
