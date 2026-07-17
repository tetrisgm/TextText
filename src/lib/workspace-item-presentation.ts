import type { FolderMode, PostType } from "@/lib/content";

export const WORKSPACE_ITEM_TYPE_LABELS: Record<PostType, string> = {
  article: "Article",
  project: "Media",
  talk: "Video",
  note: "Note",
  bookmark: "Bookmark",
};

export function homeFolderModeForPostType(type: PostType): FolderMode {
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
  postType: PostType;
  virtualLocation?: boolean;
}): boolean {
  if (virtualLocation || !folderMode) return true;
  return folderMode !== homeFolderModeForPostType(postType);
}
