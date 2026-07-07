// Create a subfolder from a sync client: the Mac app calls this when it sees
// a new local directory inside the tree, so `mkdir ~/Write/blog/ideas` on
// disk becomes a real folder (a category) server-side. Mode is inherited
// from the parent; nesting is capped in the store.
//
//   POST /api/sync/v1/folders  {"parent_path": "blog", "name": "Ideas"}
//   -> 201 {folder: {id, name, path, mode, parentId}}

import { recordAction } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { createSubfolder } from "@/lib/store";
import { resolveSyncWorkspace } from "../auth";
import { syncError } from "../sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;

  let body: { parent_path?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return syncError(400, "Send a JSON body");
  }
  const parentPath =
    typeof body.parent_path === "string" ? body.parent_path.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!parentPath || !name) {
    return syncError(400, "parent_path and name are required");
  }

  try {
    const folder = await createSubfolder(blog.handle, parentPath, name);
    await recordAction({
      actorUserId: userId,
      actorType: "external_agent",
      actionName: "sync.create_folder",
      targetType: "folder",
      targetId: folder.id,
      inputSummary: folder.path,
    });
    revalidateBlogPaths(blog);
    return Response.json({ folder }, { status: 201 });
  } catch (error) {
    return syncError(
      400,
      error instanceof Error ? error.message : "Could not create the folder",
    );
  }
}
