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
import { assertCompatibleItemTypeFields, itemTypeSaveScopeSchema, type ItemTypeSaveScope } from "@/lib/presentation/item-type-update";
import type { TemplateDefinition } from "@/lib/presentation/schema";

type CreatedItemType = {
  definition: TemplateDefinition;
  folder: null | {
    id: string;
    path: string;
    restyledItems: number;
    /** Items a bounded pass did not reach. Reporting only what changed turns
     *  a half-restyled folder into a finished one. */
    itemsLeft: number;
    /** Items someone was editing, left with their old look and their words. */
    itemsBeingEdited: number;
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
      ? { changed: 0, contested: 0, remaining: 0 }
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
      itemsLeft: restyled.remaining,
      itemsBeingEdited: restyled.contested,
    },
  };
}

export type ItemTypeUpdateResult = {
  definition: TemplateDefinition;
  previousVersion: number;
  /** Where the new version actually landed, and what it restyled. */
  applied: Array<{
    path: string;
    restyledItems: number;
    itemsLeft: number;
    itemsBeingEdited: number;
  }>;
  /** Folders left where they were because they pin an older version. */
  skipped: Array<{ path: string; pinnedTo: number }>;
  /** Folders whose look changed or disappeared before this update landed. */
  conflicted: Array<{ path: string }>;
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
 * The explicit save scope names the target folders, or saves only a version.
 * Legacy callers can still use `apply: false`. Item application moves only
 * documents pinned to the exact base reference, preserving independent looks.
 *
 * It does not accept a blind write. `baseVersion` is the version the editor was
 * looking at; if a successor appeared meanwhile the update is refused rather
 * than quietly becoming the winner of a race nobody knew they were in.
 */
export async function updateWorkspaceItemType(input: {
  actor: AuditEntry;
  apply?: boolean;
  saveScope?: ItemTypeSaveScope;
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
  // Refuse a look that was never designed from a blueprint. This was fetched
  // and then not read, so an imported, duplicated or saved-from-a-document
  // look could be replaced wholesale by a blueprint that had nothing to do
  // with it, under the same id and name. The docs and the tool description
  // both said this was impossible while the code allowed it.
  if (!current.source) {
    // Each state is a different thing to tell someone. Saying "was never
    // designed" about a look they designed, because this build's compiler has
    // moved on, is a false statement about their own work.
    throw new Error(
      current.state === "needs-migration"
        ? "That look was designed with an older version of the designer, and this one would not rebuild it the same way. Changing it here would quietly alter how it renders, so it is left as it is."
        : current.state === "unreadable"
          ? "That look's saved design could not be read, so changing it here would replace it with something unrelated. Save a copy and design that instead."
          : "That look was not designed from a blueprint, so it cannot be changed this way. It was saved from a document, imported, duplicated, or made before looks kept their design. Save a copy and design that instead.",
    );
  }
  // A retired look is one someone chose to stop offering. Editing it would
  // create a fresh, unretired version and put it back in the pickers, which is
  // not what "change this" means and not what retiring it meant either.
  if (current.retired) {
    throw new Error(
      "That look was retired. Documents already wearing it still render, but it is no longer offered, so changing it would put it back. Save a copy and change that instead.",
    );
  }
  if (current.version !== input.baseVersion) {
    throw new Error(
      `That item type has moved on: you edited version ${input.baseVersion} and it is now at ${current.version}. Read it again and reapply your change.`,
    );
  }

  const blueprint = normalizeItemTypeBlueprint(input.blueprint);
  const base = compileItemTypeBlueprint(current.source.blueprint, { id: input.templateId });
  const definition = compileItemTypeBlueprint(blueprint, { id: input.templateId });
  assertCompatibleItemTypeFields(base.fields, definition.fields);

  // Resolve and validate the whole scope before inserting an immutable version.
  // Legacy callers retain apply:false; explicit scope takes precedence.
  const scope = input.saveScope === undefined
    ? null
    : itemTypeSaveScopeSchema.parse(input.saveScope);
  const saveOnly = scope ? scope.mode === "version" : input.apply === false;
  const targets = saveOnly || scope?.mode === "folder"
    ? []
    : await listFoldersUsingTemplate(input.blogId, input.templateId);
  if (scope?.mode === "usages") {
    for (const path of scope.folderPaths) {
      if (!targets.some((folder) => folder.path === path)) {
        throw new Error(`Folder "${path}" no longer uses this item type. Review the target folders again.`);
      }
    }
  }
  const listed = scope?.mode === "usages"
    ? targets.filter((folder) => scope.folderPaths.includes(folder.path))
    : targets;
  const applicable = listed
    .filter((folder) => folder.version === input.baseVersion)
    .map((folder) => ({ ...folder, expectedReference: { id: input.templateId, version: input.baseVersion } }));
  const skipped = listed
    .filter((folder) => folder.version !== input.baseVersion)
    .map((folder) => ({ path: folder.path, pinnedTo: folder.version }));
  if (scope?.mode === "folder") {
    const folder = await getFolderByPath(input.handle, scope.folderPath);
    if (!folder) throw new Error("That folder could not be found.");
    if (!folder.defaultTemplate) throw new Error("That folder's current item type could not be read. Reload it before applying.");
    applicable.push({
      id: folder.id, path: folder.path, version: input.baseVersion,
      expectedReference: folder.defaultTemplate,
    });
  }
  const conflicted: Array<{ path: string }> = [];
  const created = await createDocumentTemplateVersion({
    blogId: input.blogId,
    definition,
    actor: input.actor,
    createdById: input.createdById ?? null,
    authoringSource: authoringSourceFor(blueprint),
    // Insert exactly the successor to the version that was edited, so a
    // concurrent edit loses to the primary key instead of landing on top.
    expectedNextVersion: input.baseVersion + 1,
  });

  const applied: Array<{
    path: string;
    restyledItems: number;
    itemsLeft: number;
    itemsBeingEdited: number;
  }> = [];
  if (!saveOnly) {
    const reference = { id: created.id, version: created.version };
    for (const folder of applicable) {
      try {
        await setFolderTemplate(input.handle, folder.id, reference, {
          expectedReference: folder.expectedReference,
          audit: { ...input.actor, actionName: "set_folder_template", targetType: "folder", targetId: folder.id },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes(
            "look changed while this item type was being applied",
          )
        ) {
          conflicted.push({ path: folder.path });
          continue;
        }
        throw error;
      }
      const restyled =
        input.applyToExisting === false
          ? { changed: 0, contested: 0, remaining: 0 }
          : await retemplateFolderItems(input.handle, folder.id, reference, {
              fromReference: { id: input.templateId, version: input.baseVersion },
              audit: (post) => ({ ...input.actor, actionName: "update_item_type_item", targetType: "item", targetId: post.id }),
            });
      applied.push({
        path: folder.path,
        restyledItems: restyled.changed,
        // Restyling stops at a bounded number of items per pass. Reporting
        // only what changed turns a half-finished folder into a finished one.
        itemsLeft: restyled.remaining,
        // And items someone was editing at that moment keep their old look,
        // because their words won. Saying nothing would be the same silent
        // half-finish in a different disguise.
        itemsBeingEdited: restyled.contested,
      });
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

  return {
    definition: created,
    previousVersion: current.version,
    applied,
    skipped,
    conflicted,
  };
}
