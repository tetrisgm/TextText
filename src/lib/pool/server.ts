import { resolveWorkspaceAccess, type AccessUser } from "@/lib/permissions";
import {
  getAllPosts,
  getBlog,
  getFolderCounts,
  getFolders,
  getTrashedFolders,
  getTrashedPosts,
  getPostSlugAliases,
  getWorkspaceWikiLinkSources,
  listDocumentTemplates,
} from "@/lib/store";
import { workspacePoolFromParts } from "@/lib/pool/selectors";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { getSharedPostsForUser } from "@/lib/shares";
import type { Post } from "@/lib/content";
import { extractWikiLinks } from "@/lib/wikilinks";

export function workspaceWikiLinkMetadata(
  fullPosts: readonly Pick<Post, "body" | "id">[],
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
    wikiLinkSources,
    slugAliases,
    trashedFolders,
    trashedPosts,
    sharedEntries,
    templates,
  ] = await Promise.all([
    getFolders(handle),
    getFolderCounts(handle),
    getAllPosts(handle),
    getWorkspaceWikiLinkSources(handle),
    getPostSlugAliases(handle),
    getTrashedFolders(handle),
    getTrashedPosts(handle),
    getSharedPostsForUser(user?.sub ? { ...user, sub: user.sub } : null),
    listDocumentTemplates(access.blogId),
  ]);
  const wikiLinks = workspaceWikiLinkMetadata(wikiLinkSources, slugAliases);

  return workspacePoolFromParts({
    blog,
    blogId: access.blogId,
    counts,
    folders,
    posts,
    trashedFolders,
    trashedPosts,
    sharedEntries,
    templates,
    ...wikiLinks,
  });
}
