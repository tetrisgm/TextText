import type { Post } from "@/lib/content";
import { parsePostMarkdownFile, slugForNewFile } from "@/lib/markdown-files";
import {
  claimIdempotencyKey,
  createDraft,
  createDraftInFolder,
  deletePost,
  getPostById,
  markCapturePending,
  releaseIdempotencyKey,
  resolveIdempotencyKey,
  savePost,
} from "@/lib/store";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { resolveSyncWorkspace } from "../auth";
import { recordAction } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  clientSaveError,
  parseSyncFileRepresentation,
  syncError,
  syncManifestItem,
  WRITE_FILE_REPRESENTATION_HEADER,
} from "../sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const access = await resolveWorkspaceAccess({ handle: blog.handle, user: workspace });
  if (!access.isOwner) {
    return syncError(403, "You cannot create files in this workspace");
  }

  const representation = parseSyncFileRepresentation(
    request.headers.get(WRITE_FILE_REPRESENTATION_HEADER),
  );
  if (!representation) {
    return syncError(
      400,
      `${WRITE_FILE_REPRESENTATION_HEADER} must be textbundle, markdown, or text`,
    );
  }

  let parsed: ReturnType<typeof parsePostMarkdownFile>;
  try {
    parsed = parsePostMarkdownFile(await request.text());
  } catch (error) {
    return syncError(400, errorMessage(error, "Could not parse the file"));
  }

  // Idempotency: a client that retries an ambiguous create (committed server
  // side, reply lost) sends the same Idempotency-Key. A resolved key returns the
  // original item; a still-running first attempt is asked to retry shortly.
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(blog.handle, idempotencyKey);
    if (claim.status === "done") {
      if (claim.kind !== "post") {
        return syncError(409, "This Idempotency-Key was used for a different resource");
      }
      const existing = await getPostById(blog.handle, claim.id);
      if (existing) {
        return Response.json({ item: syncManifestItem(blog, existing) }, { status: 201 });
      }
      // The item this key created was since deleted. The key is spent: do not
      // recreate, which two concurrent retries would each do (a second race).
      return syncError(409, "The item created for this Idempotency-Key was deleted");
    } else if (claim.status === "inflight") {
      return syncError(409, "A create with this Idempotency-Key is in progress; retry shortly");
    }
  }

  // A File Provider create knows its target folder (?folder=<id>); a plain
  // client create derives the folder from the file's type. When a folder is
  // named, its mode dictates the kind, so a file made inside Notes is a note.
  const folderId = new URL(request.url).searchParams.get("folder");
  let created: Post;
  let forcedType: Post["type"] | undefined;
  try {
    if (folderId) {
      created = await createDraftInFolder(blog.handle, folderId, {
        representation,
      });
      forcedType = created.type; // the folder's kind wins over any frontmatter
    } else {
      created = await createDraft(
        blog.handle,
        parsed.fields.type ?? "article",
        { representation },
      );
    }
  } catch (error) {
    return syncError(400, errorMessage(error, "Could not create the file"));
  }
  try {
    // date comes from the file alone: created.date is the placeholder's
    // derived createdAt, and letting it through would backdate a publish to
    // midnight today instead of savePost stamping now.
    const saved = await savePost(blog.handle, {
      ...created,
      ...parsed.fields,
      // The target folder's kind is authoritative for a folder-scoped create;
      // it must not be overridden by a stray `type:` in the file's frontmatter.
      ...(forcedType ? { type: forcedType } : {}),
      date: parsed.fields.date,
      slug: slugForNewFile(parsed.fields, created.slug),
      body: parsed.body,
    });
    await enqueueBookmarkCaptureIfNeeded(blog.handle, saved);
    if (idempotencyKey && saved.id) {
      await resolveIdempotencyKey(blog.handle, idempotencyKey, "post", saved.id);
    }
    await recordAction({
      actorUserId: userId,
      actorType: "external_agent",
      actionName: "sync.create_file",
      targetType: "item",
      targetId: saved.id,
      inputSummary: saved.title,
    });
    revalidateBlogPaths(blog, [saved.slug]);
    return Response.json({ item: syncManifestItem(blog, saved) }, { status: 201 });
  } catch (error) {
    // A failed create must free the claim so a retry starts fresh instead of
    // being told a nonexistent item already exists.
    if (idempotencyKey) await releaseIdempotencyKey(blog.handle, idempotencyKey).catch(() => {});
    // Best effort: never strand the placeholder draft behind a failed save
    // (e.g. the file's slug is already used).
    if (created.id) await deletePost(blog.handle, created.id).catch(() => {});
    const message = clientSaveError(error);
    if (message) return syncError(400, message);
    throw error; // internal failure: surface as 500, never a false 400
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function enqueueBookmarkCaptureIfNeeded(
  handle: string,
  post: Post,
): Promise<void> {
  if (!post.id) return;
  const url = bookmarkCaptureUrl(post);
  if (!url || !shouldEnqueueBookmarkCapture(post, url)) return;
  await markCapturePending(handle, post.id, url);
}

function bookmarkCaptureUrl(post: Post): string | undefined {
  if (post.type !== "bookmark") return undefined;
  const href = post.links?.[0]?.href?.trim();
  if (!href || !isHttpUrl(href)) return undefined;
  return href;
}

function shouldEnqueueBookmarkCapture(post: Post, url: string): boolean {
  if (post.captureStatus === "captured") return false;
  const captureUrl = post.capture?.url;
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
