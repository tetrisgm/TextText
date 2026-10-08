import type { VaultListing } from "./bridge";
import { folderPaths, folderTree } from "./folders";

/** Follow a whole-folder relocation only when stable file identities agree.
 * Missing or ambiguous evidence returns to a surviving ancestor; editors are
 * deliberately not replaced, flushed or closed by this navigation update. */
export function reconcileFolderLocation(folder: string, before: VaultListing | null, after: VaultListing): string {
  if (!folder || !before || before.root !== after.root || after.fullAccess !== true || !after.folders) return folder;
  const paths = new Set(folderPaths(folderTree(after.items, after.folders)));
  if (paths.has(folder)) return folder;
  const oldPaths = new Set(folderPaths(folderTree(before.items, before.folders)));
  if (!oldPaths.has(folder)) return folder;
  const byId = new Map<string, string | null>();
  for (const item of after.items) if (item.itemId) {
    byId.set(item.itemId, byId.has(item.itemId) ? null : item.path);
  }
  const children = before.items.filter(item => item.path.startsWith(folder + "/"));
  let destination: string | undefined;
  const identities = new Set<string>();
  let coherent = children.length > 0;
  for (const item of children) {
    const suffix = item.path.slice(folder.length);
    const moved = item.itemId ? byId.get(item.itemId) : null;
    if (!item.itemId || identities.has(item.itemId) || !moved?.endsWith(suffix)) { coherent = false; break; }
    identities.add(item.itemId);
    const candidate = moved.slice(0, -suffix.length);
    if (!candidate || (destination !== undefined && destination !== candidate)) { coherent = false; break; }
    destination = candidate;
  }
  if (coherent && destination && paths.has(destination)) return destination;
  let ancestor = folder;
  while (ancestor) {
    ancestor = ancestor.split("/").slice(0, -1).join("/");
    if (paths.has(ancestor)) return ancestor;
  }
  return "";
}
