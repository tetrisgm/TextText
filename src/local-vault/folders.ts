import type { VaultItem } from "./bridge";
export type VaultFolder = { name: string; path: string; folders: VaultFolder[]; items: VaultItem[] };
export function folderTree(items: readonly VaultItem[], folders: readonly string[] = []): VaultFolder {
  const root: VaultFolder = { name: "", path: "", folders: [], items: [] };
  for (const item of [...folders.map((path) => ({ path: `${path}/`, title: undefined })), ...items]) {
    const components = item.path.split("/"); components.pop();
    let parent = root;
    for (const name of components) {
      const path = parent.path ? `${parent.path}/${name}` : name;
      let child = parent.folders.find((folder) => folder.path === path);
      if (!child) { child = { name, path, folders: [], items: [] }; parent.folders.push(child); }
      parent = child;
    }
    if (!item.path.endsWith("/")) parent.items.push(item);
  }
  const sort = (folder: VaultFolder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.items.sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
    folder.folders.forEach(sort);
  };
  sort(root); return root;
}
export function folderPaths(tree: VaultFolder): string[] {
  return tree.folders.flatMap((folder) => [folder.path, ...folderPaths(folder)]);
}
export function folderForItem(path: string): string { return path.split("/").slice(0, -1).join("/"); }
