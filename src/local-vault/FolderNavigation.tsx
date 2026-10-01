import type { VaultFolder } from "./folders";
export function FolderNavigation({ tree, selectedFolder, onFolder }: {
  tree: VaultFolder; selectedFolder: string; onFolder: (path: string) => void;
}) {
  return <>{tree.folders.map((folder) => <details className="vault-folder" key={folder.path} open>
    <summary className={selectedFolder === folder.path ? "selected" : ""} onClick={() => onFolder(folder.path)}>{folder.name}</summary>
    <div className="vault-folder-children"><FolderNavigation tree={folder} selectedFolder={selectedFolder} onFolder={onFolder} /></div>
  </details>)}</>;
}
