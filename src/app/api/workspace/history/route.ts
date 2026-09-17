import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { getPostById, savePost } from "@/lib/store";
import { getPostRevision, listPostRevisions } from "@/lib/revisions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { getBlog } from "@/lib/store";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: PRIVATE });
const jsonError = (message: string, status: number) => Response.json({ error: message }, { status, headers: PRIVATE });

/**
 * A document's earlier versions, and putting one back.
 *
 * Every version here is one a write replaced, recorded by the same statement
 * that replaced it (src/lib/revisions.ts). Restoring is an ordinary save, so
 * the version it replaces is recorded too and the restore can itself be undone.
 */
async function editor(handle: string, postId: string) {
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit || !access.blogId) return { response: jsonError("You cannot edit this workspace", 403) };
  const post = await getPostById(handle, postId);
  if (!post) return { response: jsonError("Item not found", 404) };
  return { access, post };
}

/** GET ?handle=&id= -> the versions kept for this item, newest first. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim() ?? "";
  const postId = url.searchParams.get("id")?.trim() ?? "";
  if (!handle || !postId) return jsonError("Missing workspace handle or item", 400);
  const resolved = await editor(handle, postId);
  if ("response" in resolved) return resolved.response;
  return json({ versions: await listPostRevisions(postId) });
}

/** POST { handle, id, versionId } puts an earlier version back. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  const postId = typeof body.id === "string" ? body.id.trim() : "";
  const versionId = typeof body.versionId === "string" ? body.versionId.trim() : "";
  if (!handle || !postId || !versionId) return jsonError("Missing workspace handle, item, or version", 400);
  const resolved = await editor(handle, postId);
  if ("response" in resolved) return resolved.response;
  const viewer = await getCurrentUser();
  const actorUserId = viewer ? await getUserIdBySub(viewer.sub) : null;
  const version = await getPostRevision(postId, versionId);
  if (!version) return jsonError("That version is not kept for this item", 404);
  try {
    const saved = await savePost(
      handle,
      { ...resolved.post, document: version.document },
      {
        preservePublishedAt: true,
        audit: {
          actorUserId: actorUserId,
          actorType: "human",
          actionName: "restore_revision",
          targetType: "item",
          targetId: postId,
          inputSummary: versionId,
          outputSummary: version.createdAt,
        },
      },
    );
    const blog = await getBlog(handle);
    if (blog) revalidateBlogPaths(blog, [saved.slug]);
    return json({ restored: { id: saved.id, revision: saved.revision, title: saved.title } });
  } catch (error) {
    console.warn("restore revision failed", error instanceof Error ? error.message : error);
    return jsonError("Could not restore that version", 500);
  }
}
