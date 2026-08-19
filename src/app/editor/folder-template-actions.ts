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
  duplicateDocumentTemplate,
  getFolderByPath,
  getFolderPosts,
  importDocumentTemplate,
  listDocumentTemplateLibrary,
  retemplateFolderItems,
  restoreDocumentTemplateVersion,
  setFolderTemplate,
} from "@/lib/store";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  parseTemplateLook,
  type TemplateLibraryEntry,
} from "@/lib/presentation/template-library";

export type FolderLookState = {
  allowed: boolean;
  current: { id: string; version: number } | null;
  templates: TemplateDefinition[];
  library: TemplateLibraryEntry[];
  targetItemCount: number;
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
    const [library, targetItemCount] = await Promise.all([
      listDocumentTemplateLibrary(access.blogId, access.ownerId),
      folder
        ? getFolderPosts(access.handle, folder.path).then((items) => items.length)
        : Promise.resolve(0),
    ]);
    return {
      allowed: true,
      current: folder?.defaultTemplate ?? null,
      templates: library.map((entry) => entry.definition),
      library,
      targetItemCount,
    };
  } catch {
    return {
      allowed: false,
      current: null,
      templates: [],
      library: [],
      targetItemCount: 0,
    };
  }
}

function actionError(error: unknown, fallback: string) {
  return {
    ok: false as const,
    error: error instanceof Error && error.message ? error.message : fallback,
  };
}

export async function duplicateFolderLookAction(
  handleInput: unknown,
  templateIdInput: unknown,
  templateVersionInput: unknown,
  nameInput: unknown,
): Promise<
  | { ok: true; definition: TemplateDefinition }
  | { ok: false; error: string }
> {
  try {
    const access = await ownerAccess(handleInput);
    if (
      typeof templateIdInput !== "string" ||
      typeof templateVersionInput !== "number" ||
      !Number.isInteger(templateVersionInput) ||
      typeof nameInput !== "string"
    ) {
      throw new Error("That look could not be copied.");
    }
    const definition = await duplicateDocumentTemplate({
      blogId: access.blogId,
      reference: { id: templateIdInput, version: templateVersionInput },
      name: nameInput,
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "duplicate_document_template",
        targetType: "mode",
        targetId: templateIdInput,
      },
      createdById: access.ownerId,
    });
    revalidateBlogPaths({ handle: access.handle });
    return { ok: true, definition };
  } catch (error) {
    return actionError(error, "Could not save that look as new.");
  }
}

export async function importFolderLookAction(
  handleInput: unknown,
  textInput: unknown,
  modeInput: unknown,
): Promise<
  | { ok: true; definition: TemplateDefinition }
  | { ok: false; error: string }
> {
  try {
    const access = await ownerAccess(handleInput);
    if (typeof textInput !== "string") {
      throw new Error("Choose a TextText look file.");
    }
    if (modeInput !== "new" && modeInput !== "update") {
      throw new Error("Choose whether to save as new or update.");
    }
    const definition = await importDocumentTemplate({
      blogId: access.blogId,
      definition: parseTemplateLook(textInput),
      mode: modeInput,
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "import_document_template",
        targetType: "mode",
        targetId: "template-library",
      },
      createdById: access.ownerId,
    });
    revalidateBlogPaths({ handle: access.handle });
    return { ok: true, definition };
  } catch (error) {
    return actionError(error, "Could not import that look.");
  }
}

export async function restoreFolderLookVersionAction(
  handleInput: unknown,
  templateIdInput: unknown,
  templateVersionInput: unknown,
): Promise<
  | { ok: true; definition: TemplateDefinition }
  | { ok: false; error: string }
> {
  try {
    const access = await ownerAccess(handleInput);
    if (
      typeof templateIdInput !== "string" ||
      typeof templateVersionInput !== "number" ||
      !Number.isInteger(templateVersionInput)
    ) {
      throw new Error("That version could not be found.");
    }
    const definition = await restoreDocumentTemplateVersion({
      blogId: access.blogId,
      reference: { id: templateIdInput, version: templateVersionInput },
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "restore_document_template_version",
        targetType: "mode",
        targetId: `${templateIdInput}@${templateVersionInput}`,
      },
      createdById: access.ownerId,
    });
    revalidateBlogPaths({ handle: access.handle });
    return { ok: true, definition };
  } catch (error) {
    return actionError(error, "Could not restore that version.");
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
