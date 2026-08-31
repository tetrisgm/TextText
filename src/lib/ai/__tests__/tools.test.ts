import { describe, expect, it } from "vitest";
import {
  WORKSPACE_FOLDER_MODES,
  WORKSPACE_SCOPE_CAPABILITIES,
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  parseWorkspaceToolInput,
  workspaceToolModelSchema,
} from "@/lib/ai/tools";

const EXPECTED_NAMES = [
  "get_workspace",
  "list_folders",
  "list_items",
  "read_item",
  "review_brief_sources",
  "open_item",
  "search",
  "list_trash",
  "list_comments",
  "list_responses",
  "list_access",
  "list_document_templates",
  "create_item_type",
  "update_item_type",
  "save_item_as_look",
  "set_folder_template",
  "retire_document_template",
  "set_item_template",
  "create_item",
  "update_item",
  "append_to_item",
  "set_item_status",
  "move_item",
  "organize_items",
  "delete_item",
  "delete_items",
  "empty_trash",
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
  "organize_items",
  "delete_item",
  "delete_items",
  "set_item_status",
  "revoke_access",
  "set_comment_resolved",
  "recapture_bookmark",
  "remove_item_asset",
  "retire_document_template",
  "empty_trash",
]);

const IDEMPOTENT_WRITES = new Set([
  "organize_items",
  "delete_items",
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
  "empty_trash",
]);

const CONFIRMED_TOOLS = new Set([
  "empty_trash",
  "delete_items",
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

const OPEN_WORLD_TOOLS = new Set(["recapture_bookmark", "add_item_asset"]);

describe("workspace tool contract", () => {
  it("defines the complete safe workspace surface once", () => {
    expect(WORKSPACE_TOOL_NAMES).toEqual(EXPECTED_NAMES);
    expect(new Set(WORKSPACE_TOOL_NAMES).size).toBe(
      WORKSPACE_TOOL_NAMES.length,
    );
    expect(
      WORKSPACE_TOOL_NAMES.some((name) => name.includes("permanent")),
    ).toBe(false);
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

  it("makes model-facing content writes structurally safe", () => {
    const update = workspaceToolModelSchema("update_item");
    expect(update.properties).not.toHaveProperty("body");
    expect(update.properties).not.toHaveProperty("markdown");
    expect(
      WORKSPACE_TOOL_DEFINITIONS.update_item.jsonSchema.properties,
    ).toHaveProperty("body");

    const append = workspaceToolModelSchema("append_to_item");
    expect(append.required).toContain("if_match_hash");
    expect(
      WORKSPACE_TOOL_DEFINITIONS.append_to_item.jsonSchema.required,
    ).not.toContain("if_match_hash");
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
    expect(
      parseWorkspaceToolInput("create_item", {
        capture: "A thought worth keeping",
        idempotency_key: "capture:message-42",
      }),
    ).toEqual({
      capture: "A thought worth keeping",
      idempotency_key: "capture:message-42",
    });
    expect(() =>
      parseWorkspaceToolInput("create_item", {
        capture: "A thought worth keeping",
        body: "Conflicting structured body",
      }),
    ).toThrow("Pass capture by itself");
    expect(
      parseWorkspaceToolInput("create_item", {
        title: "Grounded launch brief",
        template_id: "texttext.brief",
        fields: {
          sources: [
            {
              sourceId: "research",
              title: "Research notes",
              itemId: "item-research",
              capturedHash: "sha256:research",
              status: "current",
            },
          ],
          claims: [
            {
              claimId: "claim-setup",
              claim: "Setup is the main source of friction.",
              sourceId: "research",
              evidence: "Four sessions stalled before the first edit.",
              status: "supported",
            },
          ],
        },
      }),
    ).toMatchObject({
      template_id: "texttext.brief",
      fields: {
        sources: [{ sourceId: "research" }],
        claims: [{ claimId: "claim-setup" }],
      },
    });
    expect(() =>
      parseWorkspaceToolInput("create_item", {
        markdown: "# Brief",
        template_id: "texttext.brief",
      }),
    ).toThrow();
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
    expect(
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        section: "## Pricing",
        expected_section_body: "Ten dollars.",
        body: "Twelve dollars.",
      }),
    ).toMatchObject({
      section: "## Pricing",
      expected_section_body: "Ten dollars.",
      body: "Twelve dollars.",
    });
    expect(() =>
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        section: "## Pricing",
        body: "Twelve dollars.",
      }),
    ).toThrow("requires body and expected_section_body");
    expect(() =>
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        section: "## Pricing",
        expected_section_body: "Ten dollars.",
        body: "Twelve dollars.",
        title: "Also rename it",
      }),
    ).toThrow("cannot change other content or metadata");
    expect(
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        text_edit: {
          field: "body",
          start: 2,
          end: 6,
          expected_text: "body",
          replacement_text: "draft",
        },
      }),
    ).toMatchObject({
      text_edit: {
        field: "body",
        start: 2,
        end: 6,
        expected_text: "body",
        replacement_text: "draft",
      },
    });
    expect(() =>
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        body: "A complete replacement",
      }),
    ).toThrow("Whole-item replacement requires if_match_hash");
    expect(
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        body: "A complete replacement",
        if_match_hash: "sha256:persisted",
      }),
    ).toMatchObject({
      body: "A complete replacement",
      if_match_hash: "sha256:persisted",
    });
    expect(() =>
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        markdown: "---\ntitle: Replacement\n---\n\nBody",
      }),
    ).toThrow("Whole-item replacement requires if_match_hash");
    expect(() =>
      parseWorkspaceToolInput("update_item", {
        id: "post-1",
        text_edit: {
          field: "body",
          start: 2,
          end: 5,
          expected_text: "body",
          replacement_text: "draft",
        },
      }),
    ).toThrow("range length must match expected_text");
    expect(
      parseWorkspaceToolInput("create_item_type", {
        blueprint: {
          name: "Tasks",
          styleReference: "Notion",
          fields: [
            {
              id: "status",
              label: "Status",
              type: "enum",
              options: [{ value: "todo", label: "To do" }],
            },
          ],
          item: { shape: "task" },
          collection: {
            layout: "board",
            groupBy: "status",
          },
        },
        folder_path: "notes/tasks",
      }),
    ).toMatchObject({
      blueprint: { name: "Tasks", styleReference: "Notion" },
      folder_path: "notes/tasks",
      apply_to_existing: true,
    });
  });
});

describe("update_item custom fields", () => {
  it("accepts a fields-only update, the agent field-write path", () => {
    // The refinement used to reject this with "Pass content or metadata to
    // update", which silently broke every agent field texttext: the error was
    // returned before the handler ran, no audit row, no change.
    const parsed = WORKSPACE_TOOL_DEFINITIONS.update_item.inputSchema.safeParse(
      {
        id: "00000000-0000-4000-8000-000000000000",
        fields: { rating: 4.5, status: "read", author: "Peter Watts" },
      },
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts row-record values and null clears", () => {
    const parsed = WORKSPACE_TOOL_DEFINITIONS.update_item.inputSchema.safeParse(
      {
        id: "00000000-0000-4000-8000-000000000000",
        fields: {
          tasks: [{ done: false, task: "Ship it", priority: "high" }],
          stale: null,
        },
      },
    );
    expect(parsed.success).toBe(true);
  });

  it("still rejects an update with nothing to change", () => {
    const parsed = WORKSPACE_TOOL_DEFINITIONS.update_item.inputSchema.safeParse(
      {
        id: "00000000-0000-4000-8000-000000000000",
      },
    );
    expect(parsed.success).toBe(false);
  });
});
