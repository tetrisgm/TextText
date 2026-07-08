// Effective collaboration permissions. Ownership is implicit on blogs.owner_id;
// named access lives in collaborators rows scoped to a workspace, folder, or
// item. Callers ask for capabilities and never infer them from route shape.

import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "./db/client";
import { blogs, collaborators, folders, posts, users } from "./db/schema";

export type EffectiveRole = "owner" | "editor" | "viewer";
export type CollaboratorScopeType = "workspace" | "folder" | "item";
export type ItemShareRole = "editor" | "viewer";
export type WorkspaceMemberRole = "member" | "guest";
export type StoredCollaboratorRole =
  | "admin"
  | "member"
  | "guest"
  | "editor"
  | "reviewer"
  | "viewer";

export type AccessUser = {
  sub?: string | null;
  userId?: string | null;
  email?: string | null;
  name?: string | null;
};

export type EffectiveAccess = {
  role: EffectiveRole | null;
  canView: boolean;
  canEditContent: boolean;
  canManage: boolean;
  isOwner: boolean;
  userId: string | null;
  blogId: string | null;
  workspaceRole: StoredCollaboratorRole | null;
};

type ScopeKey = {
  scopeType: CollaboratorScopeType;
  scopeId: string;
};

type CollaboratorRow = typeof collaborators.$inferSelect;
type FolderRow = typeof folders.$inferSelect;

const ROLE_RANK: Record<EffectiveRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isItemShareRole(value: unknown): value is ItemShareRole {
  return value === "editor" || value === "viewer";
}

export function isWorkspaceMemberRole(
  value: unknown,
): value is WorkspaceMemberRole {
  return value === "member" || value === "guest";
}

export function isStoredCollaboratorRole(
  value: unknown,
): value is StoredCollaboratorRole {
  return (
    value === "admin" ||
    value === "member" ||
    value === "guest" ||
    value === "editor" ||
    value === "reviewer" ||
    value === "viewer"
  );
}

export function normalizeAccessEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidAccessEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

export function maxEffectiveRole(
  current: EffectiveRole | null,
  next: EffectiveRole | null,
): EffectiveRole | null {
  if (!next) return current;
  if (!current) return next;
  return ROLE_RANK[next] > ROLE_RANK[current] ? next : current;
}

export function roleAtLeast(
  role: EffectiveRole | null,
  needed: EffectiveRole,
): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}

function emptyAccess(
  userId: string | null = null,
  blogId: string | null = null,
): EffectiveAccess {
  return {
    role: null,
    canView: false,
    canEditContent: false,
    canManage: false,
    isOwner: false,
    userId,
    blogId,
    workspaceRole: null,
  };
}

function accessFromRole(
  role: EffectiveRole | null,
  opts: {
    userId: string | null;
    blogId: string | null;
    workspaceRole?: StoredCollaboratorRole | null;
    canManage?: boolean;
    isOwner?: boolean;
  },
): EffectiveAccess {
  const isOwner = opts.isOwner ?? role === "owner";
  const canManage =
    Boolean(opts.canManage) || isOwner || opts.workspaceRole === "admin";
  return {
    role,
    canView: roleAtLeast(role, "viewer"),
    canEditContent: roleAtLeast(role, "editor"),
    canManage,
    isOwner,
    userId: opts.userId,
    blogId: opts.blogId,
    workspaceRole: opts.workspaceRole ?? null,
  };
}

function storedRole(value: string): StoredCollaboratorRole | null {
  return isStoredCollaboratorRole(value) ? value : null;
}

function roleForTarget(
  rawRole: string,
  scopeType: CollaboratorScopeType,
  targetType: CollaboratorScopeType,
): EffectiveRole | null {
  const role = storedRole(rawRole);
  if (!role) return null;

  if (targetType !== "workspace" && scopeType === "workspace") {
    if (role === "guest") return null;
    if (role === "admin" || role === "member" || role === "editor") {
      return "editor";
    }
    if (role === "reviewer" || role === "viewer") return "viewer";
    return null;
  }

  if (role === "admin" || role === "member" || role === "editor") {
    return "editor";
  }
  if (role === "guest" || role === "reviewer" || role === "viewer") {
    return "viewer";
  }
  return null;
}

function scopeWhere(scopes: ScopeKey[]): SQL | undefined {
  const predicates = scopes.map((scope) =>
    and(
      eq(collaborators.scopeType, scope.scopeType),
      eq(collaborators.scopeId, scope.scopeId),
    ),
  );
  if (predicates.length === 0) return undefined;
  if (predicates.length === 1) return predicates[0];
  return or(...predicates);
}

async function existingUserIdForAccess(user: AccessUser | null): Promise<string | null> {
  if (!db || !user) return null;
  if (user.userId) return user.userId;
  const sub = user.sub?.trim();
  if (!sub) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.appleSub, sub))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function ensureUserIdForAccess(user: AccessUser): Promise<string | null> {
  if (!db) return null;
  if (user.userId) return user.userId;
  const sub = user.sub?.trim();
  if (!sub) return null;
  const email = user.email ? normalizeAccessEmail(user.email) : null;
  await db
    .insert(users)
    .values({
      appleSub: sub,
      email,
      name: user.name ?? null,
    })
    .onConflictDoUpdate({
      target: users.appleSub,
      set: {
        email: email ?? sql`${users.email}`,
        name: user.name ?? sql`${users.name}`,
      },
    });
  return existingUserIdForAccess(user);
}

async function matchingCollaboratorRows(
  user: AccessUser | null,
  scopes: ScopeKey[],
): Promise<{ rows: CollaboratorRow[]; userId: string | null }> {
  if (!db || !user || scopes.length === 0) return { rows: [], userId: null };
  const database = db;
  const predicate = scopeWhere(scopes);
  if (!predicate) return { rows: [], userId: null };

  let userId = await existingUserIdForAccess(user);
  const email = user.email ? normalizeAccessEmail(user.email) : "";
  const rows = await database
    .select()
    .from(collaborators)
    .where(and(predicate, isNull(collaborators.revokedAt)));

  const matched = rows.filter((row) => {
    if (userId && row.userId === userId) return true;
    if (!row.userId && email && row.invitedEmail === email) return true;
    return false;
  });

  const hasUnboundEmailMatch = matched.some(
    (row) => !row.userId && email && row.invitedEmail === email,
  );
  if (hasUnboundEmailMatch && !userId) {
    userId = await ensureUserIdForAccess(user);
  }

  if (userId) {
    await Promise.all(
      matched
        .filter((row) => !row.userId && email && row.invitedEmail === email)
        .map((row) =>
          database
            .update(collaborators)
            .set({ userId })
            .where(and(eq(collaborators.id, row.id), isNull(collaborators.userId))),
        ),
    );
  }

  return {
    rows: matched.filter((row) => {
      if (row.userId && userId && row.userId !== userId) return false;
      return Boolean(row.userId || userId || (email && row.invitedEmail === email));
    }),
    userId,
  };
}

function folderAndAncestorIds(
  allFolders: FolderRow[],
  folderId: string | null,
): string[] {
  if (!folderId) return [];
  const byId = new Map(allFolders.map((folder) => [folder.id, folder]));
  const ids: string[] = [];
  let current = byId.get(folderId);
  while (current) {
    ids.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return ids;
}

function descendantFolderIds(
  allFolders: FolderRow[],
  folderId: string,
): Set<string> {
  const result = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of allFolders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

async function folderRowsForBlog(blogId: string): Promise<FolderRow[]> {
  if (!db) return [];
  return db
    .select()
    .from(folders)
    .where(and(eq(folders.blogId, blogId), isNull(folders.deletedAt)));
}

async function blogAccessBase(
  handle: string,
  user: AccessUser | null,
): Promise<{
  blogId: string;
  ownerId: string | null;
  userId: string | null;
  owner: boolean;
} | null> {
  if (!db) return null;
  const rows = await db
    .select({ id: blogs.id, ownerId: blogs.ownerId })
    .from(blogs)
    .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const userId = await existingUserIdForAccess(user);
  return {
    blogId: row.id,
    ownerId: row.ownerId,
    userId,
    owner: Boolean(userId && row.ownerId && userId === row.ownerId),
  };
}

export async function resolveWorkspaceAccess(opts: {
  handle: string;
  user: AccessUser | null;
}): Promise<EffectiveAccess> {
  const base = await blogAccessBase(opts.handle, opts.user);
  if (!base) return emptyAccess();
  if (base.owner) {
    return accessFromRole("owner", {
      userId: base.userId,
      blogId: base.blogId,
      isOwner: true,
      canManage: true,
    });
  }

  const { rows, userId } = await matchingCollaboratorRows(opts.user, [
    { scopeType: "workspace", scopeId: base.blogId },
  ]);
  let role: EffectiveRole | null = null;
  let workspaceRole: StoredCollaboratorRole | null = null;
  for (const row of rows) {
    const raw = storedRole(row.role);
    if (raw) workspaceRole = raw;
    role = maxEffectiveRole(role, roleForTarget(row.role, "workspace", "workspace"));
  }
  return accessFromRole(role, {
    userId: userId ?? base.userId,
    blogId: base.blogId,
    workspaceRole,
  });
}

export async function resolveFolderAccess(opts: {
  handle: string;
  folderId?: string;
  folderPath?: string;
  user: AccessUser | null;
}): Promise<EffectiveAccess> {
  const base = await blogAccessBase(opts.handle, opts.user);
  if (!base) return emptyAccess();
  if (base.owner) {
    return accessFromRole("owner", {
      userId: base.userId,
      blogId: base.blogId,
      isOwner: true,
      canManage: true,
    });
  }

  const allFolders = await folderRowsForBlog(base.blogId);
  const folder =
    allFolders.find((entry) =>
      opts.folderId ? entry.id === opts.folderId : entry.path === opts.folderPath,
    ) ?? null;
  if (!folder) return emptyAccess(base.userId, base.blogId);

  const folderIds = folderAndAncestorIds(allFolders, folder.id);
  const scopes: ScopeKey[] = [
    { scopeType: "workspace", scopeId: base.blogId },
    ...folderIds.map((scopeId) => ({ scopeType: "folder" as const, scopeId })),
  ];
  const { rows, userId } = await matchingCollaboratorRows(opts.user, scopes);
  let role: EffectiveRole | null = null;
  let workspaceRole: StoredCollaboratorRole | null = null;
  for (const row of rows) {
    const scopeType = row.scopeType as CollaboratorScopeType;
    if (scopeType === "workspace") {
      const raw = storedRole(row.role);
      if (raw) workspaceRole = raw;
    }
    role = maxEffectiveRole(role, roleForTarget(row.role, scopeType, "folder"));
  }
  return accessFromRole(role, {
    userId: userId ?? base.userId,
    blogId: base.blogId,
    workspaceRole,
  });
}

export async function resolveItemAccess(opts: {
  handle: string;
  postId: string;
  user: AccessUser | null;
}): Promise<EffectiveAccess> {
  if (!db || !isUuid(opts.postId)) return emptyAccess();
  const rows = await db
    .select({
      postId: posts.id,
      blogId: blogs.id,
      ownerId: blogs.ownerId,
      folderId: posts.folderId,
    })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, opts.handle),
        eq(posts.id, opts.postId),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    )
    .limit(1);
  const post = rows[0];
  if (!post) return emptyAccess();

  const userId = await existingUserIdForAccess(opts.user);
  if (userId && post.ownerId && userId === post.ownerId) {
    return accessFromRole("owner", {
      userId,
      blogId: post.blogId,
      isOwner: true,
      canManage: true,
    });
  }

  const allFolders = await folderRowsForBlog(post.blogId);
  const effectiveFolderId =
    post.folderId ?? allFolders.find((folder) => folder.path === "blog")?.id ?? null;
  const folderIds = folderAndAncestorIds(allFolders, effectiveFolderId);
  const scopes: ScopeKey[] = [
    { scopeType: "workspace", scopeId: post.blogId },
    ...folderIds.map((scopeId) => ({ scopeType: "folder" as const, scopeId })),
    { scopeType: "item", scopeId: post.postId },
  ];
  const matched = await matchingCollaboratorRows(opts.user, scopes);
  let role: EffectiveRole | null = null;
  let workspaceRole: StoredCollaboratorRole | null = null;
  for (const row of matched.rows) {
    const scopeType = row.scopeType as CollaboratorScopeType;
    if (scopeType === "workspace") {
      const raw = storedRole(row.role);
      if (raw) workspaceRole = raw;
    }
    role = maxEffectiveRole(role, roleForTarget(row.role, scopeType, "item"));
  }
  return accessFromRole(role, {
    userId: matched.userId ?? userId,
    blogId: post.blogId,
    workspaceRole,
  });
}

export async function accessibleFolderIdsForUser(
  handle: string,
  user: AccessUser | null,
): Promise<Set<string> | "all"> {
  const base = await blogAccessBase(handle, user);
  if (!base) return new Set();
  if (base.owner) return "all";
  const allFolders = await folderRowsForBlog(base.blogId);
  const scopes: ScopeKey[] = [
    { scopeType: "workspace", scopeId: base.blogId },
    ...allFolders.map((folder) => ({
      scopeType: "folder" as const,
      scopeId: folder.id,
    })),
  ];
  const { rows } = await matchingCollaboratorRows(user, scopes);
  const visible = new Set<string>();
  for (const row of rows) {
    const scopeType = row.scopeType as CollaboratorScopeType;
    const effective = roleForTarget(row.role, scopeType, "folder");
    if (!effective) continue;
    if (scopeType === "workspace") return "all";
    for (const id of descendantFolderIds(allFolders, row.scopeId)) {
      visible.add(id);
    }
  }
  return visible;
}

export async function accessiblePostIdsForUser(
  handle: string,
  user: AccessUser | null,
): Promise<Set<string> | "all"> {
  if (!db) return new Set();
  const base = await blogAccessBase(handle, user);
  if (!base) return new Set();
  if (base.owner) return "all";
  const allFolders = await folderRowsForBlog(base.blogId);
  const postRows = await db
    .select({ id: posts.id, folderId: posts.folderId })
    .from(posts)
    .where(and(eq(posts.blogId, base.blogId), isNull(posts.deletedAt)));
  const scopes: ScopeKey[] = [
    { scopeType: "workspace", scopeId: base.blogId },
    ...allFolders.map((folder) => ({
      scopeType: "folder" as const,
      scopeId: folder.id,
    })),
    ...postRows.map((post) => ({ scopeType: "item" as const, scopeId: post.id })),
  ];
  const { rows } = await matchingCollaboratorRows(user, scopes);
  const visible = new Set<string>();
  for (const row of rows) {
    const scopeType = row.scopeType as CollaboratorScopeType;
    const effective = roleForTarget(row.role, scopeType, "item");
    if (!effective) continue;
    if (scopeType === "workspace") return "all";
    if (scopeType === "item") {
      visible.add(row.scopeId);
      continue;
    }
    const folderIds = descendantFolderIds(allFolders, row.scopeId);
    const grantedFolder = allFolders.find((folder) => folder.id === row.scopeId);
    for (const post of postRows) {
      if (post.folderId && folderIds.has(post.folderId)) visible.add(post.id);
      if (!post.folderId && grantedFolder?.path === "blog") visible.add(post.id);
    }
  }
  return visible;
}
