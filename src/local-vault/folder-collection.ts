import { applyCollectionSpec } from "@/lib/documents/collection-query";
import { emptyDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import type { CollectionRenderSpec } from "@/lib/presentation/schema";
import type { VaultItem } from "./bridge";
import { folderForItem } from "./folders";

export type FolderPreview = { title: string; excerpt: string; sourceURL?: string; document?: DocumentSnapshot; metadataTruncated?: boolean; image?: { data: string; contentType: string } };

export function collectionMembers(items: VaultItem[], folder: string, templated: boolean, excludedPath?: string): VaultItem[] {
  return items.filter((item) => item.path !== excludedPath && (folder || templated ? folderForItem(item.path) === folder : !item.path.startsWith("Templates/")));
}

export function queryFolderMembers(items: VaultItem[], previews: Record<string, FolderPreview>, spec: CollectionRenderSpec): VaultItem[] {
  if (spec.sort.some((sort) => ["createdAt", "updatedAt", "publishedAt"].includes(sort.field))) {
    throw new Error("Date sorting is not available for this folder yet. Showing all files in their existing order.");
  }
  if (items.some((item) => previews[item.path]?.metadataTruncated)) throw new Error("Some folder details exceed the query limits. Showing all files without the requested sort or filters.");
  if (items.some((item) => !previews[item.path]?.document)) throw new Error("Some folder details could not be read. Showing all files without the requested sort or filters.");
  return applyCollectionSpec(items.map((item) => ({ ...item, title: previews[item.path].document!.content.title, fields: previews[item.path].document!.content.fields })), spec);
}

/** A display projection only. Original asset bytes never enter collection cards. */
export function collectionDocument(preview: FolderPreview | undefined, fallback: string, thumbnailURL?: string): DocumentSnapshot {
  const document = preview?.document || emptyDocumentSnapshot();
  return { ...document, content: { ...document.content, title: preview?.title || document.content.title || fallback,
    body: preview?.excerpt || document.content.body, assets: thumbnailURL ? [{ id: "folder-thumbnail", kind: "image", src: thumbnailURL, alt: "" }] : [] } };
}
