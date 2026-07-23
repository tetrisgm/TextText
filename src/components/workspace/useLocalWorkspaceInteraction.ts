"use client";

import { useState } from "react";
import type { FolderCreateRequest } from "@/components/FolderPage";
import { isNoCoverValue } from "@/lib/cover";
import { poolPostsForFolder } from "@/lib/pool/selectors";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { legacyTemplateId } from "@/lib/documents/legacy";

let optimisticItemSequence = 0;

function nextOptimisticItemToken(now: number): string {
  optimisticItemSequence += 1;
  return `${Math.trunc(now).toString(36)}-${optimisticItemSequence.toString(36)}`;
}

function folderForCreateRequest(
  pool: WorkspacePoolPayload,
  request: FolderCreateRequest,
) {
  const defaultPath =
    request.type === "note"
      ? "notes"
      : request.type === "bookmark"
        ? "bookmarks"
        : "blog";
  return (
    pool.folders.find((folder) => folder.path === request.folderPath) ??
    pool.folders.find((folder) => folder.path === defaultPath) ??
    null
  );
}

function bookmarkUrlParts(rawUrl: string): { href: string; host: string } {
  const raw = rawUrl.trim();
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      return {
        href: url.toString(),
        host: url.hostname.replace(/^www\./, ""),
      };
    } catch {
      // Try the next forgiving candidate.
    }
  }
  return { href: raw, host: raw };
}

export function createOptimisticWorkspacePost(
  pool: WorkspacePoolPayload,
  request: FolderCreateRequest,
  now = Date.now(),
): WorkspacePoolPost {
  const createdAt = new Date(now).toISOString();
  const token = nextOptimisticItemToken(now);
  const folder = folderForCreateRequest(pool, request);
  const slug = `untitled-${token}`;
  const template =
    folder?.defaultTemplate ?? {
      id: legacyTemplateId(request.type),
      version: 1,
    };
  const document = emptyDocumentSnapshot(template);

  if (request.type === "bookmark" && !request.blank) {
    const { href, host } = bookmarkUrlParts(request.url);
    const title = request.title?.trim() || host || "Bookmark";
    const description = request.description?.trim();
    return {
      id: `optimistic-bookmark-${token}`,
      blogId: pool.blogId,
      folderId: folder?.id,
      document: {
        ...document,
        content: {
          ...document.content,
          title,
          subtitle: description || href,
          fields: {
            sourceUrl: href,
            sourceLabel: host || title,
          },
        },
      },
      visibility: "private",
      template,
      type: "bookmark",
      captureStatus: "pending",
      capture: { url: href },
      links: [{ label: host || title, href }],
      slug,
      title,
      excerpt: description || href,
      status: "draft",
      pinned: false,
      starred: false,
      wordCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
  }

  return {
    id: `optimistic-${request.type}-${token}`,
    blogId: pool.blogId,
    folderId: folder?.id,
    document: {
      ...document,
      content: {
        ...document.content,
        title:
          request.type === "note" || request.type === "bookmark"
            ? (request.title?.trim() ?? "")
            : "",
      },
    },
    visibility: "private",
    template,
    type: request.type,
    slug,
    title:
      request.type === "note" || request.type === "bookmark"
        ? (request.title?.trim() ?? "")
        : "",
    excerpt: "",
    status: "draft",
    pinned: false,
    starred: false,
    wordCount: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

export function mergeCreatedWorkspacePost(
  saved: WorkspacePoolPost,
  optimistic: WorkspacePoolPost | null,
): WorkspacePoolPost {
  if (!optimistic) return saved;
  return {
    ...saved,
    document: optimistic.document ?? saved.document,
    visibility: optimistic.visibility ?? saved.visibility,
    template: optimistic.template ?? saved.template,
    title: optimistic.title,
    excerpt: optimistic.excerpt,
    updatedAt: optimistic.updatedAt ?? saved.updatedAt,
  };
}

export function shouldOpenWorkspacePostInEdit(
  post: WorkspacePoolPost,
  body: string | null | undefined,
): boolean {
  if (post.type === "note") return true;
  if (post.type === "bookmark") return false;

  const title = post.title.trim().toLowerCase();
  const bodyIsKnownEmpty =
    typeof body === "string" ? !body.trim() : post.wordCount === 0;
  return (
    (!title || title === "untitled") &&
    !(post.excerpt ?? "").trim() &&
    bodyIsKnownEmpty &&
    (!post.cover?.trim() || isNoCoverValue(post.cover)) &&
    (post.gallery?.length ?? 0) === 0 &&
    !post.videoUrl?.trim()
  );
}

export function shouldAutofocusWorkspacePostEditor(
  post: Pick<WorkspacePoolPost, "type">,
): boolean {
  void post.type;
  return false;
}

export function nextWorkspacePostAfterDelete(
  pool: WorkspacePoolPayload,
  postId: string,
  folderPath: string,
): WorkspacePoolPost | null {
  const siblings = poolPostsForFolder(pool, folderPath);
  const deletedIndex = siblings.findIndex((post) => post.id === postId);
  return deletedIndex >= 0 ? (siblings[deletedIndex + 1] ?? null) : null;
}

export type WorkspaceItemIdentityRegistry = {
  currentId: (postId: string) => string;
  reconcile: (previousId: string, postId: string) => void;
  resolvePost: (
    pool: WorkspacePoolPayload,
    postId: string,
  ) => WorkspacePoolPost | null;
  stableKey: (postId: string) => string;
};

export function createWorkspaceItemIdentityRegistry(): WorkspaceItemIdentityRegistry {
  const aliases = new Map<string, string>();
  const stableKeys = new Map<string, string>();

  const canonicalId = (postId: string) => {
    let current = postId;
    const visited = new Set<string>();
    while (aliases.has(current) && !visited.has(current)) {
      visited.add(current);
      current = aliases.get(current) ?? current;
    }
    return current;
  };

  const stableKey = (postId: string) => {
    const canonical = canonicalId(postId);
    return stableKeys.get(postId) ?? stableKeys.get(canonical) ?? postId;
  };

  return {
    currentId: canonicalId,
    reconcile(previousId, postId) {
      const key = stableKey(previousId);
      aliases.set(previousId, postId);
      stableKeys.set(previousId, key);
      stableKeys.set(postId, key);
    },
    resolvePost(pool, postId) {
      const direct = pool.posts.find((post) => post.id === postId);
      if (direct) return direct;
      const requestedKey = stableKey(postId);
      return (
        pool.posts.find((post) => stableKey(post.id) === requestedKey) ?? null
      );
    },
    stableKey,
  };
}

export function useLocalWorkspaceItemIdentity(): WorkspaceItemIdentityRegistry {
  const [registry] = useState(createWorkspaceItemIdentityRegistry);
  return registry;
}
