// Who may edit a workspace: its owner. Guest/anonymous edit tokens were
// removed 2026-08-14 with the trial-workspace scope (docs/SPEC.md); share
// roles in lib/permissions.ts are the collaboration surface.

import { getCurrentUser } from "@/lib/session";
import { getBlogEditRecord, getUserIdBySub } from "@/lib/store";

export type BlogEditAccess = {
  canEdit: boolean;
  isOwner: boolean;
  blogId: string | null;
  ownerId: string | null;
};

export async function getBlogEditAccess(
  handle: string,
): Promise<BlogEditAccess> {
  const record = await getBlogEditRecord(handle);
  if (!record || !record.ownerId) {
    return { canEdit: false, isOwner: false, blogId: record?.id ?? null, ownerId: null };
  }

  const user = await getCurrentUser();
  const userId = user ? user.userId ?? (await getUserIdBySub(user.sub)) : null;
  const isOwner = userId === record.ownerId;
  return {
    canEdit: isOwner,
    isOwner,
    blogId: record.id,
    ownerId: record.ownerId,
  };
}
