import { readFolderItemDefault, resolveFolderView, type FolderViewMetadata } from "./folder-view";
import { vaultRequest, type VaultFile, type VaultListing, type VaultTransport } from "./bridge";
import { readDocument } from "./model";
import { isTemplateRetirementPath, parseTemplateRetirement } from "@/lib/presentation/template-retirement";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export function folderStarter(template: TemplateDefinition | undefined, explicit: { title?: string; body?: string; fields?: Record<string, string | number | boolean | null> }) {
  return { title: explicit.title ?? template?.starter?.title ?? "", body: explicit.body ?? template?.starter?.body ?? "", fields: { ...template?.starter?.fields, ...explicit.fields } };
}
/** Resolve before creating anything, so malformed or retired defaults cannot leave a draft. */
export async function loadFolderItemDefault(folder: string, listing: VaultListing | null, request: VaultTransport = vaultRequest) {
  const { files } = await request("folderViews", { folder }) as { files: FolderViewMetadata[] };
  const chosen = readFolderItemDefault(resolveFolderView(files, folder));
  if (!chosen) return null;
  const records = listing?.items.filter(item => isTemplateRetirementPath(item.path)) ?? [];
  if (records.length > 256) throw new Error("Template retirement list exceeds limits");
  for (const item of records) {
    const file = await request("read", { path: item.path }) as VaultFile;
    const document = readDocument(file);
    if (document.content.fields.texttextRecordType !== "template-retirement") throw new Error("Invalid template retirement record");
    if (parseTemplateRetirement(document.content.body).templateId === chosen.template.id) throw new Error("This folder's default template is retired. Choose another template.");
  }
  return chosen;
}
