import { describe, expect, it } from "vitest";
import {
  WORKSPACE_FOLDER_MODES,
  WORKSPACE_SCOPE_CAPABILITIES,
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  parseWorkspaceToolInput,
} from "@/lib/ai/tools";

const EXPECTED_NAMES = [
  "get_workspace",
  "list_folders",
  "create_folder",
  "rename_folder",
  "delete_folder",
  "restore_folder",
  "list_items",
  "list_trash",
  "read_item",
  "search",
  "create_item",
  "update_item",
  "append_to_item",
  "move_item",
  "delete_item",
  "restore_item",
  "set_item_status",
  "set_item_metadata",
  "set_item_pinned",
  "list_access",
  "grant_access",
  "set_access_role",
  "revoke_access",
  "list_comments",
  "add_comment",
  "set_comment_resolved",
  "recapture_bookmark",
  "list_item_assets",
  "add_item_asset",
  "remove_item_asset",
  "set_item_cover",
] as const;

const DESTRUCTIVE_TOOLS = new Set([
  "rename_folder",
  "delete_folder",
  "update_item",
  "move_item",
  "delete_item",
  "set_item_status",
  "set_item_metadata",
  "set_item_pinned",
  "set_access_role",
  "revoke_access",
  "set_comment_resolved",
  "recapture_bookmark",
  "remove_item_asset",
  "set_item_cover",
]);

const IDEMPOTENT_WRITES = new Set([
  "delete_folder",
  "restore_folder",
  "move_item",
  "delete_item",
  "restore_item",
  "set_item_status",
  "set_item_metadata",
  "set_item_pinned",
  "set_access_role",
  "revoke_access",
  "set_comment_resolved",
  "remove_item_asset",
  "set_item_cover",
]);

const CONFIRMED_TOOLS = new Set([
  "delete_folder",
  "restore_folder",
  "delete_item",
  "restore_item",
  "set_item_status",
  "grant_access",
  "set_access_role",
  "revoke_access",
  "remove_item_asset",
]);

const OPEN_WORLD_TOOLS = new Set([
  "recapture_bookmark",
  "add_item_asset",
]);

describe("workspace tool contract", () => {
  it("defines the complete safe workspace surface once", () => {
    expect(WORKSPACE_TOOL_NAMES).toEqual(EXPECTED_NAMES);
    expect(new Set(WORKSPACE_TOOL_NAMES).size).toBe(WORKSPACE_TOOL_NAMES.length);
    expect(WORKSPACE_TOOL_NAMES.some((name) => name.includes("permanent"))).toBe(
      false,
    );
    expect(WORKSPACE_TOOL_NAMES.some((name) => name.includes("member"))).toBe(
      false,
    );
  });

  it("publishes truthful current MCP annotations and JSON schemas", () => {
    for (const name of WORKSPACE_TOOL_NAMES) {
      const definition = WORKSPACE_TOOL_DEFINITIONS[name];
      expect(definition.annotations).toEqual({
        title: definition.title,
        readOnlyHint: definition.mutability === "read",
        destructiveHint: DESTRUCTIVE_TOOLS.has(name),
        idempotentHint:
          definition.mutability === "read" || IDEMPOTENT_WRITES.has(name),
        openWorldHint: OPEN_WORLD_TOOLS.has(name),
      });
      expect(definition.jsonSchema).toMatchObject({ type: "object" });
      expect(definition.jsonSchema).toHaveProperty("properties");
      expect(definition.confirmation === "none").toBe(
        !CONFIRMED_TOOLS.has(name),
      );
      if (CONFIRMED_TOOLS.has(name)) {
        expect(definition.description).toContain("explicit human confirmation");
      }
    }
  });

  it("exposes workspace identity and scoped access capabilities", () => {
    const workspace = WORKSPACE_TOOL_DEFINITIONS.get_workspace;
    expect(workspace.mutability).toBe("read");
    expect(workspace.annotations.readOnlyHint).toBe(true);
    expect(WORKSPACE_FOLDER_MODES).toEqual(["blog", "notes", "bookmarks"]);
    expect(WORKSPACE_SCOPE_CAPABILITIES).toMatchObject({
      fullAccess: "sync",
      readOnly: expect.arrayContaining(["read"]),
    });
    expect(WORKSPACE_TOOL_DEFINITIONS.list_access.requiredScope).toBe("sync");
  });

  it("strictly validates mutation inputs", () => {
    expect(() =>
      parseWorkspaceToolInput("create_item", {
        folder_path: "blog",
        title: "Draft",
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      parseWorkspaceToolInput("set_item_metadata", { id: "post-1" }),
    ).toThrow("Pass metadata to update");
    expect(
      parseWorkspaceToolInput("set_item_status", {
        id: "post-1",
        status: "published",
      }),
    ).toEqual({ id: "post-1", status: "published" });
  });
});
