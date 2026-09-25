"use server";

import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { requireDocumentSnapshot } from "@/lib/documents/model";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { getBlog, getDocumentTemplate, getPostById, savePost } from "@/lib/store";

/** Apply a saved look to one item without changing its content or visibility. */
export async function applyItemTemplateAction(
  handleInput: unknown,
  postIdInput: unknown,
  templateIdInput: unknown,
  versionInput: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const handle = typeof handleInput === "string" ? handleInput.trim().toLowerCase() : "";
    const postId = typeof postIdInput === "string" ? postIdInput.trim() : "";
    const templateId = typeof templateIdInput === "string" ? templateIdInput.trim() : "";
    const version = typeof versionInput === "number" ? versionInput : NaN;
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
        current.presentation.template.version === version) return { ok: true };
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
      expectedRevision: post.revision,
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
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message
        ? error.message
        : "Could not apply that look.",
    };
  }
}
