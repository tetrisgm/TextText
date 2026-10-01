import { isMediaStorageConfigured, readMedia, validMediaKey } from "@/lib/media-storage";
import { getCurrentUser } from "@/lib/session";
import { getPostById, getVisualUploadItemId } from "@/lib/store";
import { type AccessUser, isUuid, resolveItemAccess, resolveWorkspaceAccess } from "@/lib/permissions";
import { isPublishedPublicPost } from "@/lib/content";
import { resolveSyncWorkspace } from "@/app/api/sync/v1/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await context.params;
  if (parts.some(part => part.includes("/")) || !validMediaKey(parts.join("/"))) return missing();
  const key = parts.join("/"), staged = parts[0] === "editor";
  const handle = staged ? parts[2] : parts[1];
  let user: AccessUser | null = await getCurrentUser();
  if (request.headers.has("authorization")) {
    const workspace = await resolveSyncWorkspace(request);
    if (workspace instanceof Response || workspace.blog.handle !== handle) return missing();
    user = workspace;
  }
  let itemId = staged ? null : parts[2];
  if (itemId === "visual") itemId = isUuid(parts[3]) ? await getVisualUploadItemId(handle, parts[3]) : null;
  if (itemId && isUuid(itemId)) {
    const post = await getPostById(handle, itemId);
    if (!post) return missing();
    // Public access follows the item's current visibility, never an unguessable URL.
    const allowed = isPublishedPublicPost(post) || (await resolveItemAccess({ handle, postId: itemId, user })).canView;
    if (!allowed) return missing();
  } else if (staged || parts[2] === "visual") {
    if (!user || !(await resolveWorkspaceAccess({ handle, user })).canEditContent) return missing();
  } else return missing();
  if (!isMediaStorageConfigured()) return new Response(null, { status: 503 });
  try { return await readMedia(key, request.headers.get("range")); }
  catch { return new Response(null, { status: 502, headers: { "Cache-Control": "private, no-store" } }); }
}
