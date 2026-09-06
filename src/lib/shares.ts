// Scoped sharing for workspace, folder, and item collaboration. Invites are
// keyed by normalized email; permission reads honor unbound email matches
// without binding them as a side effect.

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  auditInsertQuery,
  type AuditActorType,
} from "@/lib/audit";
import { db, executeAtomicBatch } from "@/lib/db/client";
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
  roleForTarget,
} from "@/lib/permissions";
import { getUserIdBySub } from "@/lib/store";

type ShareRole = ItemShareRole;
type WorkspaceShareRole = WorkspaceMemberRole;
export type ScopeShareRole = ShareRole | WorkspaceShareRole;
type ShareUser = AccessUser & { sub: string; email?: string | null };

export type ScopeShare = {
  id: string;
  email: string;
  role: ScopeShareRole;
  accepted: boolean;
  createdAt: string;
};

type ShareAuditContext = {
  actorType?: AuditActorType;
  actorUserId?: string | null;
  auditActionName?: string;
  auditInputSummary?: string;
};

function normalizeShareEmail(email: string): string {
  return normalizeAccessEmail(email);
}

function isValidShareEmail(email: string): boolean {
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
  const role = typeof value === "string" ? roleForTarget(value, "item", "item") : null;
  return isItemShareRole(role) ? role : "viewer";
}

function maxShareRole(current: ShareRole | undefined, next: ShareRole): ShareRole {
  const rank = { viewer: 0, commenter: 1, editor: 2 };
  return current && rank[current] > rank[next] ? current : next;
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
    // Atomic: the role change and its audit row commit together (batch), so a
    // permission change is never left without provenance.
    const [updated] = await executeAtomicBatch((database) => [
      database
        .update(collaborators)
        .set({ role })
        .where(eq(collaborators.id, existing[0].id))
        .returning(),
      auditInsertQuery({
        actorUserId: invitedById,
        actorType: opts.actorType ?? "human",
        actionName: opts.auditActionName ?? "share.invite",
        targetType: auditTargetType(opts.scopeType),
        targetId: opts.scopeId,
        inputSummary: opts.auditInputSummary ?? `${email} as ${role}`,
      }, database),
    ] as const);
    const row = updated[0];
    return {
      id: row.id,
      email,
      role: cleanScopeRole(opts.scopeType, row.role),
      accepted: Boolean(row.userId),
      createdAt: row.createdAt.toISOString(),
    };
  }

  const userId = await emailSubUserId(email);
  const [inserted] = await executeAtomicBatch((database) => [
    database
      .insert(collaborators)
      .values({
        scopeType: opts.scopeType,
        scopeId: opts.scopeId,
        invitedEmail: email,
        userId,
        role,
        invitedById,
      })
      .returning(),
    auditInsertQuery({
      actorUserId: invitedById,
      actorType: opts.actorType ?? "human",
      actionName: opts.auditActionName ?? "share.invite",
      targetType: auditTargetType(opts.scopeType),
      targetId: opts.scopeId,
      inputSummary: opts.auditInputSummary ?? `${email} as ${role}`,
    }, database),
  ] as const);
  const row = inserted[0];
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
  const actorUserId =
    opts.actorUserId === undefined
      ? await getUserIdBySub(opts.updatedBySub)
      : opts.actorUserId;
  await executeAtomicBatch((database) => [
    database
      .update(collaborators)
      .set({ role })
      .where(
        and(
          eq(collaborators.id, opts.shareId),
          eq(collaborators.scopeType, opts.scopeType),
          eq(collaborators.scopeId, opts.scopeId),
          isNull(collaborators.revokedAt),
        ),
      ),
    auditInsertQuery({
      actorUserId,
      actorType: opts.actorType ?? "human",
      actionName: opts.auditActionName ?? "share.role",
      targetType: auditTargetType(opts.scopeType),
      targetId: opts.scopeId,
      inputSummary: opts.auditInputSummary ?? role,
    }, database),
  ] as const);
}

export async function revokeScopeShare(
  scopeType: CollaboratorScopeType,
  scopeId: string,
  shareId: string,
  revokedBySub: string,
  audit: ShareAuditContext = {},
): Promise<void> {
  if (!db) return;
  const actorUserId =
    audit.actorUserId === undefined
      ? await getUserIdBySub(revokedBySub)
      : audit.actorUserId;
  await executeAtomicBatch((database) => [
    database
      .update(collaborators)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(collaborators.id, shareId),
          eq(collaborators.scopeType, scopeType),
          eq(collaborators.scopeId, scopeId),
          isNull(collaborators.revokedAt),
        ),
      ),
    auditInsertQuery({
      actorUserId,
      actorType: audit.actorType ?? "human",
      actionName: audit.auditActionName ?? "share.revoke",
      targetType: auditTargetType(scopeType),
      targetId: scopeId,
      inputSummary: audit.auditInputSummary,
    }, database),
  ] as const);
}

async function listSharedWithMe(
  user: ShareUser | null,
): Promise<{ items: Array<{ postId: string; role: ShareRole }>; workspaces: Map<string, { role: WorkspaceShareRole; itemRole: ShareRole }> }> {
  if (!db || !user) return { items: [], workspaces: new Map() };
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
  if (minePredicates.length === 0) return { items: [], workspaces: new Map() };
  const minePredicate =
    minePredicates.length === 1 ? minePredicates[0] : or(...minePredicates);
  if (!minePredicate) return { items: [], workspaces: new Map() };
  const rows = await db
    .select()
    .from(collaborators)
    .where(and(minePredicate, isNull(collaborators.revokedAt)));
  const mine = rows.filter((row) => row.scopeType === "workspace"
    ? roleForTarget(row.role, "workspace", "item") !== null
    : (row.scopeType === "item" || row.scopeType === "folder") && roleForTarget(row.role, row.scopeType, "item") !== null);
  const workspaces = new Map<string, { role: WorkspaceShareRole; itemRole: ShareRole }>();
  for (const row of mine.filter((row) => row.scopeType === "workspace")) {
    // Use permission normalization for legacy grants, keeping their item
    // privileges separate from the current member/guest destination label.
    const effective = roleForTarget(row.role, "workspace", "item");
    if (!isItemShareRole(effective)) continue;
    const itemRole = maxShareRole(workspaces.get(row.scopeId)?.itemRole, effective);
    workspaces.set(row.scopeId, { role: itemRole === "editor" ? "member" : "guest", itemRole });
  }
  const itemIds = new Set<string>();
  const directRoles = new Map<string, ShareRole>();

  for (const row of mine) {
    if (row.scopeType === "item") {
      itemIds.add(row.scopeId);
      directRoles.set(row.scopeId, maxShareRole(directRoles.get(row.scopeId), cleanItemRole(row.role)));
    }
  }

  const folderIds = mine
    .filter((row) => row.scopeType === "folder")
    .map((row) => row.scopeId);
  const folderRoleById = new Map<string, ShareRole>();
  for (const row of mine.filter((row) => row.scopeType === "folder")) {
    folderRoleById.set(row.scopeId, maxShareRole(folderRoleById.get(row.scopeId), cleanItemRole(row.role)));
  }
  if (folderIds.length > 0) {
    const folderRows = await db
      .select({ id: folders.id, blogId: folders.blogId, parentId: folders.parentId })
      .from(folders)
      .where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)));
    const blogsTouched = new Set(folderRows.map((folder) => folder.blogId));
    for (const blogId of blogsTouched) {
      const allFolders = await db
        .select({ id: folders.id, parentId: folders.parentId, path: folders.path })
        .from(folders)
        .where(and(eq(folders.blogId, blogId), isNull(folders.deletedAt)));
      const effectiveRoles = new Map<string, ShareRole>();
      for (const folder of folderRows.filter((entry) => entry.blogId === blogId)) {
        effectiveRoles.set(folder.id, folderRoleById.get(folder.id)!);
      }
      // Propagate each ancestor's grant only to its own descendants. A role
      // upgrade also propagates, even when a child already has a weaker grant.
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of allFolders) {
          const inherited = folder.parentId ? effectiveRoles.get(folder.parentId) : undefined;
          if (!inherited) continue;
          const role = maxShareRole(effectiveRoles.get(folder.id), inherited);
          if (role !== effectiveRoles.get(folder.id)) {
            effectiveRoles.set(folder.id, role);
            changed = true;
          }
        }
      }
      const defaultFolderId = allFolders.find((folder) => folder.path === "blog")?.id;
      const postRows = await db
        .select({ id: posts.id, folderId: posts.folderId })
        .from(posts)
        .where(
          and(
            eq(posts.blogId, blogId),
            or(
              inArray(posts.folderId, [...effectiveRoles.keys()]),
              defaultFolderId && effectiveRoles.has(defaultFolderId) ? isNull(posts.folderId) : undefined,
            ),
            isNull(posts.deletedAt),
          ),
        );
      for (const post of postRows) {
        const role = effectiveRoles.get(post.folderId ?? defaultFolderId ?? "");
        if (!role) continue;
        itemIds.add(post.id);
        directRoles.set(post.id, maxShareRole(directRoles.get(post.id), role));
      }
    }
  }

  return { items: [...itemIds].map((postId) => ({
    postId,
    role: directRoles.get(postId)!,
  })), workspaces };
}

export type SharedWithMeEntry = {
  /** Workspace entries use the workspace ID here and have no item slug. */
  postId: string;
  scopeType: "item" | "workspace";
  role: ScopeShareRole;
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
  const userId = user.userId ?? await getUserIdBySub(user.sub);
  const shares = await listSharedWithMe({ ...user, userId });
  if (shares.items.length === 0 && shares.workspaces.size === 0) return [];
  const roleByPost = new Map(shares.items.map((s) => [s.postId, s.role]));
  const rows = shares.items.length ? await db
    .select({
      id: posts.id,
      blogId: blogs.id,
      ownerId: blogs.ownerId,
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
    .where(and(inArray(posts.id, [...roleByPost.keys()]), isNull(blogs.deletedAt))) : [];
  const entries: SharedWithMeEntry[] = rows
    .filter((row) => !row.deletedAt)
    .map((row) => ({
      postId: row.id,
      scopeType: "item" as const,
      role: row.ownerId && row.ownerId === userId ? "editor" as const
        : maxShareRole(roleByPost.get(row.id), shares.workspaces.get(row.blogId)?.itemRole ?? "viewer"),
      title: row.title,
      slug: row.slug,
      blogHandle: row.blogHandle,
      blogUsername: row.blogUsername ?? null,
      blogName: row.blogName,
      updatedAt: row.updatedAt.toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (shares.workspaces.size) {
    const workspaceRows = await db.select({
      id: blogs.id, blogHandle: blogs.handle, blogName: blogs.name,
      blogUsername: users.username, updatedAt: blogs.createdAt,
    }).from(blogs).leftJoin(users, eq(blogs.ownerId, users.id))
      .where(and(inArray(blogs.id, [...shares.workspaces.keys()]), isNull(blogs.deletedAt)));
    for (const row of workspaceRows) {
      const role = shares.workspaces.get(row.id)?.role;
      if (!role) continue;
      entries.push({
        postId: row.id, scopeType: "workspace", role, title: row.blogName,
        slug: "", blogHandle: row.blogHandle, blogName: row.blogName,
        blogUsername: row.blogUsername ?? null, updatedAt: row.updatedAt.toISOString(),
      });
    }
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
