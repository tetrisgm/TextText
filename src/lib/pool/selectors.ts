import {
  BLOG_FOLDER_PATH,
  isBlogBucketPath,
  isPrivatePostType,
  readingTimeMinForWordCount,
} from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import type { AdjacentPublishedPosts } from "@/lib/store";

function fallbackFolderPathForType(type: WorkspacePoolPost["type"]): string {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return BLOG_FOLDER_PATH;
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
    type: post.type,
    captureStatus: post.captureStatus,
    capture: post.capture,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    bodyPreview:
      post.bodyPreview ?? (post.type === "note" ? post.body : undefined),
    accent: post.accent,
    cover: post.cover,
    coverCaption: post.coverCaption,
    coverHeight: post.coverHeight,
    gallery: post.gallery,
    links: post.links,
    videoUrl: post.videoUrl,
    venue: post.venue,
    duration: post.duration,
    wordCount: post.wordCount,
    readingTime: post.readingTime,
    date: post.date,
    publishedAt: post.status === "published" ? post.date : undefined,
    status: post.status,
    pinned: post.pinned,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export function postFromPoolPost(
  post: WorkspacePoolPost,
  body = "",
): Post {
  return {
    id: post.id,
    type: post.type,
    captureStatus: post.captureStatus,
    capture: post.capture,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    bodyPreview: post.bodyPreview,
    accent: post.accent,
    cover: post.cover,
    coverCaption: post.coverCaption,
    coverHeight: post.coverHeight,
    gallery: post.gallery,
    links: post.links,
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
    folderId: post.folderId,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
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
}: {
  blog: Blog;
  blogId: string;
  counts: Record<string, number>;
  folders: Folder[];
  posts: Post[];
  trashedFolders?: Folder[];
  trashedPosts?: Post[];
  sharedEntries?: WorkspacePoolPayload["sharedEntries"];
}): WorkspacePoolPayload {
  const initialBodies = posts.flatMap((post) =>
    post.id && post.type === "note"
      ? [{ postId: post.id, body: post.body, updatedAt: post.updatedAt }]
      : [],
  );
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
    initialBodies,
    fetchedAt: new Date().toISOString(),
  };
}

export function folderPathForPoolPost(
  pool: Pick<WorkspacePoolPayload, "folders">,
  post: Pick<WorkspacePoolPost, "folderId" | "type">,
): string {
  const folder = post.folderId
    ? pool.folders.find((entry) => entry.id === post.folderId)
    : null;
  return folder?.path ?? fallbackFolderPathForType(post.type);
}

export function poolPostsForFolder(
  pool: WorkspacePoolPayload,
  folderPath: string,
): WorkspacePoolPost[] {
  return pool.posts.filter((post) => {
    const postFolderPath = folderPathForPoolPost(pool, post);
    if (folderPath === BLOG_FOLDER_PATH) {
      return (
        !isPrivatePostType(post.type) &&
        (postFolderPath === BLOG_FOLDER_PATH ||
          postFolderPath.startsWith(`${BLOG_FOLDER_PATH}/`))
      );
    }
    if (isBlogBucketPath(folderPath) && isPrivatePostType(post.type)) {
      return false;
    }
    return postFolderPath === folderPath;
  });
}

export function findPoolPostBySlug(
  pool: WorkspacePoolPayload,
  slug: string,
): WorkspacePoolPost | null {
  return pool.posts.find((post) => post.slug === slug) ?? null;
}

export function findPoolPostById(
  pool: WorkspacePoolPayload,
  postId: string,
): WorkspacePoolPost | null {
  return pool.posts.find((post) => post.id === postId) ?? null;
}

function timestampForAdjacent(post: WorkspacePoolPost): string {
  return post.publishedAt ?? post.date ?? post.createdAt ?? "";
}

export function adjacentPublishedPostsForPool(
  pool: WorkspacePoolPayload,
  slug: string,
): AdjacentPublishedPosts {
  const published = pool.posts
    .filter((post) => post.status === "published" && !isPrivatePostType(post.type))
    .slice()
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      }
      return timestampForAdjacent(b).localeCompare(timestampForAdjacent(a));
    });
  const index = published.findIndex((post) => post.slug === slug);
  if (index < 0) return { previous: null, next: null };
  const previous = published[index - 1];
  const next = published[index + 1];
  return {
    previous: previous
      ? { slug: previous.slug, title: previous.title }
      : null,
    next: next ? { slug: next.slug, title: next.title } : null,
  };
}
