import { getCurrentUser } from "@/lib/session";
import { resolveApiToken } from "@/lib/api-tokens";
import { hasItemAgentScope } from "@/lib/item-agent-access";
import { getVaultWorkspaceIdentity } from "@/lib/store";
import { isUuid, resolveWorkspaceAccess, type AccessUser } from "@/lib/permissions";

/** Named-workspace authorization. Existing owner-only sync routes keep their own guard. */
export async function authorizeVaultCollaboration(request: Request, workspaceId: string, capability: "read" | "edit") {
  const deny = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!isUuid(workspaceId)) return deny(404, "Workspace not found");
  let user: AccessUser;
  let actorType: "human" | "external_agent";
  if (request.headers.has("authorization")) {
    const token = await resolveApiToken(request.headers.get("authorization"));
    if (!token) return deny(401, "A valid API token is required");
    const scopes = token.scopes.split(/\s+/);
    if (!scopes.includes("sync") || hasItemAgentScope(scopes)) return deny(403, "This token does not have workspace collaboration access");
    user = token;
    actorType = "external_agent";
  } else {
    const session = await getCurrentUser();
    if (!session) return deny(401, "Sign in required");
    if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) {
      return deny(403, "A same-origin request is required");
    }
    user = session;
    actorType = "human";
  }
  const workspace = await getVaultWorkspaceIdentity(workspaceId);
  if (!workspace || workspace.id !== workspaceId) return deny(404, "Workspace not found");
  // No module/session cache: permission and token revocation are checked on every request.
  const access = await resolveWorkspaceAccess({ handle: workspace.handle, user, fresh: true });
  if (access.blogId !== workspaceId || !access.userId || (!access.isOwner && !access.canView)) return deny(404, "Workspace not found");
  const canEditContent = access.isOwner || access.canEditContent;
  if (capability === "edit" && !canEditContent) return deny(403, "Editing permission is required");
  const root = process.env.TEXTTEXT_VAULT_ROOT;
  if (!root) return deny(503, "File vault storage is not configured");
  return { root, workspaceId, name: workspace.name, actorUserId: access.userId, actorType,
    canEditContent, canComment: access.isOwner || access.canComment };
}
