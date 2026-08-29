import { randomUUID } from "node:crypto";
import { recordAction, type AuditEntry } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  createDocumentTemplateVersion,
  getDocumentTemplateAuthoringSource,
  getFolderByPath,
  listFoldersUsingTemplate,
  retemplateFolderItems,
  setFolderTemplate,
} from "@/lib/store";
import {
  compileItemTypeBlueprint,
  normalizeItemTypeBlueprint,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import { authoringSourceFor } from "@/lib/presentation/authoring-source";
import type { TemplateDefinition } from "@/lib/presentation/schema";

type CreatedItemType = {
  definition: TemplateDefinition;
  folder: null | {
    id: string;
    path: string;
    restyledItems: number;
  };
};

function identifier(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item-type";
  return `${slug}-${randomUUID().slice(0, 6)}`;
}

/** The one mutation path used by the UI and every agent adapter. */
export async function createWorkspaceItemType(input: {
  actor: AuditEntry;
  applyToExisting?: boolean;
  blogId: string;
  blueprint: ItemTypeBlueprint;
  createdById?: string | null;
  folderPath?: string | null;
  handle: string;
}): Promise<CreatedItemType> {
  const folderPath = input.folderPath?.trim() || null;
  const folder = folderPath
    ? await getFolderByPath(input.handle, folderPath)
    : null;
  if (folderPath && !folder) throw new Error("That folder could not be found.");

  // Normalise first and compile from THAT, so the blueprint stored beside the
  // definition is the one that actually produced it. adaptCollectionToFields
  // rewrites a layout the fields cannot support, so the blueprint the model
  // sent and the blueprint that compiled are not always the same object;
  // storing the sent one would show a person reopening the look a layout their
  // type does not have.
  const blueprint = normalizeItemTypeBlueprint(input.blueprint);
  const definition = compileItemTypeBlueprint(blueprint, {
    id: identifier(blueprint.name),
  });
  const created = await createDocumentTemplateVersion({
    blogId: input.blogId,
    definition,
    actor: input.actor,
    createdById: input.createdById ?? null,
    authoringSource: authoringSourceFor(blueprint),
  });

  if (!folder) return { definition: created, folder: null };

  const reference = { id: created.id, version: created.version };
  await setFolderTemplate(input.handle, folder.id, reference);
  const restyled =
    input.applyToExisting === false
      ? { changed: 0, remaining: 0 }
      : await retemplateFolderItems(input.handle, folder.id, reference);
  await recordAction({
    ...input.actor,
    actionName: "set_folder_template",
    targetType: "folder",
    targetId: folder.id,
    inputSummary: `${folder.path} -> ${created.id}@${created.version}`,
    outputSummary: `${restyled.changed} items restyled`,
  });
  revalidateBlogPaths({ handle: input.handle });
  return {
    definition: created,
    folder: {
      id: folder.id,
      path: folder.path,
      restyledItems: restyled.changed,
    },
  };
}

export type ItemTypeUpdateResult = {
  definition: TemplateDefinition;
  previousVersion: number;
  /** Where the new version actually landed, and what it restyled. */
  applied: Array<{ path: string; restyledItems: number }>;
};

/**
 * Change a look that already exists, by reopening how it was authored.
 *
 * This is the half of the product that was missing. A look could be created
 * from a blueprint and never reopened: the blueprint was discarded at save, so
 * "make the date bigger on my recipe type" meant re-authoring the whole thing
 * blind from compiled output, under a new name.
 *
 * Three things this deliberately does NOT do:
 *
 * It does not mutate a version. Versions are immutable and documents pin exact
 * ones, so an edit adds a successor and the documents already on the old one
 * keep rendering exactly as they did.
 *
 * It does not guess where the change belongs. A new version is invisible on its
 * own, so it is applied to the folders already wearing this look, and the
 * result says which and how many items were restyled. A caller that wants the
 * version without moving anyone passes `apply: false`.
 *
 * It does not accept a blind write. `baseVersion` is the version the editor was
 * looking at; if a successor appeared meanwhile the update is refused rather
 * than quietly becoming the winner of a race nobody knew they were in.
 */
export async function updateWorkspaceItemType(input: {
  actor: AuditEntry;
  apply?: boolean;
  applyToExisting?: boolean;
  baseVersion: number;
  blogId: string;
  blueprint: ItemTypeBlueprint;
  createdById?: string | null;
  handle: string;
  templateId: string;
}): Promise<ItemTypeUpdateResult> {
  if (input.templateId.startsWith("texttext.")) {
    throw new Error(
      "Built-in looks cannot be changed. Save a copy and change that instead.",
    );
  }
  const current = await getDocumentTemplateAuthoringSource(
    input.blogId,
    input.templateId,
  );
  if (!current) throw new Error("That item type could not be found.");
  if (current.version !== input.baseVersion) {
    throw new Error(
      `That item type has moved on: you edited version ${input.baseVersion} and it is now at ${current.version}. Read it again and reapply your change.`,
    );
  }

  const blueprint = normalizeItemTypeBlueprint(input.blueprint);
  // Same id, so this is a new version of the SAME look rather than a new look
  // that happens to resemble it. createDocumentTemplateVersion picks the next
  // free version number.
  const definition = compileItemTypeBlueprint(blueprint, {
    id: input.templateId,
  });
  const created = await createDocumentTemplateVersion({
    blogId: input.blogId,
    definition,
    actor: input.actor,
    createdById: input.createdById ?? null,
    authoringSource: authoringSourceFor(blueprint),
  });

  const applied: Array<{ path: string; restyledItems: number }> = [];
  if (input.apply !== false) {
    const reference = { id: created.id, version: created.version };
    for (const folder of await listFoldersUsingTemplate(
      input.blogId,
      input.templateId,
    )) {
      await setFolderTemplate(input.handle, folder.id, reference);
      const restyled =
        input.applyToExisting === false
          ? { changed: 0, remaining: 0 }
          : await retemplateFolderItems(input.handle, folder.id, reference);
      applied.push({ path: folder.path, restyledItems: restyled.changed });
    }
    if (applied.length) revalidateBlogPaths({ handle: input.handle });
  }

  await recordAction({
    ...input.actor,
    actionName: "update_item_type",
    targetType: "mode",
    targetId: `${created.id}@${created.version}`,
    inputSummary: `from version ${current.version}`,
    outputSummary: applied.length
      ? `applied to ${applied.map((entry) => entry.path).join(", ")}`
      : "version created, not applied",
  });

  return { definition: created, previousVersion: current.version, applied };
}
