// Session-end document materialization for co-editing.
//
//   POST /api/collab/{postId}/materialize  {handle, state}  -> {ok}
//
// The canonical posts.body is fed only by the editor's 800ms-debounced autosave,
// a server action that cannot complete during a tab close. So an editor who
// closes the tab within that window leaves their final edits in the Yjs log but
// not in posts.body, and everything that reads the canonical body (reader, sync
// API, MCP, Finder mirror) serves a stale body until someone reopens the editor
// and re-materializes it. This endpoint is the unload-safe path: the client
// beacons its current body here on pagehide so the canonical body catches up
// before teardown. Editors only (collabAccess); a viewer cannot write.
//
// It is deliberately a plain body write (savePostContentPatch), not a log
// operation: it never touches collab_updates, so it cannot race a push or orphan
// a delta. The write is revision-CAS'd, so it can only ever advance posts.body
// from the exact revision this request read: it never overwrites a newer write
// (a boundary-timed external write, or another co-editor's autosave/beacon). The
// beacon body is this tab's local Y.Doc and may trail an in-flight co-editor
// edit, so it is best-effort; the Yjs log (also flushed on pagehide) carries
// anything a stale beacon missed, recovered on the next editor open.

import {
  markCollabMaterialized,
  materializeCollabDocument,
} from "@/lib/collab";
import { getCollabRequestAccess } from "@/lib/collab/access.server";
import {
  getPostById,
  getUserIdBySub,
  PostConflictError,
  savePost,
} from "@/lib/store";
import { requireDocumentSnapshot } from "@/lib/documents/model";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { getBlog } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const access = await getCollabRequestAccess(request, postId);
  const role = access.role;
  if (role !== "editor") {
    return Response.json({ error: "Not an editor of this post" }, { status: 403 });
  }

  let body: { handle?: unknown; state?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body" }, { status: 400 });
  }
  const handle = typeof body.handle === "string" ? body.handle : "";
  const state = typeof body.state === "string" ? body.state : undefined;
  const legacyBody = typeof body.body === "string" ? body.body : undefined;
  if (!handle || (!state && legacyBody === undefined)) {
    return Response.json({ error: "handle and state are required" }, { status: 400 });
  }

  // getPostById is scoped to the handle, so a mismatched handle simply misses;
  // collabAccess already proved the caller may edit THIS post.
  const post = await getPostById(handle, postId);
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }
  const currentDocument = requireDocumentSnapshot(
    post.document,
    `Persisted item ${post.id ?? post.slug}`,
  );
  const collabDocument = state
    ? await materializeCollabDocument(postId, state)
    : null;
  const nextDocument = collabDocument ?? {
    ...currentDocument,
    content: {
      ...currentDocument.content,
      body: legacyBody ?? currentDocument.content.body,
    },
  };
  if (JSON.stringify(currentDocument) === JSON.stringify(nextDocument)) {
    return Response.json({
      ok: true,
      unchanged: true,
      document: currentDocument,
      revision: post.revision,
    });
  }

  // Presence is deliberately not a write gate. A tab can become backgrounded,
  // lose its heartbeat, and still own durable local Yjs operations. Revision CAS
  // is the actual safety boundary: this materialization either advances the
  // canonical document from the revision it read or yields to a newer writer.
  let saved;
  try {
    saved = await savePost(handle, { ...post, document: nextDocument }, {
      preservePublishedAt: true,
      expectedRevision: post.revision,
      audit: {
        actorUserId: access.user
          ? access.user.userId ?? (await getUserIdBySub(access.user.sub))
          : null,
        actorType: "human",
        actionName: "collab.materialize",
        targetType: "item",
        targetId: post.id,
        inputSummary: post.title,
      },
    });
  } catch (error) {
    if (error instanceof PostConflictError) {
      return Response.json({ ok: true, skipped: "superseded" });
    }
    throw error;
  }
  // Record that this collab body write produced posts.body @ its new revision, so
  // the catch-up staleness check does not later reseed away a body the session
  // itself materialized.
  if (typeof saved.revision === "number" && saved.id) {
    await markCollabMaterialized(saved.id, saved.revision).catch(() => {});
  }
  const blog = await getBlog(handle).catch(() => null);
  revalidateBlogPaths(blog ?? { handle }, [post.slug]);
  return Response.json({
    ok: true,
    document: saved.document ?? nextDocument,
    revision: saved.revision,
  });
}
