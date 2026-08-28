import { randomUUID } from "node:crypto";
import { recordAction, type AuditEntry } from "@/lib/audit";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  createDocumentTemplateVersion,
  getFolderByPath,
  retemplateFolderItems,
  setFolderTemplate,
} from "@/lib/store";
import {
  compileItemTypeBlueprint,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
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

  const definition = compileItemTypeBlueprint(input.blueprint, {
    id: identifier(input.blueprint.name),
  });
  const created = await createDocumentTemplateVersion({
    blogId: input.blogId,
    definition,
    actor: input.actor,
    createdById: input.createdById ?? null,
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
