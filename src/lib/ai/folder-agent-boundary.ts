/** A server-issued task boundary, additional to ordinary account permissions. */
export function validFolderAgentPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 &&
    !/[\\\x00-\x1f\x7f]/.test(value) &&
    (value === "" || value.split("/").every(part => Boolean(part) && part !== "." && part !== ".." && !part.startsWith(".")));
}
export function insideAgentFolder(folder: string, path: string): boolean {
  return validFolderAgentPath(folder) && validFolderAgentPath(path) &&
    (folder === "" || path === folder || path.startsWith(folder + "/"));
}
/** New tools must explicitly opt into the folder authorization callbacks. */
export const FOLDER_AGENT_TOOLS = new Set([
  "list_folders", "list_items", "read_item", "search", "create_item", "update_item",
  "append_to_item", "add_item_asset", "remove_item_asset", "list_comments",
  "add_comment", "set_comment_resolved", "create_folder", "move_item", "delete_item",
]);
/** Templates are workspace-wide files. Only a root-folder task covers both
 * the source items and the library; a named-folder task cannot cross into it. */
export const ROOT_TEMPLATE_AGENT_TOOLS = new Set([
  "list_document_templates", "create_item_type", "update_item_type",
  "save_item_as_look", "remix_item_type", "retire_document_template",
  "set_item_template", "set_folder_template",
]);
export function folderAgentAllowsTool(folder: unknown, name: string): boolean {
  return validFolderAgentPath(folder) &&
    (FOLDER_AGENT_TOOLS.has(name) || folder === "" && ROOT_TEMPLATE_AGENT_TOOLS.has(name));
}
