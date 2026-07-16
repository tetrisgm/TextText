import { describe, expect, it } from "vitest";
import { cloudAssistantToolNames } from "@/lib/ai/cloud-tools";

// The cloud rung runs tools server-side with no interactive confirmation, so the
// exposed set must exclude both confirmation-gated tools and open-world tools
// that fetch a model-chosen URL (an exfiltration channel).
describe("cloudAssistantToolNames", () => {
  const names = cloudAssistantToolNames();

  it("exposes the safe editing tools", () => {
    for (const safe of ["create_item", "update_item", "move_item"]) {
      expect(names).toContain(safe);
    }
  });

  it("excludes confirmation-gated destructive / sharing / publish tools", () => {
    for (const gated of [
      "delete_item",
      "restore_item",
      "set_item_status",
      "grant_access",
      "set_access_role",
      "revoke_access",
    ]) {
      expect(names).not.toContain(gated);
    }
  });

  it("excludes open-world fetch tools (outbound exfiltration channel)", () => {
    expect(names).not.toContain("add_item_asset");
    expect(names).not.toContain("recapture_bookmark");
  });
});
