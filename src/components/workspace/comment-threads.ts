import type { ItemCommentView } from "@/app/editor/actions";

export type CommentThread = {
  root: ItemCommentView;
  replies: ItemCommentView[];
};

export function groupCommentThreads(
  comments: ItemCommentView[],
): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const roots: ItemCommentView[] = [];
  const repliesByRoot = new Map<string, ItemCommentView[]>();

  const rootIdFor = (comment: ItemCommentView): string | null => {
    let current = comment;
    const visited = new Set<string>([comment.id]);
    while (current.parentId) {
      if (visited.has(current.parentId)) return null;
      visited.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (!parent) return null;
      current = parent;
    }
    return current.id;
  };

  for (const comment of comments) {
    if (!comment.parentId || !byId.has(comment.parentId)) roots.push(comment);
  }
  for (const comment of comments) {
    if (!comment.parentId || !byId.has(comment.parentId)) continue;
    const rootId = rootIdFor(comment);
    if (!rootId || rootId === comment.id) continue;
    const replies = repliesByRoot.get(rootId) ?? [];
    replies.push(comment);
    repliesByRoot.set(rootId, replies);
  }

  return roots
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((root) => ({
      root,
      replies: (repliesByRoot.get(root.id) ?? []).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    }));
}
