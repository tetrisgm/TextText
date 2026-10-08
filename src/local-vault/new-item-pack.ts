import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { writePayload, type VaultTemplateSelection } from "./model";
import { emptyPack, encodePack, type PackAssetAddition } from "./pack";

/** Build before importing: no intermediate blank file or source document is written. */
export function newItemPack(document: DocumentSnapshot, selection: VaultTemplateSelection, assets: readonly PackAssetAddition[] = []): Uint8Array {
  const snapshot = validateDocumentSnapshot(document);
  const template = validateTemplateDefinition(selection.template);
  const source = selection.sourceJSON ? validatedLookSource(template, JSON.parse(selection.sourceJSON)) : undefined;
  if (selection.sourceJSON && !source) throw new Error("Invalid template authoring source.");
  const file = { path: "New item.textpack", hash: "", markdown: `---\ntextTextId: "${crypto.randomUUID()}"\n---\n\n` };
  return encodePack(emptyPack(), writePayload(file, snapshot, { template, sourceJSON: source ? JSON.stringify(source) : null }), assets);
}
