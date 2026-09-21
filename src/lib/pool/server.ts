import { resolveWorkspaceAccess, type AccessUser } from "@/lib/permissions";
import { listWorkspaceReadingSources } from "@/lib/reading/sources.server";
import {
  getWorkspacePoolPosts,
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
  includeIds: string[] = [],
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
    readingSources,
  ] = await Promise.all([
    getFolders(handle),
    getFolderCounts(handle),
    getWorkspacePoolPosts(handle, includeIds),
    getWorkspaceWikiLinkSources(handle),
    getPostSlugAliases(handle),
    getTrashedFolders(handle),
    getTrashedPosts(handle),
    getSharedPostsForUser(user?.sub ? { ...user, sub: user.sub } : null),
    listDocumentTemplates(access.blogId),
    listWorkspaceReadingSources(handle, user?.userId ?? null),
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
    readingSources,
    ...wikiLinks,
  });
}
