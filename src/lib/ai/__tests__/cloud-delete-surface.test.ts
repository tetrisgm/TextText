import { describe, expect, it } from "vitest";

import { cloudAssistantToolNames } from "@/lib/ai/cloud-tools";
import { isProposableWorkspaceWrite } from "@/lib/ai/write-proposal-policy";
import { WORKSPACE_TOOL_DEFINITIONS } from "@/lib/ai/tools";

/**
 * The browser assistant could not delete anything, which was the largest hole
 * in "the AI can do anything to my items". Two gates decided that and only one
 * was changed at first: the staging rule allowed it while the tool list still
 * hid it, so the model was never offered the command it was now permitted to
 * stage.
 */
describe("what the browser assistant is offered", () => {
  const full = cloudAssistantToolNames("full");

  it("can delete", () => {
    expect(full).toContain("delete_items");
  });

  it("still cannot share or fetch a chosen URL", () => {
    // Each changes who can see something, or reaches outward, and none has a
    // preview a person could judge. Approval does not make a fetch safe.
    for (const name of [
      "add_item_asset",
      "recapture_bookmark",
    ] as const) {
      expect(full).not.toContain(name);
    }
  });

  it("offers restore through the same owner-reviewed proposal path", () => {
    expect(full).toContain("restore_item");
    expect(isProposableWorkspaceWrite("restore_item")).toBe(true);
  });

  it("offers no write it could not actually stage", () => {
    // The two gates have to agree, or a tool appears and fails on use.
    for (const name of full) {
      if (WORKSPACE_TOOL_DEFINITIONS[name].mutability !== "write") continue;
      expect(isProposableWorkspaceWrite(name)).toBe(true);
    }
  });

  it("offers a read-only connection no writes at all", () => {
    for (const name of cloudAssistantToolNames("read_only")) {
      expect(WORKSPACE_TOOL_DEFINITIONS[name].mutability).toBe("read");
    }
  });
});
