"use server";

import { stableJson } from "@/lib/documents/sync";

import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import {
  itemTypeBlueprintSchema,
  compileItemTypeBlueprint,
  normalizeItemTypeBlueprint,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import {
  createWorkspaceItemType,
  updateWorkspaceItemType,
} from "@/lib/presentation/item-type.server";
import { getDocumentTemplate, getDocumentTemplateAuthoringSource, listFoldersUsingTemplate } from "@/lib/store";
import { itemTypeSaveScopeSchema } from "@/lib/presentation/item-type-update";
import type { ItemTypeUpdateResult } from "@/lib/presentation/item-type.server";

export async function readItemTypeUsagesAction(handleInput: unknown, templateIdInput: unknown): Promise<
  { ok: true; usages: Array<{ path: string; version: number }> } | { ok: false; error: string }
> {
  try {
    const access = await getBlogEditAccess(cleanHandle(handleInput));
    if (!access.isOwner || !access.blogId) throw new Error("Only the workspace owner can edit an item type.");
    if (typeof templateIdInput !== "string" || !templateIdInput.trim()) throw new Error("Which item type?");
    const usages = await listFoldersUsingTemplate(access.blogId, templateIdInput.trim());
    return { ok: true, usages: usages.map(({ path, version }) => ({ path, version })) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read the target folders." };
  }
}

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function createItemTypeAction(
  handleInput: unknown,
  blueprintInput: unknown,
  folderPathInput: unknown,
  applyToExistingInput: unknown,
  requestIdInput?: unknown,
): Promise<
  | {
      ok: true;
      recovered?: boolean;
      itemType: { id: string; version: number; name: string };
      folder: {
        path: string;
        restyledItems: number;
        itemsLeft: number;
        itemsBeingEdited: number;
      } | null;
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
    const requestId = typeof requestIdInput === "string" && /^[a-f0-9-]{36}$/i.test(requestIdInput) ? requestIdInput : undefined;
    if (requestIdInput !== undefined && !requestId) throw new Error("Invalid save request. Reopen the look before saving.");
    const created = await createWorkspaceItemType({
      requestId,
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "create_item_type",
        targetType: "mode",
        inputSummary: blueprint.name,
      },
      applyToExisting: applyToExistingInput === true,
      blogId: access.blogId,
      blueprint,
      createdById: access.ownerId,
      folderPath,
      handle,
    });
    return {
      ok: true,
      ...(created.recovered ? { recovered: true } : {}),
      itemType: {
        id: created.definition.id,
        version: created.definition.version,
        name: created.definition.name,
      },
      folder: created.folder
        ? {
            path: created.folder.path,
            restyledItems: created.folder.restyledItems,
            // The agent path reports these and this one dropped them, so a
            // folder larger than one restyling pass looked finished to the
            // person who asked and finished to nobody else.
            itemsLeft: created.folder.itemsLeft,
            itemsBeingEdited: created.folder.itemsBeingEdited,
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
 * Used by the folder menu and saved-type picker. Assistant and MCP paths
 * use the same underlying workspace operations.
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
  saveScopeInput: unknown = { mode: "version" },
  requestIdInput?: unknown,
): Promise<
  | {
      ok: true;
      recovered?: boolean;
      itemType: { id: string; version: number; name: string };
      applied: ItemTypeUpdateResult["applied"];
      skipped: ItemTypeUpdateResult["skipped"];
      conflicted: ItemTypeUpdateResult["conflicted"];
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
    const requestId = typeof requestIdInput === "string" && /^[a-f0-9-]{36}$/i.test(requestIdInput) ? requestIdInput : undefined;
    if (requestIdInput !== undefined && !requestId) throw new Error("Invalid save request. Reopen the look before saving.");
    if (requestId) {
      // A successor is immutable. Reconcile a lost response before considering
      // another write, and never replay the possibly completed folder changes.
      const saved = await getDocumentTemplate(access.blogId, { id: templateId, version: baseVersion + 1 });
      if (saved) {
        const expected = compileItemTypeBlueprint(normalizeItemTypeBlueprint(blueprint), { id: templateId });
        if (stableJson(saved) !== stableJson({ ...expected, version: baseVersion + 1 })) {
          throw new Error("Someone else changed this look. Reopen the latest version and review your changes.");
        }
        return { ok: true, recovered: true, itemType: { id: saved.id, version: saved.version, name: saved.name }, applied: [], skipped: [], conflicted: [] };
      }
    }
    const updated = await updateWorkspaceItemType({
      actor: {
        actorUserId: access.ownerId,
        actorType: "human",
        actionName: "update_item_type",
        targetType: "mode",
        inputSummary: blueprint.name,
      },
      saveScope: itemTypeSaveScopeSchema.parse(saveScopeInput),
      applyToExisting: applyToExistingInput === true,
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
      skipped: updated.skipped,
      conflicted: updated.conflicted,
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
