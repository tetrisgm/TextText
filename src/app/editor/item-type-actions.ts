"use server";

import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import {
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import {
  createWorkspaceItemType,
  updateWorkspaceItemType,
} from "@/lib/presentation/item-type.server";
import { getDocumentTemplateAuthoringSource } from "@/lib/store";

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function createItemTypeAction(
  handleInput: unknown,
  blueprintInput: unknown,
  folderPathInput: unknown,
  applyToExistingInput: unknown,
): Promise<
  | {
      ok: true;
      itemType: { id: string; version: number; name: string };
      folder: { path: string; restyledItems: number } | null;
    }
  | { ok: false; error: string }
> {
  try {
    const handle = cleanHandle(handleInput);
    const access = await getBlogEditAccess(handle);
    if (!access.isOwner || !access.blogId || !access.ownerId) {
      throw new Error("Only the workspace owner can create an item type.");
    }
    const blueprint = itemTypeBlueprintSchema.parse(blueprintInput);
    const folderPath =
      typeof folderPathInput === "string" && folderPathInput.trim()
        ? folderPathInput.trim()
        : null;
    const created = await createWorkspaceItemType({
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "create_item_type",
        targetType: "mode",
        inputSummary: blueprint.name,
      },
      applyToExisting: applyToExistingInput !== false,
      blogId: access.blogId,
      blueprint,
      createdById: access.ownerId,
      folderPath,
      handle,
    });
    return {
      ok: true,
      itemType: {
        id: created.definition.id,
        version: created.definition.version,
        name: created.definition.name,
      },
      folder: created.folder
        ? {
            path: created.folder.path,
            restyledItems: created.folder.restyledItems,
          }
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Could not create that item type.",
    };
  }
}

/**
 * Reopen a look that was designed here, so it can be changed by describing the
 * change rather than by building a second look that resembles the first.
 *
 * Carries WHY there is no blueprint, when there is none, because there are
 * four different reasons and they are four different things to tell a person.
 * An earlier version returned `blueprint | null` and said null meant the look
 * was assembled rather than designed, which is a false thing to say about a
 * look someone designed with a version of the designer this build has moved
 * past.
 *
 * No caller yet: the workspace UI has no entry point for editing a look, and
 * that is the remaining half of this. The assistant and MCP paths do not go
 * through here.
 */
export async function readItemTypeForEditAction(
  handleInput: unknown,
  templateIdInput: unknown,
): Promise<
  | {
      ok: true;
      version: number;
      blueprint: ItemTypeBlueprint | null;
      /** "authored" | "assembled" | "needs-migration" | "unreadable" */
      state: string;
      retired: boolean;
    }
  | { ok: false; error: string }
> {
  try {
    const handle = cleanHandle(handleInput);
    const access = await getBlogEditAccess(handle);
    if (!access.isOwner || !access.blogId) {
      throw new Error("Only the workspace owner can edit an item type.");
    }
    const templateId =
      typeof templateIdInput === "string" ? templateIdInput.trim() : "";
    if (!templateId) throw new Error("Which item type?");
    const current = await getDocumentTemplateAuthoringSource(
      access.blogId,
      templateId,
    );
    if (!current) throw new Error("That item type could not be found.");
    return {
      ok: true,
      version: current.version,
      blueprint: current.source?.blueprint ?? null,
      state: current.state,
      retired: current.retired,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Could not open that item type.",
    };
  }
}

export async function updateItemTypeAction(
  handleInput: unknown,
  templateIdInput: unknown,
  baseVersionInput: unknown,
  blueprintInput: unknown,
  applyToExistingInput: unknown,
): Promise<
  | {
      ok: true;
      itemType: { id: string; version: number; name: string };
      applied: Array<{ path: string; restyledItems: number }>;
    }
  | { ok: false; error: string }
> {
  try {
    const handle = cleanHandle(handleInput);
    const access = await getBlogEditAccess(handle);
    if (!access.isOwner || !access.blogId || !access.ownerId) {
      throw new Error("Only the workspace owner can change an item type.");
    }
    const blueprint = itemTypeBlueprintSchema.parse(blueprintInput);
    const templateId =
      typeof templateIdInput === "string" ? templateIdInput.trim() : "";
    const baseVersion = Number(baseVersionInput);
    if (!templateId || !Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new Error("Which item type, and from which version?");
    }
    const updated = await updateWorkspaceItemType({
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "update_item_type",
        targetType: "mode",
        inputSummary: blueprint.name,
      },
      applyToExisting: applyToExistingInput !== false,
      baseVersion,
      blogId: access.blogId,
      blueprint,
      createdById: access.ownerId,
      handle,
      templateId,
    });
    return {
      ok: true,
      itemType: {
        id: updated.definition.id,
        version: updated.definition.version,
        name: updated.definition.name,
      },
      applied: updated.applied,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Could not change that item type.",
    };
  }
}
