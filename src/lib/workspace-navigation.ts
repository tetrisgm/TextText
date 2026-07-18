import type { Folder, PostType } from "@/lib/content";

export type WorkspaceSearchLocation = {
  query: string;
  source: "date" | "query" | "tag";
};

export type WorkspaceHierarchyView =
  | { level: "root" }
  | ({ level: "search" } & WorkspaceSearchLocation)
  | { level: "settings" }
  | { folderPath: string; level: "section" | "trash" | "shared" | "starred" }
  | {
      folderPath: string;
      level: "post" | "edit";
      postId: string;
      returnToSearch?: WorkspaceSearchLocation;
    };

export type WorkspaceNavigationTarget =
  | { kind: "none" }
  | { kind: "home" }
  | { kind: "folder"; folderPath: string }
  | ({ kind: "search" } & WorkspaceSearchLocation)
  | { kind: "read"; folderPath: string; postId: string };

const SEARCH_RETURN_QUERY_PARAM = "searchReturn";
const SEARCH_RETURN_SOURCE_PARAM = "searchSource";

export function workspaceSearchHref(
  homePath: string,
  location: WorkspaceSearchLocation,
): string {
  const params = new URLSearchParams();
  params.set(
    location.source === "date"
      ? "date"
      : location.source === "tag"
        ? "tag"
        : "q",
    location.query,
  );
  return `${homePath}?${params.toString()}`;
}

export function workspaceSearchLocationFromUrl(
  url: URL,
): WorkspaceSearchLocation | null {
  const dateQuery = url.searchParams.get("date")?.trim();
  if (dateQuery) return { query: dateQuery, source: "date" };
  const tagQuery = url.searchParams.get("tag")?.trim();
  if (tagQuery) return { query: tagQuery, source: "tag" };
  const textQuery = url.searchParams.get("q")?.trim();
  return textQuery ? { query: textQuery, source: "query" } : null;
}

export function workspaceHrefWithSearchReturn(
  href: string,
  location: WorkspaceSearchLocation | undefined,
): string {
  if (!location?.query.trim()) return href;
  const url = new URL(href, "https://write.local");
  url.searchParams.set(SEARCH_RETURN_QUERY_PARAM, location.query);
  url.searchParams.set(SEARCH_RETURN_SOURCE_PARAM, location.source);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function workspaceSearchReturnFromUrl(
  url: URL,
): WorkspaceSearchLocation | undefined {
  const query = url.searchParams.get(SEARCH_RETURN_QUERY_PARAM)?.trim();
  if (!query) return undefined;
  return {
    query,
    source: (() => {
      const source = url.searchParams.get(SEARCH_RETURN_SOURCE_PARAM);
      return source === "date" || source === "tag" ? source : "query";
    })(),
  };
}

export function rootFolderPathForSelection(
  folders: readonly Folder[],
  folderPath: string | null | undefined,
): string | null {
  let folder = folderPath
    ? folders.find((candidate) => candidate.path === folderPath)
    : undefined;
  if (!folder) return null;
  const byId = new Map(folders.map((candidate) => [candidate.id, candidate]));
  while (folder.parentId) {
    const parent = byId.get(folder.parentId);
    if (!parent) break;
    folder = parent;
  }
  return folder.path;
}

export function rememberedRootFolderPath(
  folders: readonly Folder[],
  rememberedPath: string | null | undefined,
): string | null {
  const roots = new Set(
    folders
      .filter((folder) => !folder.parentId)
      .map((folder) => folder.path),
  );
  return rememberedPath && roots.has(rememberedPath)
    ? rememberedPath
    : null;
}

export function shouldMoveSelectionIntoSidebar({
  direction,
  hasCurrentItem,
  neighborChanged,
}: {
  direction: "down" | "left" | "right" | "up";
  hasCurrentItem: boolean;
  neighborChanged: boolean;
}): boolean {
  return direction === "left" && hasCurrentItem && !neighborChanged;
}

export function shouldClearWorkspaceSelection({
  button,
  defaultPrevented,
  insideInteractive,
}: {
  button: number;
  defaultPrevented: boolean;
  insideInteractive: boolean;
}): boolean {
  return button === 0 && !defaultPrevented && !insideInteractive;
}

export function workspaceHierarchyUpTarget(
  view: WorkspaceHierarchyView,
  folders: readonly Folder[],
): WorkspaceNavigationTarget {
  if (view.level === "root" || view.level === "search") {
    return { kind: "none" };
  }
  if (view.level === "post" || view.level === "edit") {
    if (view.returnToSearch) {
      return { kind: "search", ...view.returnToSearch };
    }
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
