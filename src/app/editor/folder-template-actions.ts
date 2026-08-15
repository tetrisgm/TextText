"use server";

// Giving a folder a look, from the UI.
//
// The agent could already do this through set_folder_template while a person
// could not do it at all, which is the wrong way round for a product whose
// pitch is that talking to the assistant and using the app are the same thing.
// This is the same store call the tool makes, behind the same owner check.

import { recordAction } from "@/lib/audit";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import {
  getFolderByPath,
  listDocumentTemplates,
  retemplateFolderItems,
  setFolderTemplate,
} from "@/lib/store";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export type FolderLookState = {
  allowed: boolean;
  current: { id: string; version: number } | null;
  templates: TemplateDefinition[];
};

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanPath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) throw new Error("That folder could not be found.");
  return path;
}

async function ownerAccess(handleInput: unknown) {
  const handle = cleanHandle(handleInput);
  const access = await getBlogEditAccess(handle);
  if (!access.isOwner || !access.blogId || !access.ownerId) {
    throw new Error("Only the workspace owner can change a folder's look.");
  }
  return { handle, blogId: access.blogId, ownerId: access.ownerId };
}

export async function getFolderLookAction(
  handleInput: unknown,
  folderPathInput: unknown,
): Promise<FolderLookState> {
  try {
    const access = await ownerAccess(handleInput);
    const folder = await getFolderByPath(access.handle, cleanPath(folderPathInput));
    return {
      allowed: true,
      current: folder?.defaultTemplate ?? null,
      templates: await listDocumentTemplates(access.blogId),
    };
  } catch {
    return { allowed: false, current: null, templates: [] };
  }
}

/**
 * Apply a look to the folder, and by default to everything already in it.
 * Restyling only future items leaves the index looking new and every existing
 * item looking old, which reads as the change not having worked.
 */
export async function setFolderLookAction(
  handleInput: unknown,
  folderPathInput: unknown,
  templateIdInput: unknown,
  templateVersionInput: unknown,
  applyToExistingInput: unknown,
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  try {
    const access = await ownerAccess(handleInput);
    const folder = await getFolderByPath(access.handle, cleanPath(folderPathInput));
    if (!folder) throw new Error("That folder could not be found.");
    if (
      typeof templateIdInput !== "string" ||
      typeof templateVersionInput !== "number" ||
      !Number.isInteger(templateVersionInput)
    ) {
      throw new Error("That look could not be found.");
    }
    const reference = { id: templateIdInput, version: templateVersionInput };

    await setFolderTemplate(access.handle, folder.id, reference);
    const restyled =
      applyToExistingInput === false
        ? { changed: 0 }
        : await retemplateFolderItems(access.handle, folder.id, reference);

    await recordAction({
      actorUserId: access.ownerId,
      actorType: "human",
      actionName: "set_folder_template",
      targetType: "folder",
      targetId: folder.id,
      inputSummary: `${folder.path} -> ${reference.id}@${reference.version}`,
      outputSummary: `${restyled.changed} items restyled`,
    });
    revalidateBlogPaths({ handle: access.handle });
    return { ok: true, changed: restyled.changed };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Could not change the folder's look.",
    };
  }
}
