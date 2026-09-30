import type { VaultFolder } from "./folders";
import type { VaultItem } from "./bridge";
export function FolderNavigation({ tree, selectedPath, busy, onOpen, onFolder }: {
  tree: VaultFolder; selectedPath?: string; busy: boolean;
  onOpen: (item: VaultItem) => void; onFolder: (path: string) => void;
}) {
  return <>{tree.folders.map((folder) => <details className="vault-folder" key={folder.path} open>
    <summary onClick={() => onFolder(folder.path)}>{folder.name}</summary>
    <div className="vault-folder-children"><FolderNavigation tree={folder} selectedPath={selectedPath} busy={busy} onOpen={onOpen} onFolder={onFolder} /></div>
  </details>)}{tree.items.map((item) => <button disabled={busy} className={selectedPath === item.path ? "selected" : ""} key={item.path}
    aria-label={item.title || item.path.replace(/\.textpack$/, "")} title={item.path} onClick={() => onOpen(item)}>
    {item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/, "")}
  </button>)}</>;
}
