import { describe, expect, it } from "vitest";
import { isProposableWorkspaceWrite, validateWorkspaceWriteProposal } from "@/lib/ai/write-proposal-policy";

// Canonical single-file deletion, frozen preview and drift tests live in
// write-proposals.test.ts. The former database bulk-delete command must stay retired.
describe("retired bulk deletion", () => {
  it("cannot enter the durable approval queue", () => {
    expect(isProposableWorkspaceWrite("delete_items")).toBe(false);
    expect(() => validateWorkspaceWriteProposal("delete_items", { ids: ["a", "b"] })).toThrow("cannot be staged");
  });
});
