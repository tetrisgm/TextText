// Session-end body materialization for co-editing.
//
//   POST /api/collab/{postId}/materialize  {handle, body}  -> {ok}
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

import { getCurrentUser } from "@/lib/session";
import {
  collabAccess,
  hasActiveCoEditors,
  markCollabMaterialized,
} from "@/lib/collab";
import {
  getPostById,
  getUserIdBySub,
  PostConflictError,
  savePostContentPatch,
} from "@/lib/store";
import { recordAction } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { getBlog } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const user = await getCurrentUser();
  const role = await collabAccess(user, postId);
  if (role !== "editor") {
    return Response.json({ error: "Not an editor of this post" }, { status: 403 });
  }

  let body: { handle?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body" }, { status: 400 });
  }
  const handle = typeof body.handle === "string" ? body.handle : "";
  const nextBody = typeof body.body === "string" ? body.body : null;
  if (!handle || nextBody === null) {
    return Response.json({ error: "handle and body are required" }, { status: 400 });
  }

  // getPostById is scoped to the handle, so a mismatched handle simply misses;
  // collabAccess already proved the caller may edit THIS post.
  const post = await getPostById(handle, postId);
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }
  // Nothing to do if the canonical body already matches: avoid a redundant write
  // and revision bump on every tab close.
  if (post.body === nextBody) {
    return Response.json({ ok: true, unchanged: true });
  }

  // Only materialize while a live session still owns the document. First safety
  // gate: presence stays fresh through a normal tab close (last heartbeat <=8s,
  // stale window 15s), so a real session-end flush proceeds; a tab frozen past
  // the window and then closed reads stale and skips.
  if (!(await hasActiveCoEditors(postId))) {
    return Response.json({ ok: true, skipped: "no active session" });
  }

  // Second safety gate, and the one that actually closes the clobber: the
  // hasActiveCoEditors check above is check-then-write, not a lock, and it flips
  // exactly at the presence-expiry boundary, which is when a mid-session-refused
  // external writer (owner save, sync PUT, MCP) retries. So compare-and-swap on
  // the revision we read, exactly like every other body-write path. If anything
  // committed since (an external write at the boundary, or a co-editor's own
  // autosave that already materialized a newer body), the guarded UPDATE matches
  // nothing and we skip rather than overwrite it. The beacon body is this tab's
  // local Y.Doc, which may trail another co-editor's in-flight edits, so this is
  // best-effort: it never clobbers a newer revision, and the Yjs log (also
  // flushed on pagehide) still carries anything a stale beacon missed.
  let saved;
  try {
    saved = await savePostContentPatch(handle, post, { body: nextBody }, {
      expectedRevision: post.revision,
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
  await recordAction({
    actorUserId: user ? user.userId ?? (await getUserIdBySub(user.sub)) : null,
    actorType: "human",
    actionName: "collab.materialize",
    targetType: "item",
    targetId: post.id,
    inputSummary: post.title,
  });
  const blog = await getBlog(handle).catch(() => null);
  revalidateBlogPaths(blog ?? { handle }, [post.slug]);
  return Response.json({ ok: true });
}
