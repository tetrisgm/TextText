import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { packIdentity } from "./pack";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema, ITEM_TYPE_BLUEPRINT_COMPILER_VERSION } from "@/lib/presentation/item-type-blueprint";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { assertCompatibleItemTypeFields } from "@/lib/presentation/item-type-update";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { readTemplate, readDocument } from "./model";
import { prepareTemplateProposal } from "./template-proposal";
import type { VaultFile } from "./bridge";

/** The persisted command is previewed only. Approval still executes its original server ID. */
export function prepareTemplateCommandPreview(tool: string, args: Record<string, unknown>, target: VaultFile, source?: VaultFile) {
  if (JSON.stringify(args).length > 1_000_000) throw new Error("This design is too large to preview.");
  let template;
  let sourceJSON: string | null = null;
  if (tool === "set_item_template") {
    if (packIdentity(target.markdown) !== args.id || target.hash !== args.if_match_hash) throw new Error("This file changed. Ask for a new proposal.");
    if (args.source_item_id !== undefined || args.source_hash !== undefined) {
      if (!source || packIdentity(source.markdown) !== args.source_item_id || source.hash !== args.source_hash) throw new Error("The template source changed. Ask for a new proposal.");
      template = readTemplate(source, readDocument(source));
      sourceJSON = source.templateAuthoringSourceJSON ?? null;
      if (template.id !== args.template_id || args.template_version !== undefined && template.version !== args.template_version) throw new Error("The template version changed. Ask for a new proposal.");
    } else {
      template = typeof args.template_id === "string" ? getBuiltinTemplate(args.template_id, typeof args.template_version === "number" ? args.template_version : undefined) : null;
      if (!template) throw new Error("The selected template is unavailable.");
    }
  } else if (tool === "create_item_type") {
    const blueprint = itemTypeBlueprintSchema.parse(args.blueprint);
    template = compileItemTypeBlueprint(blueprint, { id: "local.preview", version: 1 });
    sourceJSON = JSON.stringify({ kind: "item-type-blueprint", schemaVersion: 1, compilerVersion: ITEM_TYPE_BLUEPRINT_COMPILER_VERSION, blueprint });
  } else if (tool === "update_item_type") {
    if (!source || source.hash !== args.source_hash || !source.path.startsWith("Templates/")) throw new Error("The template source changed. Ask for a new proposal.");
    const original = readTemplate(source, readDocument(source));
    if (original.id !== args.template_id || original.version !== args.base_version) throw new Error("The template version changed. Ask for a new proposal.");
    const authored = source.templateAuthoringSourceJSON ? validatedLookSource(original, JSON.parse(source.templateAuthoringSourceJSON)) : null;
    if (source.templateAuthoringSourceJSON && !authored) throw new Error("Invalid template authoring source.");
    if (authored) {
      if (args.definition !== undefined) throw new Error("Update this template using its blueprint.");
      const blueprint = itemTypeBlueprintSchema.parse(args.blueprint);
      template = compileItemTypeBlueprint(blueprint, { id: original.id, version: original.version + 1 });
      sourceJSON = JSON.stringify({ kind: "item-type-blueprint", schemaVersion: 1, compilerVersion: ITEM_TYPE_BLUEPRINT_COMPILER_VERSION, blueprint });
    } else {
      if (args.blueprint !== undefined) throw new Error("Update this look using its definition.");
      const definition = validateTemplateDefinition(args.definition);
      if (definition.id !== original.id || definition.version !== original.version) throw new Error("The template identity changed.");
      template = validateTemplateDefinition({ ...definition, version: original.version + 1 });
    }
    assertCompatibleItemTypeFields(original.fields, template.fields);
  } else throw new Error("This command has no template preview.");
  const proposal = { path: target.path, hash: target.hash, templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: sourceJSON };
  // A blueprint source is validated above; prepareTemplateProposal also validates the rendered definition.
  const prepared = prepareTemplateProposal(target, proposal);
  return { ...prepared, proposal };
}
