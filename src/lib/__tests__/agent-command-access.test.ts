import { describe, expect, it } from "vitest";

import {
  LOCAL_AGENT_COMMANDS,
  LOCAL_AGENT_DENIED,
  LOCAL_AGENT_READ_ONLY_COMMANDS,
  undecidedLocalCommands,
  unsafeLocalAllowances,
} from "@/lib/agent-command-access";
import { WORKSPACE_TOOL_DEFINITIONS } from "@/lib/ai/tools";

/**
 * What an agent on this Mac may do.
 *
 * The first version of this widening derived the set from
 * `confirmation === "none" && !openWorldHint`. That reads well and is wrong:
 * confirmation DEFAULTS to "none", so any command added later without a thought
 * for this boundary would have joined a local agent's authority silently.
 */
describe("the local agent command boundary", () => {
  it("has decided about every command in the registry", () => {
    // The whole point: a new command cannot reach a local agent by being
    // forgotten. Adding one fails this until someone chooses a list for it.
    expect(undecidedLocalCommands()).toEqual([]);
  });

  it("allows nothing that needs a confirmation or fetches a chosen URL", () => {
    // The safety property the derived version got right, kept as a check
    // rather than as the mechanism.
    expect(unsafeLocalAllowances()).toEqual([]);
  });

  it("decides each command exactly once", () => {
    const both = [...LOCAL_AGENT_COMMANDS].filter((name) =>
      LOCAL_AGENT_DENIED.includes(name),
    );
    expect(both).toEqual([]);
  });

  it("lets an agent work on a note the way a person would", () => {
    for (const name of [
      "move_item",
      "add_comment",
      "set_comment_resolved",
      "create_folder",
      "create_item_type",
      "update_item_type",
      "set_folder_template",
      "list_items",
    ] as const) {
      expect(LOCAL_AGENT_COMMANDS.has(name)).toBe(true);
    }
  });

  it("keeps deletion, publication, sharing and URL fetching out", () => {
    for (const name of [
      "delete_item",
      "restore_item",
      "set_item_status",
      "set_access",
      "revoke_access",
      "add_item_asset",
      "recapture_bookmark",
    ] as const) {
      expect(LOCAL_AGENT_COMMANDS.has(name)).toBe(false);
    }
  });

  it("treats every allowed read as available to a read-scoped connection", () => {
    for (const name of LOCAL_AGENT_COMMANDS) {
      if (WORKSPACE_TOOL_DEFINITIONS[name].mutability !== "read") continue;
      expect(LOCAL_AGENT_READ_ONLY_COMMANDS.has(name)).toBe(true);
    }
  });

  it("never lets a write through on a read-only scope", () => {
    for (const name of LOCAL_AGENT_READ_ONLY_COMMANDS) {
      expect(WORKSPACE_TOOL_DEFINITIONS[name].mutability).toBe("read");
    }
  });
});
