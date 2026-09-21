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
  getPinnedDocumentTemplates,
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

export async function withPinnedTemplates(pool: WorkspacePoolPayload): Promise<WorkspacePoolPayload> {
  const available = new Set(pool.templates.map((definition) => `${definition.id}@${definition.version}`));
  const references = [
    ...pool.posts.map((post) => post.template ?? post.document?.presentation.template),
    ...(pool.trashedPosts ?? []).map((post) => post.template ?? post.document?.presentation.template),
    ...pool.folders.map((folder) => folder.defaultTemplate),
  ].filter((reference): reference is { id: string; version: number } => Boolean(reference && !available.has(`${reference.id}@${reference.version}`)));
  return { ...pool, pinnedTemplates: await getPinnedDocumentTemplates(pool.blogId, references) };
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

  return withPinnedTemplates(workspacePoolFromParts({
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
  }));
}
