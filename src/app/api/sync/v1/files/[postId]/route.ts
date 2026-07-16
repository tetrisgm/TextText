import type { Blog, Post } from "@/lib/content";
import { parsePostMarkdownFile } from "@/lib/markdown-files";
import type { EffectiveAccess } from "@/lib/permissions";
import { resolveItemAccess } from "@/lib/permissions";
import {
  deletePostAtomic,
  folderPathForPostType,
  getFolderById,
  getPostById,
  markCapturePending,
  movePostFile,
  PostConflictError,
  savePost,
  savePostContentPatch,
  titleRevertsRecentRename,
} from "@/lib/store";
import { resolveSyncWorkspace } from "../../auth";
import { hasActiveCoEditors } from "@/lib/collab";
import { recordAction, recordSlugChanged } from "@/lib/audit";
import { sanitizePostSlug } from "@/lib/post-slug";
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
  if (ifMatch.trim() === "*") {
    return syncError(412, "A specific If-Match validator is required");
  }
  const current = renderSyncFile(blog, post);
  if (!ifMatchSatisfied(ifMatch, `"${current.hash}"`)) {
    return syncError(412, "The post changed since this file was fetched");
  }
  // A live co-editing session owns the post body through its Yjs document, which
  // this raw overwrite has no way to merge into; the next co-editor autosave
  // would silently discard it. Refuse rather than lose the write. The sync
  // client surfaces the 409 like any conflict and retries once the session ends.
  if (post.id && (await hasActiveCoEditors(post.id))) {
    return syncError(409, "This item is being co-edited right now; try again after the session ends");
  }
  // The If-Match check above is fast but check-then-write: two PUTs on the same
  // base both pass it before either commits. The base revision is carried into
  // the save as a compare-and-swap so the store only writes if the row is still
  // the exact version we just hashed. A loser gets PostConflictError -> 412.
  const expectedRevision = post.revision;

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

  // Same rename-revert guard as PATCH, on the content path: a stale re-materialized
  // text.md carries the OLD title in its frontmatter, and its base hash still
  // matches, so the write would revert the title (and body) to a superseded value.
  // Refuse when the file's title reverts a recent rename; the client re-fetches the
  // current file and File Provider retries a genuine body edit against that base.
  if (
    post.id &&
    typeof parsed.fields.title === "string" &&
    parsed.fields.title !== post.title &&
    (await titleRevertsRecentRename(post.id, parsed.fields.title))
  ) {
    return syncError(412, "This edit reverts a recent title change");
  }

  try {
    // Fields absent from the file keep their stored values; the body is
    // always the file's. Owners may author slug/date/status metadata. A
    // collaborator save is routed through the content-only store helper so the
    // mapped date string cannot overwrite published_at.
    const saved = access.isOwner
      ? await savePost(
          blog.handle,
          {
            ...post,
            ...parsed.fields,
            date: parsed.fields.date,
            slug: parsed.fields.slug ?? post.slug,
            body: parsed.body,
          },
          { expectedRevision },
        )
      : await savePostContentPatch(
          blog.handle,
          post,
          {
            title: parsed.fields.title ?? post.title,
            cover: parsed.fields.cover ?? post.cover,
            coverCaption: parsed.fields.coverCaption ?? post.coverCaption,
            coverHeight: parsed.fields.coverHeight ?? post.coverHeight,
            body: parsed.body,
          },
          { expectedRevision },
        );
    await enqueueBookmarkCaptureIfNeeded(blog.handle, saved, post);
    await recordSlugChanged({
      actorUserId: userId,
      actorType: "external_agent",
      targetId: saved.id,
      oldSlug: post.slug,
      newSlug: saved.slug,
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
    // Lost the compare-and-swap: another writer committed between our hash
    // check and the save. Same signal as a stale If-Match, so 412.
    if (error instanceof PostConflictError) {
      return syncError(412, "The post changed since this file was fetched");
    }
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

  // A delete must identify the complete file version it is based on. Requiring
  // a specific validator prevents an old Finder view from discarding an edit it
  // has not seen; the revision guard below closes the check-then-delete race.
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch) return syncError(428, "If-Match header is required");
  if (ifMatch.trim() === "*") {
    return syncError(412, "A specific If-Match validator is required");
  }
  const current = renderSyncFile(blog, post);
  if (!ifMatchSatisfied(ifMatch, `"${current.hash}"`)) {
    return syncError(412, "The post changed since this file was fetched");
  }

  // The delete is guarded on the revision we just resolved and runs as a single
  // statement. An edit that commits after the hash check makes the guarded
  // delete match nothing, and deletePostAtomic raises a conflict.
  if (post.revision === undefined) {
    return syncError(409, "This item has no version and cannot be safely deleted");
  }
  try {
    // The audit row is folded into the delete's own transaction, so a deleted
    // post can never be left without provenance.
    await deletePostAtomic(blog.handle, postId, post.revision, {
      actorUserId: userId,
      actorType: "external_agent",
      actionName: "sync.delete_file",
      targetType: "item",
      targetId: postId,
      inputSummary: post.title,
    });
  } catch (error) {
    if (error instanceof PostConflictError) {
      return syncError(412, "The post changed since this file was fetched");
    }
    throw error;
  }
  revalidateBlogPaths(blog, [post.slug]);
  return new Response(null, { status: 204 });
}

// Move (change folder) and/or rename (change slug) without re-sending the body.
// A File Provider reparent or Finder rename maps here; content edits stay on PUT.
//
//   PATCH /api/sync/v1/files/{postId}  {"folder": "<folderId>", "slug": "new-name"}
export async function PATCH(request: Request, { params }: Props) {
  const resolved = await resolveWorkspacePost(request, params);
  if (resolved instanceof Response) return resolved;
  const { blog, post, postId, userId, access } = resolved;
  if (!access.isOwner) {
    return syncError(403, "Only the owner can move or rename files");
  }

  let body: { folder?: unknown; slug?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return syncError(400, "Send a JSON body");
  }
  const folderId = typeof body.folder === "string" ? body.folder.trim() : "";
  const slug =
    typeof body.slug === "string" && body.slug.trim()
      ? sanitizePostSlug(body.slug, post.slug)
      : undefined;
  // A File Provider rename retitles the post (the filename is the title, not the
  // slug); the slug/URL is left alone unless the caller explicitly sends one.
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title
      : undefined;
  if (!folderId && slug === undefined && title === undefined) {
    return syncError(400, "Provide a folder to move into, a slug, or a title");
  }

  // A metadata mutation must prove which complete file version it is based on.
  // Without If-Match, a client that was stale before this request could resolve
  // the latest revision and then overwrite it with an old Finder filename.
  // Vercel evaluates the standard If-Match header on PATCH before invoking a
  // route and compares it against the deployment response rather than this
  // sync file's content hash. Native clients therefore use the product-scoped
  // header; keep standard If-Match as a fallback for direct/local clients.
  const ifMatch =
    request.headers.get("x-write-if-match") ??
    request.headers.get("if-match");
  if (!ifMatch) return syncError(428, "If-Match header is required");
  if (ifMatch.trim() === "*") {
    return syncError(412, "A specific If-Match validator is required");
  }
  const baseFile = renderSyncFile(blog, post);
  if (!ifMatchSatisfied(ifMatch, `"${baseFile.hash}"`)) {
    return syncError(412, "The post changed since this file was fetched");
  }
  if (post.revision === undefined) {
    return syncError(409, "This item has no version and cannot be safely changed");
  }

  // A File Provider rename derives the title from the display filename, which for
  // a .textbundle package can trail a server-side rename until the framework
  // re-materializes the directory name. In that window the client can synthesize
  // a phantom rename back to the stale name, and because its base content hash
  // already matches the server the If-Match and revision CAS above BOTH pass.
  // Refuse a title that reverts to one this post held moments ago; the 412 makes
  // the client re-materialize the current name instead of clobbering it in a loop.
  if (
    title !== undefined &&
    title !== post.title &&
    (await titleRevertsRecentRename(postId, title))
  ) {
    return syncError(412, "This rename reverts a recent title change");
  }

  // Validate the tenant-scoped identity up front so a foreign or unknown id is
  // a clean 404, then carry that exact immutable id into the atomic update.
  let targetFolderId: string | undefined;
  if (folderId) {
    const folder = await getFolderById(blog.handle, folderId);
    if (!folder) return syncError(404, "Folder not found");
    targetFolderId = folder.id;
  }

  try {
    // One update touching only folder_id and slug: never the body, so a content
    // PUT racing this move/rename cannot be clobbered by a stale full-row save.
    // The base revision guards the update so a concurrent metadata change
    // conflicts (412) instead of being overwritten.
    // The sync.patch_file audit is folded into the move's own transaction (it
    // lands iff the guarded update actually changed a row). The secondary
    // slug-change annotation stays a best-effort follow-up.
    const result = await movePostFile(
      blog.handle,
      postId,
      {
        folderId: targetFolderId,
        slug,
        title,
        expectedRevision: post.revision,
      },
      {
        actorUserId: userId,
        actorType: "external_agent",
        actionName: "sync.patch_file",
        targetType: "item",
        targetId: postId,
        inputSummary: title ?? post.title,
      },
    );
    if (!result) return syncError(404, "Post not found");
    const current = result.post;
    if (!result.changed) {
      return Response.json({ item: syncManifestItem(blog, current) });
    }
    await recordSlugChanged({
      actorUserId: userId,
      actorType: "external_agent",
      targetId: postId,
      oldSlug: result.previousSlug,
      newSlug: current.slug,
    });
    revalidateBlogPaths(blog, [post.slug, current.slug]);
    return Response.json({ item: syncManifestItem(blog, current) });
  } catch (error) {
    // Lost the move/rename compare-and-swap: another writer committed first.
    if (error instanceof PostConflictError) {
      return syncError(412, "The post changed since this file was fetched");
    }
    const message = clientSaveError(error);
    if (message) return syncError(400, message);
    throw error;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function enqueueBookmarkCaptureIfNeeded(
  handle: string,
  post: Post,
  previousPost: Post,
): Promise<void> {
  if (!post.id) return;
  const url = bookmarkCaptureUrl(post);
  if (!url || !shouldEnqueueBookmarkCapture(post, url, previousPost)) return;
  await markCapturePending(handle, post.id, url);
}

function bookmarkCaptureUrl(post: Post): string | undefined {
  if (post.type !== "bookmark") return undefined;
  const href = post.links?.[0]?.href?.trim();
  if (!href || !isHttpUrl(href)) return undefined;
  return href;
}

function shouldEnqueueBookmarkCapture(
  post: Post,
  url: string,
  previousPost: Post,
): boolean {
  const captureUrl = post.capture?.url;
  if (post.captureStatus === "captured") {
    const previousUrl = bookmarkCaptureUrl(previousPost);
    return Boolean(
      (!previousUrl || !sameUrl(previousUrl, url)) &&
        (!captureUrl || !sameUrl(captureUrl, url)),
    );
  }
  if (captureUrl && sameUrl(captureUrl, url)) return false;
  return true;
}

function sameUrl(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const normalizedLeft = normalizeHttpUrl(left);
  const normalizedRight = normalizeHttpUrl(right);
  if (normalizedLeft && normalizedRight) return normalizedLeft === normalizedRight;
  return left.trim() === right.trim();
}

function isHttpUrl(value: string): boolean {
  return Boolean(normalizeHttpUrl(value));
}

function normalizeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
