import { describe, expect, it } from "vitest";
import { cloudAssistantToolNames, cloudAssistantToolContract } from "@/lib/ai/cloud-tools";
import { VAULT_TOOL_NAMES } from "@/lib/mcp/vault-contract";

// The cloud rung exposes ordinary tools plus actions with a durable owner
// preview. Open-world fetches remain excluded.
describe("cloudAssistantToolNames", () => {
  const names = cloudAssistantToolNames();

  it("exposes the safe editing tools", () => {
    for (const safe of ["create_item", "update_item", "move_item"]) {
      expect(names).toContain(safe);
    }
  });

  it("never advertises unsupported legacy content operations", () => {
    for (const gated of ["set_item_status", "empty_trash", "list_responses"]) {
      expect(names).not.toContain(gated);
    }
    expect(names.every(name => (VAULT_TOOL_NAMES as readonly string[]).includes(name))).toBe(true);
  });

  it("requires canonical revision and retry guards and omits unsupported metadata", () => {
    expect(cloudAssistantToolContract("move_item").schema.required).toEqual(expect.arrayContaining(["path", "if_match_hash", "idempotency_key"]));
    const edit = cloudAssistantToolContract("update_item").schema;
    expect(edit.required).toContain("if_match_hash");
    expect(edit.properties).not.toHaveProperty("status");
    expect(edit.properties).not.toHaveProperty("body");
    expect(edit.properties).toHaveProperty("expected_section_body");
    expect(() => cloudAssistantToolContract("empty_trash")).toThrow("File command unavailable");
  });

  it("excludes open-world fetch tools (outbound exfiltration channel)", () => {
    expect(names).not.toContain("add_item_asset");
    expect(names).not.toContain("recapture_bookmark");
  });

  it("has a server-selected read-only allowlist for suggestion turns", () => {
    const readOnly = cloudAssistantToolNames("read_only");
    expect(readOnly).toContain("read_item");
    expect(readOnly).toContain("search");
    expect(readOnly).not.toContain("create_item");
    expect(readOnly).not.toContain("update_item");
    expect(readOnly).not.toContain("append_to_item");
  });
});
