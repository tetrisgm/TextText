"use client";

/**
 * The open editor owns its live draft. Assistant actions use this tiny bridge
 * so they read and patch that draft instead of creating a competing copy in
 * the pool store. When an item is not open, callers fall back to the normal
 * local-first pool command.
 */
export type WorkspaceItemTextSnapshot = {
  title: string;
  excerpt: string;
  body: string;
};

export type WorkspaceItemTextPatch = Partial<WorkspaceItemTextSnapshot>;

type OpenWorkspaceItemDraft = {
  read: () => WorkspaceItemTextSnapshot;
  apply: (patch: WorkspaceItemTextPatch) => void;
};

const openDrafts = new Map<string, OpenWorkspaceItemDraft>();

export function registerOpenWorkspaceItemDraft(
  postId: string,
  draft: OpenWorkspaceItemDraft,
): () => void {
  openDrafts.set(postId, draft);
  return () => {
    if (openDrafts.get(postId) === draft) openDrafts.delete(postId);
  };
}

export function readOpenWorkspaceItemDraft(
  postId: string,
): WorkspaceItemTextSnapshot | null {
  return openDrafts.get(postId)?.read() ?? null;
}

export function patchOpenWorkspaceItemDraft(
  postId: string,
  patch: WorkspaceItemTextPatch,
): boolean {
  const draft = openDrafts.get(postId);
  if (!draft) return false;
  draft.apply(patch);
  return true;
}
