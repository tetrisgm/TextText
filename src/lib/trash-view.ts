import type { Folder } from "@/lib/content";
import type { WorkspacePoolPost } from "@/lib/pool/types";

type TrashViewProjection = {
  rootFolders: Folder[];
  visiblePosts: WorkspacePoolPost[];
};

/**
 * A trashed folder is restored as one hierarchy. Its nested folders and posts
 * stay hidden in Trash so an item cannot be restored into a deleted parent.
 */
export function projectTrashView(
  folders: Folder[],
  posts: WorkspacePoolPost[],
): TrashViewProjection {
  const trashedFolderIds = new Set(folders.map((folder) => folder.id));
  return {
    rootFolders: folders.filter(
      (folder) => !folder.parentId || !trashedFolderIds.has(folder.parentId),
    ),
    visiblePosts: posts.filter(
      (post) => !post.folderId || !trashedFolderIds.has(post.folderId),
    ),
  };
}
