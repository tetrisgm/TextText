import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { openPack } from "@/local-vault/pack";
import { readDocument, readTemplate } from "@/local-vault/model";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "./item-type-blueprint";
import { authoringSourceFor, type AuthoringSource } from "./authoring-source";
import { validatedLookSource } from "./template-library";
import { validateTemplateDefinition } from "./schema";
export type VaultTemplateCreation = { blueprint: unknown } | { sourceItemId: string; sourceHash: string; name: string };
/** A look contains presentation and declared example content, never the source's private body/assets. */
export function buildVaultTemplateArtifact(itemId: string, creation: VaultTemplateCreation, source?: { bytes: Uint8Array; relativePath: string; revision: string }) {
  const identity = { id: `local.${itemId}`, version: 1 };
  let template; let authoring: AuthoringSource | undefined;
  if ("blueprint" in creation) {
    const blueprint = itemTypeBlueprintSchema.parse(creation.blueprint);
    template = compileItemTypeBlueprint(blueprint, identity);
    authoring = authoringSourceFor(blueprint);
  } else {
    if (!source) throw new Error("Template source is unavailable");
    const file = openPack(source.bytes, source.relativePath, source.revision, creation.sourceItemId).file;
    const document = readDocument(file), original = readTemplate(file, document);
    const originalSource = file.templateAuthoringSourceJSON ? validatedLookSource(original, JSON.parse(file.templateAuthoringSourceJSON)) : undefined;
    const theme = { ...original.theme, ...document.presentation.theme };
    if (originalSource) {
      authoring = authoringSourceFor({ ...originalSource.blueprint, name: creation.name, theme });
      template = compileItemTypeBlueprint(authoring.blueprint, identity);
    } else template = validateTemplateDefinition({ ...original, ...identity, name: creation.name, theme });
  }
  if (authoring) validatedLookSource(template, authoring);
  const document = emptyDocumentSnapshot(identity);
  document.content = { ...document.content, ...(template.example ?? {}), title: template.name };
  return { template, bytes: buildTextpack("Template", { document, template, templateAuthoringSource: authoring,
    markdown: `---\ntextTextId: ${itemId}\ntitle: ${JSON.stringify(template.name)}\n---\n\n${document.content.body}` }) };
}
