// Effective collaboration permissions. Ownership is implicit on blogs.owner_id;
// named access lives in collaborators rows scoped to a workspace, folder, or
// item. Callers ask for capabilities and never infer them from route shape.

import { cache } from "react";
import { and, eq, isNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { isPrivateFolderMode, isPrivatePostType } from "./content";
import { getBlogCore } from "./blog-core";
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
type AccessUserParts = {
  userId: string | null;
  sub: string | null;
  email: string | null;
  name: string | null;
};

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

function accessUserParts(user: AccessUser | null): AccessUserParts {
  return {
    userId: user?.userId?.trim() || null,
    sub: user?.sub?.trim() || null,
    email: user?.email ? normalizeAccessEmail(user.email) : null,
    name: user?.name ?? null,
  };
}

function accessUserFromParts(
  userId: string | null,
  sub: string | null,
  email: string | null,
  name: string | null,
): AccessUser | null {
  if (!userId && !sub && !email && !name) return null;
  return { userId, sub, email, name };
}

function workspaceGrantAppliesToFolder(folder: FolderRow): boolean {
  return !isPrivateFolderMode(folder.mode);
}

function workspaceGrantAppliesToItem(
  post: { type: string; folderId: string | null },
  allFolders: FolderRow[],
): boolean {
  if (isPrivatePostType(post.type)) return false;
  const folder = post.folderId
    ? allFolders.find((entry) => entry.id === post.folderId)
    : null;
  return !isPrivateFolderMode(folder?.mode);
}

function folderGrantAppliesToItem(
  post: { type: string },
  grantedFolder: FolderRow | undefined,
): boolean {
  if (!isPrivatePostType(post.type)) return true;
  return isPrivateFolderMode(grantedFolder?.mode);
}

function roleForTarget(
  rawRole: string,
  scopeType: CollaboratorScopeType,
  targetType: CollaboratorScopeType,
  opts: { workspaceGrantApplies?: boolean } = {},
): EffectiveRole | null {
  const role = storedRole(rawRole);
  if (!role) return null;

  if (targetType !== "workspace" && scopeType === "workspace") {
    if (!opts.workspaceGrantApplies) return null;
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

function scopeCacheKey(scopeType: string, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
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

async function collaboratorRowsForUserUncached(
  user: AccessUser | null,
): Promise<{ rows: CollaboratorRow[]; userId: string | null; email: string }> {
  if (!db || !user) return { rows: [], userId: null, email: "" };
  const database = db;

  let userId = await existingUserIdForAccess(user);
  const email = user.email ? normalizeAccessEmail(user.email) : "";
  const userPredicates: SQL[] = [];
  if (userId) userPredicates.push(eq(collaborators.userId, userId));
  if (email) {
    const emailPredicate = and(
      isNull(collaborators.userId),
      eq(collaborators.invitedEmail, email),
    );
    if (emailPredicate) userPredicates.push(emailPredicate);
  }
  if (userPredicates.length === 0) return { rows: [], userId, email };
  const userPredicate =
    userPredicates.length === 1 ? userPredicates[0] : or(...userPredicates);
  if (!userPredicate) return { rows: [], userId, email };

  const rows = await database
    .select()
    .from(collaborators)
    .where(and(userPredicate, isNull(collaborators.revokedAt)));

  return { rows, userId, email };
}

const cachedCollaboratorRowsForUser = cache(
  async (
    userId: string | null,
    sub: string | null,
    email: string | null,
    name: string | null,
  ) =>
    collaboratorRowsForUserUncached(
      accessUserFromParts(userId, sub, email, name),
    ),
);

async function matchingCollaboratorRows(
  user: AccessUser | null,
  scopes: ScopeKey[],
): Promise<{ rows: CollaboratorRow[]; userId: string | null }> {
  if (!db || !user || scopes.length === 0) return { rows: [], userId: null };
  const userParts = accessUserParts(user);
  const candidateRows = await cachedCollaboratorRowsForUser(
    userParts.userId,
    userParts.sub,
    userParts.email,
    userParts.name,
  );
  const scopeKeys = new Set(
    scopes.map((scope) => scopeCacheKey(scope.scopeType, scope.scopeId)),
  );
  const matched = candidateRows.rows.filter((row) =>
    scopeKeys.has(scopeCacheKey(row.scopeType, row.scopeId)),
  );
  const userId = candidateRows.userId;
  const email = candidateRows.email;

  return {
    rows: matched.filter((row) => {
      if (row.userId && userId && row.userId !== userId) return false;
      if (row.userId) return Boolean(userId && row.userId === userId);
      return Boolean(email && row.invitedEmail === email);
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

async function folderRowsForBlogUncached(blogId: string): Promise<FolderRow[]> {
  if (!db) return [];
  return db
    .select()
    .from(folders)
    .where(and(eq(folders.blogId, blogId), isNull(folders.deletedAt)));
}

const cachedFolderRowsForBlog = cache(folderRowsForBlogUncached);

async function folderRowsForBlog(blogId: string): Promise<FolderRow[]> {
  return cachedFolderRowsForBlog(blogId);
}

async function blogAccessBaseUncached(
  handle: string,
  user: AccessUser | null,
): Promise<{
  blogId: string;
  ownerId: string | null;
  userId: string | null;
  owner: boolean;
} | null> {
  if (!db) return null;
  const row = await getBlogCore(handle);
  if (!row) return null;
  const userId = await existingUserIdForAccess(user);
  return {
    blogId: row.id,
    ownerId: row.ownerId,
    userId,
    owner: Boolean(userId && row.ownerId && userId === row.ownerId),
  };
}

const cachedBlogAccessBase = cache(
  async (
    handle: string,
    userId: string | null,
    sub: string | null,
    email: string | null,
    name: string | null,
  ) => blogAccessBaseUncached(handle, accessUserFromParts(userId, sub, email, name)),
);

async function blogAccessBase(
  handle: string,
  user: AccessUser | null,
): Promise<{
  blogId: string;
  ownerId: string | null;
  userId: string | null;
  owner: boolean;
} | null> {
  const userParts = accessUserParts(user);
  return cachedBlogAccessBase(
    handle,
    userParts.userId,
    userParts.sub,
    userParts.email,
    userParts.name,
  );
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
  const canUseWorkspaceGrant = workspaceGrantAppliesToFolder(folder);
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
    role = maxEffectiveRole(
      role,
      roleForTarget(row.role, scopeType, "folder", {
        workspaceGrantApplies: canUseWorkspaceGrant,
      }),
    );
  }
  return accessFromRole(role, {
    userId: userId ?? base.userId,
    blogId: base.blogId,
    workspaceRole: canUseWorkspaceGrant ? workspaceRole : null,
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
      type: posts.type,
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
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]));
  const effectiveFolderId =
    post.folderId ?? allFolders.find((folder) => folder.path === "blog")?.id ?? null;
  const folderIds = folderAndAncestorIds(allFolders, effectiveFolderId);
  const canUseWorkspaceGrant = workspaceGrantAppliesToItem(post, allFolders);
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
    if (
      scopeType === "folder" &&
      !folderGrantAppliesToItem(post, folderById.get(row.scopeId))
    ) {
      continue;
    }
    role = maxEffectiveRole(
      role,
      roleForTarget(row.role, scopeType, "item", {
        workspaceGrantApplies: canUseWorkspaceGrant,
      }),
    );
  }
  return accessFromRole(role, {
    userId: matched.userId ?? userId,
    blogId: post.blogId,
    workspaceRole: canUseWorkspaceGrant ? workspaceRole : null,
  });
}

function folderGrantContainsPost(
  post: { type: string; folderId: string | null },
  folderIds: Set<string>,
  grantedFolder: FolderRow | undefined,
): boolean {
  const inGrantedFolder = post.folderId
    ? folderIds.has(post.folderId)
    : grantedFolder?.path === "blog";
  if (!inGrantedFolder) return false;
  return folderGrantAppliesToItem(post, grantedFolder);
}

async function accessibleFolderIdsForUserUncached(
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
    if (scopeType === "workspace") {
      const effective = roleForTarget(row.role, scopeType, "folder", {
        workspaceGrantApplies: true,
      });
      if (!effective) continue;
      for (const folder of allFolders) {
        if (workspaceGrantAppliesToFolder(folder)) visible.add(folder.id);
      }
      continue;
    }
    const effective = roleForTarget(row.role, scopeType, "folder");
    if (!effective) continue;
    for (const id of descendantFolderIds(allFolders, row.scopeId)) {
      visible.add(id);
    }
  }
  return visible;
}

const cachedAccessibleFolderIdsForUser = cache(
  async (
    handle: string,
    userId: string | null,
    sub: string | null,
    email: string | null,
    name: string | null,
  ) =>
    accessibleFolderIdsForUserUncached(
      handle,
      accessUserFromParts(userId, sub, email, name),
    ),
);

export async function accessibleFolderIdsForUser(
  handle: string,
  user: AccessUser | null,
): Promise<Set<string> | "all"> {
  const userParts = accessUserParts(user);
  const ids = await cachedAccessibleFolderIdsForUser(
    handle,
    userParts.userId,
    userParts.sub,
    userParts.email,
    userParts.name,
  );
  return ids === "all" ? "all" : new Set(ids);
}

async function accessiblePostIdsForUserUncached(
  handle: string,
  user: AccessUser | null,
): Promise<Set<string> | "all"> {
  if (!db) return new Set();
  const base = await blogAccessBase(handle, user);
  if (!base) return new Set();
  if (base.owner) return "all";
  const allFolders = await folderRowsForBlog(base.blogId);
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]));
  const postRows = await db
    .select({ id: posts.id, folderId: posts.folderId, type: posts.type })
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
    if (scopeType === "workspace") {
      const effective = roleForTarget(row.role, scopeType, "item", {
        workspaceGrantApplies: true,
      });
      if (!effective) continue;
      for (const post of postRows) {
        if (workspaceGrantAppliesToItem(post, allFolders)) visible.add(post.id);
      }
      continue;
    }
    const effective = roleForTarget(row.role, scopeType, "item");
    if (!effective) continue;
    if (scopeType === "item") {
      visible.add(row.scopeId);
      continue;
    }
    const folderIds = descendantFolderIds(allFolders, row.scopeId);
    const grantedFolder = folderById.get(row.scopeId);
    for (const post of postRows) {
      if (folderGrantContainsPost(post, folderIds, grantedFolder)) {
        visible.add(post.id);
      }
    }
  }
  return visible;
}

const cachedAccessiblePostIdsForUser = cache(
  async (
    handle: string,
    userId: string | null,
    sub: string | null,
    email: string | null,
    name: string | null,
  ) =>
    accessiblePostIdsForUserUncached(
      handle,
      accessUserFromParts(userId, sub, email, name),
    ),
);

export async function accessiblePostIdsForUser(
  handle: string,
  user: AccessUser | null,
): Promise<Set<string> | "all"> {
  const userParts = accessUserParts(user);
  const ids = await cachedAccessiblePostIdsForUser(
    handle,
    userParts.userId,
    userParts.sub,
    userParts.email,
    userParts.name,
  );
  return ids === "all" ? "all" : new Set(ids);
}
