import { createHash } from "node:crypto";
import type { WorkspaceToolName } from "./tools";
import { getAllPosts, getFolders, getTrashedPosts, getTrashedFolders,
  getPostById, getBlogEditRecord, listDocumentTemplates } from "@/lib/store";

export type ConfirmationState = { summary: string; fingerprint: string };
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Freeze the actual scope of commands without an existing item preview. */
export async function resolveConfirmationState(
  handle: string, name: WorkspaceToolName, args: Record<string, unknown>,
): Promise<ConfirmationState> {
  if (name === "delete_folder" || name === "restore_folder") {
    const restoring = name === "restore_folder";
    const [folders, posts] = await Promise.all([
      restoring ? getTrashedFolders(handle) : getFolders(handle),
      restoring ? getTrashedPosts(handle) : getAllPosts(handle),
    ]);
    const target = folders.find((folder) => folder.id === args.folder_id);
    if (!target) throw new Error("Folder not found.");
    const subtree = folders.filter((folder) => folder.path === target.path || folder.path.startsWith(`${target.path}/`))
      .sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set(subtree.map((folder) => folder.id));
    const items = posts.filter((post) => post.folderId && ids.has(post.folderId))
      .map((post) => {
        if (!post.id || post.revision == null) throw new Error("Item version unavailable.");
        return { id: post.id, revision: post.revision, title: post.title, status: post.status, folderId: post.folderId };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      summary: `${restoring ? "Restore" : "Move to Trash"} "${target.path}", including ${restoring ? "up to " : ""}${subtree.length} ${subtree.length === 1 ? "folder" : "folders"} and ${items.length} ${items.length === 1 ? "item" : "items"}. ${restoring ? "Items return to their previous status and may become visible to readers." : "Items remain restorable."}`,
      fingerprint: fingerprint({ subtree, items }),
    };
  }
  if (name === "remove_item_asset") {
    const post = await getPostById(handle, String(args.id));
    if (!post) throw new Error("Item not found.");
    return { summary: `Remove references to ${args.asset_url} from "${post.title}".`, fingerprint: fingerprint(post) };
  }
  if (name === "retire_document_template") {
    const workspace = await getBlogEditRecord(handle);
    if (!workspace) throw new Error("Workspace not found.");
    const templates = (await listDocumentTemplates(workspace.id)).filter((template) => template.id === args.template_id);
    if (!templates.length) throw new Error("Look not found.");
    return { summary: `Retire "${templates[0].name}" from the look pickers. Existing items keep their look.`, fingerprint: fingerprint(templates) };
  }
  throw new Error("This action has no review preview.");
}
