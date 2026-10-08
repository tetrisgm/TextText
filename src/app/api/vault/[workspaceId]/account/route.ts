import { authorizeVault } from "@/app/api/vault/auth";
import { getVaultAccountProfile } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const access = await authorizeVault(request, workspaceId);
  if (access instanceof Response) return access;
  const profile = await getVaultAccountProfile(access.actorUserId);
  const headers = { "Cache-Control": "private, no-store" };
  if (!profile) return Response.json({ error: "Account not found" }, { status: 404, headers });
  return Response.json({ email: profile.email, name: profile.name, identities: profile.identities, workspaceName: access.name }, { headers });
}
