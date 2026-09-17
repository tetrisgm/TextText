import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { applyLiveDocumentMutation, markCollabMaterialized, materializeCollabDocument } from "@/lib/collab";
import { getCurrentUser } from "@/lib/session";
import {
  getBlog,
  getPostById,
  getPostStoreContext,
  getUserIdBySub,
  PostConflictError,
  savePost,
  savePostContentPatch,
} from "@/lib/store";
import { getPostRevision, listPostRevisions, MAX_LISTED_REVISIONS } from "@/lib/revisions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { isUuid } from "@/lib/permissions";
import type { DocumentMutation } from "@/lib/collab/document";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { Post } from "@/lib/content";

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
type EditorAccess =
  | { ok: false; response: Response }
  | { ok: true; access: Awaited<ReturnType<typeof getBlogEditAccess>>; post: Post };

async function editor(handle: string, postId: string): Promise<EditorAccess> {
  // A malformed id is an item that does not exist, not a database error: the
  // uuid comparison would raise 22P02 and surface as a 500.
  if (!isUuid(postId)) return { ok: false, response: jsonError("Item not found", 404) };
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit || !access.blogId) return { ok: false, response: jsonError("You cannot edit this workspace", 403) };
  const post = await getPostById(handle, postId);
  if (!post) return { ok: false, response: jsonError("Item not found", 404) };
  return { ok: true, access, post };
}

/** GET ?handle=&id= -> the versions kept for this item, newest first. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim() ?? "";
  const postId = url.searchParams.get("id")?.trim() ?? "";
  if (!handle || !postId) return jsonError("Missing workspace handle or item", 400);
  const resolved = await editor(handle, postId);
  if (!resolved.ok) return resolved.response;
  return json({ versions: await listPostRevisions(postId, MAX_LISTED_REVISIONS) });
}

/**
 * The whole of an earlier version, as one mutation of the live document.
 *
 * Fields merge rather than replace, so a key the current document has and the
 * restored one does not is cleared explicitly. Without that, "put this back"
 * would put most of it back.
 */
function restoreMutation(version: DocumentSnapshot, current: DocumentSnapshot): DocumentMutation {
  const cleared = Object.fromEntries(
    Object.keys(current.content.fields ?? {}).map((key) => [key, null] as const),
  );
  return {
    title: version.content.title,
    subtitle: version.content.subtitle ?? null,
    body: version.content.body,
    tags: version.content.tags ?? [],
    assets: version.content.assets ?? [],
    fields: { ...cleared, ...(version.content.fields ?? {}) },
    template: version.presentation.template,
  };
}

/** POST { handle, id, versionId } puts an earlier version back. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  const postId = typeof body.id === "string" ? body.id.trim() : "";
  const versionId = typeof body.versionId === "string" ? body.versionId.trim() : "";
  if (!handle || !postId || !versionId) return jsonError("Missing workspace handle, item, or version", 400);
  const resolved = await editor(handle, postId);
  if (!resolved.ok) return resolved.response;
  if (!isUuid(versionId)) return jsonError("That version is not kept for this item", 404);
  const viewer = await getCurrentUser();
  const actorUserId = viewer ? await getUserIdBySub(viewer.sub) : null;
  const audit = {
    actorUserId,
    actorType: "human" as const,
    actionName: "restore_revision",
    targetType: "item" as const,
    targetId: postId,
    inputSummary: versionId,
  };
  try {
    const version = await getPostRevision(postId, versionId);
    if (!version) return jsonError("That version is not kept for this item", 404);
    // The restore goes through the live collaborative document, exactly as an
    // agent's edit does. A tab that has this item open is usually the tab the
    // restore was asked for, and a raw write behind its back would be undone
    // by its next autosave. This way the open editor receives the older text
    // and the canonical row follows it.
    const applied = await applyLiveDocumentMutation(
      postId,
      restoreMutation(version.document, resolved.post.document!),
      { ...audit, outputSummary: version.createdAt },
    );
    if (!applied) return jsonError("Could not restore that version", 500);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const context = await getPostStoreContext(postId);
      if (!context || context.handle !== handle) return jsonError("Item not found", 404);
      const snapshot = (await materializeCollabDocument(postId)) ?? applied.snapshot;
      const revision = context.post.revision;
      if (typeof revision !== "number") return jsonError("Could not restore that version", 500);
      try {
        const saved = resolved.access.isOwner === false
          ? await savePostContentPatch(handle, resolved.post, { document: snapshot }, {
              expectedRevision: revision, audit, auditAlreadyRecorded: applied.auditRecorded,
            })
          : await savePost(
              handle,
              {
                ...resolved.post,
                document: snapshot,
                title: snapshot.content.title,
                excerpt: snapshot.content.subtitle,
                body: snapshot.content.body,
                tags: snapshot.content.tags,
              },
              {
                // Guarded on the revision this attempt read, so a write that
                // lands in between is refused rather than destroyed.
                expectedRevision: revision,
                preservePublishedAt: true,
                audit,
                auditAlreadyRecorded: applied.auditRecorded,
              },
            );
        await markCollabMaterialized(postId, saved.revision ?? revision);
        const blog = await getBlog(handle);
        if (blog) revalidateBlogPaths(blog, [saved.slug]);
        return json({ restored: { id: saved.id, revision: saved.revision, title: saved.title } });
      } catch (error) {
        if (!(error instanceof PostConflictError) || attempt === 2) throw error;
      }
    }
    return jsonError("This item changed while you were looking at it. Reopen the history and try again.", 409);
  } catch (error) {
    if (error instanceof PostConflictError) {
      return jsonError("This item changed while you were looking at it. Reopen the history and try again.", 409);
    }
    console.warn("restore revision failed", error instanceof Error ? error.message : error);
    return jsonError("Could not restore that version", 500);
  }
}
