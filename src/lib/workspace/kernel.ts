// The workspace kernel: indexed access to the pool.
//
// The pool payload is an immutable snapshot (every mutation replaces it), so
// each snapshot gets ONE index build - by id, by slug, by folder, by tag, by
// template key, plus resolved inbound links - and every read after that is a
// map lookup. Before this, resolving a post was a linear scan of the posts
// array, a folder's contents were a filter over every post, and backlinks
// re-resolved every outbound link per call; each was O(workspace) work that
// ran on hot paths (selection moves, row renders, view routing). The
// selectors in lib/pool/selectors.ts keep their signatures and route here,
// so call sites are unchanged.
//
// This module is pure data - no React, no subscriptions. The pool store owns
// change notification; the kernel owns fast reads.

import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { normalizeTags } from "@/lib/tags";

export const KERNEL_BLOG_FOLDER_PATH = "blog";

export type WorkspaceIndexes = {
  postById: Map<string, WorkspacePoolPost>;
  postBySlug: Map<string, WorkspacePoolPost>;
  /** Posts per exact folder path, in pool order. */
  postsByFolderPath: Map<string, WorkspacePoolPost[]>;
  /** The blog folder plus every blog subfolder, rolled up, in pool order. */
  blogSubtreePosts: WorkspacePoolPost[];
  folderPathByFolderId: Map<string, string>;
  folderByPath: Map<string, WorkspacePoolPayload["folders"][number]>;
  postsByTag: Map<string, WorkspacePoolPost[]>;
  starred: WorkspacePoolPost[];
  templateByKey: Map<string, TemplateDefinition>;
  /** Which posts link TO a post, resolved once per snapshot. */
  inboundLinksByPostId: Map<string, WorkspacePoolPost[]>;
};

const cache = new WeakMap<WorkspacePoolPayload, WorkspaceIndexes>();

function templateKernelKey(id: string, version: number): string {
  return `${id}@${version}`;
}

function fallbackFolderPathForType(type: WorkspacePoolPost["type"]): string {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return KERNEL_BLOG_FOLDER_PATH;
}

function buildIndexes(pool: WorkspacePoolPayload): WorkspaceIndexes {
  const postById = new Map<string, WorkspacePoolPost>();
  const postBySlug = new Map<string, WorkspacePoolPost>();
  const postsByFolderPath = new Map<string, WorkspacePoolPost[]>();
  const blogSubtreePosts: WorkspacePoolPost[] = [];
  const postsByTag = new Map<string, WorkspacePoolPost[]>();
  const starred: WorkspacePoolPost[] = [];

  const folderPathByFolderId = new Map(
    pool.folders.map((folder) => [folder.id, folder.path]),
  );
  const folderByPath = new Map(
    pool.folders.map((folder) => [folder.path, folder]),
  );

  for (const post of pool.posts) {
    postById.set(post.id, post);
    if (!postBySlug.has(post.slug)) postBySlug.set(post.slug, post);
    const folderPath =
      (post.folderId ? folderPathByFolderId.get(post.folderId) : null) ??
      fallbackFolderPathForType(post.type);
    let bucket = postsByFolderPath.get(folderPath);
    if (!bucket) {
      bucket = [];
      postsByFolderPath.set(folderPath, bucket);
    }
    bucket.push(post);
    if (
      folderPath === KERNEL_BLOG_FOLDER_PATH ||
      folderPath.startsWith(`${KERNEL_BLOG_FOLDER_PATH}/`)
    ) {
      blogSubtreePosts.push(post);
    }
    if (post.starred) starred.push(post);
    for (const tag of normalizeTags(post.tags)) {
      let tagBucket = postsByTag.get(tag);
      if (!tagBucket) {
        tagBucket = [];
        postsByTag.set(tag, tagBucket);
      }
      tagBucket.push(post);
    }
  }

  starred.sort((left, right) =>
    (right.updatedAt ?? right.createdAt ?? "").localeCompare(
      left.updatedAt ?? left.createdAt ?? "",
    ),
  );

  const templateByKey = new Map<string, TemplateDefinition>();
  for (const template of pool.templates ?? []) {
    templateByKey.set(
      templateKernelKey(template.id, template.version),
      template,
    );
  }

  // Inbound links: resolve every outbound link once. Targets resolve by
  // current slug first, then through the alias table.
  const inboundLinksByPostId = new Map<string, WorkspacePoolPost[]>();
  const aliasTable = pool.slugAliases ?? {};
  const resolveTarget = (target: string): WorkspacePoolPost | null => {
    const direct = postBySlug.get(target);
    if (direct) return direct;
    const currentSlug = aliasTable[target];
    return currentSlug ? (postBySlug.get(currentSlug) ?? null) : null;
  };
  for (const source of pool.posts) {
    const links = pool.outboundLinks?.[source.id] ?? [];
    const seenTargets = new Set<string>();
    for (const link of links) {
      const target = resolveTarget(link.target);
      if (!target || target.id === source.id || seenTargets.has(target.id)) {
        continue;
      }
      seenTargets.add(target.id);
      let bucket = inboundLinksByPostId.get(target.id);
      if (!bucket) {
        bucket = [];
        inboundLinksByPostId.set(target.id, bucket);
      }
      bucket.push(source);
    }
  }

  return {
    postById,
    postBySlug,
    postsByFolderPath,
    blogSubtreePosts,
    folderPathByFolderId,
    folderByPath,
    postsByTag,
    starred,
    templateByKey,
    inboundLinksByPostId,
  };
}

/** The indexes for one pool snapshot, built once per snapshot identity. */
export function workspaceIndexes(
  pool: WorkspacePoolPayload,
): WorkspaceIndexes {
  const cached = cache.get(pool);
  if (cached) return cached;
  const built = buildIndexes(pool);
  cache.set(pool, built);
  return built;
}

export function kernelTemplateFor(
  pool: WorkspacePoolPayload,
  id: string,
  version: number,
): TemplateDefinition | null {
  return (
    workspaceIndexes(pool).templateByKey.get(templateKernelKey(id, version)) ??
    null
  );
}
