import { authorizeVaultWorkspaceOrScoped } from "@/app/api/vault/scoped-auth";
import { changeVaultGrant, inviteVaultGrant, listVaultGrants, type VaultGrantScope } from "@/lib/vault/grants";
import { readVaultTextpack } from "@/lib/store";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { isItemShareRole, isUuid } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string }> };
const headers = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

function scopeFrom(value: Record<string, unknown>): VaultGrantScope | null {
  return (value.scopeType === "item" || value.scopeType === "folder") && typeof value.scopeKey === "string"
    ? { type: value.scopeType, key: value.scopeKey } : null;
}

async function owner(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorizeVaultWorkspaceOrScoped(request, workspaceId);
  if (access instanceof Response) return access;
  if (!access.canManageShares) return fail(403, "Only the workspace owner can manage file shares");
  return access;
}

function publicGrants(grants: Awaited<ReturnType<typeof listVaultGrants>>) {
  return grants.map(({ id, email, role, createdAt }) => ({ id, email, role, createdAt }));
}

function failure(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof Error && /Invalid vault|valid email|Folder not found/.test(error.message)) return fail(400, error.message);
  if (error instanceof Error && /Only the workspace owner/.test(error.message)) return fail(403, error.message);
  return fail(503, "File shares are temporarily unavailable");
}

export async function GET(request: Request, context: Context) {
  const access = await owner(request, context);
  if (access instanceof Response) return access;
  const params = new URL(request.url).searchParams;
  const scope = scopeFrom({ scopeType: params.get("scopeType"), scopeKey: params.get("scopeKey") });
  if (!scope) return fail(400, "A file or folder scope is required");
  try { return Response.json({ grants: publicGrants(await listVaultGrants(access.workspaceId, scope)) }, { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  const access = await owner(request, context);
  if (access instanceof Response) return access;
  const parsed = await readBoundedJson<Record<string, unknown>>(request, 4096);
  if ("error" in parsed || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return fail(400, "Invalid share request");
  const scope = scopeFrom(parsed.value), email = parsed.value.email, role = parsed.value.role;
  if (!scope || typeof email !== "string" || !isItemShareRole(role)) return fail(400, "A scope, email, and role are required");
  try {
    if (scope.type === "item" && !await readVaultTextpack({ root: access.root, workspaceId: access.workspaceId, itemId: scope.key })) {
      return fail(404, "Item not found");
    }
    await inviteVaultGrant({ root: access.root, workspaceId: access.workspaceId, scope,
      email, role, actorUserId: access.actorUserId, actorType: access.actorType });
    return Response.json({ grants: publicGrants(await listVaultGrants(access.workspaceId, scope)) }, { headers });
  } catch (error) { return failure(error); }
}

async function change(request: Request, context: Context, revoke: boolean) {
  const access = await owner(request, context);
  if (access instanceof Response) return access;
  const parsed = await readBoundedJson<Record<string, unknown>>(request, 4096);
  if ("error" in parsed || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return fail(400, "Invalid share request");
  const scope = scopeFrom(parsed.value), grantId = parsed.value.grantId, role = parsed.value.role;
  if (!scope || typeof grantId !== "string" || !isUuid(grantId) || (!revoke && !isItemShareRole(role))) return fail(400, "A scope, grant, and role are required");
  try {
    const changed = await changeVaultGrant({ root: access.root, workspaceId: access.workspaceId, scope,
      grantId, ...(revoke ? { revoke: true } : { role: role as "viewer" | "commenter" | "editor" }),
      actorUserId: access.actorUserId, actorType: access.actorType });
    if (!changed) return fail(404, "Share not found");
    return Response.json({ grants: publicGrants(await listVaultGrants(access.workspaceId, scope)) }, { headers });
  } catch (error) { return failure(error); }
}
export const PATCH = (request: Request, context: Context) => change(request, context, false);
export const DELETE = (request: Request, context: Context) => change(request, context, true);
