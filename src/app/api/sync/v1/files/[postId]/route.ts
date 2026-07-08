import type { Blog, Post } from "@/lib/content";
import { parsePostMarkdownFile } from "@/lib/markdown-files";
import type { EffectiveAccess } from "@/lib/permissions";
import { resolveItemAccess } from "@/lib/permissions";
import {
  deletePost,
  folderPathForPostType,
  getPostById,
  savePost,
  savePostContentPatch,
} from "@/lib/store";
import { resolveSyncWorkspace } from "../../auth";
import { recordAction } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  clientSaveError,
  ifMatchSatisfied,
  ifNoneMatchSatisfied,
  isUuid,
  renderSyncFile,
  syncError,
  syncManifestItem,
} from "../../sync";

interface Props {
  params: Promise<{ postId: string }>;
}

export const dynamic = "force-dynamic";

type WorkspacePost = {
  blog: Blog;
  post: Post;
  postId: string;
  userId: string;
  access: EffectiveAccess;
};

// Auth, then the post, scoped to the token owner's blog: a foreign id can
// never resolve, so 404 covers both "not yours" and "does not exist".
async function resolveWorkspacePost(
  request: Request,
  params: Props["params"],
): Promise<WorkspacePost | Response> {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { postId } = await params;
  if (!isUuid(postId)) return syncError(404, "Post not found");
  const post = await getPostById(workspace.blog.handle, postId);
  if (!post) return syncError(404, "Post not found");
  const access = await resolveItemAccess({
    handle: workspace.blog.handle,
    postId,
    user: workspace,
  });
  if (!access.canView) return syncError(404, "Post not found");
  return { blog: workspace.blog, post, postId, userId: workspace.userId, access };
}

export async function GET(request: Request, { params }: Props) {
  const resolved = await resolveWorkspacePost(request, params);
  if (resolved instanceof Response) return resolved;
  const { blog, post } = resolved;

  const file = renderSyncFile(blog, post);
  const etag = `"${file.hash}"`;
  const headers: Record<string, string> = { ETag: etag };
  if (post.updatedAt) {
    headers["Last-Modified"] = new Date(post.updatedAt).toUTCString();
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatchSatisfied(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(file.text, {
    headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export async function PUT(request: Request, { params }: Props) {
  const resolved = await resolveWorkspacePost(request, params);
  if (resolved instanceof Response) return resolved;
  const { blog, post, userId, access } = resolved;
  if (!access.canEditContent) {
    return syncError(403, "You cannot edit this file");
  }

  // If-Match is the sync conflict signal: the client must prove its edit is
  // based on the file the server has now. 428 asks for the header; 412 means
  // the post changed underneath the client, which should refetch and merge.
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch) return syncError(428, "If-Match header is required");
  const current = renderSyncFile(blog, post);
  if (!ifMatchSatisfied(ifMatch, `"${current.hash}"`)) {
    return syncError(412, "The post changed since this file was fetched");
  }

  let parsed: ReturnType<typeof parsePostMarkdownFile>;
  try {
    parsed = parsePostMarkdownFile(await request.text());
  } catch (error) {
    return syncError(400, errorMessage(error, "Could not parse the file"));
  }

  // The file's kind may only change within the item's folder (same rule as
  // the editor and the MCP update_item tool): the store never moves a post
  // between folders on save, and relabeling a note or bookmark as a blog
  // kind would let one file update publish something the owner filed as
  // private (savePost's always-draft guard keys off the incoming type).
  const nextType = parsed.fields.type ?? post.type;
  if (folderPathForPostType(nextType) !== folderPathForPostType(post.type)) {
    return syncError(400, "This item cannot change type");
  }

  try {
    // Fields absent from the file keep their stored values; the body is
    // always the file's. Owners may author slug/date/status metadata. A
    // collaborator save is routed through the content-only store helper so the
    // mapped date string cannot overwrite published_at.
    const saved = access.isOwner
      ? await savePost(blog.handle, {
          ...post,
          ...parsed.fields,
          date: parsed.fields.date,
          slug: parsed.fields.slug ?? post.slug,
          body: parsed.body,
        })
      : await savePostContentPatch(blog.handle, post, {
          title: parsed.fields.title ?? post.title,
          cover: parsed.fields.cover ?? post.cover,
          coverCaption: parsed.fields.coverCaption ?? post.coverCaption,
          coverHeight: parsed.fields.coverHeight ?? post.coverHeight,
          body: parsed.body,
        });
    await recordAction({
      actorUserId: userId,
      actorType: "external_agent",
      actionName: "sync.put_file",
      targetType: "item",
      targetId: saved.id,
      inputSummary: saved.title,
    });
    revalidateBlogPaths(blog, [post.slug, saved.slug]);
    // The new manifest entry (with the NEW hash) lets the client update its
    // index without refetching the file it just wrote.
    return Response.json({ item: syncManifestItem(blog, saved) });
  } catch (error) {
    const message = clientSaveError(error);
    if (message) return syncError(400, message);
    throw error; // internal failure: surface as 500, never a false 400
  }
}

export async function DELETE(request: Request, { params }: Props) {
  const resolved = await resolveWorkspacePost(request, params);
  if (resolved instanceof Response) return resolved;
  const { blog, post, postId, userId, access } = resolved;
  if (!access.isOwner) {
    return syncError(403, "Only the owner can delete files");
  }

  await deletePost(blog.handle, postId);
  await recordAction({
    actorUserId: userId,
    actorType: "external_agent",
    actionName: "sync.delete_file",
    targetType: "item",
    targetId: postId,
    inputSummary: post.title,
  });
  revalidateBlogPaths(blog, [post.slug]);
  return new Response(null, { status: 204 });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
