// Bookmarks waiting for a capture agent.
//
//   GET /api/sync/v1/captures -> {captures: [{id, slug, title, url}]}
//
// The Mac app long-polls /changes, then drains this list: for each entry it
// loads the page in an offscreen web view, extracts the readable text, saves
// the original HTML and a screenshot, and PUTs the result to
// /api/sync/v1/captures/{id}.

import { resolveWorkspaceAccess } from "@/lib/permissions";
import { listPendingCaptures } from "@/lib/store";
import { resolveSyncWorkspace } from "../auth";
import { syncError } from "../sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const access = await resolveWorkspaceAccess({
    handle: workspace.blog.handle,
    user: workspace,
  });
  if (!access.isOwner) return syncError(403, "Only the owner can list captures");
  const captures = await listPendingCaptures(workspace.blog.handle);
  return Response.json({ captures });
}
