import { BUILTIN_TEMPLATES } from "./templates";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { openPack } from "@/local-vault/pack";
import { readDocument, readTemplate } from "@/local-vault/model";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "./item-type-blueprint";
import { authoringSourceFor, type AuthoringSource } from "./authoring-source";
import { validatedLookSource } from "./template-library";
import { validateTemplateDefinition } from "./schema";
import { assertCompatibleItemTypeFields } from "./item-type-update";
export type VaultTemplateCreation = { builtinTemplateId: string; builtinTemplateVersion: number; name: string } | { sourceItemId: string; sourceHash: string; remix: { templateId: string; templateVersion: number; name: string } } | { blueprint: unknown } | { sourceItemId: string; sourceHash: string; name: string } | { sourceItemId: string; sourceHash: string; update: { templateId: string; baseVersion: number; blueprint?: unknown; definition?: unknown } };
/** A look contains presentation and declared example content, never the source's private body/assets. */
export function buildVaultTemplateArtifact(itemId: string, creation: VaultTemplateCreation, source?: { bytes: Uint8Array; relativePath: string; revision: string }) {
  let identity = { id: `local.${itemId}`, version: 1 };
  let template; let authoring: AuthoringSource | undefined;
  if ("builtinTemplateId" in creation) {
    const original = BUILTIN_TEMPLATES.find(value => value.id === creation.builtinTemplateId && value.version === creation.builtinTemplateVersion);
    if (!original) throw new Error("Choose an exact built-in template version");
    template = validateTemplateDefinition({ ...original, ...identity, name: creation.name });
  } else if ("blueprint" in creation) {
    const blueprint = itemTypeBlueprintSchema.parse(creation.blueprint);
    template = compileItemTypeBlueprint(blueprint, identity);
    authoring = authoringSourceFor(blueprint);
  } else {
    if (!source) throw new Error("Template source is unavailable");
    const file = openPack(source.bytes, source.relativePath, source.revision, creation.sourceItemId).file;
    const document = readDocument(file), original = readTemplate(file, document);
    const originalSource = file.templateAuthoringSourceJSON ? validatedLookSource(original, JSON.parse(file.templateAuthoringSourceJSON)) : undefined;
    if ("remix" in creation) {
      if (!source.relativePath.startsWith("Templates/") || original.id !== creation.remix.templateId || original.version !== creation.remix.templateVersion) throw new Error("Read the exact workspace template version before remixing it");
      template = validateTemplateDefinition({ ...original, ...identity, name: creation.remix.name });
      if (originalSource) {
        authoring = authoringSourceFor({ ...originalSource.blueprint, name: creation.remix.name });
        // Generated description/example labels follow the new blueprint name;
        // its fields, layouts, theme and explicit starter remain unchanged.
        template = compileItemTypeBlueprint(authoring.blueprint, identity);
      }
    } else if ("update" in creation) {
      const change = creation.update;
      if (!source.relativePath.startsWith("Templates/") || original.id.startsWith("texttext.") || original.id !== change.templateId || original.version !== change.baseVersion || !Number.isSafeInteger(change.baseVersion) || change.baseVersion < 1 || change.baseVersion >= Number.MAX_SAFE_INTEGER) throw new Error("Read the current workspace template version before updating it");
      identity = { id: original.id, version: original.version + 1 };
      if (originalSource) {
        if (change.blueprint === undefined || change.definition !== undefined) throw new Error("Update this authored template using its complete blueprint");
        const blueprint = itemTypeBlueprintSchema.parse(change.blueprint);
        authoring = authoringSourceFor(blueprint);
        template = compileItemTypeBlueprint(blueprint, identity);
      } else {
        if (change.definition === undefined || change.blueprint !== undefined) throw new Error("Update this look using its complete definition");
        const definition = validateTemplateDefinition(change.definition);
        if (definition.id !== original.id || definition.version !== original.version) throw new Error("Keep the template identity and base version unchanged");
        template = validateTemplateDefinition({ ...definition, ...identity });
      }
      assertCompatibleItemTypeFields(original.fields, template.fields);
    } else {
      const theme = { ...original.theme, ...document.presentation.theme };
      if (originalSource) {
        authoring = authoringSourceFor({ ...originalSource.blueprint, name: creation.name, theme });
        template = compileItemTypeBlueprint(authoring.blueprint, identity);
      } else template = validateTemplateDefinition({ ...original, ...identity, name: creation.name, theme });
    }
  }
  if (authoring) validatedLookSource(template, authoring);
  const document = emptyDocumentSnapshot(identity);
  document.content = { ...document.content, ...(template.example ?? {}), title: template.name };
  return { template, bytes: buildTextpack("Template", { document, template, templateAuthoringSource: authoring,
    markdown: `---\ntextTextId: ${itemId}\ntitle: ${JSON.stringify(template.name)}\n---\n\n${document.content.body}` }) };
}
