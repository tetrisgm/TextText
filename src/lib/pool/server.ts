import { resolveWorkspaceAccess, type AccessUser } from "@/lib/permissions";
import {
  getAllPosts,
  getBlog,
  getFolderCounts,
  getFolders,
  getTrashedFolders,
  getTrashedPosts,
} from "@/lib/store";
import {
  workspacePoolFromParts,
} from "@/lib/pool/selectors";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { getSharedPostsForUser } from "@/lib/shares";

export async function getWorkspacePoolForOwner(
  handle: string,
  user: AccessUser | null,
): Promise<WorkspacePoolPayload | null> {
  const [blog, access] = await Promise.all([
    getBlog(handle),
    resolveWorkspaceAccess({ handle, user }),
  ]);
  if (!blog || !access.isOwner || !access.blogId) return null;

  const [folders, counts, posts, trashedFolders, trashedPosts, sharedEntries] = await Promise.all([
    getFolders(handle),
    getFolderCounts(handle),
    getAllPosts(handle),
    getTrashedFolders(handle),
    getTrashedPosts(handle),
    getSharedPostsForUser(
      user?.sub ? { ...user, sub: user.sub } : null,
    ),
  ]);

  return workspacePoolFromParts({
    blog,
    blogId: access.blogId,
    counts,
    folders,
    posts,
    trashedFolders,
    trashedPosts,
    sharedEntries,
  });
}
