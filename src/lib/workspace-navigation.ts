import type { Folder, PostType } from "@/lib/content";

export type WorkspaceHierarchyView =
  | { level: "root" }
  | { level: "settings" }
  | { folderPath: string; level: "section" | "trash" | "shared" }
  | { folderPath: string; level: "post" | "edit"; postId: string };

export type WorkspaceNavigationTarget =
  | { kind: "none" }
  | { kind: "home" }
  | { kind: "folder"; folderPath: string }
  | { kind: "read"; folderPath: string; postId: string };

export function workspaceHierarchyUpTarget(
  view: WorkspaceHierarchyView,
  folders: readonly Folder[],
): WorkspaceNavigationTarget {
  if (view.level === "root") return { kind: "none" };
  if (view.level === "post" || view.level === "edit") {
    return { kind: "folder", folderPath: view.folderPath };
  }
  if (view.level === "section") {
    const folder = folders.find((candidate) => candidate.path === view.folderPath);
    const parent = folder?.parentId
      ? folders.find((candidate) => candidate.id === folder.parentId)
      : null;
    return parent
      ? { kind: "folder", folderPath: parent.path }
      : { kind: "home" };
  }
  return { kind: "home" };
}

export function workspaceEscapeTarget(
  view: WorkspaceHierarchyView,
  folders: readonly Folder[],
  postType?: PostType,
): WorkspaceNavigationTarget {
  if (view.level === "edit" && postType !== "note") {
    return {
      kind: "read",
      folderPath: view.folderPath,
      postId: view.postId,
    };
  }
  return workspaceHierarchyUpTarget(view, folders);
}
