// Local draft sessions: the in-tab record of open editors' unsaved state,
// shared between the shell (pool merge), the editor wrappers and the pool
// cache. Extracted from the PostWorkspaceShell monolith; module state on
// purpose - one workspace tab, one set of open drafts.

import type { DraftState } from "@/lib/post-edit-draft";
import { slugify } from "@/lib/post-edit-draft";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import {
  getCachedWorkspacePostDocument,
  updatePostDocument,
} from "@/lib/pool/store";
import { persistWorkspaceDraft } from "@/lib/pool/storage";
import { markdownSubtitle } from "@/lib/markdown-subtitle";

export const localWorkspaceDraftSessions = new Map<string, DraftState>();
export const localWorkspacePendingSaveIds = new Set<string>();
export const localWorkspaceDraftRevisions = new Map<string, number>();
export const localWorkspaceServerRevisions = new Map<string, string>();

export function localDraftRevision(postId: string): number {
  return localWorkspaceDraftRevisions.get(postId) ?? 0;
}

export function bumpLocalDraftRevision(postId: string): number {
  const revision = localDraftRevision(postId) + 1;
  localWorkspaceDraftRevisions.set(postId, revision);
  return revision;
}

export function transferLocalDraftRevision(previousId: string, postId: string) {
  const revision = localDraftRevision(previousId);
  localWorkspaceDraftRevisions.delete(previousId);
  if (revision > 0) localWorkspaceDraftRevisions.set(postId, revision);
}

export function persistLocalWorkspaceDraft(
  blogId: string,
  postId: string,
  draft: DraftState,
  key: string,
  baseUpdatedAt?: string,
) {
  void persistWorkspaceDraft({
    blogId,
    postId,
    draft,
    key,
    baseUpdatedAt,
    persistedAt: new Date().toISOString(),
  });
}

export function mergeDraftIntoWorkspacePost(
  post: WorkspacePoolPost,
  draft: DraftState,
): WorkspacePoolPost {
  return {
    ...post,
    type: draft.type,
    title: draft.title,
    excerpt: markdownSubtitle(draft.body) || undefined,
    slug: slugify(draft.slug, post.slug),
    status: draft.status,
    cover: draft.cover || undefined,
    coverCaption: draft.coverCaption || undefined,
    coverHeight: draft.coverHeight ?? undefined,
    accent: draft.accent || undefined,
    gallery: draft.gallery,
    tags: draft.tags,
    videoUrl: draft.videoUrl || undefined,
    venue: draft.venue || undefined,
    duration: draft.duration || undefined,
    date: draft.date || undefined,
  };
}

export function documentWithUpdatedBody(
  document: DocumentSnapshot,
  body: string,
): DocumentSnapshot {
  return {
    ...document,
    content: { ...document.content, body },
  };
}

export function updateCachedDocumentBody(
  blogId: string,
  postId: string,
  body: string,
): DocumentSnapshot {
  const document = getCachedWorkspacePostDocument(blogId, postId)?.document;
  if (!document) {
    throw new Error(`Cannot update item ${postId} before its document loads`);
  }
  const nextDocument = documentWithUpdatedBody(document, body);
  updatePostDocument(blogId, postId, nextDocument);
  return nextDocument;
}
