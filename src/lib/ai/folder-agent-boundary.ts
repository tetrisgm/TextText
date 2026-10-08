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
