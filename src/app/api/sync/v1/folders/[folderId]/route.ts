// Rename a subfolder from a sync client: renaming a folder in Finder (via the
// File Provider) maps here. Content lives on the posts, so a rename only
// changes the folder's display name; its path segment and mode are unchanged.
//
//   PATCH /api/sync/v1/folders/{folderId}  {"name": "New name"}
//   -> 200 {folder: {id, name, path, mode, parentId}}

import { recordAction } from "@/lib/audit";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { renameFolder } from "@/lib/store";
import { resolveSyncWorkspace } from "../../auth";
import { syncError } from "../../sync";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ folderId: string }>;
}

export async function PATCH(request: Request, { params }: Props) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const access = await resolveWorkspaceAccess({ handle: blog.handle, user: workspace });
  if (!access.isOwner) {
    return syncError(403, "Only the owner can rename folders");
  }

  const { folderId } = await params;
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return syncError(400, "Send a JSON body");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return syncError(400, "name is required");

  try {
    const folder = await renameFolder(blog.handle, folderId, name);
    await recordAction({
      actorUserId: userId,
      actorType: "external_agent",
      actionName: "sync.rename_folder",
      targetType: "folder",
      targetId: folder.id,
      inputSummary: folder.name,
    });
    revalidateBlogPaths(blog);
    return Response.json({ folder });
  } catch (error) {
    return syncError(
      400,
      error instanceof Error ? error.message : "Could not rename the folder",
    );
  }
}
