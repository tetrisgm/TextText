// Create a subfolder from a sync client: the Mac app calls this when it sees
// a new local directory inside the tree, so `mkdir ~/TextText/blog/ideas` on
// disk becomes a real folder (a category) server-side. Mode is inherited
// from the parent; nesting is capped in the store.
//
//   POST /api/sync/v1/folders  {"parent_path": "blog", "name": "Ideas"}
//   -> 201 {folder: {id, name, path, mode, parentId}}

import { recordAction } from "@/lib/audit";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  claimIdempotencyKey,
  createSubfolder,
  getFolderById,
  releaseIdempotencyKey,
  resolveIdempotencyKey,
} from "@/lib/store";
import { resolveSyncWorkspace } from "../auth";
import { syncError } from "../sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const access = await resolveWorkspaceAccess({ handle: blog.handle, user: workspace });
  if (!access.isOwner) {
    return syncError(403, "Only the owner can create folders");
  }

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

  // Idempotency: without it, a retried create makes "ideas" then "ideas-2".
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(blog.handle, idempotencyKey);
    if (claim.status === "done") {
      if (claim.kind !== "folder") {
        return syncError(409, "This Idempotency-Key was used for a different resource");
      }
      const existing = await getFolderById(blog.handle, claim.id);
      if (existing) return Response.json({ folder: existing }, { status: 201 });
      // The folder this key created was since deleted; the key is spent.
      return syncError(409, "The folder created for this Idempotency-Key was deleted");
    } else if (claim.status === "inflight") {
      return syncError(409, "A create with this Idempotency-Key is in progress; retry shortly");
    }
  }

  try {
    const folder = await createSubfolder(blog.handle, parentPath, name);
    if (idempotencyKey) {
      await resolveIdempotencyKey(blog.handle, idempotencyKey, "folder", folder.id);
    }
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
    if (idempotencyKey) await releaseIdempotencyKey(blog.handle, idempotencyKey).catch(() => {});
    return syncError(
      400,
      error instanceof Error ? error.message : "Could not create the folder",
    );
  }
}
