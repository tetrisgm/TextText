// Scoped sharing for workspace, folder, and item collaboration. Invites are
// keyed by normalized email; permission reads honor unbound email matches
// without binding them as a side effect.

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { recordAction, type AuditActorType } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { blogs, collaborators, folders, posts, users } from "@/lib/db/schema";
import {
  type AccessUser,
  type CollaboratorScopeType,
  type ItemShareRole,
  type WorkspaceMemberRole,
  isItemShareRole,
  isValidAccessEmail,
  isWorkspaceMemberRole,
  normalizeAccessEmail,
  resolveItemAccess,
} from "@/lib/permissions";
import { getUserIdBySub } from "@/lib/store";

export type ShareRole = ItemShareRole;
export type WorkspaceShareRole = WorkspaceMemberRole;
export type ScopeShareRole = ShareRole | WorkspaceShareRole;
export type ShareUser = AccessUser & { sub: string; email?: string | null };

export type ScopeShare = {
  id: string;
  email: string;
  role: ScopeShareRole;
  accepted: boolean;
  createdAt: string;
};

export type PostShare = ScopeShare & { role: ShareRole };

type ShareAuditContext = {
  actorType?: AuditActorType;
  actorUserId?: string | null;
  auditActionName?: string;
};

export function normalizeShareEmail(email: string): string {
  return normalizeAccessEmail(email);
}

export function isValidShareEmail(email: string): boolean {
  return isValidAccessEmail(email);
}

function cleanScopeRole(
  scopeType: CollaboratorScopeType,
  value: unknown,
): ScopeShareRole {
  if (scopeType === "workspace") {
    if (value === "admin") return "member";
    return isWorkspaceMemberRole(value) ? value : "guest";
  }
  return isItemShareRole(value) ? value : "viewer";
}

function cleanItemRole(value: unknown): ShareRole {
  return value === "editor" ? "editor" : "viewer";
}

function maxShareRole(current: ShareRole | undefined, next: ShareRole): ShareRole {
  return current === "editor" || next === "editor" ? "editor" : "viewer";
}

function auditTargetType(scopeType: CollaboratorScopeType): "workspace" | "folder" | "item" {
  return scopeType;
}

async function emailSubUserId(email: string): Promise<string | null> {
  return getUserIdBySub(`email:${email}`);
}

export async function listScopeShares(
  scopeType: CollaboratorScopeType,
  scopeId: string,
): Promise<ScopeShare[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(collaborators)
    .where(
      and(
        eq(collaborators.scopeType, scopeType),
        eq(collaborators.scopeId, scopeId),
        isNull(collaborators.revokedAt),
      ),
    );
  return rows
    .map((row) => ({
      id: row.id,
      email: row.invitedEmail ?? "",
      role: cleanScopeRole(scopeType, row.role),
      accepted: Boolean(row.userId),
      createdAt: row.createdAt.toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function inviteScopeShare(opts: {
  scopeType: CollaboratorScopeType;
  scopeId: string;
  email: string;
  role: ScopeShareRole;
  invitedBySub: string;
} & ShareAuditContext): Promise<ScopeShare> {
  if (!db) throw new Error("Sharing needs a database.");
  const email = normalizeShareEmail(opts.email);
  if (!isValidShareEmail(email)) throw new Error("Enter a valid email address.");
  const role = cleanScopeRole(opts.scopeType, opts.role);
  const invitedById =
    opts.actorUserId === undefined
      ? await getUserIdBySub(opts.invitedBySub)
      : opts.actorUserId;

  const existing = await db
    .select()
    .from(collaborators)
    .where(
      and(
        eq(collaborators.scopeType, opts.scopeType),
        eq(collaborators.scopeId, opts.scopeId),
        eq(collaborators.invitedEmail, email),
        isNull(collaborators.revokedAt),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const updated = await db
      .update(collaborators)
      .set({ role })
      .where(eq(collaborators.id, existing[0].id))
      .returning();
    const row = updated[0];
    await recordAction({
      actorUserId: invitedById,
      actorType: opts.actorType ?? "human",
      actionName: opts.auditActionName ?? "share.invite",
      targetType: auditTargetType(opts.scopeType),
      targetId: opts.scopeId,
      inputSummary: `${email} as ${role}`,
    });
    return {
      id: row.id,
      email,
      role: cleanScopeRole(opts.scopeType, row.role),
      accepted: Boolean(row.userId),
      createdAt: row.createdAt.toISOString(),
    };
  }

  const inserted = await db
    .insert(collaborators)
    .values({
      scopeType: opts.scopeType,
      scopeId: opts.scopeId,
      invitedEmail: email,
      userId: await emailSubUserId(email),
      role,
      invitedById,
    })
    .returning();
  const row = inserted[0];
  await recordAction({
    actorUserId: invitedById,
    actorType: opts.actorType ?? "human",
    actionName: opts.auditActionName ?? "share.invite",
    targetType: auditTargetType(opts.scopeType),
    targetId: opts.scopeId,
    inputSummary: `${email} as ${role}`,
  });
  return {
    id: row.id,
    email,
    role: cleanScopeRole(opts.scopeType, row.role),
    accepted: Boolean(row.userId),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function updateScopeShareRole(opts: {
  scopeType: CollaboratorScopeType;
  scopeId: string;
  shareId: string;
  role: ScopeShareRole;
  updatedBySub: string;
} & ShareAuditContext): Promise<void> {
  if (!db) return;
  const role = cleanScopeRole(opts.scopeType, opts.role);
  await db
    .update(collaborators)
    .set({ role })
    .where(
      and(
        eq(collaborators.id, opts.shareId),
        eq(collaborators.scopeType, opts.scopeType),
        eq(collaborators.scopeId, opts.scopeId),
        isNull(collaborators.revokedAt),
      ),
    );
  await recordAction({
    actorUserId:
      opts.actorUserId === undefined
        ? await getUserIdBySub(opts.updatedBySub)
        : opts.actorUserId,
    actorType: opts.actorType ?? "human",
    actionName: opts.auditActionName ?? "share.role",
    targetType: auditTargetType(opts.scopeType),
    targetId: opts.scopeId,
    inputSummary: role,
  });
}

export async function revokeScopeShare(
  scopeType: CollaboratorScopeType,
  scopeId: string,
  shareId: string,
  revokedBySub: string,
  audit: ShareAuditContext = {},
): Promise<void> {
  if (!db) return;
  await db
    .update(collaborators)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(collaborators.id, shareId),
        eq(collaborators.scopeType, scopeType),
        eq(collaborators.scopeId, scopeId),
        isNull(collaborators.revokedAt),
      ),
    );
  await recordAction({
    actorUserId:
      audit.actorUserId === undefined
        ? await getUserIdBySub(revokedBySub)
        : audit.actorUserId,
    actorType: audit.actorType ?? "human",
    actionName: audit.auditActionName ?? "share.revoke",
    targetType: auditTargetType(scopeType),
    targetId: scopeId,
  });
}

export async function listPostShares(postId: string): Promise<PostShare[]> {
  return (await listScopeShares("item", postId)).map((share) => ({
    ...share,
    role: cleanItemRole(share.role),
  }));
}

export async function invitePostShare(opts: {
  postId: string;
  email: string;
  role: ShareRole;
  invitedBySub: string;
}): Promise<PostShare> {
  const share = await inviteScopeShare({
    scopeType: "item",
    scopeId: opts.postId,
    email: opts.email,
    role: opts.role,
    invitedBySub: opts.invitedBySub,
  });
  return { ...share, role: cleanItemRole(share.role) };
}

export async function revokePostShare(
  postId: string,
  shareId: string,
  revokedBySub: string,
): Promise<void> {
  return revokeScopeShare("item", postId, shareId, revokedBySub);
}

export async function postShareRoleFor(
  user: ShareUser | null,
  postId: string,
): Promise<ShareRole | null> {
  if (!db || !user) return null;
  const rows = await db
    .select({ handle: blogs.handle })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(blogs.deletedAt)))
    .limit(1);
  const handle = rows[0]?.handle;
  if (!handle) return null;
  const access = await resolveItemAccess({ handle, postId, user });
  if (access.canEditContent) return "editor";
  if (access.canView) return "viewer";
  return null;
}

export async function listSharedWithMe(
  user: ShareUser | null,
): Promise<Array<{ postId: string; role: ShareRole }>> {
  if (!db || !user) return [];
  const userId = user.userId ?? await getUserIdBySub(user.sub);
  const email = user.email ? normalizeShareEmail(user.email) : "";
  const minePredicates: SQL[] = [];
  if (userId) minePredicates.push(eq(collaborators.userId, userId));
  if (email) {
    const emailPredicate = and(
      isNull(collaborators.userId),
      eq(collaborators.invitedEmail, email),
    );
    if (emailPredicate) minePredicates.push(emailPredicate);
  }
  if (minePredicates.length === 0) return [];
  const minePredicate =
    minePredicates.length === 1 ? minePredicates[0] : or(...minePredicates);
  if (!minePredicate) return [];
  const rows = await db
    .select()
    .from(collaborators)
    .where(and(minePredicate, isNull(collaborators.revokedAt)));
  const mine = rows;
  const itemIds = new Set<string>();
  const directRoles = new Map<string, ShareRole>();

  for (const row of mine) {
    if (row.scopeType === "item") {
      itemIds.add(row.scopeId);
      directRoles.set(row.scopeId, cleanItemRole(row.role));
    }
  }

  const folderIds = mine
    .filter((row) => row.scopeType === "folder")
    .map((row) => row.scopeId);
  const folderRoleById = new Map(
    mine
      .filter((row) => row.scopeType === "folder")
      .map((row) => [row.scopeId, cleanItemRole(row.role)]),
  );
  if (folderIds.length > 0) {
    const folderRows = await db
      .select({ id: folders.id, blogId: folders.blogId, parentId: folders.parentId })
      .from(folders)
      .where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)));
    const blogsTouched = new Set(folderRows.map((folder) => folder.blogId));
    for (const blogId of blogsTouched) {
      const allFolders = await db
        .select({ id: folders.id, parentId: folders.parentId })
        .from(folders)
        .where(and(eq(folders.blogId, blogId), isNull(folders.deletedAt)));
      const visibleFolderIds = new Set<string>();
      let folderRole: ShareRole = "viewer";
      let changed = true;
      for (const folder of folderRows.filter((entry) => entry.blogId === blogId)) {
        visibleFolderIds.add(folder.id);
        folderRole = maxShareRole(folderRole, folderRoleById.get(folder.id) ?? "viewer");
      }
      while (changed) {
        changed = false;
        for (const folder of allFolders) {
          if (
            folder.parentId &&
            visibleFolderIds.has(folder.parentId) &&
            !visibleFolderIds.has(folder.id)
          ) {
            visibleFolderIds.add(folder.id);
            changed = true;
          }
        }
      }
      const postRows = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.blogId, blogId),
            inArray(posts.folderId, [...visibleFolderIds]),
            isNull(posts.deletedAt),
          ),
        );
      for (const post of postRows) {
        itemIds.add(post.id);
        directRoles.set(post.id, maxShareRole(directRoles.get(post.id), folderRole));
      }
    }
  }

  return [...itemIds].map((postId) => ({
    postId,
    role: directRoles.get(postId) ?? "viewer",
  }));
}

export type SharedWithMeEntry = {
  postId: string;
  role: ShareRole;
  title: string;
  slug: string;
  blogHandle: string;
  blogUsername: string | null;
  blogName: string;
  updatedAt: string;
};

export async function getSharedPostsForUser(
  user: ShareUser | null,
): Promise<SharedWithMeEntry[]> {
  if (!db || !user) return [];
  const shares = await listSharedWithMe(user);
  if (shares.length === 0) return [];
  const roleByPost = new Map(shares.map((s) => [s.postId, s.role]));
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      updatedAt: posts.updatedAt,
      deletedAt: posts.deletedAt,
      blogHandle: blogs.handle,
      blogName: blogs.name,
      blogUsername: users.username,
    })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .leftJoin(users, eq(blogs.ownerId, users.id))
    .where(inArray(posts.id, [...roleByPost.keys()]));
  return rows
    .filter((row) => !row.deletedAt)
    .map((row) => ({
      postId: row.id,
      role: roleByPost.get(row.id) ?? "viewer",
      title: row.title,
      slug: row.slug,
      blogHandle: row.blogHandle,
      blogUsername: row.blogUsername ?? null,
      blogName: row.blogName,
      updatedAt: row.updatedAt.toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function emailForSub(sub: string): Promise<string | null> {
  if (!db) return null;
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.appleSub, sub))
    .limit(1);
  return rows[0]?.email ?? null;
}
