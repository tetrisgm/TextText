import { WORKSPACE_TOOL_DEFINITIONS, type WorkspaceToolName } from "@/lib/ai/tools";
export const VAULT_TOOL_NAMES = ["get_workspace", "list_folders", "list_items", "read_item", "search", "create_item", "update_item", "append_to_item", "list_comments", "add_comment", "set_comment_resolved"] as const;
const fields: Partial<Record<WorkspaceToolName, readonly string[]>> = {
  add_comment: ["id", "body", "parent_comment_id", "idempotency_key"],
  create_item: ["capture", "markdown", "title", "body", "excerpt", "kind", "fields", "folder_path", "idempotency_key"],
  update_item: ["id", "title", "body", "excerpt", "tags", "section", "expected_section_body", "if_match_hash"],
};
const descriptions: Partial<Record<WorkspaceToolName, string>> = {
  add_comment: "Add a file comment or reply, up to 4000 characters. Pass idempotency_key for retry safety. Quote anchors are not supported yet.",
  list_comments: "Read accessible file comment threads filtered by open, resolved or all state.",
  create_item: "Create a private file using title, body, excerpt, kind and optional fields. Uses Notes, Blog, Bookmarks, Gallery or Presentations unless folder_path is supplied. Pass idempotency_key for retry safety. Pass capture for text or a standalone URL, or markdown for a complete Markdown file with frontmatter. These are alternatives to structured fields. Custom templates are not supported by this command yet.",
  update_item: "Edit title, body, excerpt, tags or one guarded Markdown section in a file. Requires the current if_match_hash from read_item. Unsupported metadata and publication changes fail without changing the file.",
  append_to_item: "Append markdown or markdown_fragment to a file using the current if_match_hash from read_item. Pass a stable idempotency_key so a lost response can be retried exactly once.",
  list_items: "List accessible files, optionally restricted to an exact folder path. Omit folder_path to list the workspace. Returns titles, paths and hashes.",
  read_item: "Read an accessible file's complete DocumentSnapshot, Markdown body, path and current content hash.",
};
export function vaultToolDefinitions() {
  return VAULT_TOOL_NAMES.map((name) => {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    const inputSchema = structuredClone(definition.jsonSchema) as { properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };
    const allowed = fields[name];
    if (allowed && inputSchema.properties) inputSchema.properties = Object.fromEntries(Object.entries(inputSchema.properties).filter(([key]) => allowed.includes(key)));
    if (name === "add_comment" && inputSchema.properties?.body) inputSchema.properties.body = { type: "string", minLength: 1, maxLength: 4000 };
    if (name === "update_item") inputSchema.required = [...new Set([...(inputSchema.required ?? []), "if_match_hash"])];
    if (name === "append_to_item") inputSchema.required = [...new Set([...(inputSchema.required ?? []), "if_match_hash"])];
    return { name, title: definition.title, description: descriptions[name] ?? definition.description, inputSchema, annotations: definition.annotations };
  });
}
