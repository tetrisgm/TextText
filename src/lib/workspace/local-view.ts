// The local workspace's view model: the URL <-> view mapping, hrefs, and the
// pure selection/geometry helpers the shell and its pages share. Extracted
// from the PostWorkspaceShell monolith; everything here is renderless and
// most of it is pure.

import type { Blog, Folder, FolderMode, ItemKind } from "@/lib/content";
import type { SpatialDirection } from "@/lib/commands/types";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import {
  findPoolPostById,
  findPoolPostBySlug,
  folderPathForPoolPost,
  poolPostsForFolder,
} from "@/lib/pool/selectors";
import {
  workspaceSearchLocationFromUrl,
  workspaceSearchReturnFromUrl,
  type WorkspaceSearchLocation,
} from "@/lib/workspace-navigation";
import {
  SHARED_FOLDER_PATH,
  STARRED_FOLDER_PATH,
  TRASH_FOLDER_PATH,
} from "@/lib/workspace-paths";

export type SidebarFolderId = string;

export const ROOT_SECTION_MODES: FolderMode[] = ["blog", "notes", "bookmarks"];

export type LocalWorkspaceView =
  | { level: "root" }
  | ({ level: "search" } & WorkspaceSearchLocation)
  | { level: "settings" }
  | { folderPath: string; level: "section" }
  | { folderPath: typeof TRASH_FOLDER_PATH; level: "trash" }
  | { folderPath: typeof SHARED_FOLDER_PATH; level: "shared" }
  | { folderPath: typeof STARRED_FOLDER_PATH; level: "starred" }
  | {
      folderPath: string;
      level: "post";
      postId: string;
      openedFrom?: "folder" | "root" | "search";
      returnToSearch?: WorkspaceSearchLocation;
    }
  | {
      folderPath: string;
      level: "edit";
      postId: string;
      openedFrom?: "folder" | "root" | "search";
      returnToSearch?: WorkspaceSearchLocation;
    };

export type WorkspaceActiveRegion = "body" | "sidebar";

export function encodedTenantHomePath(blog: Blog): string {
  return `/t/${encodeURIComponent(blog.handle)}`;
}

export function trimTrailingSlash(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

export function viewFromUrl(
  pool: WorkspacePoolPayload,
  homePath: string,
  url: URL,
): LocalWorkspaceView {
  const pathname = trimTrailingSlash(url.pathname);
  const homePaths = [
    trimTrailingSlash(homePath),
    trimTrailingSlash(encodedTenantHomePath(pool.blog)),
  ];
  const matchingHome = homePaths.find(
    (candidate) =>
      pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  if (!matchingHome) return { level: "root" };

  if (pathname === matchingHome) {
    if (url.searchParams.get("view") === "settings") {
      return { level: "settings" };
    }
    const folderPath = url.searchParams.get("folder");
    if (folderPath === TRASH_FOLDER_PATH) {
      return { level: "trash", folderPath: TRASH_FOLDER_PATH };
    }
    if (folderPath === SHARED_FOLDER_PATH) {
      return { level: "shared", folderPath: SHARED_FOLDER_PATH };
    }
    if (folderPath === STARRED_FOLDER_PATH) {
      return { level: "starred", folderPath: STARRED_FOLDER_PATH };
    }
    if (
      folderPath &&
      pool.folders.some((folder) => folder.path === folderPath)
    ) {
      return { level: "section", folderPath };
    }
    const searchLocation = workspaceSearchLocationFromUrl(url);
    if (searchLocation) return { level: "search", ...searchLocation };
    return { level: "root" };
  }

  const rest = pathname.slice(matchingHome.length + 1);
  // Item URLs are folder-scoped ("documentation/reader-images", nested
  // folders included): the SLUG is the last segment. Taking the first
  // segment here made every history navigation to an item parse as an
  // unknown slug and fall back to the root view, so a forward swipe drew
  // the list and then a later URL sync corrected it - the redraw churn
  // reported on swipe navigation.
  const segments = rest.split("/").map((part) => decodeURIComponent(part));
  const slug = segments[segments.length - 1] ?? "";
  if (!slug || segments[0] === "c") return { level: "root" };
  const editRequested = url.searchParams.get("edit") === "1";
  const editId = url.searchParams.get("id");
  const post =
    editRequested && editId
      ? (findPoolPostById(pool, editId) ?? findPoolPostBySlug(pool, slug))
      : findPoolPostBySlug(pool, slug);
  if (!post) return { level: "root" };
  const urlFolderPath = segments.slice(0, -1).join("/");
  const folderPath =
    urlFolderPath && pool.folders.some((folder) => folder.path === urlFolderPath)
      ? urlFolderPath
      : folderPathForPoolPost(pool, post);
  return {
    level: editRequested || post.type === "note" ? "edit" : "post",
    postId: post.id,
    folderPath,
    returnToSearch: workspaceSearchReturnFromUrl(url),
  };
}

export function currentLocalView(
  pool: WorkspacePoolPayload,
  homePath: string,
): LocalWorkspaceView {
  if (typeof window === "undefined") return { level: "root" };
  return viewFromUrl(pool, homePath, new URL(window.location.href));
}

export function localWorkspaceViewDepth(view: LocalWorkspaceView): number {
  if (view.level === "root" || view.level === "search") return 0;
  if (
    view.level === "settings" ||
    view.level === "section" ||
    view.level === "trash" ||
    view.level === "shared" ||
    view.level === "starred"
  ) {
    return 1;
  }
  return 2;
}

export function localViewActiveFolder(
  view: LocalWorkspaceView,
): SidebarFolderId | null {
  if (
    view.level === "root" ||
    view.level === "search" ||
    view.level === "settings"
  ) {
    return null;
  }
  return view.folderPath;
}

export function isOptimisticPostId(postId: string): boolean {
  return postId.startsWith("optimistic-");
}

export function workspaceActionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

export function folderWorkspaceHref(
  homePath: string,
  folder: SidebarFolderId,
): string {
  return `${homePath}?folder=${encodeURIComponent(folder)}`;
}

export function workspaceRootHref(homePath: string): string {
  return homePath;
}

export function workspaceSettingsHref(homePath: string): string {
  return `${homePath}?view=settings`;
}

export function rootSectionFolders(pool: WorkspacePoolPayload): Folder[] {
  const roots = pool.folders
    .filter(
      (folder) => !folder.parentId && ROOT_SECTION_MODES.includes(folder.mode),
    )
    .slice()
    .sort((a, b) => a.position - b.position);
  if (roots.length > 0) return roots.slice(0, 3);
  return ROOT_SECTION_MODES.map(
    (mode) => pool.folders.find((folder) => folder.mode === mode) ?? null,
  ).filter((folder): folder is Folder => Boolean(folder));
}

export function validRootSectionPath(
  pool: WorkspacePoolPayload,
  preferred: string | null,
): string | null {
  if (preferred === STARRED_FOLDER_PATH) return preferred;
  if (preferred && pool.folders.some((folder) => folder.path === preferred)) {
    return preferred;
  }
  return null;
}

export function selectedPostIdForView(
  pool: WorkspacePoolPayload,
  view: LocalWorkspaceView,
  preferred?: string | null,
): string | null {
  if (view.level === "post" || view.level === "edit") return view.postId;
  if (view.level === "trash") {
    const posts = pool.trashedPosts ?? [];
    if (preferred && posts.some((post) => post.id === preferred))
      return preferred;
    return null;
  }
  if (view.level === "search") {
    if (preferred && pool.posts.some((post) => post.id === preferred)) {
      return preferred;
    }
    return null;
  }
  if (view.level === "starred") {
    if (
      preferred &&
      pool.posts.some((post) => post.id === preferred && post.starred)
    ) {
      return preferred;
    }
    return null;
  }
  if (view.level !== "section") return null;
  const posts = poolPostsForFolder(pool, view.folderPath);
  if (preferred && posts.some((post) => post.id === preferred)) {
    return preferred;
  }
  return null;
}

export function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function visibleWorkspaceItems(attribute: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[${attribute}]`),
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export function spatialNeighbor(
  items: HTMLElement[],
  current: HTMLElement | null,
  direction: SpatialDirection,
): HTMLElement | null {
  if (items.length === 0) return null;
  if (!current) return items[0] ?? null;
  const currentRect = current.getBoundingClientRect();
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;
  let best: { element: HTMLElement; score: number } | null = null;

  for (const element of items) {
    if (element === current) continue;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const primary =
      direction === "left"
        ? -dx
        : direction === "right"
          ? dx
          : direction === "up"
            ? -dy
            : dy;
    if (primary <= 2) continue;
    const cross =
      direction === "left" || direction === "right"
        ? Math.abs(dy)
        : Math.abs(dx);
    const score = primary + cross * 3;
    if (!best || score < best.score) best = { element, score };
  }

  return best?.element ?? current;
}

