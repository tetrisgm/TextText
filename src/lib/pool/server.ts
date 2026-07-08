import { resolveWorkspaceAccess, type AccessUser } from "@/lib/permissions";
import {
  getAllPosts,
  getBlog,
  getFolderCounts,
  getFolders,
} from "@/lib/store";
import {
  workspacePoolFromParts,
} from "@/lib/pool/selectors";
import type { WorkspacePoolPayload } from "@/lib/pool/types";

export async function getWorkspacePoolForOwner(
  handle: string,
  user: AccessUser | null,
): Promise<WorkspacePoolPayload | null> {
  const [blog, access] = await Promise.all([
    getBlog(handle),
    resolveWorkspaceAccess({ handle, user }),
  ]);
  if (!blog || !access.isOwner || !access.blogId) return null;

  const [folders, counts, posts] = await Promise.all([
    getFolders(handle),
    getFolderCounts(handle),
    getAllPosts(handle),
  ]);

  return workspacePoolFromParts({
    blog,
    blogId: access.blogId,
    counts,
    folders,
    posts,
  });
}
