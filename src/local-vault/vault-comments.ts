import type { VaultAccess } from "./shared-vaults";

export type VaultComment = {
  id: string;
  parentId: string | null;
  imageAssetId?: string;
  body: string;
  authorUserId: string;
  authorName: string;
  authorActorType: "human" | "external_agent";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedByActorType: "human" | "external_agent" | null;
};
export type VaultCommentThread = { root: VaultComment; replies: VaultComment[] };
export type VaultCommentsPage = { comments: VaultComment[]; nextCursor: string | null; revision: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validComment(value: unknown): value is VaultComment {
  const comment = value as Partial<VaultComment> | null;
  return !!comment && typeof comment.id === "string" && uuid.test(comment.id) &&
    (comment.parentId === null || typeof comment.parentId === "string" && uuid.test(comment.parentId)) &&
    (comment.imageAssetId === undefined || typeof comment.imageAssetId === "string" && !!comment.imageAssetId.trim() && comment.imageAssetId.length <= 120) &&
    typeof comment.body === "string" && comment.body.length > 0 && comment.body.length <= 4000 &&
    typeof comment.authorUserId === "string" && typeof comment.authorName === "string" &&
    ["human", "external_agent"].includes(comment.authorActorType ?? "") &&
    typeof comment.createdAt === "string" && Number.isFinite(Date.parse(comment.createdAt)) &&
    typeof comment.updatedAt === "string" && Number.isFinite(Date.parse(comment.updatedAt)) &&
    (comment.resolvedAt === null || typeof comment.resolvedAt === "string" && Number.isFinite(Date.parse(comment.resolvedAt))) &&
    (comment.resolvedByUserId === null || typeof comment.resolvedByUserId === "string") &&
    (comment.resolvedByActorType === null || ["human", "external_agent"].includes(comment.resolvedByActorType ?? ""));
}

export function parseVaultCommentsPage(value: unknown): VaultCommentsPage {
  const page = value as Partial<VaultCommentsPage> | null;
  if (!page || !Array.isArray(page.comments) || page.comments.length > 100 ||
      page.comments.some(comment => !validComment(comment)) ||
      !(page.nextCursor === null || typeof page.nextCursor === "string" && uuid.test(page.nextCursor)) ||
      typeof page.revision !== "string" || !page.revision) {
    throw new Error("The comments response is invalid.");
  }
  return page as VaultCommentsPage;
}

export function groupVaultCommentThreads(comments: readonly VaultComment[]): VaultCommentThread[] {
  const threads: VaultCommentThread[] = [];
  const roots = new Map<string, VaultCommentThread>();
  for (const comment of comments) {
    if (!comment.parentId) {
      const thread = { root: comment, replies: [] };
      roots.set(comment.id, thread);
      threads.push(thread);
    } else {
      const parent = roots.get(comment.parentId);
      if (parent) parent.replies.push(comment);
      else threads.push({ root: comment, replies: [] });
    }
  }
  return threads;
}

export function vaultCommentCapabilities(access: VaultAccess | null, itemId: string, relativePath: string):
  { canComment: boolean; canResolve: boolean } {
  if (!access) return { canComment: false, canResolve: false };
  if (access.fullAccess) return { canComment: access.canComment, canResolve: access.canEditContent };
  const roles = access.grants.filter(grant => grant.scopeType === "item" ? grant.scopeKey === itemId :
    relativePath.startsWith(`${grant.scopeKey}/`)).map(grant => grant.role);
  return { canComment: roles.includes("commenter") || roles.includes("editor"), canResolve: roles.includes("editor") };
}

/** Refresh only while the panel is visible, without overlapping requests. */
export function watchVaultComments(
  win: Pick<Window, "addEventListener" | "removeEventListener">,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">,
  busy: () => boolean,
  refresh: () => Promise<unknown>,
): () => void {
  let active = true;
  let pending = false;
  const update = () => {
    if (!active || pending || busy() || doc.visibilityState !== "visible") return;
    pending = true;
    void refresh().catch(() => {}).finally(() => { pending = false; });
  };
  const timer = setInterval(update, 15_000);
  win.addEventListener("focus", update);
  doc.addEventListener("visibilitychange", update);
  return () => {
    active = false;
    clearInterval(timer);
    win.removeEventListener("focus", update);
    doc.removeEventListener("visibilitychange", update);
  };
}
