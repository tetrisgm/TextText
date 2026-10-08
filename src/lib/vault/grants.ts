import { assertNoReservedFolderMove } from "./folder-move-metadata";
// File-vault authorization metadata. Legacy collaborators.scope_id points to
// database posts/folders; it must never authorize a portable TextPack identity.
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { auditValues } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { actionAudit, blogs, collaborators, users, vaultGrants } from "@/lib/db/schema";
import { isItemShareRole, isUuid, normalizeAccessEmail, isValidAccessEmail, type ItemShareRole } from "@/lib/permissions";
import { validVaultFolderPath, validVaultItemId, vaultFolderSignature } from "./folder-identity";

export type VaultGrantScope = { type: "item" | "folder"; key: string };
export type ActiveVaultGrant = { id: string; scope: VaultGrantScope; role: ItemShareRole; folderSignature: string | null };
export type VaultGrantSummary = { id: string; email: string; scope: VaultGrantScope; role: ItemShareRole; createdAt: string };

function assertScope(scope: VaultGrantScope) {
  if ((scope.type === "item" && validVaultItemId(scope.key)) ||
      (scope.type === "folder" && validVaultFolderPath(scope.key))) return;
  throw new Error("Invalid vault grant scope");
}

function rank(role: ItemShareRole | null): number {
  return role === "editor" ? 3 : role === "commenter" ? 2 : role === "viewer" ? 1 : 0;
}
function stronger(left: ItemShareRole | null, right: ItemShareRole): ItemShareRole {
  return rank(right) > rank(left) ? right : left!;
}

/** Fresh rows on every call. The account email comes from users, never from a
 * route parameter or a token's arbitrary display name. */
export async function activeVaultGrants(input: { root: string; workspaceId: string; userId: string }): Promise<ActiveVaultGrant[]> {
  if (!db || !isUuid(input.workspaceId) || !isUuid(input.userId)) return [];
  const account = await db.select({ email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!account[0]) return [];
  const email = account[0].email ? normalizeAccessEmail(account[0].email) : "";
  const identity = email ? or(eq(vaultGrants.userId, input.userId), and(isNull(vaultGrants.userId), eq(vaultGrants.invitedEmail, email)))
    : eq(vaultGrants.userId, input.userId);
  const rows = await db.select().from(vaultGrants).where(and(
    eq(vaultGrants.workspaceId, input.workspaceId), isNull(vaultGrants.revokedAt), identity,
  ));
  const signatures = new Map<string, string | null>();
  const result: ActiveVaultGrant[] = [];
  for (const row of rows) {
    if (!isItemShareRole(row.role)) continue;
    if (row.scopeType === "item" && validVaultItemId(row.scopeKey) && row.folderSignature === null) {
      result.push({ id: row.id, scope: { type: "item", key: row.scopeKey }, role: row.role, folderSignature: null });
    } else if (row.scopeType === "folder" && validVaultFolderPath(row.scopeKey) && row.folderSignature) {
      let signature = signatures.get(row.scopeKey);
      if (signature === undefined) {
        signature = await vaultFolderSignature(input.root, input.workspaceId, row.scopeKey);
        signatures.set(row.scopeKey, signature);
      }
      if (signature === row.folderSignature) result.push({ id: row.id, scope: { type: "folder", key: row.scopeKey }, role: row.role, folderSignature: row.folderSignature });
    }
  }
  return result;
}

/** Workspace IDs only; callers still verify the workspace, current folder
 * identity, and visible files before returning an entry point to the user. */
export async function candidateVaultSharedWorkspaces(userId: string): Promise<string[]> {
  if (!db || !isUuid(userId)) return [];
  const account = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account[0]) return [];
  const email = account[0].email ? normalizeAccessEmail(account[0].email) : "";
  const identity = email ? or(eq(vaultGrants.userId, userId), and(isNull(vaultGrants.userId), eq(vaultGrants.invitedEmail, email)))
    : eq(vaultGrants.userId, userId);
  const rows = await db.selectDistinct({ workspaceId: vaultGrants.workspaceId }).from(vaultGrants)
    .where(and(isNull(vaultGrants.revokedAt), identity)).limit(101);
  if (rows.length > 100) throw new Error("Too many shared workspaces to list");
  return rows.map(row => row.workspaceId);
}

/** Candidate identities only; each must still pass fresh workspace authorization.
 * Include full memberships and every owned workspace, not just file invitations. */
export async function candidateVaultAccountWorkspaces(userId: string): Promise<{ owned: string[]; shared: string[] }> {
  if (!db || !isUuid(userId)) return { owned: [], shared: [] };
  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return { owned: [], shared: [] };
  const email = account.email ? normalizeAccessEmail(account.email) : "";
  const identity = email ? or(eq(collaborators.userId, userId), and(isNull(collaborators.userId), eq(collaborators.invitedEmail, email)))
    : eq(collaborators.userId, userId);
  const owned = await db.select({ id: blogs.id }).from(blogs)
    .where(and(eq(blogs.ownerId, userId), isNull(blogs.deletedAt))).orderBy(asc(blogs.createdAt), asc(blogs.id)).limit(101);
  const memberships = await db.selectDistinct({ id: collaborators.scopeId }).from(collaborators)
    .where(and(eq(collaborators.scopeType, "workspace"), isNull(collaborators.revokedAt), identity)).limit(101);
  const shared = [...new Set([...memberships.map(row => row.id), ...await candidateVaultSharedWorkspaces(userId)])];
  if (owned.length > 100 || shared.length > 100) throw new Error("Too many workspaces to list");
  return { owned: owned.map(row => row.id), shared };
}

export function roleForVaultItem(grants: readonly ActiveVaultGrant[], itemId: string, relativePath: string): ItemShareRole | null {
  let role: ItemShareRole | null = null;
  for (const grant of grants) {
    if (grant.scope.type === "item" ? grant.scope.key === itemId : relativePath.startsWith(`${grant.scope.key}/`)) {
      role = stronger(role, grant.role);
    }
  }
  return role;
}

export function roleForVaultFolder(grants: readonly ActiveVaultGrant[], folderPath: string): ItemShareRole | null {
  let role: ItemShareRole | null = null;
  for (const grant of grants) {
    if (grant.scope.type === "folder" && (folderPath === grant.scope.key || folderPath.startsWith(`${grant.scope.key}/`))) {
      role = stronger(role, grant.role);
    }
  }
  return role;
}

export async function listVaultGrants(workspaceId: string, scope: VaultGrantScope): Promise<VaultGrantSummary[]> {
  if (!db) throw new Error("Sharing requires the database");
  assertScope(scope);
  const rows = await db.select().from(vaultGrants).where(and(
    eq(vaultGrants.workspaceId, workspaceId), eq(vaultGrants.scopeType, scope.type),
    eq(vaultGrants.scopeKey, scope.key), isNull(vaultGrants.revokedAt),
  ));
  return rows.filter(row => isItemShareRole(row.role)).map(row => ({
    id: row.id, email: row.invitedEmail, scope, role: row.role as ItemShareRole, createdAt: row.createdAt.toISOString(),
  })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

type GrantMutation = { root: string; workspaceId: string; scope: VaultGrantScope; actorUserId: string;
  actorType?: "human" | "external_agent" };

async function ownerLock(transaction: Parameters<Parameters<NonNullable<typeof db>["transaction"]>[0]>[0], workspaceId: string, actorUserId: string) {
  const result = await transaction.execute(sql`SELECT id FROM blogs WHERE id = ${workspaceId}::uuid AND owner_id = ${actorUserId}::uuid AND deleted_at IS NULL FOR UPDATE`);
  if (result.rows.length !== 1) throw new Error("Only the workspace owner can manage file shares");
  await assertNoReservedFolderMove(transaction, workspaceId);
}

function auditEntry(actionName: string, input: GrantMutation, description: string) {
  return auditValues({ actorUserId: input.actorUserId, actorType: input.actorType ?? "human", actionName,
    targetType: input.scope.type, targetId: `${input.workspaceId}:${input.scope.key}`, inputSummary: description });
}

export async function inviteVaultGrant(input: GrantMutation & { email: string; role: ItemShareRole }): Promise<VaultGrantSummary> {
  if (!db) throw new Error("Sharing requires the database");
  assertScope(input.scope);
  if (!isUuid(input.workspaceId) || !isUuid(input.actorUserId) || !isItemShareRole(input.role)) throw new Error("Invalid vault share");
  const email = normalizeAccessEmail(input.email);
  if (!isValidAccessEmail(email)) throw new Error("Enter a valid email address");
  const folderSignature = input.scope.type === "folder" ? await vaultFolderSignature(input.root, input.workspaceId, input.scope.key) : null;
  if (input.scope.type === "folder" && !folderSignature) throw new Error("Folder not found");
  const row = await db.transaction(async transaction => {
    await ownerLock(transaction, input.workspaceId, input.actorUserId);
    const existing = await transaction.select().from(vaultGrants).where(and(
      eq(vaultGrants.workspaceId, input.workspaceId), eq(vaultGrants.scopeType, input.scope.type),
      eq(vaultGrants.scopeKey, input.scope.key), eq(vaultGrants.invitedEmail, email), isNull(vaultGrants.revokedAt),
    )).limit(1);
    const changed = existing[0]
      ? await transaction.update(vaultGrants).set({ role: input.role, folderSignature }).where(eq(vaultGrants.id, existing[0].id)).returning()
      : await transaction.insert(vaultGrants).values({ workspaceId: input.workspaceId, scopeType: input.scope.type,
          scopeKey: input.scope.key, folderSignature, invitedEmail: email, role: input.role, invitedById: input.actorUserId }).returning();
    await transaction.insert(actionAudit).values(auditEntry("vault.share.invite", input, `${email} as ${input.role}`));
    return changed[0];
  });
  return { id: row.id, email, scope: input.scope, role: input.role, createdAt: row.createdAt.toISOString() };
}

export async function changeVaultGrant(input: GrantMutation & { grantId: string; role?: ItemShareRole; revoke?: boolean }): Promise<boolean> {
  if (!db) throw new Error("Sharing requires the database");
  assertScope(input.scope);
  if (!isUuid(input.workspaceId) || !isUuid(input.actorUserId) || !isUuid(input.grantId) ||
      (input.revoke ? input.role !== undefined : !isItemShareRole(input.role))) throw new Error("Invalid vault share change");
  return db.transaction(async transaction => {
    await ownerLock(transaction, input.workspaceId, input.actorUserId);
    const changed = await transaction.update(vaultGrants)
      .set(input.revoke ? { revokedAt: new Date() } : { role: input.role })
      .where(and(eq(vaultGrants.id, input.grantId), eq(vaultGrants.workspaceId, input.workspaceId),
        eq(vaultGrants.scopeType, input.scope.type), eq(vaultGrants.scopeKey, input.scope.key), isNull(vaultGrants.revokedAt)))
      .returning({ id: vaultGrants.id });
    if (!changed[0]) return false;
    await transaction.insert(actionAudit).values(auditEntry(input.revoke ? "vault.share.revoke" : "vault.share.role", input,
      input.revoke ? "Revoked" : input.role!));
    return true;
  });
}
