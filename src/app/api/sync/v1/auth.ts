// Bearer auth -> workspace resolution for every sync API route. The token's
// user's OWNED blog is the workspace; resolving it here means no post or
// folder lookup below can ever cross tenants.

import { resolveApiToken, type ApiTokenIdentity } from "@/lib/api-tokens";
import type { Blog } from "@/lib/content";
import { getOwnedBlog } from "@/lib/store";
import { syncDatabaseUnavailable, syncError } from "./sync";

export type SyncWorkspace = ApiTokenIdentity & { blog: Blog };

/**
 * The authenticated workspace for a request, or the error Response to return:
 * 401 for a missing/invalid/revoked token, 403 without the sync scope, 404
 * when the user has no blog.
 */
export async function resolveSyncWorkspace(
  request: Request,
): Promise<SyncWorkspace | Response> {
  let identity: ApiTokenIdentity | null;
  try {
    identity = await resolveApiToken(request.headers.get("authorization"));
  } catch (error) {
    const unavailable = syncDatabaseUnavailable(error);
    if (unavailable) return unavailable;
    throw error;
  }
  if (!identity) {
    return Response.json(
      { error: "A valid API token is required" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  if (!identity.scopes.split(/\s+/).includes("sync")) {
    return syncError(403, "This token does not have the sync scope");
  }
  let blog: Blog | null;
  try {
    blog = await getOwnedBlog(identity.sub);
  } catch (error) {
    const unavailable = syncDatabaseUnavailable(error);
    if (unavailable) return unavailable;
    throw error;
  }
  if (!blog) return syncError(404, "No blog exists for this token's user");
  return { ...identity, blog };
}
