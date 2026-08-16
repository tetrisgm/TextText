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
  "list_items",
  "read_item",
  "open_item",
  "search",
  "list_trash",
  "list_comments",
  "list_responses",
  "list_access",
  "list_document_templates",
  "save_item_as_look",
  "set_folder_template",
  "retire_document_template",
  "set_item_template",
  "create_item",
  "update_item",
  "append_to_item",
  "set_item_status",
  "move_item",
  "delete_item",
  "restore_item",
  "add_item_asset",
  "remove_item_asset",
  "recapture_bookmark",
  "add_comment",
  "set_comment_resolved",
  "create_folder",
  "rename_folder",
  "delete_folder",
  "restore_folder",
  "set_access",
  "revoke_access",
] as const;

const DESTRUCTIVE_TOOLS = new Set([
  "rename_folder",
  "delete_folder",
  "update_item",
  "move_item",
  "delete_item",
  "set_item_status",
  "revoke_access",
  "set_comment_resolved",
  "recapture_bookmark",
  "remove_item_asset",
  "retire_document_template",
]);

const IDEMPOTENT_WRITES = new Set([
  "delete_folder",
  "restore_folder",
  "move_item",
  "delete_item",
  "restore_item",
  "set_item_status",
  "set_access",
  "revoke_access",
  "set_comment_resolved",
  "remove_item_asset",
  "set_folder_template",
  "retire_document_template",
  "set_item_template",
]);

const CONFIRMED_TOOLS = new Set([
  "delete_folder",
  "restore_folder",
  "delete_item",
  "restore_item",
  "set_item_status",
  "set_access",
  "revoke_access",
  "remove_item_asset",
  "retire_document_template",
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
    expect(
      parseWorkspaceToolInput("create_item", {
        body: "# Draft from body\n\nComplete text.",
      }),
    ).toEqual({ body: "# Draft from body\n\nComplete text." });
    expect(() =>
      parseWorkspaceToolInput("create_item", {
        folder_path: "blog",
        title: "Draft",
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      parseWorkspaceToolInput("update_item", { id: "post-1" }),
    ).toThrow("Pass content or metadata to update");
    expect(
      parseWorkspaceToolInput("set_item_status", {
        id: "post-1",
        status: "published",
      }),
    ).toEqual({ id: "post-1", status: "published" });
    expect(
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        tags: ["design", "notes"],
      }),
    ).toEqual({ id: "post-1", tags: ["design", "notes"] });
    expect(
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        pinned: true,
      }),
    ).toEqual({ id: "post-1", pinned: true });
  });
});

describe("update_item custom fields", () => {
  it("accepts a fields-only update, the agent field-write path", () => {
    // The refinement used to reject this with "Pass content or metadata to
    // update", which silently broke every agent field texttext: the error was
    // returned before the handler ran, no audit row, no change.
    const parsed = WORKSPACE_TOOL_DEFINITIONS.update_item.inputSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000000",
      fields: { rating: 4.5, status: "read", author: "Peter Watts" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts row-record values and null clears", () => {
    const parsed = WORKSPACE_TOOL_DEFINITIONS.update_item.inputSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000000",
      fields: {
        tasks: [{ done: false, task: "Ship it", priority: "high" }],
        stale: null,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("still rejects an update with nothing to change", () => {
    const parsed = WORKSPACE_TOOL_DEFINITIONS.update_item.inputSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000000",
    });
    expect(parsed.success).toBe(false);
  });
});

