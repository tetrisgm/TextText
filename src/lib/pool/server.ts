import { resolveWorkspaceAccess, type AccessUser } from "@/lib/permissions";
import {
  getAllPostFiles,
  getBlog,
  getFolderCounts,
  getFolders,
  getTrashedFolders,
  getTrashedPosts,
  getPostSlugAliases,
} from "@/lib/store";
import { workspacePoolFromParts } from "@/lib/pool/selectors";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { getSharedPostsForUser } from "@/lib/shares";
import type { Post } from "@/lib/content";
import { extractWikiLinks } from "@/lib/wikilinks";

export function workspaceWikiLinkMetadata(
  fullPosts: readonly Post[],
  slugAliases: Record<string, string>,
): Pick<WorkspacePoolPayload, "outboundLinks" | "slugAliases"> {
  return {
    outboundLinks: Object.fromEntries(
      fullPosts.flatMap((post) =>
        post.id ? [[post.id, extractWikiLinks(post.body)] as const] : [],
      ),
    ),
    slugAliases,
  };
}

export async function getWorkspacePoolForOwner(
  handle: string,
  user: AccessUser | null,
): Promise<WorkspacePoolPayload | null> {
  const [blog, access] = await Promise.all([
    getBlog(handle),
    resolveWorkspaceAccess({ handle, user }),
  ]);
  if (!blog || !access.isOwner || !access.blogId) return null;

  const [
    folders,
    counts,
    posts,
    slugAliases,
    trashedFolders,
    trashedPosts,
    sharedEntries,
  ] = await Promise.all([
    getFolders(handle),
    getFolderCounts(handle),
    getAllPostFiles(handle),
    getPostSlugAliases(handle),
    getTrashedFolders(handle),
    getTrashedPosts(handle),
    getSharedPostsForUser(user?.sub ? { ...user, sub: user.sub } : null),
  ]);
  const wikiLinks = workspaceWikiLinkMetadata(posts, slugAliases);

  return workspacePoolFromParts({
    blog,
    blogId: access.blogId,
    counts,
    folders,
    posts,
    trashedFolders,
    trashedPosts,
    sharedEntries,
    ...wikiLinks,
  });
}
