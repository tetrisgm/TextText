"use server";

// Saving the look of a document you made.
//
// This is the whole of "creating a look" now. It replaced an operations API
// that a person could not use at all and an agent could only use by declaring
// fields and rebinding two render trees in a single call. You design by editing
// a document, which is the only way anybody has ever actually designed one.

import { recordAction } from "@/lib/audit";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { saveDocumentAsLook } from "@/lib/store";

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function saveItemAsLookAction(
  handleInput: unknown,
  postIdInput: unknown,
  nameInput: unknown,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const handle = cleanHandle(handleInput);
    const access = await getBlogEditAccess(handle);
    if (!access.isOwner || !access.blogId || !access.ownerId) {
      throw new Error("Only the workspace owner can save a look.");
    }
    const postId = typeof postIdInput === "string" ? postIdInput.trim() : "";
    if (!postId) throw new Error("That item could not be found.");
    const name = typeof nameInput === "string" ? nameInput : "";

    const look = await saveDocumentAsLook({
      blogId: access.blogId,
      handle,
      postId,
      name,
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "save_item_as_look",
        targetType: "item",
        targetId: postId,
      },
      createdById: access.ownerId,
    });

    await recordAction({
      actorUserId: access.ownerId,
      actorType: "human",
      actionName: "save_item_as_look",
      targetType: "item",
      targetId: postId,
      inputSummary: look.name,
      outputSummary: `${look.id}@${look.version}`,
    });
    return { ok: true, name: look.name };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Could not save that look.",
    };
  }
}
