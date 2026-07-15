// Pure helpers for the MCP workspace tools. Deliberately the SAME
// markdown-file vocabulary as the sync API v1 (src/app/api/sync/v1/sync.ts):
// items travel as markdown files with frontmatter, indexes travel as
// manifest-style entries, and the sha256 hash of the rendered file is the
// conflict currency for updates. Nothing here touches the database.

import { blogBaseUrl, oneLine, postUrl } from "@/lib/agent-surface";
import type { Blog, Folder, FolderMode, ItemKind, Post, PostType } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import { itemKindForPostType, renderPostMarkdownFile } from "@/lib/markdown-files";

/** What a new item is when the file's frontmatter does not say. */
export const DEFAULT_TYPE_BY_MODE: Record<FolderMode, PostType> = {
  blog: "article",
  notes: "note",
  bookmarks: "bookmark",
};

/** Manifest-style entry, the shape every listing and mutation tool returns. */
export type McpItemEntry = {
  id?: string;
  slug: string;
  title: string;
  kind: ItemKind;
  status: Post["status"];
  date?: string;
  createdAt?: string;
  updatedAt?: string;
  /** monotonic store revision used by guarded mutations */
  revision?: number;
  /** the same file over HTTP, on the sync API */
  file?: string;
  /** sha256 hex of the rendered markdown file; the if_match_hash currency */
  hash: string;
};

/** notes and bookmarks are always unlisted: their status never leaves draft. */
export function isAlwaysDraftType(type: PostType): boolean {
  return type === "note" || type === "bookmark";
}

/**
 * The folder mode a post type natively belongs to. The store files a post by
 * its type (createDraft) and never moves it on save, so a type may only ever
 * change within one mode: letting a note become an "article" would both
 * strand a public post inside the private notes folder and, worse, publish
 * something the owner filed as private.
 */
export function folderModeForType(type: PostType): FolderMode {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return "blog";
}

/** The file-vocabulary kinds a folder mode accepts, for tool error messages. */
export function kindsForFolderMode(mode: FolderMode): string {
  if (mode === "notes") return "note";
  if (mode === "bookmarks") return "bookmark";
  return "article, media_post, or video_post";
}

/**
 * The item kind for a post. itemKindForPostType (markdown-files.ts) only
 * speaks the blog folder's vocabulary and would call a note an "article", so
 * the private types are mapped here first.
 */
export function itemKindForPost(post: Pick<Post, "type">): ItemKind {
  if (post.type === "note") return "note";
  if (post.type === "bookmark") return "bookmark";
  return itemKindForPostType(post.type);
}

/** Path of a post's markdown file on the sync API (the HTTP twin of MCP). */
export function syncFileUrl(postId: string): string {
  return `/api/sync/v1/files/${postId}`;
}

/**
 * A post's markdown file exactly as the sync API GET serves it (public
 * canonical URL baked in) plus its content hash.
 */
export function renderItemFile(
  blog: Blog,
  post: Post,
): { text: string; hash: string } {
  const text = renderPostMarkdownFile({
    blog,
    canonicalUrl: postUrl(blogBaseUrl(blog), post.slug),
    post,
  });
  return { text, hash: markdownFileHash(text) };
}

/** One manifest-style entry for a post, as every tool returns it. */
export function itemEntry(blog: Blog, post: Post): McpItemEntry {
  return {
    ...(post.id ? { id: post.id } : {}),
    slug: post.slug,
    title: post.title,
    kind: itemKindForPost(post),
    status: post.status,
    ...(post.date ? { date: post.date } : {}),
    ...(post.createdAt ? { createdAt: post.createdAt } : {}),
    ...(post.updatedAt ? { updatedAt: post.updatedAt } : {}),
    ...(post.revision !== undefined ? { revision: post.revision } : {}),
    ...(post.id ? { file: syncFileUrl(post.id) } : {}),
    hash: renderItemFile(blog, post).hash,
  };
}

/**
 * Whether a post lives in a folder. A post without a folderId (not yet
 * backfilled) counts as living in the default "blog" folder, the same rule as
 * the sync manifest route.
 */
export function postInFolder(folder: Folder, post: Post): boolean {
  return post.folderId ? post.folderId === folder.id : folder.path === "blog";
}

/**
 * An if_match_hash as clients may quote it: bare hex, an ETag ("hash"), or a
 * proxy-weakened W/"hash" all normalize to the bare hex the manifest carries.
 */
export function normalizeItemHash(value: string): string {
  return value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

/** Case-insensitive substring match over an item's title, excerpt, and body. */
export function postMatchesQuery(post: Post, query: string): boolean {
  const q = query.toLowerCase();
  return [post.title, post.excerpt ?? "", post.body].some((text) =>
    text.toLowerCase().includes(q),
  );
}

/** A short one-line snippet around the first match, for search results. */
export function searchSnippet(post: Post, query: string): string {
  const q = query.toLowerCase();
  for (const source of [post.excerpt ?? "", post.body]) {
    const flat = oneLine(source);
    const index = flat.toLowerCase().indexOf(q);
    if (index === -1) continue;
    const start = Math.max(0, index - 60);
    const end = Math.min(flat.length, index + q.length + 100);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < flat.length ? "..." : "";
    return `${prefix}${flat.slice(start, end)}${suffix}`;
  }
  // The match was in the title alone; fall back to how the item opens.
  const opening = oneLine(post.excerpt || post.body);
  return opening.length > 160 ? `${opening.slice(0, 157)}...` : opening;
}
