import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { writePayload, type VaultTemplateSelection } from "./model";
import { emptyPack, encodePack, type PackAssetAddition } from "./pack";

const MAX_NEW_ITEM_BYTES = 32 * 1024 * 1024;
const sizeError = () => new Error("This item is larger than 32 MiB. Use smaller attachments.");

/** Build before importing: no intermediate blank file or source document is written. */
export function newItemPack(document: DocumentSnapshot, selection: VaultTemplateSelection, assets: readonly PackAssetAddition[] = []): Uint8Array {
  // Avoid allocating a ZIP that cannot fit any of the native/web import bridges.
  if (assets.reduce((total, asset) => total + asset.data.byteLength, 0) >= MAX_NEW_ITEM_BYTES) throw sizeError();
  const snapshot = validateDocumentSnapshot(document);
  const template = validateTemplateDefinition(selection.template);
  const source = selection.sourceJSON ? validatedLookSource(template, JSON.parse(selection.sourceJSON)) : undefined;
  if (selection.sourceJSON && !source) throw new Error("Invalid template authoring source.");
  const file = { path: "New item.textpack", hash: "", markdown: `---\ntextTextId: "${crypto.randomUUID()}"\n---\n\n` };
  const bytes = encodePack(emptyPack(), writePayload(file, snapshot, { template, sourceJSON: source ? JSON.stringify(source) : null }), assets);
  if (bytes.byteLength > MAX_NEW_ITEM_BYTES) throw sizeError();
  return bytes;
}
