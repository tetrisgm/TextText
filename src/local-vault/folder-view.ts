import { validatedLookSource } from "@/lib/presentation/template-library";
import type { AuthoringSource } from "@/lib/presentation/authoring-source";
import { emptyDocumentSnapshot, validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition, type TemplateDefinition } from "@/lib/presentation/schema";
import type { VaultFile, VaultItem } from "./bridge";
import { folderForItem } from "./folders";
import { writePayload } from "./model";
import { emptyPack, encodePack, type OpenPack } from "./pack";
import { prepareTemplateProposal } from "./template-proposal";

export const FOLDER_VIEW_FILENAME = "Folder view.textpack";
export const FOLDER_VIEW_FIELD = "texttextFolderView";
export type FolderView = { path: string; hash: string; document: DocumentSnapshot; template: TemplateDefinition };
export type FolderViewMetadata = Pick<VaultFile, "path" | "hash" | "documentJSON" | "templateJSON">;

export function folderViewPath(folder: string): string {
  if (folder && (folder.startsWith("/") || folder.includes("\\") || folder.split("/").some((part) => !part || part === "." || part === "..") || /[\u0000-\u001f]/.test(folder))) {
    throw new Error("Choose an ordinary relative workspace folder.");
  }
  return folder ? `${folder}/${FOLDER_VIEW_FILENAME}` : FOLDER_VIEW_FILENAME;
}

/** Recognition is explicit. A filename alone never turns someone's note into configuration. */
export function readFolderView(file: FolderViewMetadata): FolderView | null {
  if (!file.documentJSON) return null;
  let candidate: unknown;
  try { candidate = JSON.parse(file.documentJSON); } catch { return null; }
  if (!candidate || typeof candidate !== "object" || !("content" in candidate)) return null;
  const content = candidate.content;
  if (!content || typeof content !== "object" || !("fields" in content)) return null;
  const fields = content.fields;
  if (!fields || typeof fields !== "object" || !(FOLDER_VIEW_FIELD in fields)) return null;
  if (fields[FOLDER_VIEW_FIELD] !== "v1") throw new Error("This folder view uses an unsupported definition version.");
  const document = validateDocumentSnapshot(candidate);
  if (!file.templateJSON) throw new Error("The folder view is missing its embedded template.");
  const template = validateTemplateDefinition(JSON.parse(file.templateJSON));
  const reference = document.presentation.template;
  if (reference.id !== template.id || reference.version !== template.version) throw new Error("The folder view and embedded template do not match.");
  return { path: file.path, hash: file.hash, document, template };
}

/** Call with metadata for immediate children; unrelated nested definitions never apply. */
export function resolveFolderView(files: readonly FolderViewMetadata[], folder: string): FolderView | null {
  folderViewPath(folder);
  const views = files.filter((file) => folderForItem(file.path) === folder).map(readFolderView).filter((view): view is FolderView => view !== null);
  if (views.length > 1) throw new Error("This folder contains multiple folder views. Keep one definition in this folder.");
  return views[0] ?? null;
}

export function folderViewMembers<T extends VaultItem>(items: readonly T[], folder: string, view: FolderView | null = null): T[] {
  folderViewPath(folder);
  if (view && folderForItem(view.path) !== folder) throw new Error("This folder view belongs to a different folder.");
  return items.filter((item) => folderForItem(item.path) === folder && item.path !== view?.path);
}

/** Returns a create-only candidate. The transport must reject an existing destination atomically. */
export function createFolderViewPack(folder: string, definition: TemplateDefinition, existing: readonly VaultItem[] = []): { path: string; bytes: Uint8Array } {
  const path = folderViewPath(folder);
  if (existing.some((item) => item.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error("A file already occupies the folder view path. It has not been replaced.");
  const template = validateTemplateDefinition(definition);
  const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
  document.content.title = "Folder view";
  document.content.body = "This file defines how the containing folder is displayed. Editing its design leaves the other files unchanged.";
  document.content.fields[FOLDER_VIEW_FIELD] = "v1";
  const file: VaultFile = { path, hash: "", markdown: `---\ntextTextId: "${crypto.randomUUID()}"\n---\n\n`, templateJSON: JSON.stringify(template) };
  return { path, bytes: encodePack(emptyPack(), writePayload(file, document)) };
}

/** Stage only this definition's replacement; callers still perform a conditional write with expectedHash. */
export function updateFolderViewPack(pack: OpenPack, expectedHash: string, definition: TemplateDefinition): { path: string; expectedHash: string; bytes: Uint8Array } {
  if (pack.file.hash !== expectedHash) throw new Error("The folder view changed. Read it again before keeping this design.");
  const view = readFolderView(pack.file);
  if (!view) throw new Error("Choose an explicitly marked folder view file.");
  const template = validateTemplateDefinition(definition);
  const { payload } = prepareTemplateProposal(pack.file, { path: view.path, hash: expectedHash, templateJSON: JSON.stringify(template) });
  return { path: view.path, expectedHash, bytes: encodePack(pack, explicitFolderDesignPayload(payload)) };
}

export const FOLDER_DEFAULT_FIELD = "texttextFolderDefault";
export const FOLDER_STANDARD_LAYOUT_FIELD = "texttextFolderStandardLayout";
export type FolderItemDefault = { version: 1; template: TemplateDefinition; authoringSource?: AuthoringSource };
export function readFolderItemDefault(view: FolderView | null): FolderItemDefault | null {
  const raw = view?.document.content.fields[FOLDER_DEFAULT_FIELD];
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length > 1_000_000) throw new Error("Invalid folder item default");
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || Object.keys(value).some(key => !["version", "template", "authoringSource"].includes(key))) throw new Error("Unsupported folder item default");
  const template = validateTemplateDefinition(value.template);
  const authoringSource = value.authoringSource === undefined ? undefined : validatedLookSource(template, value.authoringSource);
  if (value.authoringSource !== undefined && !authoringSource) throw new Error("Invalid folder template source");
  return { version: 1, template, ...(authoringSource ? { authoringSource } : {}) };
}
export function folderCollectionTemplate(view: FolderView | null): TemplateDefinition | undefined {
  return view?.document.content.fields[FOLDER_STANDARD_LAYOUT_FIELD] === "v1" ? undefined : view?.template;
}

export function explicitFolderDesignPayload<T extends { documentJSON?: string | null }>(payload: T): T {
  if (!payload.documentJSON) throw new Error("Folder design document is missing");
  const document = validateDocumentSnapshot(JSON.parse(payload.documentJSON));
  delete document.content.fields[FOLDER_STANDARD_LAYOUT_FIELD];
  return { ...payload, documentJSON: JSON.stringify(document) };
}
