import { authorizeVaultPrincipal, authorizeVaultWorkspaceOrScoped } from "../scoped-auth";
import { getOwnedBlog } from "@/lib/store";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { candidateVaultSharedWorkspaces } from "@/lib/vault/grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Account discovery only. Opening a workspace must reauthorize the selected ID. */
export async function GET(request: Request) {
  try {
    const principal = await authorizeVaultPrincipal(request);
    if (principal instanceof Response) return principal;
    if (!principal.trustedAppOrSession) return Response.json({ error: "An account session or native app sign-in is required" }, { status: 403, headers });
    if (!principal.user.sub) return Response.json({ error: "Sign in required" }, { status: 401, headers });
    const owner = await getOwnedBlog(principal.user.sub);
    const access = owner ? await resolveWorkspaceAccess({ handle: owner.handle, user: principal.user, fresh: true }) : null;
    const userId = access?.userId ?? principal.user.userId;
    if (!userId) return Response.json({ defaultWorkspaceId: null, workspaces: [] }, { headers });
    const ownedId = access?.isOwner ? access.blogId : null;
    const candidates = new Set([...(ownedId ? [ownedId] : []), ...await candidateVaultSharedWorkspaces(userId)]);
    const workspaces: { id: string; name: string; access: "owner" | "workspace" | "scoped" }[] = [];
    for (const id of candidates) {
      // Recheck current authentication and current grants after candidate discovery.
      const current = await authorizeVaultWorkspaceOrScoped(request, id);
      if (current instanceof Response) {
        if (current.status === 404) continue;
        return current;
      }
      if (current.actorUserId !== userId) return Response.json({ error: "Account changed during discovery" }, { status: 401, headers });
      workspaces.push({ id, name: current.name, access: current.isOwner ? "owner" : current.fullAccess ? "workspace" : "scoped" });
    }
    return Response.json({ defaultWorkspaceId: workspaces.some(workspace => workspace.id === ownedId) ? ownedId : null, workspaces }, { headers });
  } catch {
    return Response.json({ error: "Workspaces are temporarily unavailable" }, { status: 503, headers });
  }
}
