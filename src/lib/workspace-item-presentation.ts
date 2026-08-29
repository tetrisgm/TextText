import type { FolderMode, ItemKind } from "@/lib/content";

export const WORKSPACE_ITEM_TYPE_LABELS: Record<ItemKind, string> = {
  article: "Article",
  media_post: "Media",
  video_post: "Video",
  note: "Note",
  bookmark: "Bookmark",
};

export function homeFolderModeForPostType(type: ItemKind): FolderMode {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
}

export function shouldShowWorkspaceTypeChip({
  folderMode,
  postType,
  virtualLocation = false,
}: {
  folderMode?: FolderMode | null;
  postType: ItemKind;
  virtualLocation?: boolean;
}): boolean {
  if (virtualLocation || !folderMode) return true;
  return folderMode !== homeFolderModeForPostType(postType);
}
