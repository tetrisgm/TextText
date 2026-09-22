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
  getDocumentTemplate,
  getDocumentTemplateAuthoringSource,
  importDocumentTemplate,
  listDocumentTemplateLibrary,
  retemplateFolderItems,
  restoreDocumentTemplateVersion,
  retireDocumentTemplate,
  setFolderTemplate,
} from "@/lib/store";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  parseTemplateLookBundle,
  serializeTemplateLook,
  type TemplateLibraryEntry,
} from "@/lib/presentation/template-library";

export type FolderLookState = {
  allowed: boolean;
  current: { id: string; version: number } | null;
  library: TemplateLibraryEntry[];
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

export async function getTypeLibraryAction(
  handleInput: unknown,
  folderPathInput?: unknown,
): Promise<FolderLookState> {
  try {
    const access = await ownerAccess(handleInput);
    const folder = folderPathInput === undefined ? null : await getFolderByPath(access.handle, cleanPath(folderPathInput));
    const library = await listDocumentTemplateLibrary(access.blogId, access.ownerId);
    return {
      allowed: true,
      current: folder?.defaultTemplate ?? null,
      library,
    };
  } catch {
    return {
      allowed: false,
      current: null,
      library: [],
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
    const bundle = parseTemplateLookBundle(textInput);
    const definition = await importDocumentTemplate({
      blogId: access.blogId,
      definition: bundle.template,
      authoringSource: bundle.authoringSource,
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

export async function retireFolderLookAction(
  handleInput: unknown,
  templateIdInput: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const access = await ownerAccess(handleInput);
    if (typeof templateIdInput !== "string" || !templateIdInput.trim() || templateIdInput.startsWith("texttext.")) {
      throw new Error("Choose a custom type to retire.");
    }
    const changed = await retireDocumentTemplate(access.blogId, templateIdInput, {
      audit: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "retire_document_template",
        targetType: "mode",
        targetId: templateIdInput,
      },
    });
    if (!changed) throw new Error("That type is unavailable or already retired.");
    revalidateBlogPaths({ handle: access.handle });
    return { ok: true };
  } catch (error) {
    return actionError(error, "Could not retire that type.");
  }
}

/** Set the folder default. Existing items change only on explicit opt-in. */
export async function setFolderLookAction(
  handleInput: unknown,
  folderPathInput: unknown,
  templateIdInput: unknown,
  templateVersionInput: unknown,
  applyToExistingInput: unknown,
): Promise<
  | { ok: true; changed: number; beingEdited: number; itemsLeft: number }
  | { ok: false; error: string }
> {
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
      applyToExistingInput === true
        ? await retemplateFolderItems(access.handle, folder.id, reference)
        : { changed: 0, contested: 0, remaining: 0 };

    await recordAction({
      actorUserId: access.ownerId,
      actorType: "human",
      actionName: "set_folder_template",
      targetType: "folder",
      targetId: folder.id,
      inputSummary: `${folder.path} -> ${reference.id}@${reference.version}`,
      outputSummary: [
        `${restyled.changed} items restyled`,
        restyled.contested
          ? `${restyled.contested} left alone because someone was editing them`
          : "",
        restyled.remaining ? `${restyled.remaining} still to do` : "",
      ]
        .filter(Boolean)
        .join(", "),
    });
    revalidateBlogPaths({ handle: access.handle });
    // contested is surfaced, not swallowed: an item left with its old look
    // because someone was typing into it is a thing the person who asked for
    // the restyle needs to know, not an internal detail.
    return {
      ok: true,
      changed: restyled.changed,
      beingEdited: restyled.contested,
      // Restyling stops after a bounded number per pass. Returning only what
      // changed made a folder larger than one pass look finished.
      itemsLeft: restyled.remaining,
    };
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

/** Export the exact version, including its validated editable source when present. */
export async function exportTemplateLookAction(handle: string, id: string, version: number): Promise<string> {
  const access = await ownerAccess(handle);
  if (!id || !Number.isInteger(version) || version < 1) throw new Error("Choose a valid look version.");
  const definition = await getDocumentTemplate(access.blogId, { id, version });
  if (!definition) throw new Error("That look could not be found.");
  const authored = await getDocumentTemplateAuthoringSource(access.blogId, id, version);
  return serializeTemplateLook(definition, authored?.source);
}
