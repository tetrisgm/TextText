"use server";

import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { requireDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { getBlog, getDocumentTemplate, getPostById, savePost } from "@/lib/store";

/** Apply a saved look to one item without changing its content or visibility. */
export async function applyItemTemplateAction(
  handleInput: unknown,
  postIdInput: unknown,
  templateIdInput: unknown,
  versionInput: unknown,
  expectedRevisionInput: unknown,
): Promise<
  | { ok: true; revision: number; document: DocumentSnapshot }
  | { ok: false; error: string; code?: "conflict" | "unknown"; revision?: number }
> {
  try {
    const handle = typeof handleInput === "string" ? handleInput.trim().toLowerCase() : "";
    const postId = typeof postIdInput === "string" ? postIdInput.trim() : "";
    const templateId = typeof templateIdInput === "string" ? templateIdInput.trim() : "";
    const version = typeof versionInput === "number" ? versionInput : NaN;
    const expectedRevision = typeof expectedRevisionInput === "number" ? expectedRevisionInput : NaN;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      return { ok: false, code: "conflict", error: "Reopen the document preview before saving its look." };
    }
    if (!handle || !postId || !templateId || !Number.isSafeInteger(version) || version < 1) {
      throw new Error("Choose a saved item and look.");
    }
    const access = await getBlogEditAccess(handle);
    if (!access.isOwner || !access.blogId || !access.ownerId) {
      throw new Error("Only the workspace owner can change this item's look.");
    }
    const [post, template] = await Promise.all([
      getPostById(handle, postId),
      getDocumentTemplate(access.blogId, { id: templateId, version }),
    ]);
    if (!post?.id || !Number.isSafeInteger(post.revision)) throw new Error("Item not found.");
    if (!template) throw new Error("That look is unavailable.");
    const current = requireDocumentSnapshot(post.document);
    if (current.presentation.template.id === templateId &&
        current.presentation.template.version === version) {
      // A lost response may be checked again. Readback acknowledges the saved
      // reference without replaying a write against a later document revision.
      return { ok: true, revision: post.revision!, document: current };
    }
    if (post.revision !== expectedRevision) {
      return { ok: false, code: "conflict", revision: post.revision,
        error: "This document changed after the preview was opened. Reload its current content and review your look before saving." };
    }
    const saved = await savePost(handle, {
      ...post,
      document: {
        ...current,
        presentation: {
          ...current.presentation,
          template: { id: templateId, version },
        },
      },
      template: { id: templateId, version },
    }, {
      expectedRevision,
      preservePublishedAt: true,
      audit: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "apply_item_template",
        targetType: "item",
        targetId: postId,
        inputSummary: `${templateId}@${version}`,
      },
    });
    const blog = await getBlog(handle);
    if (blog) revalidateBlogPaths(blog, [saved.slug]);
    const authoritative = await getPostById(handle, postId);
    if (!authoritative?.document || !Number.isSafeInteger(authoritative.revision)) {
      return { ok: false, code: "unknown", error: "The save was sent, but its result could not be checked. Reopen the document before trying another change." };
    }
    const document = requireDocumentSnapshot(authoritative.document);
    if (document.presentation.template.id !== templateId || document.presentation.template.version !== version) {
      return { ok: false, code: "conflict", revision: authoritative.revision,
        error: "The document's look changed while this save was being checked. Reopen it to review the current version." };
    }
    return { ok: true, revision: authoritative.revision!, document };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error && error.name === "PostConflictError" ? "conflict" : "unknown",
      error: error instanceof Error && error.message
        ? error.message
        : "Could not apply that look.",
    };
  }
}
