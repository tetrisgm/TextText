import { detachedSlice } from "@/lib/detached-slice";
import {
  BLOG_FOLDER_PATH,
  isPublishedPublicPost,
  readingTimeMinForWordCount,
} from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import type { AdjacentPublishedPosts } from "@/lib/store";
import { markdownSubtitle, postSubtitle } from "@/lib/markdown-subtitle";
import { normalizeTag, normalizeTags } from "@/lib/tags";
import { workspaceIndexes } from "@/lib/workspace/kernel";
import { blogPostPath } from "@/lib/public-paths";
import type {
  WikiLinkRenderTarget,
  WikiLinkRenderTargets,
} from "@/lib/wikilinks";
import { legacyTemplateId } from "@/lib/documents/legacy";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  BUILTIN_TEMPLATES,
  requireBuiltinTemplate,
  templateKey,
} from "@/lib/presentation/templates";

function fallbackFolderPathForType(type: WorkspacePoolPost["type"]): string {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return BLOG_FOLDER_PATH;
}

// Folder paths are read throughout the shell (lists, breadcrumbs, commands,
// search, and action menus). Looking up every post with Array.find made those
// renders O(posts * folders). Pool updates replace the folders array, so a
// weakly-held index gives every consumer O(1) lookup without adding serialized
// index data to the pool payload or retaining old workspaces.
const folderPathsByFolderArray = new WeakMap<Folder[], Map<string, string>>();

function folderPathIndex(folders: Folder[]): Map<string, string> {
  const cached = folderPathsByFolderArray.get(folders);
  if (cached) return cached;
  const index = new Map(folders.map((folder) => [folder.id, folder.path]));
  folderPathsByFolderArray.set(folders, index);
  return index;
}

export function narrowPostFromPost(
  post: Post,
  blogId: string,
): WorkspacePoolPost | null {
  if (!post.id) return null;
  return {
    id: post.id,
    blogId,
    folderId: post.folderId,
    visibility: post.visibility,
    template: post.template,
    type: post.type,
    captureStatus: post.captureStatus,
    capture: post.capture,
    slug: post.slug,
    title: post.title,
    excerpt: postSubtitle(post) || undefined,
    // detachedSlice, not slice: a plain cut is a V8 SlicedString that holds
    // the whole document body alive through this one preview field.
    bodyPreview:
      post.bodyPreview ?? (detachedSlice(post.body, 2048) || undefined),
    accent: post.accent,
    cover: post.cover,
    coverCaption: post.coverCaption,
    coverHeight: post.coverHeight,
    gallery: post.gallery,
    links: post.links,
    tags: normalizeTags(post.tags),
    videoUrl: post.videoUrl,
    venue: post.venue,
    duration: post.duration,
    wordCount: post.wordCount,
    readingTime: post.readingTime,
    date: post.date,
    publishedAt: post.status === "published" ? post.date : undefined,
    status: post.status,
    pinned: post.pinned,
    starred: post.starred,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    revision: post.revision,
  };
}

export function postFromPoolPost(
  post: WorkspacePoolPost,
  body = "",
): Post {
  return {
    id: post.id,
    document: post.document,
    visibility: post.visibility,
    template: post.template,
    type: post.type,
    captureStatus: post.captureStatus,
    capture: post.capture,
    slug: post.slug,
    title: post.title,
    excerpt: markdownSubtitle(body) || post.excerpt,
    bodyPreview: post.bodyPreview,
    accent: post.accent,
    cover: post.cover,
    coverCaption: post.coverCaption,
    coverHeight: post.coverHeight,
    gallery: post.gallery,
    links: post.links,
    tags: normalizeTags(post.tags),
    videoUrl: post.videoUrl,
    venue: post.venue,
    duration: post.duration,
    body,
    wordCount: post.wordCount,
    readingTime:
      post.readingTime ??
      (typeof post.wordCount === "number"
        ? readingTimeMinForWordCount(post.wordCount)
        : undefined),
    date: post.date,
    status: post.status,
    pinned: post.pinned,
    starred: post.starred,
    folderId: post.folderId,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    revision: post.revision,
  };
}


/**
 * Whether a selector argument is a full pool snapshot the kernel can index.
 * Unit tests hand these selectors hand-built partial pools; those keep the
 * linear paths, while the app's real snapshots get O(1) indexed reads.
 */
function isIndexablePool(pool: unknown): pool is WorkspacePoolPayload {
  return Boolean(
    pool &&
      typeof pool === "object" &&
      "blogId" in pool &&
      "posts" in pool &&
      "folders" in pool,
  );
}

export function starredPoolPosts(
  pool: Pick<WorkspacePoolPayload, "posts">,
): WorkspacePoolPost[] {
  if (isIndexablePool(pool)) return workspaceIndexes(pool).starred;
  return pool.posts
    .filter((post) => Boolean(post.starred))
    .slice()
    .sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? "").localeCompare(
        left.updatedAt ?? left.createdAt ?? "",
      ),
    );
}

export function workspacePoolFromParts({
  blog,
  blogId,
  counts,
  folders,
  posts,
  trashedFolders = [],
  trashedPosts = [],
  sharedEntries = [],
  templates = [...BUILTIN_TEMPLATES],
  outboundLinks = {},
  slugAliases = {},
}: {
  blog: Blog;
  blogId: string;
  counts: Record<string, number>;
  folders: Folder[];
  posts: Post[];
  trashedFolders?: Folder[];
  trashedPosts?: Post[];
  sharedEntries?: WorkspacePoolPayload["sharedEntries"];
  templates?: TemplateDefinition[];
  outboundLinks?: WorkspacePoolPayload["outboundLinks"];
  slugAliases?: WorkspacePoolPayload["slugAliases"];
}): WorkspacePoolPayload {
  return {
    version: 1,
    blogId,
    blog,
    folders,
    counts,
    posts: posts
      .map((post) => narrowPostFromPost(post, blogId))
      .filter((post): post is WorkspacePoolPost => Boolean(post)),
    trashedPosts: trashedPosts
      .map((post) => narrowPostFromPost(post, blogId))
      .filter((post): post is WorkspacePoolPost => Boolean(post)),
    trashedFolders,
    sharedEntries,
    templates,
    initialDocuments: [],
    outboundLinks,
    slugAliases,
    fetchedAt: new Date().toISOString(),
  };
}

export function templateForPoolPost(
  pool: Pick<WorkspacePoolPayload, "templates">,
  post: Pick<WorkspacePoolPost, "document" | "template" | "type">,
): TemplateDefinition {
  const reference =
    post.template ??
    post.document?.presentation.template ?? {
      id: legacyTemplateId(post.type),
      version: 1,
    };
  if (isIndexablePool(pool)) {
    return (
      workspaceIndexes(pool).templateByKey.get(
        `${reference.id}@${reference.version}`,
      ) ?? requireBuiltinTemplate(reference.id, reference.version)
    );
  }
  return (
    pool.templates.find(
      (template) =>
        templateKey(template.id, template.version) ===
        templateKey(reference.id, reference.version),
    ) ?? requireBuiltinTemplate(reference.id, reference.version)
  );
}

export function folderPathForPoolPost(
  pool: Pick<WorkspacePoolPayload, "folders">,
  post: Pick<WorkspacePoolPost, "folderId" | "type">,
): string {
  const folderPath = post.folderId
    ? folderPathIndex(pool.folders).get(post.folderId)
    : null;
  return folderPath ?? fallbackFolderPathForType(post.type);
}

export function poolPostsForFolder(
  pool: WorkspacePoolPayload,
  folderPath: string,
): WorkspacePoolPost[] {
  // Indexed: one bucket per folder, built once per pool snapshot. The
  // returned array is the shared index bucket - treat it as frozen. The
  // stable identity per (snapshot, folder) is a feature: downstream
  // useMemo/memo consumers key off it.
  const indexes = workspaceIndexes(pool);
  if (folderPath === BLOG_FOLDER_PATH) return indexes.blogSubtreePosts;
  return indexes.postsByFolderPath.get(folderPath) ?? [];
}

export function poolPostsForTag(
  pool: Pick<WorkspacePoolPayload, "posts">,
  tagInput: string,
): WorkspacePoolPost[] {
  const tag = normalizeTag(tagInput);
  if (!tag) return [];
  if (isIndexablePool(pool)) {
    return workspaceIndexes(pool).postsByTag.get(tag) ?? [];
  }
  return pool.posts.filter((post) => normalizeTags(post.tags).includes(tag));
}

export function allTagsInPool(
  pool: Pick<WorkspacePoolPayload, "posts">,
): string[] {
  const tags = new Set<string>();
  for (const post of pool.posts) {
    for (const tag of normalizeTags(post.tags)) tags.add(tag);
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
}

export function findPoolPostBySlug(
  pool: WorkspacePoolPayload,
  slug: string,
): WorkspacePoolPost | null {
  return workspaceIndexes(pool).postBySlug.get(slug) ?? null;
}

function resolvePoolWikiLinkTarget(
  pool: Pick<WorkspacePoolPayload, "posts" | "slugAliases">,
  target: string,
): WorkspacePoolPost | null {
  const direct = pool.posts.find((post) => post.slug === target);
  if (direct) return direct;
  const currentSlug = pool.slugAliases?.[target];
  return currentSlug
    ? (pool.posts.find((post) => post.slug === currentSlug) ?? null)
    : null;
}

export function backlinksForPost(
  pool: Pick<
    WorkspacePoolPayload,
    "outboundLinks" | "posts" | "slugAliases"
  >,
  post: Pick<WorkspacePoolPost, "id" | "slug">,
): WorkspacePoolPost[] {
  if (isIndexablePool(pool)) {
    return workspaceIndexes(pool).inboundLinksByPostId.get(post.id) ?? [];
  }
  const seen = new Set<string>();
  return pool.posts.filter((source) => {
    if (source.id === post.id || seen.has(source.id)) return false;
    const links = pool.outboundLinks?.[source.id] ?? [];
    const linksHere = links.some(
      (link) => resolvePoolWikiLinkTarget(pool, link.target)?.id === post.id,
    );
    if (linksHere) seen.add(source.id);
    return linksHere;
  });
}

export function wikiLinkRenderTargetsForPool(
  pool: Pick<WorkspacePoolPayload, "blog" | "posts" | "slugAliases">,
): WikiLinkRenderTargets {
  const targets: WikiLinkRenderTargets = {};
  for (const post of pool.posts) {
    targets[post.slug] = {
      slug: post.slug,
      href: blogPostPath(pool.blog, post),
    };
  }
  for (const [alias, currentSlug] of Object.entries(pool.slugAliases ?? {})) {
    const target: WikiLinkRenderTarget | undefined = targets[currentSlug];
    if (target) targets[alias] = target;
  }
  return targets;
}

export function findPoolPostById(
  pool: WorkspacePoolPayload,
  postId: string,
): WorkspacePoolPost | null {
  return workspaceIndexes(pool).postById.get(postId) ?? null;
}

function timestampForAdjacent(post: WorkspacePoolPost): string {
  return post.publishedAt ?? post.date ?? post.createdAt ?? "";
}

export function adjacentPublishedPostsForPool(
  pool: WorkspacePoolPayload,
  postKey: string,
): AdjacentPublishedPosts {
  const published = pool.posts
    .filter(isPublishedPublicPost)
    .slice()
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      }
      return timestampForAdjacent(b).localeCompare(timestampForAdjacent(a));
    });
  const index = published.findIndex(
    (post) => post.id === postKey || post.slug === postKey,
  );
  if (index < 0) return { previous: null, next: null };
  const previous = published[index - 1];
  const next = published[index + 1];
  return {
    previous: previous
      ? {
          id: previous.id,
          folderId: previous.folderId,
          slug: previous.slug,
          title: previous.title,
        }
      : null,
    next: next
      ? { id: next.id, folderId: next.folderId, slug: next.slug, title: next.title }
      : null,
  };
}
