import type { Post } from "@/lib/content";
import { parsePostMarkdownFile, slugForNewFile } from "@/lib/markdown-files";
import {
  createDraft,
  createDraftInFolder,
  deletePost,
  markCapturePending,
  savePost,
} from "@/lib/store";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { resolveSyncWorkspace } from "../auth";
import { recordAction } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { clientSaveError, syncError, syncManifestItem } from "../sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const access = await resolveWorkspaceAccess({ handle: blog.handle, user: workspace });
  if (!access.isOwner) {
    return syncError(403, "You cannot create files in this workspace");
  }

  let parsed: ReturnType<typeof parsePostMarkdownFile>;
  try {
    parsed = parsePostMarkdownFile(await request.text());
  } catch (error) {
    return syncError(400, errorMessage(error, "Could not parse the file"));
  }

  // A File Provider create knows its target folder (?folder=<id>); a plain
  // client create derives the folder from the file's type. When a folder is
  // named, its mode dictates the kind, so a file made inside Notes is a note.
  const folderId = new URL(request.url).searchParams.get("folder");
  let created: Post;
  let forcedType: Post["type"] | undefined;
  try {
    if (folderId) {
      created = await createDraftInFolder(blog.handle, folderId);
      forcedType = created.type; // the folder's kind wins over any frontmatter
    } else {
      created = await createDraft(blog.handle, parsed.fields.type ?? "article");
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
