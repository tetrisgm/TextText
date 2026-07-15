import type { WorkspacePoolPayload } from "@/lib/pool/types";
import {
  findPoolPostById,
  folderPathForPoolPost,
} from "@/lib/pool/selectors";

export type AssistantContextKind = "workspace" | "folder" | "item";

export type AssistantContext = {
  label: string;
  detail?: string;
  kind?: AssistantContextKind;
};

export type AssistantViewSnapshot = {
  level?: string;
  folderPath?: string;
  postId?: string;
};

export type AssistantWorkspaceView =
  | { level: "root" }
  | { folderPath: string; level: "section" | "trash" | "shared" }
  | { folderPath: string; level: "post" | "edit"; postId: string };

export type ResolvedAssistantContext = {
  chip: AssistantContext;
  contextKey: string;
  view: AssistantViewSnapshot;
};

function folderPlaceKey(homePath: string, folderPath: string): string {
  return `place:${homePath}?folder=${encodeURIComponent(folderPath)}`;
}

export function resolveWorkspaceAssistantContext({
  homePath,
  pool,
  selectedFolderPath,
  selectedPostId,
  view,
}: {
  homePath: string;
  pool: WorkspacePoolPayload;
  selectedFolderPath: string | null;
  selectedPostId: string | null;
  view: AssistantWorkspaceView;
}): ResolvedAssistantContext {
  const itemId =
    view.level === "post" || view.level === "edit"
      ? view.postId
      : view.level === "section"
        ? selectedPostId
        : null;
  const item = itemId ? findPoolPostById(pool, itemId) : null;

  if (item) {
    const folderPath = folderPathForPoolPost(pool, item);
    return {
      chip: {
        kind: "item",
        label: item.title.trim() || "Untitled",
        detail:
          view.level === "edit"
            ? "Editing"
            : view.level === "section"
              ? "Selected item"
              : "Item",
      },
      contextKey: `item:${item.id}`,
      view: {
        level: view.level === "edit" ? "edit" : "post",
        folderPath,
        postId: item.id,
      },
    };
  }

  const folderPath =
    view.level === "root"
      ? selectedFolderPath
      : view.level === "section"
        ? view.folderPath
        : null;
  const folder = folderPath
    ? pool.folders.find((candidate) => candidate.path === folderPath)
    : null;

  if (folder) {
    return {
      chip: { kind: "folder", label: folder.name, detail: "Folder" },
      contextKey: folderPlaceKey(homePath, folder.path),
      view: { level: "section", folderPath: folder.path },
    };
  }

  if (view.level === "trash" || view.level === "shared") {
    const label = view.level === "trash" ? "Trash" : "Shared with me";
    return {
      chip: { kind: "folder", label },
      contextKey: folderPlaceKey(homePath, view.folderPath),
      view: { level: view.level, folderPath: view.folderPath },
    };
  }

  return {
    chip: {
      kind: "workspace",
      label: pool.blog.name,
      detail: "Workspace",
    },
    contextKey: `place:${homePath}`,
    view: { level: "root" },
  };
}
