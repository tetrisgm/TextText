import type { Blog, Post } from "@/lib/content";
import { parsePostMarkdownFile } from "@/lib/markdown-files";
import { deletePost, getPostById, savePost } from "@/lib/store";
import { resolveSyncWorkspace } from "../../auth";
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

type WorkspacePost = { blog: Blog; post: Post; postId: string };

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
  return { blog: workspace.blog, post, postId };
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
  const { blog, post } = resolved;

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

  try {
    // Fields absent from the file keep their stored values; the body is
    // always the file's. The slug follows the file when it sets one. The date
    // is the exception to "absent keeps stored": post.date is derived
    // (publishedAt, falling back to createdAt for drafts), so passing it back
    // to savePost would turn a derived value into an authored publish date;
    // with no date in the file, savePost keeps the stored publish date and
    // stamps a first publish as now, same as the editor.
    const saved = await savePost(blog.handle, {
      ...post,
      ...parsed.fields,
      date: parsed.fields.date,
      slug: parsed.fields.slug ?? post.slug,
      body: parsed.body,
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
  const { blog, post, postId } = resolved;

  await deletePost(blog.handle, postId);
  revalidateBlogPaths(blog, [post.slug]);
  return new Response(null, { status: 204 });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
