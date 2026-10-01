import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub, getVaultWorkspaceIdentity, listVaultTextpacks } from "@/lib/store";
import { activeVaultGrants, candidateVaultSharedWorkspaces } from "@/lib/vault/grants";
import { canSeeVaultItem } from "@/app/api/vault/scoped-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** A signed-in person's explicit file/folder invitations, with no sibling
 * paths, counts, problem names, or global workspace manifest revision. */
export async function GET() {
  const session = await getCurrentUser();
  if (!session) return Response.json({ error: "Sign in required" }, { status: 401, headers });
  const userId = session.userId ?? await getUserIdBySub(session.sub);
  if (!userId) return Response.json({ workspaces: [] }, { headers });
  const root = process.env.TEXTTEXT_VAULT_ROOT;
  if (!root) return Response.json({ error: "File vault storage is not configured" }, { status: 503, headers });
  try {
    const workspaces = [];
    for (const workspaceId of await candidateVaultSharedWorkspaces(userId)) {
      const identity = await getVaultWorkspaceIdentity(workspaceId);
      if (!identity) continue;
      const grants = await activeVaultGrants({ root, workspaceId, userId });
      if (!grants.length) continue;
      const manifest = await listVaultTextpacks({ root, workspaceId });
      const items = manifest.items.filter(item => canSeeVaultItem(grants, item.itemId, item.relativePath))
        .map(({ itemId, relativePath }) => ({ itemId, relativePath }));
      const folders = [...new Set(grants.filter(grant => grant.scope.type === "folder").map(grant => grant.scope.key))];
      if (items.length || folders.length) workspaces.push({ id: workspaceId, name: identity.name, items, folders });
    }
    return Response.json({ workspaces }, { headers });
  } catch {
    return Response.json({ error: "Shared workspaces are temporarily unavailable" }, { status: 503, headers });
  }
}
