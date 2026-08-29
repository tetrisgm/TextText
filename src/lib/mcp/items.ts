// Pure helpers for the MCP workspace tools. Deliberately the SAME
// markdown-file vocabulary as the sync API v1 (src/app/api/sync/v1/sync.ts):
// items travel as markdown files with frontmatter, indexes travel as
// manifest-style entries, and the sha256 hash of the rendered file is the
// conflict currency for updates. Nothing here touches the database.

import { blogBaseUrl, oneLine, postUrl } from "@/lib/agent-surface";
import type { Blog, FolderMode, ItemKind, Post } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import { renderPostMarkdownFile } from "@/lib/markdown-files";
import { normalizeTags } from "@/lib/tags";
import { extractWikiLinks, resolveTarget } from "@/lib/wikilinks";
import { serializeWikiLink } from "@/lib/wikilink-syntax";
import { rankSearchText, searchExcerpt } from "@/lib/workspace-search";

/** What a new item is when the file's frontmatter does not say. */
export const DEFAULT_TYPE_BY_MODE: Record<FolderMode, ItemKind> = {
  blog: "article",
  notes: "note",
  bookmarks: "bookmark",
};

type WikiLink = {
  raw: string;
  targetId?: string;
  targetSlug?: string;
  title?: string;
  resolved: boolean;
};

export type BacklinkRef = {
  id: string;
  slug: string;
  title: string;
};

/** Manifest-style entry, the shape every listing and mutation tool returns. */
type McpItemEntry = {
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
  tags: string[];
  /** The pinned immutable template reference, when the item carries one. */
  template?: { id: string; version: number };
  /** Custom field values declared by the item's template; omitted when empty. */
  fields?: Record<string, unknown>;
  wikilinks: WikiLink[];
  /** Populated only by read_item because it requires a full workspace scan. */
  backlinks?: BacklinkRef[];
};

/** notes and bookmarks are always unlisted: their status never leaves draft. */
export function isAlwaysDraftType(type: ItemKind): boolean {
  return type === "note" || type === "bookmark";
}

/**
 * The folder mode a post type natively belongs to. The store files a post by
 * its type (createDraft) and never moves it on save, so a type may only ever
 * change within one mode: letting a note become an "article" would both
 * strand a public post inside the private notes folder and, worse, publish
 * something the owner filed as private.
 */
export function folderModeForType(type: ItemKind): FolderMode {
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
  return post.type;
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

async function resolvedWikiLinks(
  blog: Blog,
  post: Post,
  visiblePosts: readonly Post[],
): Promise<WikiLink[]> {
  const visibleIds = new Set(
    visiblePosts.flatMap((candidate) => (candidate.id ? [candidate.id] : [])),
  );
  const visibleSlugs = new Set(visiblePosts.map((candidate) => candidate.slug));
  return Promise.all(
    extractWikiLinks(post.body).map(async (reference) => {
      const resolution = await resolveTarget(blog.handle, reference.target);
      if (
        (resolution.kind === "exact" || resolution.kind === "history") &&
        (resolution.post.id
          ? visibleIds.has(resolution.post.id)
          : visibleSlugs.has(resolution.post.slug))
      ) {
        return {
          raw: serializeWikiLink(reference),
          ...(resolution.post.id ? { targetId: resolution.post.id } : {}),
          targetSlug: resolution.post.slug,
          title: resolution.post.title,
          resolved: true,
        };
      }
      return {
        raw: serializeWikiLink(reference),
        targetSlug: reference.target,
        resolved: false,
      };
    }),
  );
}

/**
 * Find live items whose prose resolves to this item. getAllPosts excludes
 * trashed rows, and resolveTarget excludes missing, ambiguous, and tombstoned
 * targets, so deleted content cannot pollute the backlink graph.
 */
export async function itemBacklinks(
  blog: Blog,
  post: Post,
  livePosts: Post[],
): Promise<BacklinkRef[]> {
  const cache = new Map<string, ReturnType<typeof resolveTarget>>();
  const backlinks: BacklinkRef[] = [];

  for (const source of livePosts) {
    if (!source.id || source.id === post.id) continue;
    let linksHere = false;
    for (const reference of extractWikiLinks(source.body)) {
      let pending = cache.get(reference.target);
      if (!pending) {
        pending = resolveTarget(blog.handle, reference.target);
        cache.set(reference.target, pending);
      }
      const resolution = await pending;
      if (
        (resolution.kind === "exact" || resolution.kind === "history") &&
        (post.id
          ? resolution.post.id === post.id
          : resolution.post.slug === post.slug)
      ) {
        linksHere = true;
        break;
      }
    }
    if (linksHere) {
      backlinks.push({ id: source.id, slug: source.slug, title: source.title });
    }
  }
  return backlinks;
}

/** One manifest-style entry for a post, as every item tool returns it. */
export async function itemEntry(
  blog: Blog,
  post: Post,
  options: {
    hash?: string;
    backlinks?: BacklinkRef[];
    visiblePosts?: readonly Post[];
  } = {},
): Promise<McpItemEntry> {
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
    hash: options.hash ?? renderItemFile(blog, post).hash,
    tags: normalizeTags(post.tags),
    // What an agent needs to work with typed documents: which template the
    // item pins and the custom field values it carries. Without these, an
    // agent could WRITE a field but never read one back.
    ...(post.template ? { template: post.template } : {}),
    ...(post.document && Object.keys(post.document.content.fields).length > 0
      ? { fields: post.document.content.fields }
      : {}),
    wikilinks: await resolvedWikiLinks(blog, post, options.visiblePosts ?? []),
    ...(options.backlinks ? { backlinks: options.backlinks } : {}),
  };
}

/**
 * An if_match_hash as clients may quote it: bare hex, an ETag ("hash"), or a
 * proxy-weakened W/"hash" all normalize to the bare hex the manifest carries.
 */
export function normalizeItemHash(value: string): string {
  return value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

/** The canonical ranked token match over an item's title, excerpt, and body. */
export function postSearchScore(post: Post, query: string): number | null {
  return rankSearchText(
    post.title,
    [post.excerpt ?? "", post.body].filter(Boolean).join(" "),
    query,
  );
}

/** A short one-line snippet around the first match, for search results. */
export function searchSnippet(post: Post, query: string): string {
  const opening = oneLine([post.excerpt ?? "", post.body].filter(Boolean).join(" "));
  const excerpt = searchExcerpt(opening, query);
  if (excerpt) return excerpt;
  // The match was in the title alone; fall back to how the item opens.
  return opening.length > 160 ? `${opening.slice(0, 157)}...` : opening;
}
