import { describe, expect, it } from "vitest";
import { WORKSPACE_TOOL_NAMES } from "@/lib/ai/tools";

// Deleting an account is a person's decision, made in the app, and it is never
// a tool call.
//
// This is a boundary, not a preference. The MCP registry maps this frozen array
// straight to listTools() with no allowlist in between, so any verb added here
// is published immediately to every external agent holding a sync scope, and
// the surface itself advertises that it performs no permanent deletion. An
// account-deletion tool would make an irreversible, unconfirmable action
// reachable by anything holding a token.
describe("the workspace tool surface", () => {
  it("carries no account-deletion verb", () => {
    for (const forbidden of [
      "delete_account",
      "close_account",
      "purge_account",
      "delete_user",
    ]) {
      expect(WORKSPACE_TOOL_NAMES).not.toContain(forbidden);
    }
  });

  it("carries no verb whose name reaches for the account itself", () => {
    const reaching = WORKSPACE_TOOL_NAMES.filter((name) =>
      /account|user/i.test(name),
    );
    expect(reaching).toEqual([]);
  });
});
