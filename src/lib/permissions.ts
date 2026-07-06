// Role model for collaboration (seed). The blog owner is implicit (owner_id
// on the blogs row); everyone else holds a collaborators row scoped to the
// workspace, a folder, or a single item. Nothing grants access silently:
// callers ask for a capability, not a role name.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { collaborators } from "./db/schema";

export type CollaboratorRole = "editor" | "reviewer" | "viewer";
export type CollaboratorScopeType = "workspace" | "folder" | "item";

const ROLE_RANK: Record<CollaboratorRole, number> = {
  viewer: 0,
  reviewer: 1,
  editor: 2,
};

export function isCollaboratorRole(value: unknown): value is CollaboratorRole {
  return value === "editor" || value === "reviewer" || value === "viewer";
}

/**
 * The user's role on a scope, or null. Wider scopes are the caller's concern:
 * check workspace first, then the folder, then the item, and take the widest.
 */
export async function collaboratorRole(
  userId: string,
  scopeType: CollaboratorScopeType,
  scopeId: string,
): Promise<CollaboratorRole | null> {
  if (!db) return null;
  const rows = await db
    .select({ role: collaborators.role })
    .from(collaborators)
    .where(
      and(
        eq(collaborators.userId, userId),
        eq(collaborators.scopeType, scopeType),
        eq(collaborators.scopeId, scopeId),
        isNull(collaborators.revokedAt),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return isCollaboratorRole(role) ? role : null;
}

/** True when `role` grants at least `needed` (editor > reviewer > viewer). */
export function roleAtLeast(
  role: CollaboratorRole | null,
  needed: CollaboratorRole,
): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}
