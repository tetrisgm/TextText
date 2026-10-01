import path from "node:path";
import { getCurrentUser } from "@/lib/session";
import { resolveApiToken } from "@/lib/api-tokens";
import { hasItemAgentScope } from "@/lib/item-agent-access";
import { getVaultWorkspaceIdentity, readVaultTextpack, readVaultTextpackPath } from "@/lib/store";
import { isUuid, resolveWorkspaceAccess, type AccessUser, type ItemShareRole } from "@/lib/permissions";
import { activeVaultGrants, roleForVaultItem, roleForVaultFolder, type ActiveVaultGrant } from "@/lib/vault/grants";
import { validVaultItemId, validVaultTextpackPath, validVaultFolderPath } from "@/lib/vault/folder-identity";

export type VaultCapability = "read" | "comment" | "edit";
type Principal = { user: AccessUser; actorType: "human" | "external_agent"; actorName: string;
  trustedAppOrSession: boolean; nativeAppToken: boolean };
const noCache = { "Cache-Control": "no-store" };
const deny = (status: number, error: string) => Response.json({ error }, { status, headers: noCache });

function safeName(value: string | null | undefined): string {
  return value?.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 80) || "Collaborator";
}

async function principal(request: Request): Promise<Principal | Response> {
  if (request.headers.has("authorization")) {
    const token = await resolveApiToken(request.headers.get("authorization"));
    if (!token) return deny(401, "A valid API token is required");
    const scopes = token.scopes.split(/\s+/);
    if (!scopes.includes("sync") || hasItemAgentScope(scopes)) return deny(403, "This token does not have file vault access");
    return { user: token, actorType: "external_agent", actorName: safeName(token.name),
      trustedAppOrSession: token.kind === "app", nativeAppToken: token.kind === "app" };
  }
  const session = await getCurrentUser();
  if (!session) return deny(401, "Sign in required");
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) {
    return deny(403, "A same-origin request is required");
  }
  return { user: session, actorType: "human", actorName: safeName(session.name),
    trustedAppOrSession: true, nativeAppToken: false };
}

export async function authorizeVaultWorkspaceOrScoped(request: Request, workspaceId: string) {
  if (!isUuid(workspaceId)) return deny(404, "Workspace not found");
  const identity = await principal(request);
  if (identity instanceof Response) return identity;
  const workspace = await getVaultWorkspaceIdentity(workspaceId);
  if (!workspace || workspace.id !== workspaceId) return deny(404, "Workspace not found");
  const access = await resolveWorkspaceAccess({ handle: workspace.handle, user: identity.user, fresh: true,
    workspaceSnapshot: { id: workspace.id, ownerId: workspace.ownerId } });
  if (access.blogId !== workspaceId || !access.userId) return deny(404, "Workspace not found");
  const root = process.env.TEXTTEXT_VAULT_ROOT;
  if (!root) return deny(503, "File vault storage is not configured");
  const fullAccess = access.isOwner || access.canView;
  const grants = fullAccess ? [] : await activeVaultGrants({ root, workspaceId, userId: access.userId });
  if (!fullAccess && !grants.length) return deny(404, "Workspace not found");
  return { root, workspaceId, name: workspace.name, actorUserId: access.userId, actorType: identity.actorType,
    actorName: identity.actorName, canUseHumanPresence: identity.trustedAppOrSession,
    canAttributeNativeEditor: identity.nativeAppToken,
    canManageShares: identity.trustedAppOrSession && access.isOwner, fullAccess, isOwner: access.isOwner,
    canEditContent: access.isOwner || access.canEditContent, canComment: access.isOwner || access.canComment,
    grants };
}

type WorkspaceAuthorization = Exclude<Awaited<ReturnType<typeof authorizeVaultWorkspaceOrScoped>>, Response>;

function authorizePath(access: WorkspaceAuthorization, itemId: string, relativePath: string, capability: VaultCapability) {
  if (!validVaultItemId(itemId) || !validVaultTextpackPath(relativePath)) return deny(404, "Item not found");
  const role: ItemShareRole | null = access.fullAccess ? null : roleForVaultItem(access.grants, itemId, relativePath);
  if (!access.fullAccess && !role) return deny(404, "Item not found");
  const canEditContent = access.fullAccess ? access.canEditContent : role === "editor";
  const canComment = access.fullAccess ? access.canComment : role === "editor" || role === "commenter";
  if (capability === "edit" && !canEditContent) return deny(403, "Editing permission is required");
  if (capability === "comment" && !canComment) return deny(403, "Commenting permission is required");
  return { root: access.root, workspaceId: access.workspaceId, name: access.name,
    actorUserId: access.actorUserId, actorType: access.actorType, actorName: access.actorName,
    itemId, relativePath, canEditContent, canComment, fullAccess: access.fullAccess,
    canUseHumanPresence: access.canUseHumanPresence, canAttributeNativeEditor: access.canAttributeNativeEditor,
    canManageShares: access.canManageShares };
}

/** Safe inside a vault writer's lock: this rechecks current database grants and
 * stats only the granted folder. It never acquires the vault filesystem lock. */
export async function authorizeVaultItemAtPath(request: Request, workspaceId: string, itemId: string, relativePath: string, capability: VaultCapability) {
  const access = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  return access instanceof Response ? access : authorizePath(access, itemId, relativePath, capability);
}

/** Preflight for existing items. The route checks again after a read or under
 * the store lock before a mutation, because a file may move or a grant change. */
export async function authorizeVaultItem(request: Request, workspaceId: string, itemId: string, capability: VaultCapability) {
  if (!validVaultItemId(itemId)) return deny(404, "Item not found");
  const access = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (access instanceof Response) return access;
  const item = await readVaultTextpack({ root: access.root, workspaceId, itemId });
  if (!item) return deny(404, "Item not found");
  return authorizePath(access, itemId, item.relativePath, capability);
}

/** For reads that load the live TextPack or collaboration state themselves and
 * recheck current path and grants before returning the result. */
export async function authorizeVaultItemUsingMetadata(request: Request, workspaceId: string, itemId: string, capability: VaultCapability) {
  if (!validVaultItemId(itemId)) return deny(404, "Item not found");
  const access = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (access instanceof Response) return access;
  const relativePath = await readVaultTextpackPath({ root: access.root, workspaceId, itemId });
  if (!relativePath) return deny(404, "Item not found");
  return authorizePath(access, itemId, relativePath, capability);
}

export function canSeeVaultItem(grants: readonly ActiveVaultGrant[], itemId: string, relativePath: string): boolean {
  return roleForVaultItem(grants, itemId, relativePath) !== null;
}

export function canSeeVaultFolder(grants: readonly ActiveVaultGrant[], folder: string): boolean {
  return validVaultFolderPath(folder) && roleForVaultFolder(grants, folder) !== null;
}

export function vaultFolderForPath(relativePath: string): string {
  return path.posix.dirname(relativePath).replace(/^\.$/, "");
}
