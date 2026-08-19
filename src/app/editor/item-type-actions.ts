"use server";

import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { itemTypeBlueprintSchema } from "@/lib/presentation/item-type-blueprint";
import { createWorkspaceItemType } from "@/lib/presentation/item-type.server";

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
