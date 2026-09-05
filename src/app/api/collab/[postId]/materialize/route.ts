// Unload-safe canonical save. Client state is fenced by its learned epoch,
// then persisted with revision CAS, epoch locking, provenance and audit.

import {
  CollabEpochConflictError,
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
import { readBoundedJson } from "@/lib/http/bounded-json";

export const dynamic = "force-dynamic";

// A supported document is capped well below this once decoded. The extra room
// covers base64 and Yjs structure without permitting an unbounded unload beacon.
const MAX_MATERIALIZE_BODY_BYTES = 8 * 1024 * 1024;

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const { postId } = await ctx.params;
  const access = await getCollabRequestAccess(request, postId);
  const role = access.role;
  if (role !== "editor") {
    if (access.trashed) {
      return Response.json(
        { error: "This item was moved to Trash", reason: "trashed" },
        { status: 410 },
      );
    }
    return Response.json({ error: "Not an editor of this post" }, { status: 403 });
  }

  const decoded = await readBoundedJson<{
    handle?: unknown;
    state?: unknown;
    epoch?: unknown;
  }>(request, MAX_MATERIALIZE_BODY_BYTES);
  if ("error" in decoded) {
    if (decoded.error === "too_large") {
      return Response.json(
        { error: "Collaborative document state is too large" },
        { status: 413, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json({ error: "Send a JSON body" }, { status: 400 });
  }
  const body = decoded.value;
  const handle = typeof body.handle === "string" ? body.handle : "";
  const state = typeof body.state === "string" ? body.state : undefined;
  const epoch = body.epoch;
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) {
    return epochConflict();
  }
  if (!handle || !state) {
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
  let nextDocument;
  try {
    nextDocument = await materializeCollabDocument(postId, state, epoch);
  } catch (error) {
    if (error instanceof CollabEpochConflictError) return epochConflict();
    throw error;
  }
  if (!nextDocument) {
    return Response.json({ error: "Invalid collaborative document state" }, { status: 400 });
  }
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
      expectedCollabEpoch: epoch,
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
      return epochConflict();
    }
    throw error;
  }
  const blog = await getBlog(handle).catch(() => null);
  revalidateBlogPaths(blog ?? { handle }, [post.slug]);
  return Response.json({
    ok: true,
    document: saved.document ?? nextDocument,
    revision: saved.revision,
  });
}

function epochConflict() {
  return Response.json(
    { error: "This document changed elsewhere. Keep your local copy for recovery.", retired: true },
    { status: 409, headers: { "Cache-Control": "private, no-store" } },
  );
}
