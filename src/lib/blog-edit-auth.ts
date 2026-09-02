// Who may edit a workspace: its owner. Guest/anonymous edit tokens were
// removed 2026-08-14 with the trial-workspace scope (docs/SPEC.md); share
// roles in lib/permissions.ts are the collaboration surface.

import { getCurrentUser } from "@/lib/session";
import { getBlogEditRecord, getUserIdBySub } from "@/lib/store";

type BlogEditAccess = {
  canEdit: boolean;
  isOwner: boolean;
  blogId: string | null;
  ownerId: string | null;
};

export async function getBlogEditAccess(
  handle: string,
): Promise<BlogEditAccess> {
  // The edit record and the viewer identity are independent lookups; issuing
  // them serially cost the workspace home a database round trip per render.
  const [record, userId] = await Promise.all([
    getBlogEditRecord(handle),
    // The identity table is authoritative. A JWT can outlive an
    // account-linking change, so its embedded userId is only a compatibility
    // fallback when the current subject has no database mapping yet.
    getCurrentUser().then(async (user) =>
      user ? (await getUserIdBySub(user.sub)) ?? user.userId ?? null : null,
    ),
  ]);
  if (!record || !record.ownerId) {
    return { canEdit: false, isOwner: false, blogId: record?.id ?? null, ownerId: null };
  }
  const isOwner = userId === record.ownerId;
  return {
    canEdit: isOwner,
    isOwner,
    blogId: record.id,
    ownerId: record.ownerId,
  };
}
