import { authorizeVaultWorkspaceOrScoped } from "@/app/api/vault/scoped-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** UI capabilities only. Every content request still reauthorizes independently. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const access = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (access instanceof Response) return access;
  return Response.json({ fullAccess: access.fullAccess, isOwner: access.isOwner,
    canEditContent: access.canEditContent, canComment: access.canComment, canManageShares: access.canManageShares,
    grants: access.grants.map(grant => ({ scopeType: grant.scope.type, scopeKey: grant.scope.key, role: grant.role })) },
  { headers: { "Cache-Control": "no-store" } });
}
