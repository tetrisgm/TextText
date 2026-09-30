import { resolveSyncWorkspace } from "@/app/api/sync/v1/auth";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog } from "@/lib/store";
import { resolveWorkspaceAccess } from "@/lib/permissions";

export async function authorizeVault(request: Request, workspaceId?: string) {
  let handle: string;
  let name: string;
  let user: { sub: string; userId?: string };
  let actorType: "human" | "external_agent";
  if (request.headers.has("authorization")) {
    const token = await resolveSyncWorkspace(request);
    if (token instanceof Response) return token;
    handle = token.blog.handle;
    name = token.blog.name;
    user = token;
    actorType = "external_agent";
  } else {
    const session = await getCurrentUser();
    if (!session) return Response.json({ error: "Sign in required" }, { status: 401 });
    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== new URL(request.url).origin) {
      return Response.json({ error: "A same-origin request is required" }, { status: 403 });
    }
    const blog = await getOwnedBlog(session.sub);
    if (!blog) return Response.json({ error: "Workspace not found" }, { status: 404 });
    handle = blog.handle;
    name = blog.name;
    user = session;
    actorType = "human";
  }
  const access = await resolveWorkspaceAccess({ handle, user });
  if (!access.isOwner || !access.blogId || (workspaceId !== undefined && access.blogId !== workspaceId) || !access.userId) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }
  const root = process.env.TEXTTEXT_VAULT_ROOT;
  if (!root) return Response.json({ error: "File vault storage is not configured" }, { status: 503 });
  return { root, workspaceId: access.blogId, name, actorUserId: access.userId, actorType };
}
