import { recordAction } from "@/lib/audit";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { getAccessibleFolders, updateBlogByHandle } from "@/lib/store";
import { resolveSyncWorkspace } from "../auth";
import { syncError, WORKSPACE_SCHEMA } from "../sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog } = workspace;

  const folders = await getAccessibleFolders(blog.handle, workspace);
  return Response.json({
    schema: WORKSPACE_SCHEMA,
    blog: {
      handle: blog.handle,
      username: blog.username ?? null,
      name: blog.name,
      homeLayout: blog.homeLayout,
      cardStyle: blog.cardStyle,
    },
    folders: folders.map((folder) => ({
      id: folder.id,
      parentId: folder.parentId ?? null,
      name: folder.name,
      path: folder.path,
      mode: folder.mode,
    })),
  });
}

// Rename the workspace from a sync client: renaming the workspace folder in
// Finder (via the File Provider) maps here. This is the workspace's display
// name (blogs.name), the same field the in-app settings edit, so it reflects
// everywhere the workspace is shown. The handle/URL is unchanged.
//
//   PATCH /api/sync/v1/workspace  {"name": "New name"}
//   -> 200 {blog: {handle, username, name, homeLayout, cardStyle}}
export async function PATCH(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const access = await resolveWorkspaceAccess({ handle: blog.handle, user: workspace });
  if (!access.isOwner) {
    return syncError(403, "Only the owner can rename the workspace");
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return syncError(400, "Send a JSON body");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return syncError(400, "name is required");

  try {
    const updated = await updateBlogByHandle(blog.handle, { name });
    await recordAction({
      actorUserId: userId,
      actorType: "external_agent",
      actionName: "sync.rename_workspace",
      targetType: "workspace",
      targetId: updated.handle,
      inputSummary: updated.name,
    });
    revalidateBlogPaths(updated);
    return Response.json({
      blog: {
        handle: updated.handle,
        username: updated.username ?? null,
        name: updated.name,
        homeLayout: updated.homeLayout,
        cardStyle: updated.cardStyle,
      },
    });
  } catch (error) {
    return syncError(
      400,
      error instanceof Error ? error.message : "Could not rename the workspace",
    );
  }
}
